/**
 * Fitness (workout-frequency) analyzer engine · 2026-06-02
 *
 * Ports the `fitness-analyzer` skill's CONSISTENCY methodology (active-day rate
 * + streaks + cadence + recent-vs-prior trend) GROUNDED in the only workout
 * signal statenour actually stores: a daily BOOLEAN. CRITICAL anti-fabrication
 * rule: this is workout-FREQUENCY ONLY. statenour logs whether a workout
 * happened, NOT its type / intensity / duration / load — so the analyzer is
 * EXPLICIT in its result that it measures consistency, not training quality.
 * Nothing about volume or progression is invented.
 *
 * Data sources (the operator's OWN logs · merged by date):
 *   · PersonalDailyLog.workoutCompleted (Boolean)
 *   · BodyTracking.workoutDone (Boolean?) — the /body check-in's own flag
 * A day is ACTIVE if EITHER source is true for that date (union). A day with a
 * false in either source but no true counts as a logged rest day.
 *
 * Architecture (mirrors mental-health.ts / goal.ts / trends.ts EXACTLY): a pure
 * core `computeFitness(input, now)` (unit-tested, no IO, `now` injected for
 * determinism) + a thin IO wrapper `analyzeFitness({days})` (prisma reads ->
 * compute). The agent tool (lib/ai/tools/brain.ts) lazy-imports the wrapper.
 * No model call.
 */
import { prisma } from "@/lib/prisma";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
const MS_PER_DAY = 86_400_000;

/** Minimum logged days for a reliable read (a thinner window is directional). */
const MIN_DAYS = 5;

// ── types ────────────────────────────────────────────────────────────────
export type FitnessTrend = "increasing" | "steady" | "decreasing";

export interface DailyWorkoutRow {
  logDate: Date;
  workoutCompleted: boolean;
}
export interface BodyWorkoutRow {
  date: string;
  workoutDone: boolean | null;
}

/** One merged day: a date + whether it was an active (workout) day. */
export interface WorkoutDay {
  date: Date;
  active: boolean;
}

export interface FitnessAnalysis {
  window: { days: number };
  /** Loud, explicit scope note — frequency only, not training quality. */
  measures: string;
  dataCompleteness: {
    loggedDays: number;
    sufficient: boolean;
    note: string;
  };
  fitness: {
    activeDays: number;
    activeRate: number; // 0-1, fraction of logged days that were active
    currentStreak: number; // consecutive active days ending at the last logged day
    longestStreak: number; // max consecutive active-day run in the window
    avgWorkoutsPerWeek: number; // activeDays normalized to a 7-day week of logged days
    trend: FitnessTrend; // active-rate recent half vs prior half
  } | null;
  guidance: string[];
}

/** Merge daily-log + body workout flags by date. A date is active if EITHER
 *  source is true. Returns logged days sorted ascending. */
