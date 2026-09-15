/**
 * The DOMAIN sendTelegram tool tells the truth about completion.
 *
 * Before 2026-09-15 the tool's dedupe branch returned `sent: true` from the
 * mere existence of a claim marker, and a transport timeout was folded into
 * `false` (a "known failure") which released the marker and let a retry
 * double-send. Since the same day the tool is the first consumer of the
 * DURABLE delegation contract (action_attempts): the claim is a row with a
 * state machine, the provider's message id is recorded on it, and the model
 * sees attemptId + ledgerState. Drives the REAL tool with a mocked durable
 * store, a mocked bridge store (for the missing-table fallback) and a mocked
 * observed transport: positive control first, then every state the model can
 * now see, and the things that must never happen again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const actionAttempt = { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() };
const brainMemory = { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn() };
vi.mock("@/lib/prisma", () => ({ prisma: { actionAttempt, brainMemory } }));

const sendTelegramObserved = vi.fn();
vi.mock("@/lib/services/telegram-observed", () => ({ sendTelegramObserved }));

import { socialTools } from "@/lib/ai/tools/social";

type Exec = (input: { message: string; title?: string; urgency: "low" | "medium" | "high" }, opts: unknown) => Promise<{
  sent: boolean;
  state: string;
  deduped?: boolean;
  priorState?: string;
  priorAttemptState?: string;
  attemptId?: string;
  ledgerState?: string;
  error?: string;
  messageId?: number;
}>;
const run = (input: Parameters<Exec>[0]) =>
  (socialTools.sendTelegram.execute as unknown as Exec)(input, { toolCallId: "t1", messages: [] });

/** The attempt row as settle() reads it back after a successful claim. */
const executing = () => ({ state: "EXECUTING", holdUntil: new Date(Date.now() + 5 * 60_000) });
/** The prior row begin() reads back after a unique-key conflict. */
const prior = (state: string, holdMs = 60_000) => ({ id: "a-prior", state, attemptNo: 1, holdUntil: new Date(Date.now() + holdMs) });

beforeEach(() => {
  vi.clearAllMocks();
  actionAttempt.create.mockResolvedValue({ id: "a1", attemptNo: 1 });
  actionAttempt.findUnique.mockResolvedValue(executing());
  actionAttempt.update.mockResolvedValue({});
  brainMemory.create.mockResolvedValue({});
  brainMemory.findUnique.mockResolvedValue(null);
  brainMemory.update.mockResolvedValue({});
  brainMemory.deleteMany.mockResolvedValue({ count: 1 });
});

const settledTo = () => actionAttempt.update.mock.calls.map((c) => c[0]?.data?.state).filter(Boolean);

