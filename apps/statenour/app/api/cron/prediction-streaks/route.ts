/**
 * GET /api/cron/prediction-streaks — Prediction-Streak Tracker (F4)
 *
 * Daily: compute Nick's per-category accuracy streaks and surface
 * extensions or breaks as ambient observations.
 *
 * A streak is N consecutive predictions in a category that resolve
 * "confirmed" with no "disproven" in between. When a streak extends
 * or breaks, write/refresh a BrainMemory row so HQ can show
 * "Nick on a 7-streak for revenue predictions" type signals.
 *
 * Per-category rows: key=`streak_<category>`, category=BRAIN_CATEGORIES.PREDICTION_STREAK
 * Shape of metadata:
 *   {
 *     category, currentStreak, longestStreak, lastResolved,
 *     accuracyLifetime, confirmed, disproven, state: "extending" | "broken" | "building"
 *   }
 */
import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  // Pull all resolved predictions, newest first. A "streak" is the
  // count of consecutive "confirmed" starting from the most recent.
  // v10.0.42 — bounded scan. Pre-fix no `take`; over time every
  // graded prediction was loaded into memory just to compute a
  // streak from the most-recent N per category. 500 newest is
  // plenty for streak calculation (longest realistic streak ~30).
  const resolved = await prisma.prediction.findMany({
    where: { status: { in: ["confirmed", "disproven"] } },
    orderBy: { updatedAt: "desc" },
    select: { category: true, status: true, updatedAt: true },
    take: 500,
  });

  if (resolved.length === 0) {
    return { ok: true, skipped: true, reason: "no resolved predictions yet" };
  }

  // Group by category + walk each list newest→oldest
  const byCategory = new Map<string, typeof resolved>();
  for (const p of resolved) {
    const arr = byCategory.get(p.category) ?? [];
    arr.push(p);
    byCategory.set(p.category, arr);
  }

  const results: Array<{ category: string; currentStreak: number; state: string }> = [];

  for (const [category, preds] of byCategory) {
    // currentStreak: consecutive confirmed from the top
    let currentStreak = 0;
    for (const p of preds) {
      if (p.status === "confirmed") currentStreak++;
      else break;
    }

    // longestStreak: scan the whole list
    let longestStreak = 0;
    let running = 0;
    for (const p of preds) {
      if (p.status === "confirmed") {
        running++;
        longestStreak = Math.max(longestStreak, running);
      } else {
        running = 0;
      }
    }

    const confirmed = preds.filter((p) => p.status === "confirmed").length;
    const disproven = preds.length - confirmed;
    const accuracyLifetime = preds.length > 0 ? confirmed / preds.length : 0;

    const prior = await prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.PREDICTION_STREAK, key: `streak_${category}` } },
    });
    const priorStreak =
      prior?.metadata && typeof prior.metadata === "object" && "currentStreak" in prior.metadata
        ? Number((prior.metadata as { currentStreak: unknown }).currentStreak) || 0
        : 0;

    let state: "extending" | "broken" | "building" | "steady" = "steady";
    if (currentStreak > priorStreak) state = "extending";
    else if (currentStreak === 0 && priorStreak >= 3) state = "broken";
    else if (currentStreak >= 2 && priorStreak === 0) state = "building";

    const lastResolved = preds[0].updatedAt.toISOString();

    await brainMemory.remember(
      BRAIN_CATEGORIES.PREDICTION_STREAK,
      `streak_${category}`,
      `${category}: current streak ${currentStreak} · longest ${longestStreak} · accuracy ${Math.round(accuracyLifetime * 100)}% (${confirmed}/${preds.length}) · state=${state}`,
      "prediction-streaks-cron",
      {
        category,
        currentStreak,
        longestStreak,
        confirmed,
        disproven,
        accuracyLifetime,
        lastResolved,
        state,
      },
    );

    results.push({ category, currentStreak, state });
  }

  return { ok: true, categories: results.length, streaks: results };
});
