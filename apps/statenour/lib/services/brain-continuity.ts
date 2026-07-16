/**
 * lib/services/brain-continuity.ts · scattered-components REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/brain/* slice).
 *
 * The cross-session memory-continuity rollup · lifted verbatim from the
 * GET handler of app/api/brain/continuity/route.ts so the legacy REST
 * endpoint AND the new `brain.continuityReport` tRPC procedure call the
 * SAME function · drift between consumers structurally impossible.
 *
 * `BrainMemory` carries a `metadata` Json column, but this rollup
 * `select`s only scalar fields (never `metadata`) · every row is still
 * projected to the explicit, flat `ContinuityMemoryRow` shape with
 * `Date` fields stringified to ISO. The public AppRouter type therefore
 * stays shallow and stable — the TS2589 firewall discipline applied
 * uniformly.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/** A flat, shallow projection of a BrainMemory row for the continuity feed. */
export interface ContinuityMemoryRow {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  seenCount: number;
  source: string;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
}

/** The continuity dashboard payload · totals + recent activity + leaderboards. */
export interface ContinuityReport {
  totals: {
    allTime: number;
    active: number;
    expired: number;
    byCategory: Record<string, number>;
  };
  recent: {
    created: ContinuityMemoryRow[];
    reinforced: ContinuityMemoryRow[];
    decayed: ContinuityMemoryRow[];
    promoted: ContinuityMemoryRow[];
    prunedEstimate: number;
  };
  topReinforced: ContinuityMemoryRow[];
  topConfidence: ContinuityMemoryRow[];
  categoryMovers: Array<{
    category: string;
    delta24h: number;
    delta7d: number;
    total: number;
  }>;
  computedAt: string;
}

/** Project a Prisma BrainMemory row (scalar select) to the flat row shape. */
function toRow(m: {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  seenCount: number;
  source: string;
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
}): ContinuityMemoryRow {
  return {
    id: m.id,
    category: m.category,
    key: m.key,
    content: m.content,
    confidence: m.confidence,
    seenCount: m.seenCount,
    source: m.source,
    lastSeen: m.lastSeen.toISOString(),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/**
 * Build the cross-session memory-continuity rollup — totals, what was
 * created / reinforced / decayed / promoted in the last 24h, the 7d
 * reinforced leaderboard, the all-time confidence leaderboard, and the
 * per-category churn movers. The REST route and the
 * `brain.continuityReport` procedure both call this.
 */
export async function buildContinuityReport(): Promise<ContinuityReport> {
  const now = new Date();
  const day1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // ── Totals ──
  // phantom-counts final wave (2026-07-16, operator call): every total on
  // this card describes the LIVE population. `allTime` now means "all live
  // rows ever" (all rows ever written minus tombstones), NOT "all rows ever
  // written" — so allTime/active/expired stay mutually consistent.
  const [allCount, activeCount, expiredCount, byCategoryRaw] =
    await Promise.all([
      prisma.brainMemory.count({ where: { deletedAt: null } }),
      prisma.brainMemory.count({
        where: {
          deletedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      prisma.brainMemory.count({
        where: { deletedAt: null, expiresAt: { lt: now } },
      }),
      prisma.brainMemory.groupBy({
        by: ["category"],
        where: { deletedAt: null },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 15,
      }),
    ]);
  const byCategory: Record<string, number> = {};
  for (const row of byCategoryRaw) byCategory[row.category] = row._count.id;

  // ── Recent activity ──
  const memorySelect = {
    id: true,
    category: true,
    key: true,
    content: true,
    confidence: true,
    seenCount: true,
    source: true,
    lastSeen: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  // v8.27 · soft-delete retrofit · the continuity feed shouldn't
  // resurface tombstoned memories.
  const [created24h, reinforced24h, wisdomPromoted24h] = await Promise.all([
    prisma.brainMemory.findMany({
      where: { createdAt: { gte: day1 }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: memorySelect,
    }),
    // "Reinforced" = updated in last 24h AND NOT created in last 24h
    //               (created rows aren't reinforcement, they're new)
    prisma.brainMemory.findMany({
      where: {
        updatedAt: { gte: day1 },
        createdAt: { lt: day1 },
        seenCount: { gt: 1 },
        deletedAt: null,
      },
      orderBy: { seenCount: "desc" },
      take: 25,
      select: memorySelect,
    }),
    prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.WISDOM,
        createdAt: { gte: day1 },
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: memorySelect,
    }),
  ]);

  // Decayed = confidence < 0.3 AND lastSeen older than 14d — these are
  // the "about to be pruned" set. We can't reliably flag actual decay
  // since we overwrite confidence on update; this is the best proxy.
  const decayedSoon = await prisma.brainMemory.findMany({
    where: {
      confidence: { lt: 0.3 },
      lastSeen: { lt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
      deletedAt: null,
    },
    orderBy: { lastSeen: "asc" },
    take: 15,
    select: memorySelect,
  });

  // ── Top reinforced in last 7d ──
  const topReinforced = await prisma.brainMemory.findMany({
    where: { updatedAt: { gte: day7 }, seenCount: { gte: 2 }, deletedAt: null },
    orderBy: [{ seenCount: "desc" }, { confidence: "desc" }],
    take: 10,
    select: memorySelect,
  });

  // ── Top confidence all-time ──
  const topConfidence = await prisma.brainMemory.findMany({
    where: { confidence: { gte: 0.85 }, deletedAt: null },
    orderBy: [{ confidence: "desc" }, { seenCount: "desc" }],
    take: 10,
    select: memorySelect,
  });

  // ── Category movers — which categories had the most churn ──
  const categoryMoversRaw = await Promise.all(
    Object.keys(byCategory).map(async (category) => {
      const [delta24h, delta7d] = await Promise.all([
        prisma.brainMemory.count({
          where: {
            category,
            deletedAt: null,
            OR: [{ createdAt: { gte: day1 } }, { updatedAt: { gte: day1 } }],
          },
        }),
        prisma.brainMemory.count({
          where: {
            category,
            deletedAt: null,
            OR: [{ createdAt: { gte: day7 } }, { updatedAt: { gte: day7 } }],
          },
        }),
      ]);
      return { category, delta24h, delta7d, total: byCategory[category] };
    }),
  );
  const categoryMovers = categoryMoversRaw
    .sort((a, b) => b.delta24h - a.delta24h || b.delta7d - a.delta7d)
    .slice(0, 10);

  return {
    totals: {
      allTime: allCount,
      active: activeCount,
      expired: expiredCount,
      byCategory,
    },
    recent: {
      created: created24h.map(toRow),
      reinforced: reinforced24h.map(toRow),
      decayed: decayedSoon.map(toRow),
      promoted: wisdomPromoted24h.map(toRow),
      prunedEstimate: Math.max(0, expiredCount),
    },
    topReinforced: topReinforced.map(toRow),
    topConfidence: topConfidence.map(toRow),
    categoryMovers,
    computedAt: now.toISOString(),
  };
}
