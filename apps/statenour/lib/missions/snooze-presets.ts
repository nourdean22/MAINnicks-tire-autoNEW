/**
 * Snooze presets: the instants every snooze affordance offers, and the copy
 * that may promise them.
 *
 * The only reviver is cron task-resurface (config/crons.ts), once a day at
 * RESURFACE_HOUR_UTC. It flips WAITING to READY when snoozedUntil <= now. A
 * snooze therefore comes back at the first run AT OR AFTER its instant, so
 * every preset lands at midnight ET of the target day: the 09:00Z run that
 * morning picks it up (05:00 EDT, 04:00 EST). The old 06:00-local presets
 * landed after that run and came back a day late (job 2026-10-23, map F7).
 * tests/lib/missions/snooze-presets.test.ts pins the cron string and both
 * DST regimes.
 */
import { etMidnightToUtc } from "@/lib/utils/datetime";

/** Hour (UTC) of the daily task-resurface run. Must match config/crons.ts. */
export const RESURFACE_HOUR_UTC = 9;

/** What the presets may promise: the latest ET hour the run lands (05:00 EDT, 04:00 EST). */
export const RESURFACE_PROMISE = "by 5 am";

function etYmd(at: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday };
}

/** Midnight ET, `days` ET calendar days after today. */
export function inDaysMorning(days: number, now: Date = new Date()): string {
  const { year, month, day } = etYmd(now);
  return etMidnightToUtc(year, month, day + days).toISOString();
}

export function tomorrowMorning(now: Date = new Date()): string {
  return inDaysMorning(1, now);
}

/** Midnight ET of the next Monday; on a Monday, the following one. */
export function nextMondayMorning(now: Date = new Date()): string {
  const { weekday } = etYmd(now);
  const daysUntilNextMon = weekday === 1 ? 7 : (8 - weekday) % 7 || 7;
  return inDaysMorning(daysUntilNextMon, now);
}
