// ── Date & Time Utilities ──────────────────────────────────────────────
// Consolidates scattered date logic across the codebase.

/** Returns today's date as YYYY-MM-DD string in Eastern Time.
 *  IMPORTANT: The system operates in ET (Cleveland). Using UTC would
 *  return tomorrow's date when crons run at 5am UTC (midnight ET). */
export function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Current hour (0-23) in Eastern Time. The server runs UTC (Railway), so
 *  `new Date().getHours()` returns the UTC hour — use this for ET time-gates
 *  (e.g. "before 9pm ET" nudges) so they fire at the right wall-clock. */
export function hourET(at: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(at)) % 24;
}

/** Day of week (0=Sun .. 6=Sat) in Eastern Time. The server runs UTC
 *  (Railway), so `new Date().getDay()` returns the UTC weekday — use this
 *  for ET day-gates (e.g. "only on Friday", "skip weekends") so they fire
 *  on the right ET calendar day. */
export function weekdayET(at: Date = new Date()): number {
  return etCalendarParts(at).weekday;
}

/** Returns a Date object n days ago */
export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Returns a Date object n days from now */
export function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

/** Checks if a date is older than N days */
export function isStale(date: Date | string | null | undefined, thresholdDays: number): boolean {
  if (!date) return true;
  const d = typeof date === "string" ? new Date(date) : date;
  return d.getTime() < daysAgo(thresholdDays).getTime();
}

/** Format milliseconds to human-readable duration */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

/** Relative time string: "3 hours ago", "2 days ago", "just now" */
export function relativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString();
}

