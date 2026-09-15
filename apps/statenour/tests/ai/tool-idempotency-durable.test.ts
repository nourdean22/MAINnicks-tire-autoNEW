/**
 * withToolIdempotency · durable mode (2026-09-15).
 *
 * `options.durable` routes the claim through action_attempts instead of the
 * BrainMemory marker bridge. Mocks the SERVICE (not Prisma) so each contract
 * is pinned at the seam: claim before run, settle with the disposition and the
 * provider reference, duplicate context carries the real ledger state, a
 * missing table falls back to the bridge, and any other store failure is the
 * caller's fail-open / fail-closed decision — never a silent run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const svc = {
  beginAttempt: vi.fn(),
  settleAttempt: vi.fn(),
  isMissingTableError: vi.fn((e: { code?: string }) => e?.code === "P2021"),
};
vi.mock("@/lib/services/action-attempts", () => svc);

const brainMemory = { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn() };
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory } }));

import { withToolIdempotency } from "@/lib/ai/tools/tool-idempotency";

beforeEach(() => {
  vi.clearAllMocks();
  svc.beginAttempt.mockResolvedValue({ kind: "claimed", attemptId: "a1", attemptNo: 1 });
  svc.settleAttempt.mockResolvedValue("SUCCEEDED_UNVERIFIED");
  brainMemory.create.mockResolvedValue({});
  brainMemory.findUnique.mockResolvedValue(null);
  brainMemory.update.mockResolvedValue({});
  brainMemory.deleteMany.mockResolvedValue({ count: 1 });
});

const durable = { tool: "sendTelegram", effectClass: "write" as const };

describe("withToolIdempotency · durable", () => {
  it("claims through the service BEFORE running, hands the attempt id to the caller, settles success with the provider reference", async () => {
    const seen: string[] = [];
    const run = vi.fn(async () => ({ ok: true, id: 42 }));
    const r = await withToolIdempotency("sendTelegram:abcdef0123456789", 5000, run, () => ({ ok: false, id: 0 }), undefined, {
      durable,
      onAttempt: (id) => seen.push(id),
      classifyResult: (x) => (x.ok ? "success" : "known_failure"),
      externalReference: (x) => `telegram:message:${x.id}`,
    });
    expect(r).toEqual({ ok: true, id: 42 });
    expect(svc.beginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ operationKey: "sendTelegram:abcdef0123456789", tool: "sendTelegram", effectClass: "write", argumentsHash: "abcdef0123456789", windowMs: 5000 }),
    );
    expect(svc.beginAttempt.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
    expect(seen).toEqual(["a1"]);
    expect(svc.settleAttempt).toHaveBeenCalledWith("a1", expect.objectContaining({ disposition: "success", externalReference: "telegram:message:42" }));
    expect(brainMemory.create).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL: a duplicate does not run and the duplicate context carries the real ledger state", async () => {
    const hold = new Date(Date.now() + 1000);
    svc.beginAttempt.mockResolvedValueOnce({ kind: "duplicate", attemptId: "a0", state: "UNKNOWN", holdUntil: hold, attemptNo: 1 });
    const run = vi.fn(async () => "ran");
    const onDuplicate = vi.fn(() => "dup");
    const r = await withToolIdempotency("k:1", 5000, run, onDuplicate, undefined, { durable });
    expect(r).toBe("dup");
    expect(run).not.toHaveBeenCalled();
    expect(onDuplicate).toHaveBeenCalledWith({ state: "unknown", expiresAt: hold, attemptId: "a0", attemptState: "UNKNOWN" });
    expect(svc.settleAttempt).not.toHaveBeenCalled();
  });

  it("a non-UNKNOWN active prior attempt maps to the legacy 'claimed' state", async () => {
    svc.beginAttempt.mockResolvedValueOnce({ kind: "duplicate", attemptId: "a0", state: "SUCCEEDED_UNVERIFIED", holdUntil: null, attemptNo: 2 });
    const onDuplicate = vi.fn(() => "dup");
    await withToolIdempotency("k:1", 5000, async () => "ran", onDuplicate, undefined, { durable });
    expect(onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ state: "claimed", attemptState: "SUCCEEDED_UNVERIFIED" }));
  });

  it("a known failure result settles FAILED; an unknown result settles UNKNOWN with the unknown fence", async () => {
    await withToolIdempotency("k:1", 5000, async () => "bad", () => "dup", undefined, {
      durable,
      classifyResult: () => "known_failure",
    });
    expect(svc.settleAttempt).toHaveBeenLastCalledWith("a1", expect.objectContaining({ disposition: "known_failure" }));
    svc.beginAttempt.mockResolvedValueOnce({ kind: "claimed", attemptId: "a2", attemptNo: 1 });
    await withToolIdempotency("k:2", 5000, async () => "?", () => "dup", undefined, {
      durable,
      classifyResult: () => "unknown",
      unknownWindowMs: 30 * 60_000,
    });
    expect(svc.settleAttempt).toHaveBeenLastCalledWith("a2", expect.objectContaining({ disposition: "unknown", unknownHoldMs: 30 * 60_000 }));
  });

  it("a throw settles by classifyError (default known_failure) and is rethrown", async () => {
    await expect(
      withToolIdempotency("k:1", 5000, async () => { throw new Error("boom"); }, () => "dup", undefined, { durable }),
    ).rejects.toThrow("boom");
    expect(svc.settleAttempt).toHaveBeenCalledWith("a1", expect.objectContaining({ disposition: "known_failure", reason: "boom" }));
    svc.beginAttempt.mockResolvedValueOnce({ kind: "claimed", attemptId: "a3", attemptNo: 1 });
    await expect(
      withToolIdempotency("k:3", 5000, async () => { throw new Error("socket hang up"); }, () => "dup", undefined, { durable, classifyError: () => "unknown" }),
    ).rejects.toThrow("socket hang up");
    expect(svc.settleAttempt).toHaveBeenLastCalledWith("a3", expect.objectContaining({ disposition: "unknown" }));
  });

  it("a missing table falls back to the BrainMemory bridge and still runs exactly once", async () => {
    svc.beginAttempt.mockRejectedValueOnce({ code: "P2021" });
    const run = vi.fn(async () => "ran");
    const r = await withToolIdempotency("k:1", 5000, run, () => "dup", undefined, { durable });
    expect(r).toBe("ran");
    expect(run).toHaveBeenCalledOnce();
    expect(brainMemory.create).toHaveBeenCalledOnce();
    expect(svc.settleAttempt).not.toHaveBeenCalled();
  });

  it("any other store failure is the caller's policy: fail closed when onClaimUnavailable is given, fail open otherwise", async () => {
    svc.beginAttempt.mockRejectedValueOnce(new Error("db down"));
    const run = vi.fn(async () => "ran");
    const closed = await withToolIdempotency("k:1", 5000, run, () => "dup", undefined, { durable, onClaimUnavailable: () => "blocked" });
    expect(closed).toBe("blocked");
    expect(run).not.toHaveBeenCalled();
    svc.beginAttempt.mockRejectedValueOnce(new Error("db down"));
    const open = await withToolIdempotency("k:1", 5000, run, () => "dup", undefined, { durable });
    expect(open).toBe("ran");
    expect(brainMemory.create).not.toHaveBeenCalled(); // fail-open runs untracked; it does not pretend the bridge answered
  });

  it("without options.durable the bridge path is untouched (every legacy caller keeps its behaviour)", async () => {
    const r = await withToolIdempotency("k:1", 5000, async () => "ran", () => "dup");
    expect(r).toBe("ran");
    expect(svc.beginAttempt).not.toHaveBeenCalled();
    expect(brainMemory.create).toHaveBeenCalledOnce();
  });
});
