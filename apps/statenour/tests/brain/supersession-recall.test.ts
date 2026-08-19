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

/** The updateMany call that stamps the LOSER (vs the winner's lastVerifiedAt bump). */
function loserStampCalls() {
  return mocks.brainMemory.updateMany.mock.calls.filter(
    (c: any[]) => c[0]?.data?.supersededById !== undefined,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFlag.mockReturnValue({ isOn: false }); // soft-delete lane OFF
  mocks.brainMemory.updateMany.mockResolvedValue({ count: 1 });
  mocks.brainMemory.update.mockResolvedValue({});
  // Winner row: no validFrom writer exists yet, not itself superseded.
  mocks.brainMemory.findUnique.mockResolvedValue({ validFrom: null, supersededById: null });
});

describe("supersession writer · cleanupResolvedContradiction", () => {
  it("current_wins → the OLD row is superseded by the new one, even with the delete flag off", async () => {
    const res = await cleanupResolvedContradiction("current_wins", "mem-new", "mem-old");

    expect(res.superseded).toBe(true);
    expect(res.cleaned).toBe(false); // flag off — no soft delete
    const stamps = loserStampCalls();
    expect(stamps).toHaveLength(1);
    expect(stamps[0][0].where).toMatchObject({ id: "mem-old", supersededById: null, deletedAt: null });
    expect(stamps[0][0].data.supersededById).toBe("mem-new");
    expect(stamps[0][0].data.validUntil).toBeInstanceOf(Date);
  });

  it("stamps lastVerifiedAt on the WINNER — an operator adjudication is a verification event", async () => {
    await cleanupResolvedContradiction("current_wins", "mem-new", "mem-old");
    const verify = mocks.brainMemory.updateMany.mock.calls.find(
      (c: any[]) => c[0]?.data?.lastVerifiedAt !== undefined && c[0]?.where?.id === "mem-new",
    );
    expect(verify, "winner lastVerifiedAt bump missing").toBeDefined();
  });

  it("uses the winner's validFrom as the loser's validUntil when present (Zep t_invalid semantics)", async () => {
    const winnerBorn = new Date("2026-08-01T00:00:00Z");
    mocks.brainMemory.findUnique.mockResolvedValue({ validFrom: winnerBorn, supersededById: null });
    await cleanupResolvedContradiction("current_wins", "mem-new", "mem-old");
    expect(loserStampCalls()[0][0].data.validUntil).toEqual(winnerBorn);
  });

  it("a verdict FLIP un-strands the winner instead of leaving both rows superseded", async () => {
    // Round 1 resolved the other way: the row now ruled correct carries a
    // stamp pointing at the row it now beats.
    mocks.brainMemory.findUnique.mockResolvedValue({ validFrom: null, supersededById: "mem-old" });
    await cleanupResolvedContradiction("current_wins", "mem-new", "mem-old");
    expect(mocks.brainMemory.update).toHaveBeenCalledTimes(1);
    const unstrand = mocks.brainMemory.update.mock.calls[0][0];
    expect(unstrand.where).toEqual({ id: "mem-new" });
    expect(unstrand.data.supersededById).toBeNull();
    expect(unstrand.data.validUntil).toBeNull();
    expect(unstrand.data.lastVerifiedAt).toBeInstanceOf(Date);
    // The loser still gets stamped.
    expect(loserStampCalls()).toHaveLength(1);
  });

  it("old_wins → the NEW row is the loser", async () => {
    await cleanupResolvedContradiction("old_wins", "mem-new", "mem-old");
    const call = loserStampCalls()[0][0];
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
    mocks.brainMemory.findUnique.mockRejectedValue(new Error("db down"));
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

  it("Lane B prisma pool, the fallback AND the graph-context lane all filter supersededById/validUntil", () => {
    const src = read("lib/brain/contextual-recall.ts");
    const hits = src.match(/supersededById: null/g) ?? [];
    // top-300 pool + getFallbackMemories + appendGraphContext (round-2:
    // the graph lane injected content past the filtered pool).
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/OR: \[\{ validUntil: null \}, \{ validUntil: \{ gt: new Date\(\) \} \}\]/);
  });

  // Round-2 review: "both recall lanes honor it" was FALSE — three more
  // operator-facing read lanes had no filter. Each is pinned now.
  it("searchMemories (the ask-Nick-directly chat tool) filters in BOTH its FTS SQL and prisma where", () => {
    const src = read("lib/ai/tools/brain.ts");
    expect(src).toMatch(/superseded_by_id IS NULL/);
    expect(src).toMatch(/supersededById: null/);
  });

  it("cold-memory id-hydration carries the full liveness contract", () => {
    const src = read("lib/brain/cold-memory.ts");
    expect(src).toMatch(/deletedAt: null,\s*\n\s*supersededById: null/);
  });

  it("memory-manager recall() (memory-browser REST + tRPC) filters superseded rows", () => {
    const src = read("lib/brain/memory-manager.ts");
    expect(src).toMatch(/supersededById: null/);
  });

  it("the shared vector boundary (knnSearch liveness EXISTS) enforces supersession for every semanticSearch caller", () => {
    const src = read("lib/db/pgvector.ts");
    expect(src).toMatch(/bm\.superseded_by_id IS NULL AND \(bm\.valid_until IS NULL OR bm\.valid_until > NOW\(\)\)/);
  });

  it("embedding-utils' brain_memory hydration filters superseded rows (belt to the knnSearch braces)", () => {
    const src = read("lib/brain/embedding-utils.ts");
    expect(src).toMatch(/supersededById: null/);
  });
});
