/**
 * Birthday day-counts on Nour's clock, America/New_York (people W0, 2026-10-30).
 *
 * The picks, the watchlist and the birthday cron each took today's month-day
 * from `toISOString()` (UTC), so from 20:00 ET an evening look counted from
 * tomorrow. One helper, one clock.
 */
import { toDateString } from "@/lib/utils/datetime";

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "MM-DD" for `now` in America/New_York. */
export function monthDayET(now: Date = new Date()): string {
  return toDateString(now).slice(5, 10);
}

/**
 * Whole days from today (ET) to the next occurrence of `birthday` ("YYYY-MM-DD";
 * the year may be a placeholder), 0 = today. Feb 29 falls on Mar 1 in a common
 * year. Null for a missing or malformed date.
 */
export function daysUntilBirthday(birthday: string | null | undefined, now: Date = new Date()): number | null {
  const b = birthday ? ISO_DATE.exec(birthday) : null;
  if (!b) return null;
  const bm = Number(b[2]);
  const bd = Number(b[3]);
  // A real calendar day: 2000 is a leap year, so Feb 29 passes and Feb 30 / Apr 31 do not.
  if (bm < 1 || bm > 12 || new Date(Date.UTC(2000, bm - 1, bd)).getUTCDate() !== bd) return null;
  const [ty, tm, td] = toDateString(now).split("-").map(Number);
  const today = Date.UTC(ty, tm - 1, td);
  let next = Date.UTC(ty, bm - 1, bd);
  if (next < today) next = Date.UTC(ty + 1, bm - 1, bd);
  return Math.round((next - today) / DAY_MS);
}
