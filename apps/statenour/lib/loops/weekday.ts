/**
 * 2026-06-06 · WEEKLY task recurrence · pure weekday math (no deps, testable).
 */

/**
 * The next calendar date at local midnight strictly AFTER `from` whose
 * weekday is in `days` (0=Sunday .. 6=Saturday · JS Date.getDay()).
 *
 * Used to snooze a completed WEEKLY task until its next scheduled day — the
 * task-resurface cron then flips it WAITING → READY when that midnight passes.
 * Returns null when `days` is empty or contains no valid 0–6 entry (a WEEKLY
 * task with no days configured then just stays READY, like DAILY).
 */
export function nextWeekdayOccurrence(days: number[], from: Date): Date | null {
  const set = new Set((days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (set.size === 0) return null;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (set.has(d.getDay())) return d;
  }
  return null;
}
