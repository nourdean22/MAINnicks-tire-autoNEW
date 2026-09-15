/**
 * ActionAttempt — the durable delegation contract (2026-09-15).
 *
 * Pure state machine + the claim/settle protocol over a mocked
 * prisma.actionAttempt. Break-it-first: an illegal transition must throw,
 * a duplicate inside the hold window must NOT be re-claimed, and a missing
 * table must be recognisable so the caller can fall back to the bridge.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ACTIVE_STATES,
  beginAttempt,
  canTransition,
  compensateAttempt,
  isDuplicate,
  isMissingTableError,
  settleAttempt,
  verifyAttempt,
  TRANSITIONS,
  type AttemptState,
} from "@/lib/services/action-attempts";

const actionAttempt = { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
const prisma = { actionAttempt } as never;
const NOW = new Date("2026-09-15T18:00:00.000Z");
const deps = { prisma, now: () => NOW };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("state machine", () => {
  it("only VERIFIED is reachable through reconciliation, never straight from EXECUTING", () => {
    expect(canTransition("EXECUTING", "VERIFIED")).toBe(false);
    expect(canTransition("SUCCEEDED_UNVERIFIED", "VERIFIED")).toBe(true);
    expect(canTransition("UNKNOWN", "VERIFIED")).toBe(true);
  });

  it("UNKNOWN is terminal for execution: it can only be resolved, never re-run by transition", () => {
    expect(TRANSITIONS.UNKNOWN).not.toContain("EXECUTING");
    expect(TRANSITIONS.UNKNOWN).toEqual(expect.arrayContaining(["VERIFIED", "FAILED", "COMPENSATED"]));
  });

  it("every state is covered and every target is a real state", () => {
    const states = Object.keys(TRANSITIONS) as AttemptState[];
    expect(states).toHaveLength(8);
    for (const s of states) for (const t of TRANSITIONS[s]) expect(states).toContain(t);
  });

  it("isDuplicate honours the hold window and the active set", () => {
    const soon = new Date(NOW.getTime() + 1000);
    const past = new Date(NOW.getTime() - 1000);
    expect(isDuplicate({ state: "EXECUTING", holdUntil: soon }, NOW)).toBe(true);
    expect(isDuplicate({ state: "UNKNOWN", holdUntil: soon }, NOW)).toBe(true);
    expect(isDuplicate({ state: "SUCCEEDED_UNVERIFIED", holdUntil: past }, NOW)).toBe(false); // window over
    expect(isDuplicate({ state: "FAILED", holdUntil: soon }, NOW)).toBe(false); // failed is never a duplicate
    expect(isDuplicate({ state: "VERIFIED", holdUntil: null }, NOW)).toBe(false);
    expect([...ACTIVE_STATES].sort()).toEqual(["EXECUTING", "SUCCEEDED_UNVERIFIED", "UNKNOWN", "VERIFIED"]);
  });
});

describe("beginAttempt", () => {
  it("claims a fresh key as EXECUTING attempt 1 with a hold window", async () => {
    actionAttempt.create.mockResolvedValueOnce({ id: "a1", attemptNo: 1 });
    const r = await beginAttempt({ operationKey: "sendTelegram:abc", tool: "sendTelegram", argumentsHash: "abc", windowMs: 5 * 60_000, effectClass: "write" }, deps);
    expect(r).toEqual({ kind: "claimed", attemptId: "a1", attemptNo: 1 });
    const data = actionAttempt.create.mock.calls[0][0].data;
    expect(data.state).toBe("EXECUTING");
    expect(data.holdUntil.getTime()).toBe(NOW.getTime() + 5 * 60_000);
    expect(data.effectClass).toBe("write");
  });

  it("POSITIVE CONTROL: a duplicate inside the hold window is NOT re-claimed and reports the prior state", async () => {
    actionAttempt.create.mockRejectedValueOnce({ code: "P2002" });
    actionAttempt.findUnique.mockResolvedValueOnce({ id: "a1", state: "UNKNOWN", attemptNo: 1, holdUntil: new Date(NOW.getTime() + 60_000) });
    const r = await beginAttempt({ operationKey: "k", tool: "t", argumentsHash: "h", windowMs: 1000 }, deps);
    expect(r).toMatchObject({ kind: "duplicate", attemptId: "a1", state: "UNKNOWN" });
    expect(actionAttempt.update).not.toHaveBeenCalled();
  });

  it("re-claims a FAILED row as attemptNo + 1 — through a compare-and-swap on the observed row, never an update by id", async () => {
    actionAttempt.create.mockRejectedValueOnce({ code: "P2002" });
    actionAttempt.findUnique.mockResolvedValueOnce({ id: "a1", state: "FAILED", attemptNo: 1, holdUntil: null });
    actionAttempt.updateMany.mockResolvedValueOnce({ count: 1 });
    const r = await beginAttempt({ operationKey: "k", tool: "t", argumentsHash: "h", windowMs: 1000 }, deps);
    expect(r).toEqual({ kind: "claimed", attemptId: "a1", attemptNo: 2 });
    const cas = actionAttempt.updateMany.mock.calls[0][0];
    expect(cas.where).toEqual({ id: "a1", attemptNo: 1, state: "FAILED" }); // the observed row, pinned
    expect(cas.data).toMatchObject({ state: "EXECUTING", attemptNo: 2, externalReference: null });
    expect(actionAttempt.update).not.toHaveBeenCalled();
  });

  it("re-claims an expired SUCCEEDED_UNVERIFIED row (the window is the dedupe bound, not forever)", async () => {
    actionAttempt.create.mockRejectedValueOnce({ code: "P2002" });
    actionAttempt.findUnique.mockResolvedValueOnce({ id: "a1", state: "SUCCEEDED_UNVERIFIED", attemptNo: 3, holdUntil: new Date(NOW.getTime() - 1) });
    actionAttempt.updateMany.mockResolvedValueOnce({ count: 1 });
    const r = await beginAttempt({ operationKey: "k", tool: "t", argumentsHash: "h", windowMs: 1000 }, deps);
    expect(r).toEqual({ kind: "claimed", attemptId: "a1", attemptNo: 4 });
  });

  it("THE RACE (Codex, #2338): two callers read the same reclaimable row — the one whose swap matched nothing is a duplicate, not a second claim", async () => {
    // Caller B observed FAILED/attemptNo 1, but caller A reclaimed it first: the
    // row is now EXECUTING/attemptNo 2, so B's pinned WHERE matches 0 rows.
    actionAttempt.create.mockRejectedValueOnce({ code: "P2002" });
    actionAttempt.findUnique.mockResolvedValueOnce({ id: "a1", state: "FAILED", attemptNo: 1, holdUntil: null });
    actionAttempt.updateMany.mockResolvedValueOnce({ count: 0 });
    const winnersHold = new Date(NOW.getTime() + 1000);
    actionAttempt.findUnique.mockResolvedValueOnce({ id: "a1", state: "EXECUTING", attemptNo: 2, holdUntil: winnersHold });
    const r = await beginAttempt({ operationKey: "k", tool: "t", argumentsHash: "h", windowMs: 1000 }, deps);
    expect(r).toEqual({ kind: "duplicate", attemptId: "a1", state: "EXECUTING", holdUntil: winnersHold, attemptNo: 2 });
    expect(actionAttempt.updateMany).toHaveBeenCalledOnce(); // no second swap, no retry loop
    expect(actionAttempt.update).not.toHaveBeenCalled();
  });

  it("propagates a non-conflict store error (the caller decides fail-open vs fail-closed)", async () => {
    actionAttempt.create.mockRejectedValueOnce({ code: "P2021", message: "relation \"action_attempts\" does not exist" });
    await expect(beginAttempt({ operationKey: "k", tool: "t", argumentsHash: "h", windowMs: 1000 }, deps)).rejects.toMatchObject({ code: "P2021" });
  });
});

describe("settleAttempt", () => {
  it("success -> SUCCEEDED_UNVERIFIED with the provider reference, hold window kept", async () => {
    const hold = new Date(NOW.getTime() + 5000);
    actionAttempt.findUnique.mockResolvedValueOnce({ state: "EXECUTING", holdUntil: hold });
    actionAttempt.update.mockResolvedValueOnce({});
    await expect(settleAttempt("a1", { disposition: "success", externalReference: "msg:42" }, deps)).resolves.toBe("SUCCEEDED_UNVERIFIED");
    expect(actionAttempt.update.mock.calls[0][0].data).toMatchObject({ state: "SUCCEEDED_UNVERIFIED", externalReference: "msg:42", holdUntil: hold });
  });

  it("known_failure -> FAILED and the hold is released", async () => {
    actionAttempt.findUnique.mockResolvedValueOnce({ state: "EXECUTING", holdUntil: new Date(NOW.getTime() + 5000) });
    actionAttempt.update.mockResolvedValueOnce({});
    await expect(settleAttempt("a1", { disposition: "known_failure", reason: "400" }, deps)).resolves.toBe("FAILED");
    expect(actionAttempt.update.mock.calls[0][0].data).toMatchObject({ state: "FAILED", holdUntil: null, reason: "400" });
  });

  it("unknown -> UNKNOWN with the longer of (remaining window, unknownHoldMs)", async () => {
    actionAttempt.findUnique.mockResolvedValueOnce({ state: "EXECUTING", holdUntil: new Date(NOW.getTime() + 5000) });
    actionAttempt.update.mockResolvedValueOnce({});
    await settleAttempt("a1", { disposition: "unknown", unknownHoldMs: 30 * 60_000 }, deps);
    expect(actionAttempt.update.mock.calls[0][0].data.holdUntil.getTime()).toBe(NOW.getTime() + 30 * 60_000);
  });

  it("POSITIVE CONTROL: settling a row that is not EXECUTING is refused", async () => {
    actionAttempt.findUnique.mockResolvedValueOnce({ state: "FAILED", holdUntil: null });
    await expect(settleAttempt("a1", { disposition: "success" }, deps)).rejects.toThrow(/illegal transition FAILED -> SUCCEEDED_UNVERIFIED/);
    expect(actionAttempt.update).not.toHaveBeenCalled();
  });
});

describe("verify / compensate", () => {
  it("VERIFIED only from SUCCEEDED_UNVERIFIED or UNKNOWN", async () => {
    actionAttempt.findUnique.mockResolvedValueOnce({ state: "SUCCEEDED_UNVERIFIED" });
    actionAttempt.update.mockResolvedValueOnce({});
    await verifyAttempt("a1", { reason: "read back from provider" }, deps);
    expect(actionAttempt.update.mock.calls[0][0].data).toMatchObject({ state: "VERIFIED" });
    actionAttempt.findUnique.mockResolvedValueOnce({ state: "EXECUTING" });
    await expect(verifyAttempt("a1", { reason: "x" }, deps)).rejects.toThrow(/illegal transition EXECUTING -> VERIFIED/);
  });

  it("COMPENSATED is refused from FAILED (nothing happened to undo)", async () => {
    actionAttempt.findUnique.mockResolvedValueOnce({ state: "FAILED" });
    await expect(compensateAttempt("a1", "undo", deps)).rejects.toThrow(/illegal transition FAILED -> COMPENSATED/);
  });
});

describe("isMissingTableError", () => {
  it("recognises the Prisma codes and the raw Postgres message, and nothing else", () => {
    expect(isMissingTableError({ code: "P2021" })).toBe(true);
    expect(isMissingTableError({ message: 'relation "action_attempts" does not exist' })).toBe(true);
    expect(isMissingTableError({ code: "P2002" })).toBe(false);
    expect(isMissingTableError(new Error("db down"))).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
