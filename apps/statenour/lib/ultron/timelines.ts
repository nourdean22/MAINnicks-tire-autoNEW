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
import { daysAgo, hourET, toDateString } from "@/lib/utils/datetime";

export interface Timeline {
  id: string;
  kind: "if_skip" | "if_do" | "at_rate" | "caution" | "streak";
  text: string;
  domain: "body" | "mind" | "money" | "life" | "system";
  severity: "info" | "warn" | "win";
}

interface Inputs {
  workoutDoneToday: boolean;
  /** Whether workouts are tracked AT ALL (a DAILY workout habit exists, or a
   *  workout-ish task was completed in the last 7d). When false the
   *  skip-workout warn is suppressed — pre-fix, zero DAILY tasks existed in
   *  prod so "skip workout → -2 discipline" fired every day before 9 PM
   *  forever, regardless of actual workouts logged as ONCE tasks. */
  tracksWorkouts: boolean;
  workoutStreak: number;           // days in a row before today
  habitsDone: number;
  habitsTotal: number;
  driftOpen: number;
  sleepHoursAvg7d: number | null;
  hourOfDay: number;
}

/** Workout-ish task-title fragments — same fuzzy-match family as
 *  ultron-ticker's fetchSelfMetricsTop (workout/move/gym/exercise), extended
 *  with the vocabulary Nour actually uses ("RUN OR 10X10", "run plus 10 x 10"). */
const WORKOUT_TITLE_FRAGMENTS = [
  "workout", "gym", "exercise", "lift", "cardio", "run", "10x10", "10 x 10", "planet fitness",
] as const;

function titleLooksLikeWorkout(title: string): boolean {
  const t = title.toLowerCase();
  return WORKOUT_TITLE_FRAGMENTS.some((frag) => t.includes(frag));
}

export async function computeInputs(): Promise<Inputs> {
  const now = new Date();
  const todayStr = toDateString(now);
  const weekAgo = daysAgo(7);

  // v10.0.59 · Wave A part 2 · habits via legacy-shims. habitsToday
  // filters today's rows from the synthesized habit history; habitsWeek
  // slices the last 7 days. (Daily-score inputs removed 2026-05-31 — the
  // score-derived timeline items were retired in the score→reflection pivot.)
  const [habitsToday, habitsWeek, drift, sleepRows, doneWorkoutTasks] = await Promise.all([
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
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
        },
        select: { metadata: true },
      })
      .then((rows) => {
        return rows.filter((r) => {
          const meta = (r.metadata ?? {}) as Record<string, any>;
          return !meta.ackedAt;
        }).length;
      })
      .catch((err) => {
        console.warn("[ultron/timelines] brainMemory.count for drift-recovery failed:", err instanceof Error ? err.message : err);
        return 0;
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
    // Workout evidence from COMPLETED tasks (any loopKind). Nour logs
    // workouts as ONCE tasks ("RUN OR 10X10"), not DAILY habits — the
    // habit-only detection above never sees them. Fuzzy title filter
    // happens in JS (titleLooksLikeWorkout) since the fragment list
    // outgrows a Prisma OR-contains cleanly.
    prisma.task
      .findMany({
        where: {
          status: "DONE",
          deletedAt: null,
          updatedAt: { gte: weekAgo },
        },
        select: { title: true, updatedAt: true },
      })
      .catch((err): Array<{ title: string; updatedAt: Date }> => {
        console.warn("[ultron/timelines] task.findMany for workout evidence failed:", err instanceof Error ? err.message : err);
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

  // Habit-based signal (kept for anyone who DOES run a DAILY habit) — fuzzy
  // title match instead of the old exact `=== "workout"`, which could never
  // match real task titles like "Morning Workout" or "Gym".
  const workoutToday = habitsToday.find((h) => titleLooksLikeWorkout(h.habitKey));
  const habitsDone = habitsToday.filter((h) => h.completed).length;
  const habitsTotal = habitsToday.length;

  // Task-based signal — a workout-ish task completed TODAY counts as done,
  // whatever its loopKind. `toDateString` keeps the comparison in ET.
  const workoutTasks = doneWorkoutTasks.filter((t) => titleLooksLikeWorkout(t.title));
  const workoutTaskDoneToday = workoutTasks.some(
    (t) => toDateString(t.updatedAt) === todayStr,
  );
  const tracksWorkouts = workoutToday !== undefined || workoutTasks.length > 0;

  // No DAILY habit streak → derive one from completed workout-ish tasks
  // (consecutive ET days ending yesterday), so streak items work for the
  // ONCE-task tracking style actually in use.
  if (workoutStreak === 0 && workoutTasks.length > 0) {
    const daysWithWorkout = new Set(workoutTasks.map((t) => toDateString(t.updatedAt)));
    for (let i = 1; i <= 7; i++) {
      const day = new Date(now.getTime() - i * 86400_000);
      if (daysWithWorkout.has(toDateString(day))) workoutStreak++;
      else break;
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
    workoutDoneToday: !!workoutToday?.completed || workoutTaskDoneToday,
    tracksWorkouts,
    workoutStreak,
    habitsDone,
    habitsTotal,
    driftOpen: drift,
    sleepHoursAvg7d,
    hourOfDay: hourET(now),
  };
}

/**
 * Generate timelines from the current inputs. Pure function.
 * Returns up to 8 items ordered by severity (warn > caution > info > win).
 */
export function generateTimelines(i: Inputs): Timeline[] {
  const items: Timeline[] = [];

  // Workout skip — only when workouts are tracked at all AND not done yet
  // today. Without the tracksWorkouts gate this warned unconditionally
  // every day (prod had zero DAILY tasks, so workoutDoneToday was always
  // false) — a permanent false "skip workout → -2 discipline" in the pulse.
  if (i.tracksWorkouts && !i.workoutDoneToday && i.hourOfDay < 21) {
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
        text: `skip workout → -2 discipline · breaks momentum`,
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
      text: `${i.driftOpen} open loops. Close 3 today.`,
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
