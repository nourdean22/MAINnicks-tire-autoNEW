/**
 * ROS-058 · the persist → obligation transaction window.
 *
 * The durable-response spine exists to guarantee one thing: "a customer who texted
 * us will be answered even if this process dies." That guarantee was defeated at
 * the entry point. In the SMS gateway webhook the message INSERT was awaited but
 * the obligation INSERT rode a fire-and-forget block that ran AFTER res.status(200),
 * so a restart in between left a persisted text with no duty to answer it — and the
 * webhook's dedupe, keyed on the MESSAGE row rather than the OBLIGATION row, then
 * discarded the only redelivery that could have created one.
 *
 * These tests pin the four decisions that close it:
 *   1. one key derivation, so an existence check can never look up the wrong row;
 *   2. a transient obligation failure THROWS, so the webhook can return 5xx and let
 *      the provider redeliver (silently degrading is what hid ROS-059 for 4 days);
 *   3. a genuinely absent table degrades instead of throwing, so a deploy-state
 *      problem cannot spin at-least-once redelivery into a retry storm;
 *   4. answering an obligation whose claim is lost sends NOTHING — the claim guard,
 *      not the existence check, is what prevents a second reply to one text.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const h = vi.hoisted(() => ({ getDb: vi.fn(), orchestrate: vi.fn() }));

vi.mock("./db", () => ({ getDb: h.getDb, getOrCreateConversation: vi.fn() }));
vi.mock("./services/smsOrchestrator", () => ({
  orchestrateSms: (...a: unknown[]) => h.orchestrate(...a),
}));

import {
  providerMsgIdempotencyKey,
  responseIdempotencyKey,
  ensureResponseObligation,
  answerResponseObligation,
  responseObligationExistsForProviderMsg,
} from "./services/smsResponseJobs";

/** mysql2 resolves a write to [ResultSetHeader, FieldPacket[]]. */
const writeResult = (affectedRows: number) => [{ affectedRows }, []];
/** ...and a read to [rows, FieldPacket[]]. */
const readResult = (rows: unknown[]) => [rows, []];

const INPUT = { conversationId: 7, phone: "+12165550100", providerMsgId: "SM-abc", body: "225/50R17" };

afterEach(() => {
  // singleFork shares ONE process across files — leaked mock state resurfaces as
  // an unrelated failure elsewhere (apps/nickstire/AGENTS.md §3).
  h.getDb.mockReset();
  h.orchestrate.mockReset();
});

describe("providerMsgIdempotencyKey — one derivation, so a lookup can't miss the row", () => {
  it("matches responseIdempotencyKey for the same provider message id", () => {
    // The pin that matters: if the derivation ever starts consuming conversationId,
    // phone or body, this fails loudly instead of the existence check silently
    // querying a key that no row was ever written under — which would report
    // "obligation missing" forever and re-answer customers on every redelivery.
    expect(providerMsgIdempotencyKey("SM-abc")).toBe(responseIdempotencyKey(INPUT));
  });

  it("is independent of the conversation the message belongs to", () => {
    const a = responseIdempotencyKey({ ...INPUT, conversationId: 1 });
    const b = responseIdempotencyKey({ ...INPUT, conversationId: 99999 });
    expect(a).toBe(b);
    expect(a).toBe(providerMsgIdempotencyKey("SM-abc"));
  });
});

