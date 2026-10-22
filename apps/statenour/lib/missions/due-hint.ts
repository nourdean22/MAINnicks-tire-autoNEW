/**
 * Due-date hint for a mission task row ("today", "2d late", "Oct 30").
 * Lifted from components/missions/mission-task-row.tsx so the day math can be
 * tested with a pinned `now`.
 *
 * The due date is a calendar day stored as UTC midnight (a `type="date"` input
 * through z.coerce.date()), so read its UTC date and compare it with the
 * viewer's local today. A raw millisecond gap put "today" on the evening
 * before and "1d late" on the due day itself west of UTC (bug hunt 2026-10-22).
 */
export function formatDueHint(due: string | null | undefined, now: Date = new Date()): string | null {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const dueDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((dueDay - today) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
