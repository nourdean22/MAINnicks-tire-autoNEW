// ── Date & Time Utilities ──────────────────────────────────────────────
// Consolidates scattered date logic across the codebase.

/** Returns today's date as YYYY-MM-DD string in Eastern Time.
 *  IMPORTANT: The system operates in ET (Cleveland). Using UTC would
 *  return tomorrow's date when crons run at 5am UTC (midnight ET). */
export function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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

/** Returns YYYY-MM-DD for a Date object in Eastern Time */
export function toDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Returns start of day (midnight) for a given date */
export function startOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Returns end of day (23:59:59.999) for a given date */
export function endOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Returns start of week (Sunday midnight) for a given date */
export function startOfWeek(value: Date): Date {
  const next = startOfDay(value);
  const day = next.getDay();
  next.setDate(next.getDate() - day);
  return next;
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
