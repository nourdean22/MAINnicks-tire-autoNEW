/**
 * BDN-310 bi-temporal supersession — writer + reader contract (2026-08-19).
 *
 * The columns (validFrom / validUntil / lastVerifiedAt / supersededById)
 * were applied to prod Neon on 2026-08-14 and then had ZERO writers and
 * ZERO readers — "the schema is ahead of the app on purpose" aged into a
 * dead seam: a superseded belief stayed exactly as recallable as a fresh
 * one.
 *
 * This pins both halves of the closure:
 *   WRITER — cleanupResolvedContradiction stamps supersededById +
 *   validUntil on the explicit LOSER of an operator-resolved
 *   contradiction, unconditionally (the soft-delete stays flag-gated).
 *   READERS — both recall lanes (Lane A hybrid SQL, Lane B prisma pool +
 *   lexical SQL + fallback) filter superseded/expired rows out. Those are
 *   pinned as source predicates because invoking the full recall
 *   pipelines here would mean mocking half the AI stack — a text pin that
 *   goes red on deletion beats no pin (same pattern as the
 *   containing-block CSS scan).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    updateMany: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  getFlag: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: mocks.brainMemory },
}));

vi.mock("@/lib/feature-flags", () => ({
  getFlag: mocks.getFlag,
}));

vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));

import { cleanupResolvedContradiction } from "@/lib/brain/contradiction-cleanup";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFlag.mockReturnValue({ isOn: false }); // soft-delete lane OFF
  mocks.brainMemory.updateMany.mockResolvedValue({ count: 1 });
});

describe("supersession writer · cleanupResolvedContradiction", () => {
  it("current_wins → the OLD row is superseded by the new one, even with the delete flag off", async () => {
    const res = await cleanupResolvedContradiction("current_wins", "mem-new", "mem-old");

    expect(res.superseded).toBe(true);
    expect(res.cleaned).toBe(false); // flag off — no soft delete
    expect(mocks.brainMemory.updateMany).toHaveBeenCalledTimes(1);
    const call = mocks.brainMemory.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: "mem-old", supersededById: null, deletedAt: null });
    expect(call.data.supersededById).toBe("mem-new");
    expect(call.data.validUntil).toBeInstanceOf(Date);
  });

  it("old_wins → the NEW row is the loser", async () => {
    await cleanupResolvedContradiction("old_wins", "mem-new", "mem-old");
    const call = mocks.brainMemory.updateMany.mock.calls[0][0];
    expect(call.where.id).toBe("mem-new");
    expect(call.data.supersededById).toBe("mem-old");
  });

  it("both_valid / dismissed name no loser → nothing is stamped", async () => {
    for (const status of ["both_valid", "dismissed", "unresolved"]) {
      const res = await cleanupResolvedContradiction(status, "a", "b");
      expect(res.superseded).toBe(false);
      expect(res.skippedReason).toBe("no_loser");
    }
    expect(mocks.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("is idempotent — an already-superseded row is not re-stamped", async () => {
    mocks.brainMemory.updateMany.mockResolvedValue({ count: 0 });
    const res = await cleanupResolvedContradiction("current_wins", "mem-new", "mem-old");
    expect(res.superseded).toBe(false);
  });

  it("a failed stamp never throws into the resolve path", async () => {
    mocks.brainMemory.updateMany.mockRejectedValue(new Error("db down"));
    const res = await cleanupResolvedContradiction("current_wins", "mem-new", "mem-old");
    expect(res.superseded).toBe(false);
  });
});

// ── Reader pins — the recall lanes must keep filtering superseded rows ──

const APP_ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(APP_ROOT, rel), "utf8");

describe("supersession readers · recall-lane source pins", () => {
  it("Lane A (hybrid SQL) excludes superseded + expired rows", () => {
    const src = read("lib/brain/memory-recall.ts");
    expect(src).toMatch(/superseded_by_id IS NULL/);
    expect(src).toMatch(/valid_until IS NULL OR bm\.valid_until > NOW\(\)/);
  });

  it("Lane B lexical SQL excludes superseded + expired rows", () => {
    const src = read("lib/brain/contextual-recall.ts");
    expect(src).toMatch(/superseded_by_id IS NULL/);
  });

  it("Lane B prisma pool AND the fallback both filter supersededById/validUntil", () => {
    const src = read("lib/brain/contextual-recall.ts");
    const hits = src.match(/supersededById: null/g) ?? [];
    // one for the top-300 pool, one for getFallbackMemories
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/OR: \[\{ validUntil: null \}, \{ validUntil: \{ gt: new Date\(\) \} \}\]/);
  });
});