describe("sendTelegram tool · completion truth (durable ActionAttempt)", () => {
  it("positive control: a provider receipt is the only way to get sent:true, and it settles SUCCEEDED_UNVERIFIED with the message id", async () => {
    sendTelegramObserved.mockResolvedValueOnce({ state: "provider_accepted", messageId: 42 });
    const r = await run({ message: "hi", urgency: "medium" });
    expect(r).toMatchObject({ sent: true, state: "provider_accepted", messageId: 42, attemptId: "a1", ledgerState: "SUCCEEDED_UNVERIFIED" });
    expect(r.error).toBeUndefined();
    const claim = actionAttempt.create.mock.calls[0][0].data;
    expect(claim).toMatchObject({ tool: "sendTelegram", effectClass: "write", state: "EXECUTING" });
    expect(claim.operationKey).toMatch(/^sendTelegram:[0-9a-f]{16}$/);
    expect(settledTo()).toEqual(["SUCCEEDED_UNVERIFIED"]);
    expect(actionAttempt.update.mock.calls[0][0].data.externalReference).toBe("telegram:message:42");
    expect(brainMemory.create).not.toHaveBeenCalled(); // the bridge is not consulted when the ledger answers
  });

  it("an EXECUTING/accepted prior attempt inside its hold window is NOT a receipt: suppressed, sent:false, prior state named", async () => {
    actionAttempt.create.mockRejectedValueOnce({ code: "P2002" });
    actionAttempt.findUnique.mockResolvedValueOnce(prior("SUCCEEDED_UNVERIFIED"));
    const r = await run({ message: "hi", urgency: "medium" });
    expect(sendTelegramObserved).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, state: "duplicate_suppressed", deduped: true, priorState: "claimed", priorAttemptState: "SUCCEEDED_UNVERIFIED", attemptId: "a-prior" });
    expect(r.error).toMatch(/already claimed/);
    expect(actionAttempt.update).not.toHaveBeenCalled();
  });

  it("a prior UNKNOWN attempt is surfaced as such — never retried, never called sent", async () => {
    actionAttempt.create.mockRejectedValueOnce({ code: "P2002" });
    actionAttempt.findUnique.mockResolvedValueOnce(prior("UNKNOWN", 30 * 60_000));
    const r = await run({ message: "hi", urgency: "high" });
    expect(sendTelegramObserved).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, state: "duplicate_suppressed", priorState: "unknown", priorAttemptState: "UNKNOWN" });
    expect(r.error).toMatch(/unknown completion/);
  });

  it("a FAILED prior attempt is re-claimable: attempt 2 runs", async () => {
    actionAttempt.create.mockRejectedValueOnce({ code: "P2002" });
    actionAttempt.findUnique.mockResolvedValueOnce({ id: "a-prior", state: "FAILED", attemptNo: 1, holdUntil: null });
    actionAttempt.update.mockResolvedValueOnce({ id: "a-prior", attemptNo: 2 }); // the re-claim
    sendTelegramObserved.mockResolvedValueOnce({ state: "provider_accepted", messageId: 7 });
    const r = await run({ message: "hi", urgency: "medium" });
    expect(r).toMatchObject({ sent: true, attemptId: "a-prior", ledgerState: "SUCCEEDED_UNVERIFIED" });
    expect(actionAttempt.update.mock.calls[0][0].data).toMatchObject({ state: "EXECUTING", attemptNo: 2 });
  });

  it("a transport timeout is UNKNOWN completion: sent:false, an error the model sees, the row settles UNKNOWN and stays held (no blind retry)", async () => {
    sendTelegramObserved.mockResolvedValueOnce({ state: "unknown_completion", reason: "TimeoutError" });
    const r = await run({ message: "hi", urgency: "medium" });
    expect(r).toMatchObject({ sent: false, state: "unknown_completion", ledgerState: "UNKNOWN", attemptId: "a1" });
    expect(r.error).toMatch(/unknown/);
    expect(settledTo()).toEqual(["UNKNOWN"]);
    const hold = actionAttempt.update.mock.calls[0][0].data.holdUntil as Date;
    expect(hold.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000); // the 30-minute unknown fence
  });

  it("an explicit provider rejection is a KNOWN failure: sent:false, the row settles FAILED and the hold is released so a real retry can run", async () => {
    sendTelegramObserved.mockResolvedValueOnce({ state: "known_failure", reason: "telegram_http_400", status: 400 });
    const r = await run({ message: "hi", urgency: "low" });
    expect(r).toMatchObject({ sent: false, state: "known_failure", ledgerState: "FAILED" });
    expect(r.error).toMatch(/failed/);
    expect(settledTo()).toEqual(["FAILED"]);
    expect(actionAttempt.update.mock.calls[0][0].data.holdUntil).toBeNull();
  });

  it("fails CLOSED when the durable store is down: no send, an honest state", async () => {
    actionAttempt.create.mockRejectedValueOnce(new Error("db down"));
    const r = await run({ message: "hi", urgency: "medium" });
    expect(sendTelegramObserved).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, state: "idempotency_unavailable" });
    expect(r.error).toMatch(/unavailable/);
  });

  it("falls back to the BrainMemory bridge when the action_attempts table does not exist (never crash on a missing table)", async () => {
    actionAttempt.create.mockRejectedValueOnce({ code: "P2021", message: 'relation "action_attempts" does not exist' });
    sendTelegramObserved.mockResolvedValueOnce({ state: "provider_accepted", messageId: 9 });
    const r = await run({ message: "hi", urgency: "medium" });
    expect(r).toMatchObject({ sent: true, state: "provider_accepted", messageId: 9 });
    expect(r.attemptId).toBeUndefined(); // the ledger did not answer
    expect(brainMemory.create).toHaveBeenCalledOnce(); // the bridge did
  });
});