function mergeDays(
  daily: DailyWorkoutRow[],
  body: BodyWorkoutRow[],
): WorkoutDay[] {
  const byDate = new Map<string, boolean>();
  for (const d of daily) {
    const key = toDateString(d.logDate);
    byDate.set(key, (byDate.get(key) ?? false) || d.workoutCompleted);
  }
  for (const b of body) {
    if (b.workoutDone == null) continue; // a null body flag isn't a logged day on its own
    byDate.set(b.date, (byDate.get(b.date) ?? false) || b.workoutDone);
  }
  return [...byDate.entries()]
    .map(([date, active]) => ({ date: new Date(date), active }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Longest consecutive active-day run across the ordered logged days. */
function longestRun(days: WorkoutDay[]): number {
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d.active ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** Active-day run ending at the most recent logged day (0 if the last day was rest). */
function trailingRun(days: WorkoutDay[]): number {
  let run = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].active) run += 1;
    else break;
  }
  return run;
}

/**
 * Pure analysis core — synthetic-testable, `now` accepted for signature parity
 * with the sibling analyzers (frequency math is `now`-independent; the param
 * keeps the call shape uniform).
 */
export function computeFitness(
  args: {
    daily: DailyWorkoutRow[];
    body: BodyWorkoutRow[];
    days: number;
  },
  _now: Date,
): FitnessAnalysis {
  const { daily, body, days } = args;
  const measures =
    "Workout FREQUENCY only — statenour logs a daily yes/no, not type, intensity, duration, or load. This reads consistency, not training quality.";

  const merged = mergeDays(daily, body);
  const loggedDays = merged.length;
  const sufficient = loggedDays >= MIN_DAYS;

  const dataCompleteness = {
    loggedDays,
    sufficient,
    note: sufficient
      ? `Based on ${loggedDays} logged day(s) over ~${days} days.`
      : loggedDays === 0
        ? "No workout days logged in this window. Mark workouts in the daily check-in or /body so Nick can track consistency."
        : `Only ${loggedDays} logged day(s) — need >=${MIN_DAYS} for a reliable read. Treat this as directional.`,
  };

  if (loggedDays === 0) {
    return {
      window: { days },
      measures,
      dataCompleteness,
      fitness: null,
      guidance: [
        "Log whether you worked out each day so Nick can track active-day rate and streaks.",
      ],
    };
  }

  const activeDays = merged.filter((d) => d.active).length;
  const activeRate = round(activeDays / loggedDays);
  const currentStreak = trailingRun(merged);
  const longestStreak = longestRun(merged);
  // workouts per week = active-day rate scaled to 7 (logged-day basis, so a
  // sparse window isn't punished for unlogged days — it's a per-logged-day rate).
  const avgWorkoutsPerWeek = round(activeRate * 7, 1);

  // trend — active-rate of the recent half vs the prior half (position split).
  let trend: FitnessTrend = "steady";
  if (loggedDays >= 4) {
    const mid = Math.floor(loggedDays / 2);
    const prior = merged.slice(0, mid);
    const recent = merged.slice(mid);
    const priorRate = prior.filter((d) => d.active).length / prior.length;
    const recentRate = recent.filter((d) => d.active).length / recent.length;
    const delta = recentRate - priorRate;
    if (delta >= 0.15) trend = "increasing";
    else if (delta <= -0.15) trend = "decreasing";
  }

  // ── grounded guidance (derived from the metrics — never invented) ──
  const guidance: string[] = [];
  guidance.push(
    `Trained ${activeDays} of ${loggedDays} logged day(s) (${Math.round(activeRate * 100)}%, ~${avgWorkoutsPerWeek}/wk).`,
  );
  if (currentStreak >= 2) {
    guidance.push(`On a ${currentStreak}-day streak right now — momentum is real.`);
  } else if (currentStreak === 0 && longestStreak >= 2) {
    guidance.push(`Streak is at 0 (last logged day was rest); your best run was ${longestStreak} days.`);
  }
  if (trend === "decreasing") {
    guidance.push("Workout frequency dropped in the recent half of the window — watch the slide.");
  } else if (trend === "increasing") {
    guidance.push("Workout frequency is climbing recently — keep building.");
  }
  if (!sufficient) {
    guidance.push(`Log at least ${MIN_DAYS} days to unlock a reliable read.`);
  }

  return {
    window: { days },
    measures,
    dataCompleteness,
    fitness: {
      activeDays,
      activeRate,
      currentStreak,
      longestStreak,
      avgWorkoutsPerWeek,
      trend,
    },
    guidance,
  };
}

/**
 * IO wrapper — reads the operator's own workout flags and runs the pure core.
 * Each read degrades to [] on error so the tool never throws (mirrors the
 * other brain-tool readers).
 */
export async function analyzeFitness({
  days = 30,
}: { days?: number } = {}): Promise<FitnessAnalysis> {
  const since = daysAgo(days);
  const sinceStr = toDateString(since);
  const [dailyRaw, bodyRaw] = await Promise.all([
    prisma.personalDailyLog
      .findMany({
        where: { logDate: { gte: since } },
        orderBy: { logDate: "asc" },
        select: { logDate: true, workoutCompleted: true },
      })
      .catch((): never[] => []),
    prisma.bodyTracking
      .findMany({
        where: { date: { gte: sinceStr } },
        orderBy: { date: "asc" },
        select: { date: true, workoutDone: true },
      })
      .catch((): never[] => []),
  ]);

  const daily: DailyWorkoutRow[] = dailyRaw.map((d) => ({
    logDate: d.logDate,
    workoutCompleted: d.workoutCompleted,
  }));
  const body: BodyWorkoutRow[] = bodyRaw.map((b) => ({
    date: b.date,
    workoutDone: b.workoutDone,
  }));

  return computeFitness({ daily, body, days }, new Date());
}
