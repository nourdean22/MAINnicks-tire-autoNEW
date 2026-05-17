/**
 * Prediction streak tracker · v8.1 · Apr 29 (F4 from the v11.1 audit).
 *
 * Pure read helper — given the live Prediction table, computes per-
 * category accuracy streaks (current run of confirmed-in-a-row,
 * longest historical run, last-result delta) and surfaces a
 * structured payload the UI can render and the brain layer can
 * react to (streak-break detection).
 *
 * Definitions:
 *   · status="confirmed"  → counts as a HIT
 *   · status="disproven"  → counts as a MISS
 *   · status="expired" / "pending" → ignored (not a graded outcome)
 *
 * A streak is a contiguous run of HITs by `targetDate` ASC, ending at
 * the most recent graded prediction. A streak BREAK is a transition
 * from HIT → MISS as the very latest result.
 *
 * Output is sized for one card: ~6 categories, top of /brain page.
 */

import { prisma } from "@/lib/prisma";

export interface CategoryStreak {
  category: string;
  /** Current run of consecutive HITs ending at the latest prediction. */
  currentStreak: number;
  /** Longest run of HITs in the last 90 days. */
  longestStreak: number;
  /** Total graded predictions in the last 90 days. */
  totalGraded: number;
  /** Hit-rate over the last 90 days, 0..1. */
  hitRate: number;
  /** True when the most recent graded prediction was a MISS following a HIT (i.e. streak just snapped). */
  brokenJustNow: boolean;
  /** ISO datetime of the latest graded prediction. */
  lastGradedAt: string | null;
}

export interface StreaksReport {
  computedAt: string;
  byCategory: CategoryStreak[];
  /** Categories where the streak broke in the last 24h — surfaced as alerts. */
  freshBreaks: CategoryStreak[];
  /** Best active streak across all categories. */
  topActive: CategoryStreak | null;
}

interface PredRow {
  category: string;
  status: string;
  targetDate: string;
  updatedAt: Date;
}

/**
 * Compute streaks. `windowDays` defaults to 90 — wide enough to give
 * a real signal, narrow enough to ignore stale categories.
 */
export async function computePredictionStreaks(
  windowDays: number = 90,
): Promise<StreaksReport> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const rows = (await prisma.prediction.findMany({
    where: {
      status: { in: ["confirmed", "disproven"] },
      updatedAt: { gte: since },
    },
    orderBy: [{ category: "asc" }, { targetDate: "asc" }],
    select: {
      category: true,
      status: true,
      targetDate: true,
      updatedAt: true,
    },
  })) as PredRow[];

  // Group by category, ordered by targetDate ascending so the streak
  // walk is left-to-right and the "latest" is the last element.
  const buckets = new Map<string, PredRow[]>();
  for (const r of rows) {
    const arr = buckets.get(r.category) ?? [];
    arr.push(r);
    buckets.set(r.category, arr);
  }

  const dayMs = 86_400_000;
  const now = Date.now();

  const byCategory: CategoryStreak[] = [];
  for (const [category, items] of buckets.entries()) {
    let currentStreak = 0;
    // Walk backwards: count consecutive hits at the tail.
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].status === "confirmed") currentStreak++;
      else break;
    }

    // Longest: linear scan
    let longest = 0;
    let run = 0;
    for (const r of items) {
      if (r.status === "confirmed") {
        run++;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
    }

    const hits = items.filter((r) => r.status === "confirmed").length;
    const totalGraded = items.length;
    const hitRate = totalGraded > 0 ? hits / totalGraded : 0;

    // Streak break: most-recent is MISS AND there was at least one
    // HIT immediately before it.
    const last = items[items.length - 1];
    const prior = items[items.length - 2];
    const brokenJustNow =
      !!last && last.status === "disproven" &&
      !!prior && prior.status === "confirmed";

    const lastGradedAt = last ? last.updatedAt.toISOString() : null;

    byCategory.push({
      category,
      currentStreak,
      longestStreak: longest,
      totalGraded,
      hitRate,
      brokenJustNow,
      lastGradedAt,
    });
  }

  // Sort: brokenJustNow first (alerts), then by currentStreak DESC,
  // then by hitRate DESC.
  byCategory.sort((a, b) => {
    if (a.brokenJustNow !== b.brokenJustNow) return a.brokenJustNow ? -1 : 1;
    if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak;
    return b.hitRate - a.hitRate;
  });

  const freshBreaks = byCategory.filter((c) => {
    if (!c.brokenJustNow || !c.lastGradedAt) return false;
    return now - new Date(c.lastGradedAt).getTime() < dayMs;
  });

  const topActive =
    byCategory.find((c) => c.currentStreak > 0 && !c.brokenJustNow) ?? null;

  return {
    computedAt: new Date().toISOString(),
    byCategory,
    freshBreaks,
    topActive,
  };
}
