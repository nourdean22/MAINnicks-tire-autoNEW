/**
 * Tool idempotency helper — locks the duplicate-destructive-action guard.
 * Pure logic over a mocked BrainMemory claim table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const brainMemory = {
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory } }));

import { withToolIdempotency, idempotencyKey } from "@/lib/ai/tools/tool-idempotency";

beforeEach(() => {
  vi.clearAllMocks();
  brainMemory.create.mockResolvedValue({});
  brainMemory.findUnique.mockResolvedValue(null);
  brainMemory.update.mockResolvedValue({});
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
    brainMemory.findUnique.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 60_000) });
    const run = vi.fn().mockResolvedValue("ran");
    const r = await withToolIdempotency("k", 1000, run, () => "dup");
    expect(r).toBe("dup");
    expect(run).not.toHaveBeenCalled();
  });

  it("reclaims + runs when the existing marker is EXPIRED", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2002" });
    brainMemory.findUnique.mockResolvedValueOnce({ expiresAt: new Date(Date.now() - 1000) });
    const run = vi.fn().mockResolvedValue("ran");
    const r = await withToolIdempotency("k", 1000, run, () => "dup");
    expect(r).toBe("ran");
    expect(brainMemory.update).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("releases the marker + rethrows when the action FAILS after claiming", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withToolIdempotency("k", 1000, run, () => "dup")).rejects.toThrow("boom");
    expect(brainMemory.deleteMany).toHaveBeenCalledOnce();
  });

  it("does NOT block the action on a non-P2002 DB error (fail-open)", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2010", message: "db down" });
    const run = vi.fn().mockResolvedValue("ran");
    const r = await withToolIdempotency("k", 1000, run, () => "dup");
    expect(r).toBe("ran");
    expect(run).toHaveBeenCalledOnce();
  });

  it("RELEASES the marker when the action reports failure by RETURN VALUE (no throw)", async () => {
    // The real bug the self-review caught: sendTelegram returns false / queryNick
    // returns {error} instead of throwing, so a failed send must still free the marker.
    const run = vi.fn().mockResolvedValue({ ok: false });
    const r = await withToolIdempotency("k", 1000, run, () => ({ ok: false, dup: true }), (res) => res.ok === true);
    expect(r).toEqual({ ok: false });
    expect(brainMemory.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("KEEPS the marker when the action succeeds (per the succeeded predicate)", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    await withToolIdempotency("k", 1000, run, () => ({ ok: false, dup: true }), (res) => res.ok === true);
    expect(brainMemory.deleteMany).not.toHaveBeenCalled();
  });
});

describe("idempotencyKey", () => {
  it("is stable, tool-prefixed, and content-sensitive", () => {
    expect(idempotencyKey("sendTelegram", "hello")).toBe(idempotencyKey("sendTelegram", "hello"));
    expect(idempotencyKey("sendTelegram", "hello")).toMatch(/^sendTelegram:[0-9a-f]{16}$/);
    expect(idempotencyKey("sendTelegram", "hello")).not.toBe(idempotencyKey("sendTelegram", "world"));
  });
});
