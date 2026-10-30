/**
 * lib/stats/workout-streak.ts · the ONE workout streak every surface shows (2026-10-30, home-pulse W1).
 *
 * The Pulse once showed "1d workout streak" and "workout streak 8d" side by side: the ticker read the
 * DAILY workout task's counter, timelines counted completed rows across every daily habit. Prod that day
 * had no workout flags in PersonalDailyLog or BodyTracking for 14 days; the only live record was the
 * DAILY workout task, whose `streakCount` the completion path maintains. So that counter is the source,
 * live only while its last completion is today or yesterday (ET); older means the streak ended.
 */
import { prisma } from "@/lib/prisma";
import { toDateString } from "@/lib/utils/datetime";

/** Workout-ish title fragments (moved from lib/ultron/timelines.ts, which now imports them). */
const WORKOUT_TITLE_FRAGMENTS = [
  "workout", "gym", "exercise", "lift", "cardio", "run", "10x10", "10 x 10", "planet fitness",
] as const;

export function titleLooksLikeWorkout(title: string): boolean {
  const t = title.toLowerCase();
  return WORKOUT_TITLE_FRAGMENTS.some((frag) => t.includes(frag));
}

export interface StreakTask {
  title: string;
  streakCount: number;
  lastCompletedAt: Date | null;
}

/**
 * Pure: the best live streak among DAILY workout-ish tasks. With none live, falls back to consecutive
 * ET days ending yesterday that have a finished one-off workout task (the "RUN OR 10X10" style), as
 * timelines did before it read this.
 */
export function workoutStreakFrom(
  dailyTasks: ReadonlyArray<StreakTask>,
  now: Date = new Date(),
  doneWorkoutDays: ReadonlyArray<Date> = [],
): number {
  const today = toDateString(now);
  const yesterday = toDateString(new Date(now.getTime() - 86_400_000));
  let best = 0;
  for (const t of dailyTasks) {
    if (!t.lastCompletedAt || !titleLooksLikeWorkout(t.title)) continue;
    const last = toDateString(t.lastCompletedAt);
    if (last !== today && last !== yesterday) continue;
    best = Math.max(best, t.streakCount);
  }
  if (best > 0 || doneWorkoutDays.length === 0) return best;
  const days = new Set(doneWorkoutDays.map(toDateString));
  let run = 0;
  for (let i = 1; i <= 7 && days.has(toDateString(new Date(now.getTime() - i * 86_400_000))); i++) run++;
  return run;
}

/** IO wrapper. null = the read failed (unknown, never a zero streak). */
export async function readWorkoutStreak(now: Date = new Date()): Promise<number | null> {
  try {
    const [daily, done] = await Promise.all([
      prisma.task.findMany({
        where: { loopKind: "DAILY", deletedAt: null },
        select: { title: true, streakCount: true, lastCompletedAt: true },
      }),
      prisma.task.findMany({
        where: { status: "DONE", deletedAt: null, updatedAt: { gte: new Date(now.getTime() - 8 * 86_400_000) } },
        select: { title: true, updatedAt: true },
      }),
    ]);
    const doneDays = done.filter((t) => titleLooksLikeWorkout(t.title)).map((t) => t.updatedAt);
    return workoutStreakFrom(daily, now, doneDays);
  } catch {
    return null;
  }
}
