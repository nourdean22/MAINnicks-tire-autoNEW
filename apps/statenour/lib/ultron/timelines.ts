/**
 * SIMULATED TIMELINES — short projection lines Ultron rotates in the ticker.
 *
 * Each one is a "what-if" or "at current rate" sentence computed from today's
 * state. Fast to compute (no AI), grounded in actual data (habits, mastery,
 * drift, recent scores).
 *
 * Target shape: one-liner ≤ 70 chars with a clear signal → implication arrow.
 * Examples:
 *   "skip workout today → -$185 wk rev, -2 discipline"
 *   "no score logged → decision quality ↓22%"
 *   "workout streak 7d → discipline peak window, protect it"
 *
 * Callers:
 *   - /api/ultron/ticker interleaves these with market/macro items
 *   - /api/ultron/timelines returns the raw array (for a standalone view)
 */

import { prisma } from "@/lib/prisma";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

export interface Timeline {
  id: string;
  kind: "if_skip" | "if_do" | "at_rate" | "caution" | "streak";
  text: string;
  domain: "body" | "mind" | "money" | "life" | "system";
  severity: "info" | "warn" | "win";
}

interface Inputs {
  workoutDoneToday: boolean;
  workoutStreak: number;           // days in a row before today
  habitsDone: number;
  habitsTotal: number;
  driftOpen: number;
  daniaSilentDays: number;         // 0 if mentioned today
  sleepHoursAvg7d: number | null;
  hourOfDay: number;
}

export async function computeInputs(): Promise<Inputs> {
  const now = new Date();
  const todayStr = toDateString(now);
  const weekAgo = daysAgo(7);

  // v10.0.59 · Wave A part 2 · habits via legacy-shims. habitsToday
  // filters today's rows from the synthesized habit history; habitsWeek
  // slices the last 7 days. (Daily-score inputs removed 2026-05-31 — the
  // score-derived timeline items were retired in the score→reflection pivot.)
  const [habitsToday, habitsWeek, drift, chatMessages, sleepRows] = await Promise.all([
    (async () => {
      const { recentDailyHabits } = await import("@/lib/brain/legacy-shims");
      const all = await recentDailyHabits(1);
      return all
        .filter((r) => r.date === todayStr)
        .map((r) => ({ habitKey: r.habitKey, completed: r.completed }));
    })(),
    (async () => {
      const { recentDailyHabits } = await import("@/lib/brain/legacy-shims");
      const all = await recentDailyHabits(7);
      return all.map((r) => ({ date: r.date, completed: r.completed }));
    })(),
    prisma.driftAlert.count({ where: { resolved: false } }).catch((err) => {
      console.warn("[ultron/timelines] driftAlert.count failed:", err instanceof Error ? err.message : err);
      return 0;
    }),
    prisma.chatMessage
      .findMany({
        where: { role: "user", createdAt: { gte: daysAgo(14) } },
        select: { content: true, createdAt: true },
        take: 100,
      })
      .catch((err): Array<{ content: string; createdAt: Date }> => {
        console.warn("[ultron/timelines] chatMessage.findMany failed:", err instanceof Error ? err.message : err);
        return [];
      }),
    // 2026-05-27 · sleep-tracking wire-up. The legacy `sleepHoursAvg7d`
    // was hardcoded null with "TODO v3 when we have sleep tracking" —
    // but BodyTracking.sleepHours has been live since Wave 63. The
    // timeline engine + downstream MODE classifier were flying blind
    // on the most load-bearing personal variable. Pull the last 7
    // days · the `take: 7` is safe because `date String @unique` so
    // there's exactly one row per day.
    prisma.bodyTracking
      .findMany({
        where: { sleepHours: { not: null } },
        select: { date: true, sleepHours: true },
        orderBy: { date: "desc" },
        take: 7,
      })
      .catch((err): Array<{ date: string; sleepHours: number | null }> => {
        console.warn("[ultron/timelines] bodyTracking.findMany failed:", err instanceof Error ? err.message : err);
        return [];
      }),
  ]);

  // Workout streak = consecutive days with completed=true ending yesterday
  // (today may not be done yet; streak is *prior* context).
  let workoutStreak = 0;
  const sorted = [...habitsWeek].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const h of sorted) {
    if (h.date === todayStr) continue;
    if (h.completed) workoutStreak++;
    else break;
  }

  const workoutToday = habitsToday.find((h) => h.habitKey === "workout");
  const habitsDone = habitsToday.filter((h) => h.completed).length;
  const habitsTotal = habitsToday.length;

  // Dania silence from chat messages (14d window)
  let daniaSilentDays = 14;
  const daniaRx = /\bdania\b|\bwife\b/i;
  for (const m of chatMessages) {
    if (daniaRx.test(m.content)) {
      const days = Math.floor((Date.now() - m.createdAt.getTime()) / 86400000);
      daniaSilentDays = Math.min(daniaSilentDays, days);
    }
  }

  // 2026-05-27 · wired-up. BodyTracking.sleepHours (Float?, one row per
  // date via @unique) feeds the avg. Returns null only when zero rows
  // have a non-null sleepHours — preserves the legacy "missing data →
  // null, caller can pick a proxy" contract that downstream MODE
  // classifier + workout-skip nudges expect. Round to one decimal so
  // ticker rendering ("6.4h avg sleep · ↓1.2h vs target") stays clean.
  let sleepHoursAvg7d: number | null = null;
  const validSleep = sleepRows
    .map((r) => (typeof r.sleepHours === "number" ? r.sleepHours : null))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (validSleep.length > 0) {
    const sum = validSleep.reduce((a, b) => a + b, 0);
    sleepHoursAvg7d = Math.round((sum / validSleep.length) * 10) / 10;
  }

  return {
    workoutDoneToday: !!workoutToday?.completed,
    workoutStreak,
    habitsDone,
    habitsTotal,
    driftOpen: drift,
    daniaSilentDays,
    sleepHoursAvg7d,
    hourOfDay: now.getHours(),
  };
}