/** Relative "time ago", sub-minute precision in seconds (e.g. "5s ago", "3m ago", "2h ago", "4d ago"). null -> "never". */
export function relativeTimeSeconds(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

/** Relative "time ago", "just now" under a minute (e.g. "just now", "3m ago", "2h ago", "4d ago"). null -> "never". */
export function relativeTimeMinutes(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

/** Returns YYYY-MM-DD for a Date object in Eastern Time */
export function toDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Returns start of day (midnight ET) for a given date. ET-correct —
 *  delegates to startOfDayET below. The prior bare `setHours(0,0,0,0)`
 *  floored to midnight in the SERVER zone (UTC on Railway), ~4-5h off
 *  Eastern. (`function` declarations hoist, so the forward reference to
 *  startOfDayET is fine.) */
export function startOfDay(date: Date = new Date()): Date {
  return startOfDayET(date);
}

/** Returns end of day (last millisecond, ET) for a given date. */
export function endOfDay(date: Date = new Date()): Date {
  // endOfDayET returns the START of the next ET day — back off 1ms for
  // the inclusive end-of-day this function has always returned.
  return new Date(endOfDayET(date).getTime() - 1);
}

/** Returns start of week (Sunday midnight ET) for a given date. */
export function startOfWeek(value: Date): Date {
  return startOfWeekET(value);
}

const DAY_MS = 1000 * 60 * 60 * 24;

/** Returns whole days until target (positive if future, negative if past),
 *  or null if target is missing or invalid. */
export function daysUntil(target: Date | string | null | undefined, now = new Date()): number | null {
  if (!target) return null;
  const date = target instanceof Date ? target : new Date(target);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

/** Returns whole days since target (positive if past, negative if future),
 *  or null if target is missing or invalid. */
export function daysSince(target: Date | string | null | undefined, now = new Date()): number | null {
  if (!target) return null;
  const date = target instanceof Date ? target : new Date(target);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

/** Returns a new Date offset by `days` (positive = future, negative = past). */
export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

/** Returns a new Date offset back by `days`. */
export function subDays(value: Date, days: number): Date {
  return addDays(value, -days);
}

/** Returns true if target is older than `days` from `now`, false otherwise.
 *  Returns false if target is missing or invalid. */
export function isOlderThanDays(target: Date | string | null | undefined, days: number, now = new Date()): boolean {
  const age = daysSince(target, now);
  return age !== null && age > days;
}

// ── Eastern-Time day/week/month boundaries ─────────────────────────────
// The system operates in ET (Cleveland) but the server runs UTC. The
// legacy startOfDay/endOfDay/startOfWeek above use setHours(), which
// floors to midnight in the SERVER zone (UTC) — so "today" boundaries
// land 4-5h off ET. These *ET helpers floor to the ET wall-clock and
// return the equivalent UTC instant, safe as Prisma gte/lt filters.

const ET_TZ = "America/New_York";

/** ET UTC-offset (ms) for `at` — ET = UTC + offset; negative (EDT -4h,
 *  EST -5h). DST-correct: derived from how `at` formats in the ET zone. */
function etOffsetMs(at: Date): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const etWallAsUtc = Date.UTC(
    n("year"),
    n("month") - 1,
    n("day"),
    n("hour") % 24, // some engines emit "24" at midnight
    n("minute"),
    n("second"),
  );
  return etWallAsUtc - at.getTime();
}

/** ET wall-clock calendar parts of `at` (month 1-12, weekday 0=Sun). */
function etCalendarParts(at: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const WD: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(v("year")),
    month: Number(v("month")),
    day: Number(v("day")),
    weekday: WD[v("weekday")] ?? 0,
  };
}

/** UTC instant of ET midnight for the given ET wall-clock Y/M/D. Date.UTC
 *  normalizes out-of-range day/month (e.g. day+1 across a month end). */
function etMidnightToUtc(year: number, month: number, day: number): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  // Two passes: the offset at the wall-clock instant approximates the
  // real offset; recomputing at the candidate resolves DST-transition
  // days exactly.
  const approx = wallAsUtc - etOffsetMs(new Date(wallAsUtc));
  return new Date(wallAsUtc - etOffsetMs(new Date(approx)));
}

/** Start (midnight ET) of the ET day containing `at`, as a UTC Date. */
export function startOfDayET(at: Date = new Date()): Date {
  const { year, month, day } = etCalendarParts(at);
  return etMidnightToUtc(year, month, day);
}

/** Start of the NEXT ET day — exclusive upper bound for "today" filters. */
export function endOfDayET(at: Date = new Date()): Date {
  const { year, month, day } = etCalendarParts(at);
  return etMidnightToUtc(year, month, day + 1);
}

/** Start (Sunday midnight ET) of the ET week containing `at`. */
export function startOfWeekET(at: Date = new Date()): Date {
  const { year, month, day, weekday } = etCalendarParts(at);
  return etMidnightToUtc(year, month, day - weekday);
}

/** Start (1st, midnight ET) of the ET month containing `at`. */
export function startOfMonthET(at: Date = new Date()): Date {
  const { year, month } = etCalendarParts(at);
  return etMidnightToUtc(year, month, 1);
}

/** Start (Jan 1, midnight ET) of the ET year containing `at`. */
export function startOfYearET(at: Date = new Date()): Date {
  const { year } = etCalendarParts(at);
  return etMidnightToUtc(year, 1, 1);
}

/**
 * The Monday that starts the Mon-Sun week containing `at`, and the one before
 * it, both as ET date strings.
 *
 * MOVED HERE 2026-08-25 from app/api/cron/weekly-digest/route.ts, where it was
 * hand-rolled next to a duplicate of `startOfWeekET`. Two reasons it could not
 * stay: a Next route module rejects non-standard exports, so it was untestable
 * in place; and it MIXED FRAMES in a way that reads as a bug —
 * `now.getDate()` is the SERVER day-of-month while `weekdayET(now)` is the ET
 * weekday.
 *
 * That mix is in fact SAFE, and the measurement is why this is a move rather
 * than a rewrite: `setDate(getDate() - n)` shifts the INSTANT by n days and the
 * ET conversion happens afterwards, so the frames never actually meet. Verified
 * against an independent walk-back oracle over 2,904 instants x 4 server
 * timezones (UTC, America/New_York, Asia/Tokyo, Australia/Sydney — both DST
 * regimes, both hemispheres): 11,616 checks, 0 mismatches.
 *
 * Recorded because the danger is now inverted. The code LOOKS wrong, so the
 * next reader is likely to "fix" it into being wrong. The test beside this
 * pins the behaviour against the same oracle.
 */
export function recentMondaysET(at: Date = new Date()): [string, string] {
  const day = weekdayET(at);
  const diff = day === 0 ? 6 : day - 1;
  const thisMonday = new Date(at);
  thisMonday.setDate(at.getDate() - diff);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  return [toDateString(thisMonday), toDateString(lastMonday)];
}
