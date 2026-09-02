/**
 * tests/lib/services/brain-continuity-honest-counts.test.ts · 2026-09-02.
 *
 * TWO NUMBERS ON THE CONTINUITY CARD DESCRIBED SOMETHING OTHER THAN WHAT
 * THEY WERE LABELLED.
 *
 * ── 1 · "decayed/pruned in the last cycle" counted rows NOT pruned ──
 * `prunedEstimate: Math.max(0, expiredCount)` where `expiredCount` counts
 * `{ deletedAt: null, expiresAt: { lt: now } }` — precisely the population
 * the nightly sweep is about to soft-delete (lib/brain/memory-consolidation.ts
 * `pruneNoise`), i.e. its BACKLOG, not its output. continuity-view.tsx then
 * rendered the identical value twice on one card: once as "expired" and once
 * as "~N decayed/pruned in the last cycle". A row cannot be both. The
 * consequence is inverted: right after a HEALTHY consolidation run the
 * backlog is near zero, so the "pruned" line read ~0 — indistinguishable
 * from "nothing ever expires". (`Math.max(0, ...)` on a `count()` was dead
 * code besides.)
 *
 * ── 2 · "Category movers · +N/24h" was a touched-row count ──
 * `OR: [{ createdAt: { gte } }, { updatedAt: { gte } }]`, rendered as an
 * increase and used to light the "hot" flame. Recall bumps lastSeen +
 * seenCount — and therefore `updatedAt` — on every wisdom row it returns
 * (lib/brain/contextual-recall.ts:981-988). A memory that was merely READ
 * counted as "+1" growth, so on a busy chat day `wisdom` could top the
 * movers board having gained nothing.
 *
 * The mock below is the canary for (2): it answers 900 to the OR-shaped
 * query and 0 to the createdAt-only one, so a revert to the touched-row
 * form does not merely change a label — it puts `wisdom` back on top of a
 * board it did not earn, and the ranking assertion fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory } }));

import { buildContinuityReport } from "@/lib/services/brain-continuity";

/** Totals the count-router hands back, per population. */
const TOTALS = {
  all: 17_926,
  active: 17_800,
  /** Past TTL and still live — the sweep's backlog. Healthy = near zero. */
  expired: 3,
  /** Tombstoned in the last 24h — the sweep's actual output. */
  pruned: 137,
};

/**
 * Per-category answers. `touchedOr` is what the OLD query would have
 * returned for that category; `created` is the honest new-row count.
 */
const CATEGORY_ANSWERS: Record<string, { created24h: number; created7d: number; touchedOr: number }> = {
  // Read constantly by recall, written rarely. The exact shape of the bug.
  wisdom: { created24h: 0, created7d: 1, touchedOr: 900 },
  insight: { created24h: 4, created7d: 9, touchedOr: 6 },
};

type Where = Record<string, unknown>;

function routeCount(args: { where: Where }): number {
  const w = args.where;
  if (typeof w.category === "string") {
    const answers = CATEGORY_ANSWERS[w.category as string];
    // A revert to the touched-row form lands here and gets 900 for wisdom.
    if (w.OR || w.updatedAt) return answers.touchedOr;
    const gte = (w.createdAt as { gte: Date }).gte.getTime();
    const ageMs = Date.now() - gte;
    return ageMs < 2 * 86_400_000 ? answers.created24h : answers.created7d;
  }
  if (w.deletedAt && typeof w.deletedAt === "object") return TOTALS.pruned;
  if (w.expiresAt) return TOTALS.expired;
  if (w.OR) return TOTALS.active;
  return TOTALS.all;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.count.mockImplementation(async (args: { where: Where }) =>
    routeCount(args),
  );
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.groupBy.mockResolvedValue([
    { category: "wisdom", _count: { id: 254 } },
    { category: "insight", _count: { id: 1046 } },
  ]);
});

describe("buildContinuityReport · pruned is the sweep's output, not its backlog", () => {
  it("does not report the expired backlog as the pruned count", async () => {
    const report = await buildContinuityReport();

    // The defect in one line: these were the SAME number.
    expect(report.totals.expired).toBe(TOTALS.expired);
    expect(report.recent.prunedLast24h).toBe(TOTALS.pruned);
    expect(report.recent.prunedLast24h).not.toBe(report.totals.expired);
  });

  it("counts rows TOMBSTONED in the window, not rows awaiting the sweep", async () => {
    await buildContinuityReport();

    const prunedCall = mocks.brainMemory.count.mock.calls.find(
      (c: [{ where: Where }]) =>
        c[0].where.deletedAt !== null && typeof c[0].where.deletedAt === "object",
    );
    expect(prunedCall, "no deletedAt-window count was issued").toBeTruthy();
    const where = prunedCall![0].where as { deletedAt: { gte: Date } };
    // A soft-delete inside the last 24h — the population pruneNoise creates.
    const ageMs = Date.now() - where.deletedAt.gte.getTime();
    expect(ageMs).toBeGreaterThan(23 * 3_600_000);
    expect(ageMs).toBeLessThan(25 * 3_600_000);
    // And it must NOT be filtered to live rows — tombstones are the point.
    expect((where as Record<string, unknown>).expiresAt).toBeUndefined();
  });
});

describe("buildContinuityReport · category movers count new rows, not touched rows", () => {
  it("a category that was only READ shows zero growth", async () => {
    const report = await buildContinuityReport();
    const wisdom = report.categoryMovers.find((m) => m.category === "wisdom");

    // 900 recall touches, one write. The old query said 900.
    expect(wisdom?.created24h).toBe(0);
  });

  it("and therefore does not out-rank a category that actually grew", async () => {
    // The consequence, not the number: `wisdom` topped this board on read
    // traffic alone, pushing the category that gained four real memories
    // below it.
    const report = await buildContinuityReport();

    expect(report.categoryMovers[0].category).toBe("insight");
    expect(report.categoryMovers[0].created24h).toBe(4);
  });

  it("never issues an OR / updatedAt mover query", async () => {
    await buildContinuityReport();

    const categoryCalls = mocks.brainMemory.count.mock.calls.filter(
      (c: [{ where: Where }]) => typeof c[0].where.category === "string",
    );
    expect(categoryCalls.length).toBeGreaterThan(0);
    for (const [args] of categoryCalls) {
      expect(args.where.OR).toBeUndefined();
      expect(args.where.updatedAt).toBeUndefined();
      expect(args.where.createdAt).toBeDefined();
      // Tombstones still excluded — that filter was correct and stays.
      expect(args.where.deletedAt).toBeNull();
    }
  });

  it("CONTROL · the 7d window is still a separate, wider count", async () => {
    // Without this, collapsing both counts onto one window would pass every
    // assertion above.
    const report = await buildContinuityReport();
    const insight = report.categoryMovers.find((m) => m.category === "insight");

    expect(insight?.created24h).toBe(4);
    expect(insight?.created7d).toBe(9);
  });
});
