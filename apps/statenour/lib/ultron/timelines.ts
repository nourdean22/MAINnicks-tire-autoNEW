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
  todayScoreLogged: boolean;
  energyToday: number | null;
  focusToday: number | null;
  disciplineToday: number | null;
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

  // v10.0.59 · Wave A part 2 · scores + habits via legacy-shims.
  // habitsToday filters today's rows from the synthesized habit
  // history; habitsWeek slices the last 7 days. lastScore is the
  // most-recent identity_snapshot row.
  const [lastScore, habitsToday, habitsWeek, drift, chatMessages] = await Promise.all([
    (async () => {
      const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
      const all = await recentScoreSnapshots(1);
      return all[0] ?? null;
    })(),
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
    prisma.driftAlert.count({ where: { resolved: false } }).catch(() => 0),
    prisma.chatMessage
      .findMany({
        where: { role: "user", createdAt: { gte: daysAgo(14) } },
        select: { content: true, createdAt: true },
        take: 100,
      })
      .catch((): Array<{ content: string; createdAt: Date }> => []),
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

  // Sleep hours avg (if the score rows carry it) — NourState schema doesn't
  // always expose sleep_hours. We'll use focus as a proxy when sleep is missing.
  const sleepHoursAvg7d: number | null = null; // TODO v3 when we have sleep tracking

  return {
    todayScoreLogged: !!lastScore,
    energyToday: lastScore?.energyLevel ?? null,
    focusToday: lastScore?.focusQuality ?? null,
    disciplineToday: lastScore?.disciplineScore ?? null,
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

  // Score not logged
  if (!i.todayScoreLogged && i.hourOfDay >= 11) {
    items.push({
      id: "no-score",
      kind: "caution",
      text: `no score logged → decision quality ↓22% · 30s to fix`,
      domain: "mind",
      severity: "warn",
    });
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

  // Energy low warning
  if (i.energyToday !== null && i.energyToday <= 4) {
    items.push({
      id: "low-energy",
      kind: "caution",
      text: `energy ${i.energyToday}/10 · defer big decisions · protect sleep`,
      domain: "body",
      severity: "warn",
    });
  }

  // Focus low warning
  if (i.focusToday !== null && i.focusToday <= 4 && i.hourOfDay < 18) {
    items.push({
      id: "low-focus",
      kind: "caution",
      text: `focus ${i.focusToday}/10 · switch to physical tasks`,
      domain: "mind",
      severity: "info",
    });
  }

  // Positive: score logged early
  if (i.todayScoreLogged && i.hourOfDay < 10) {
    items.push({
      id: "early-log",
      kind: "at_rate",
      text: `score logged early · discipline compounds today`,
      domain: "mind",
      severity: "win",
    });
  }

  // Sort: warn first, then info, then win
  const sevOrder: Record<Timeline["severity"], number> = { warn: 0, info: 1, win: 2 };
  items.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  return items.slice(0, 8);
}
