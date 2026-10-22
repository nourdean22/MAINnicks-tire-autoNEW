/**
 * Tool idempotency helper — locks the duplicate-destructive-action guard.
 * Pure logic over a mocked BrainMemory claim table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const brainMemory = {
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory } }));

import { withToolIdempotency, idempotencyKey } from "@/lib/ai/tools/tool-idempotency";

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps queued *Once values; an unconsumed one would leak into the next test.
  for (const fn of Object.values(brainMemory)) fn.mockReset();
  brainMemory.create.mockResolvedValue({});
  brainMemory.findUnique.mockResolvedValue(null);
  brainMemory.update.mockResolvedValue({});
  brainMemory.updateMany.mockResolvedValue({ count: 1 });
  brainMemory.deleteMany.mockResolvedValue({ count: 1 });
});

describe("withToolIdempotency", () => {
  it("runs the action on the first claim", async () => {
    const run = vi.fn().mockResolvedValue("ran");
    const r = await withToolIdempotency("k", 1000, run, () => "dup");
    expect(r).toBe("ran");
    expect(run).toHaveBeenCalledOnce();
    expect(brainMemory.create).toHaveBeenCalledOnce();
  });

  it("dedups (skips the action) when a LIVE marker already exists", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2002" });
    brainMemory.findUnique.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 60_000),
      content: "claimed:2026-09-13T00:00:00.000Z",
    });
    const run = vi.fn().mockResolvedValue("ran");
    const r = await withToolIdempotency("k", 1000, run, () => "dup");
    expect(r).toBe("dup");
    expect(run).not.toHaveBeenCalled();
  });

  it("reclaims + runs when the existing marker is EXPIRED", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2002" });
    brainMemory.findUnique.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() - 1000),
      content: "claimed:2026-09-13T00:00:00.000Z",
    });
    const run = vi.fn().mockResolvedValue("ran");
    const r = await withToolIdempotency("k", 1000, run, () => "dup");
    expect(r).toBe("ran");
    expect(brainMemory.updateMany).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  // Bug hunt 2026-10-22 · the reclaim was update-by-key: two identical calls after the marker
  // expired both read "expired", both updated, both ran (two receipts, two approval prompts).
  it("the expired-marker reclaim is a compare-and-swap pinned to the row it read", async () => {
    const expiredAt = new Date(Date.now() - 1000);
    brainMemory.create.mockRejectedValueOnce({ code: "P2002" });
    brainMemory.findUnique.mockResolvedValueOnce({ expiresAt: expiredAt, content: "claimed:2026-09-13T00:00:00.000Z" });
    await withToolIdempotency("k", 1000, vi.fn().mockResolvedValue("ran"), () => "dup");
    expect(brainMemory.update).not.toHaveBeenCalled();
    expect(brainMemory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category: "tool_idempotency",
          key: "k",
          expiresAt: expiredAt,
          content: "claimed:2026-09-13T00:00:00.000Z",
        },
      }),
    );
  });

  it("two racers on one expired marker: the swap winner runs, the loser is a duplicate", async () => {
    const expired = { expiresAt: new Date(Date.now() - 1000), content: "claimed:2026-09-13T00:00:00.000Z" };
    const fresh = { expiresAt: new Date(Date.now() + 60_000), content: "claimed:2026-10-22T12:00:00.000Z" };
    brainMemory.create.mockRejectedValue({ code: "P2002" });
    // Both racers read the same expired row; the loser's re-read sees the winner's claim.
    brainMemory.findUnique
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(fresh);
    brainMemory.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const run = vi.fn().mockResolvedValue("ran");
    const onDuplicate = vi.fn((ctx) => `dup:${ctx?.state}`);

    // Two dynamic imports of the mocked "@/lib/prisma" in flight at once can hand one caller the
    // REAL module (statenour-verify trap; witnessed here). Start the second racer once the first
    // is past its import. The race itself is modelled by the swap counts above, not by timing.
    const first = withToolIdempotency("k", 1000, run, onDuplicate);
    await vi.waitFor(() => expect(brainMemory.create).toHaveBeenCalledTimes(1));
    const second = withToolIdempotency("k", 1000, run, onDuplicate);
    const results = await Promise.all([first, second]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(results.sort()).toEqual(["dup:claimed", "ran"]);
    expect(onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: fresh.expiresAt }));
  });

  it("a lost swap whose row then vanished keeps the old failed-reclaim policy (strict callers block)", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2002" });
    brainMemory.findUnique
      .mockResolvedValueOnce({ expiresAt: new Date(Date.now() - 1000), content: "claimed:x" })
      .mockResolvedValueOnce(null);
    brainMemory.updateMany.mockResolvedValueOnce({ count: 0 });
    const run = vi.fn().mockResolvedValue("RAN");
    const r = await withToolIdempotency("k", 1000, run, () => "dup", undefined, {
      onClaimUnavailable: () => "BLOCKED",
    });
    expect(r).toBe("BLOCKED");
    expect(run).not.toHaveBeenCalled();
  });

  it("strict mode blocks when a duplicate marker exists but its state cannot be read", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2002" });
    brainMemory.findUnique.mockRejectedValueOnce(new Error("read path down"));
    const run = vi.fn().mockResolvedValue("RAN-DANGEROUSLY");
    const r = await withToolIdempotency(
      "k",
      1000,
      run,
      () => "dup",
      undefined,
      { onClaimUnavailable: () => "BLOCKED" },
    );
    expect(r).toBe("BLOCKED");
    expect(run).not.toHaveBeenCalled();
    expect(brainMemory.update).not.toHaveBeenCalled();
    expect(brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("legacy mode fails open when a duplicate marker exists but its state cannot be read, without reclaiming it", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2002" });
    brainMemory.findUnique.mockRejectedValueOnce(new Error("read path down"));
    const run = vi.fn().mockResolvedValue("ran");
    const r = await withToolIdempotency("k", 1000, run, () => "dup");
    expect(r).toBe("ran");
    expect(run).toHaveBeenCalledOnce();
    expect(brainMemory.update).not.toHaveBeenCalled();
    expect(brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("legacy behavior still releases the marker + rethrows on a throw", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withToolIdempotency("k", 1000, run, () => "dup")).rejects.toThrow("boom");
    expect(brainMemory.deleteMany).toHaveBeenCalledOnce();
  });

  it("legacy behavior still fails open on a non-P2002 claim-store error", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2010", message: "db down" });
    const run = vi.fn().mockResolvedValue("ran");
    const r = await withToolIdempotency("k", 1000, run, () => "dup");
    expect(r).toBe("ran");
    expect(run).toHaveBeenCalledOnce();
  });

  it("RELEASES the marker when the legacy success predicate reports a known failure", async () => {
    const run = vi.fn().mockResolvedValue({ ok: false });
    const r = await withToolIdempotency(
      "k",
      1000,
      run,
      () => ({ ok: false, dup: true }),
      (res) => res.ok === true,
    );
    expect(r).toEqual({ ok: false });
    expect(brainMemory.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("KEEPS the marker when the action succeeds", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    await withToolIdempotency(
      "k",
      1000,
      run,
      () => ({ ok: false, dup: true }),
      (res) => res.ok === true,
    );
    expect(brainMemory.deleteMany).not.toHaveBeenCalled();
  });

  it("UNKNOWN completion keeps the marker instead of enabling a blind retry", async () => {
    const run = vi.fn().mockResolvedValue({ state: "unknown" as const });
    const r = await withToolIdempotency(
      "k",
      1000,
      run,
      () => ({ state: "duplicate" as const }),
      undefined,
      {
        classifyResult: (result) => result.state === "unknown" ? "unknown" : "success",
        unknownWindowMs: 30_000,
      },
    );
    expect(r).toEqual({ state: "unknown" });
    expect(brainMemory.deleteMany).not.toHaveBeenCalled();
    expect(brainMemory.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content: expect.stringMatching(/^unknown:/) }),
    }));
  });

  it("UNKNOWN thrown error keeps the marker and still rethrows", async () => {
    const run = vi.fn().mockRejectedValue(new Error("response lost after send"));
    await expect(
      withToolIdempotency("k", 1000, run, () => "dup", undefined, {
        classifyError: () => "unknown",
      }),
    ).rejects.toThrow("response lost after send");
    expect(brainMemory.deleteMany).not.toHaveBeenCalled();
    expect(brainMemory.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content: expect.stringMatching(/^unknown:/) }),
    }));
  });

  it("tells a duplicate caller when the prior live marker is UNKNOWN", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2002" });
    brainMemory.findUnique.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 60_000),
      content: "unknown:2026-09-13T00:00:00.000Z",
    });
    const onDuplicate = vi.fn((ctx) => ctx?.state ?? "missing");
    const r = await withToolIdempotency("k", 1000, vi.fn(), onDuplicate);
    expect(r).toBe("unknown");
    expect(onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ state: "unknown" }));
  });

  it("can fail closed when the idempotency store itself is unavailable", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2010", message: "db down" });
    const run = vi.fn().mockResolvedValue("RAN-DANGEROUSLY");
    const r = await withToolIdempotency(
      "k",
      1000,
      run,
      () => "dup",
      undefined,
      { onClaimUnavailable: () => "BLOCKED" },
    );
    expect(r).toBe("BLOCKED");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("idempotencyKey", () => {
  it("is stable, tool-prefixed, and content-sensitive", () => {
    expect(idempotencyKey("sendTelegram", "hello")).toBe(idempotencyKey("sendTelegram", "hello"));
    expect(idempotencyKey("sendTelegram", "hello")).toMatch(/^sendTelegram:[0-9a-f]{16}$/);
    expect(idempotencyKey("sendTelegram", "hello")).not.toBe(idempotencyKey("sendTelegram", "world"));
  });
});