/**
 * Generate timelines from the current inputs. Pure function.
 * Returns up to 8 items ordered by severity (warn > caution > info > win).
 */
export function generateTimelines(i: Inputs): Timeline[] {
  const items: Timeline[] = [];

  // Workout skip — only relevant if Nour hasn't done it yet today
  if (!i.workoutDoneToday && i.hourOfDay < 21) {
    if (i.workoutStreak >= 3) {
      items.push({
        id: "skip-workout-streak",
        kind: "if_skip",
        text: `skip workout today → breaks ${i.workoutStreak}d streak · -2 discipline`,
        domain: "body",
        severity: "warn",
      });
    } else {
      items.push({
        id: "skip-workout",
        kind: "if_skip",
        text: `skip workout → -$185 wk rev avg, -2 discipline`,
        domain: "body",
        severity: "warn",
      });
    }
  }

  // Drift accumulating
  if (i.driftOpen >= 3) {
    items.push({
      id: "drift-accumulating",
      kind: "caution",
      text: `${i.driftOpen} drift alerts open · each +day = discipline -0.3`,
      domain: "mind",
      severity: "warn",
    });
  }

  // Habits behind pace
  if (i.habitsTotal > 0 && i.hourOfDay >= 14) {
    const pct = i.habitsDone / i.habitsTotal;
    if (pct < 0.5) {
      items.push({
        id: "habits-behind",
        kind: "at_rate",
        text: `${i.habitsDone}/${i.habitsTotal} habits · closer to D than B grade today`,
        domain: "body",
        severity: "warn",
      });
    }
  }

  // Dania silence
  if (i.daniaSilentDays >= 5) {
    items.push({
      id: "dania-silent",
      kind: "caution",
      text: `Dania ${i.daniaSilentDays}d silent · past pattern: rough at 7+ days`,
      domain: "life",
      severity: i.daniaSilentDays >= 7 ? "warn" : "info",
    });
  }

  // Positive streaks worth protecting
  if (i.workoutStreak >= 7) {
    items.push({
      id: "streak-protect",
      kind: "streak",
      text: `workout streak ${i.workoutStreak}d · discipline peak window · protect`,
      domain: "body",
      severity: "win",
    });
  }

  // Sort: warn first, then info, then win
  const sevOrder: Record<Timeline["severity"], number> = { warn: 0, info: 1, win: 2 };
  items.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  return items.slice(0, 8);
}
