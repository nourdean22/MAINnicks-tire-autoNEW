/**
 * GET /api/mastery/radar · Wave 24 (v10.0.529.80) · #2
 *
 * Returns the operator's mastery radar data — one row per domain with
 * current score + 7d-ago score for the delta overlay. Feeds the
 * <MasteryRadar> component on /trends.
 *
 * Response shape:
 *   {
 *     axes: [
 *       { domain: "fitness", current: 47.5, week_ago: 44, delta: 3.5 },
 *       { domain: "business", current: 62, week_ago: 59, delta: 3 },
 *       ...
 *     ],
 *     domainsCount: N,
 *   }
 *
 * Sorted alphabetically by domain so the radar shape is stable
 * across re-renders.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { today as todayET } from "@/lib/utils/datetime";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    // Latest score per domain · sort by date desc and dedupe in memory.
    const recent = await prisma.masteryScore
      .findMany({
        orderBy: { date: "desc" },
        take: 300,
        select: { domain: true, score: true, date: true },
      })
      .catch((): Array<{ domain: string; score: number; date: string }> => []);

    if (recent.length === 0) {
      return { axes: [], domainsCount: 0 };
    }

    const currentByDomain = new Map<string, { score: number; date: string }>();
    for (const r of recent) {
      if (!currentByDomain.has(r.domain)) {
        currentByDomain.set(r.domain, { score: r.score, date: r.date });
      }
    }

    // For each domain, find the score from ~7 days ago.
    const today = todayET();
    const sevenDaysAgoDate = (() => {
      const d = new Date(`${today}T00:00:00.000-04:00`);
      d.setDate(d.getDate() - 7);
      return d.toISOString().slice(0, 10);
    })();

    const axes: Array<{
      domain: string;
      current: number;
      weekAgo: number;
      delta: number;
    }> = [];

    for (const [domain, cur] of currentByDomain) {
      const weekAgoRow = await prisma.masteryScore
        .findFirst({
          where: {
            domain,
            date: { lte: sevenDaysAgoDate },
          },
          orderBy: { date: "desc" },
          select: { score: true },
        })
        .catch(() => null);
      const weekAgo = weekAgoRow?.score ?? cur.score; // baseline = current if no history
      const delta = Math.round((cur.score - weekAgo) * 10) / 10;
      axes.push({
        domain,
        current: cur.score,
        weekAgo,
        delta,
      });
    }

    axes.sort((a, b) => a.domain.localeCompare(b.domain));

    return { axes, domainsCount: axes.length };
  },
  { auth: "owner" },
);