describe("ensureResponseObligation — the webhook's transaction boundary", () => {
  it("THROWS on a transient failure so the caller can 5xx and let the provider redeliver", async () => {
    // The whole point of the fix. Swallowing this is what left a persisted text
    // with nobody obligated to answer it.
    h.getDb.mockResolvedValue({ execute: vi.fn().mockRejectedValue(new Error("ETIMEDOUT")) });
    await expect(ensureResponseObligation(INPUT)).rejects.toThrow("ETIMEDOUT");
  });

  it("degrades (no throw) when the table is genuinely absent — errno 1146", async () => {
    // A missing table is a deploy-state problem retrying cannot fix; 5xx here would
    // only spin Capevace's at-least-once redelivery into a storm.
    const err = Object.assign(new Error("Table 'sms_response_jobs' doesn't exist"), { errno: 1146 });
    h.getDb.mockResolvedValue({ execute: vi.fn().mockRejectedValue(err) });
    await expect(ensureResponseObligation(INPUT)).resolves.toEqual({
      jobId: null,
      durable: false,
      created: false,
    });
  });

  it("degrades when there is no database at all, reporting NOT durable", async () => {
    h.getDb.mockResolvedValue(null);
    const handle = await ensureResponseObligation(INPUT);
    expect(handle.durable).toBe(false);
    expect(handle.jobId).toBeNull();
  });

  it("reports a durable handle once the row exists", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(writeResult(1)) // INSERT IGNORE → inserted
      .mockResolvedValueOnce(readResult([{ id: 42 }])); // SELECT id
    h.getDb.mockResolvedValue({ execute });
    await expect(ensureResponseObligation(INPUT)).resolves.toEqual({
      jobId: 42,
      durable: true,
      created: true,
    });
  });

  it("reports created:false for a redelivery that deduped onto the existing row", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(writeResult(0)) // INSERT IGNORE → key already present
      .mockResolvedValueOnce(readResult([{ id: 42 }]));
    h.getDb.mockResolvedValue({ execute });
    const handle = await ensureResponseObligation(INPUT);
    expect(handle).toEqual({ jobId: 42, durable: true, created: false });
  });
});

describe("answerResponseObligation — the claim guard is what prevents a second reply", () => {
  it("sends NOTHING when the claim is lost (already answered, or another worker owns it)", async () => {
    // claimJobById's guarded UPDATE matches only pending/stale rows, so re-running
    // an answered job is a no-op. This is why healing a redelivery is safe.
    h.getDb.mockResolvedValue({ execute: vi.fn().mockResolvedValue(writeResult(0)) });
    await answerResponseObligation({ jobId: 42, durable: true, created: false }, INPUT);
    expect(h.orchestrate).not.toHaveBeenCalled();
  });

  it("falls back to answering in-process when the obligation is not durable", async () => {
    // Preserves the pre-spine behavior exactly: an inbound is never dropped just
    // because the durability layer is unavailable.
    h.orchestrate.mockResolvedValue({ status: "sent" });
    await answerResponseObligation({ jobId: null, durable: false, created: false }, INPUT);
    expect(h.orchestrate).toHaveBeenCalledWith({
      type: "inbound_sms",
      phone: INPUT.phone,
      body: INPUT.body,
      conversationId: INPUT.conversationId,
    });
  });
});

describe("responseObligationExistsForProviderMsg — undeterminable is not 'missing'", () => {
  it("returns null (not false) when the database is unavailable", async () => {
    // false would mean "heal", i.e. re-answer the customer on every redelivery
    // whenever the DB hiccups. Undeterminable must stay undeterminable.
    h.getDb.mockResolvedValue(null);
    expect(await responseObligationExistsForProviderMsg("SM-abc")).toBeNull();
  });

  it("returns null when the query itself fails", async () => {
    h.getDb.mockResolvedValue({ execute: vi.fn().mockRejectedValue(new Error("ECONNRESET")) });
    expect(await responseObligationExistsForProviderMsg("SM-abc")).toBeNull();
  });

  it("returns null for an empty provider id rather than guessing", async () => {
    expect(await responseObligationExistsForProviderMsg("")).toBeNull();
  });

  it("returns true when a row exists and false when the obligation is genuinely absent", async () => {
    h.getDb.mockResolvedValue({ execute: vi.fn().mockResolvedValue(readResult([{ id: 42 }])) });
    expect(await responseObligationExistsForProviderMsg("SM-abc")).toBe(true);

    h.getDb.mockResolvedValue({ execute: vi.fn().mockResolvedValue(readResult([])) });
    expect(await responseObligationExistsForProviderMsg("SM-abc")).toBe(false);
  });
});
