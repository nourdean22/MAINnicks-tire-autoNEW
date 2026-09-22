/**
 * `createVoicePromise` — a shop COMMITMENT becomes a promise; a customer
 * REQUEST does not, and a promise never invents its own deadline.
 *
 * The Promise Ledger existed, was wired to a router, a UI panel and the
 * morning brief — and had no voice writer at all. Every promise in it had to be
 * typed by hand by the operator, while the highest-volume source of promises in
 * the business (Nick offering a callback on a live call) recorded nothing.
 *
 * The two refusals below are the load-bearing behaviour, not edge cases:
 *
 *   - NO DERIVABLE DUE TIME → NO PROMISE. `due_at` is what kept-vs-missed is
 *     scored against, so a fabricated deadline manufactures a breach the shop
 *     never agreed to.
 *   - IDEMPOTENT ON THE CALL ID. VAPI redelivers webhooks; without a guard one
 *     promise becomes three and the kept-rate denominator silently inflates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
const getDb = vi.fn(async () => ({ execute }));

vi.mock("../db", () => ({ getDb: () => getDb() }));

/** Rows come back from mysql2 as [rows, fields]. */
const asRows = (rows: unknown[]) => [rows, []];

beforeEach(() => {
  execute.mockReset();
  getDb.mockClear();
  getDb.mockImplementation(async () => ({ execute }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DUE = new Date("2026-09-23T12:00:00Z");

async function subject() {
  return (await import("../services/promiseLedger")).createVoicePromise;
}

describe("it refuses to invent a deadline", () => {
  it("a null dueAt is SKIPPED, not defaulted to some arbitrary time", async () => {
    const createVoicePromise = await subject();
    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_1",
      dueAt: null,
    });
    expect(res).toEqual({ ok: false, skipped: true, reason: "no_due_time" });
    // The critical assertion: it must not have touched the database at all.
    expect(execute).not.toHaveBeenCalled();
  });

  it("a missing call id is SKIPPED — no idempotency key means no safe write", async () => {
    const createVoicePromise = await subject();
    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "",
      dueAt: DUE,
    });
    expect(res).toEqual({ ok: false, skipped: true, reason: "no_call_id" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("it is idempotent on the call", () => {
  it("a second delivery of the same call returns the EXISTING id and inserts nothing", async () => {
    const createVoicePromise = await subject();
    // First execute() is the dedupe SELECT, and it finds a row.
    execute.mockResolvedValueOnce(asRows([{ id: "existing-uuid" }]));

    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_dup",
      dueAt: DUE,
    });

    expect(res).toEqual({ ok: true, id: "existing-uuid", created: false, reason: "duplicate" });
    // Exactly one statement ran — the SELECT. No INSERT followed.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("a first delivery DOES insert", async () => {
    const createVoicePromise = await subject();
    execute
      .mockResolvedValueOnce(asRows([]))   // dedupe SELECT → nothing
      .mockResolvedValueOnce(asRows([]));  // INSERT

    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_new",
      dueAt: DUE,
    });

    expect(res).toMatchObject({ ok: true, created: true });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("POSITIVE CONTROL: duplicate and first-delivery take DIFFERENT paths", async () => {
    // Without this, a function that always returned `duplicate` would satisfy
    // the dedupe test, and one that always inserted would satisfy the other.
    const createVoicePromise = await subject();

    execute.mockResolvedValueOnce(asRows([{ id: "x" }]));
    const dup = await createVoicePromise({
      promiseType: "callback", promisedAction: "a", vapiCallId: "c1", dueAt: DUE,
    });

    execute.mockReset();
    execute.mockResolvedValueOnce(asRows([])).mockResolvedValueOnce(asRows([]));
    const fresh = await createVoicePromise({
      promiseType: "callback", promisedAction: "a", vapiCallId: "c2", dueAt: DUE,
    });

    expect((dup as { created: boolean }).created).toBe(false);
    expect((fresh as { created: boolean }).created).toBe(true);
  });
});

describe("it degrades rather than breaking the call", () => {
  it("an unavailable DB returns an error object, never throws", async () => {
    const createVoicePromise = await subject();
    getDb.mockImplementation(async () => null as unknown as { execute: typeof execute });
    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_nodb",
      dueAt: DUE,
    });
    expect(res).toEqual({ ok: false, error: "DB unavailable" });
  });

  it("the un-applied 0102 table is reported, not thrown", async () => {
    const createVoicePromise = await subject();
    const missing = Object.assign(new Error("Table 'customer_promises' doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
    });
    execute.mockRejectedValueOnce(missing);
    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_notable",
      dueAt: DUE,
    });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain("0102");
  });
});
