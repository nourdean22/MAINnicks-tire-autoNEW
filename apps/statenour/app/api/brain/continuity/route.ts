/**
 * GET /api/brain/continuity
 *
 * Cross-session memory continuity — what Nick remembered, what
 * decayed, what got reinforced, what's brand-new. One snapshot the
 * /brain/continuity page renders. Owner-auth.
 *
 * Time windows (all vs "now"):
 *   recent   — last 24h  (memories touched/created)
 *   weekly   — last 7d
 *   longterm — all time
 *
 * Returns:
 *   {
 *     totals: { allTime, active, expired, byCategory: {...} },
 *     recent: {
 *       created: Array<Memory>,      // created in last 24h
 *       reinforced: Array<Memory>,   // seenCount increased in last 24h
 *       decayed: Array<Memory>,      // confidence dropped below 0.3 in 24h
 *       promoted: Array<Memory>,     // promoted to category=wisdom in 24h
 *       pruned: number               // deleted in last 24h (estimated)
 *     },
 *     topReinforced: Array<Memory>,  // top 10 by seenCount in last 7d
 *     topConfidence: Array<Memory>,  // top 10 by confidence all-time
 *     categoryMovers: Array<{        // which categories changed most
 *       category: string, delta24h: number, delta7d: number, total: number
 *     }>
 *   }
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const GET = apiHandler(
  async () => {
    const now = new Date();
    const day1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // ── Totals ──
    const [allCount, activeCount, expiredCount, byCategoryRaw] = await Promise.all([
      prisma.brainMemory.count(),
      prisma.brainMemory.count({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      prisma.brainMemory.count({ where: { expiresAt: { lt: now } } }),
      prisma.brainMemory.groupBy({
        by: ["category"],
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

    // v8.27 · soft-delete retrofit · /brain/continuity feed shouldn't
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
        where: { category: BRAIN_CATEGORIES.WISDOM, createdAt: { gte: day1 }, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: memorySelect,
      }),
    ]);

    // Decayed = confidence < 0.3 AND lastSeen older than 14d — these
    // are the "about to be pruned" set. We can't reliably flag actual
    // decay since we overwrite confidence on update; this is the best
    // proxy.
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
          prisma.brainMemory.count({ where: { category, OR: [{ createdAt: { gte: day1 } }, { updatedAt: { gte: day1 } }] } }),
          prisma.brainMemory.count({ where: { category, OR: [{ createdAt: { gte: day7 } }, { updatedAt: { gte: day7 } }] } }),
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
        created: created24h,
        reinforced: reinforced24h,
        decayed: decayedSoon,
        promoted: wisdomPromoted24h,
        prunedEstimate: Math.max(0, expiredCount),
      },
      topReinforced,
      topConfidence,
      categoryMovers,
      computedAt: now.toISOString(),
    };
  },
  { auth: "owner" },
);
