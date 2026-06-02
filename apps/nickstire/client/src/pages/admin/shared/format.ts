/**
 * wave-118 — single source of truth for date formatting across admin.
 * Audit found admin sections using `toLocaleDateString()` /
 * `toLocaleString()` ad-hoc, producing inconsistent formats depending
 * on the operator's locale + each developer's whim. These helpers
 * pin the format so every section displays dates the same way on
 * phone + desktop.
 *
 * Defaults are sized for the admin's compact layouts:
 *  · formatDate(d)        → "May 9, 2026"   (short month, no time)
 *  · formatDateTime(d)    → "May 9, 2026, 3:42 PM"
 *  · formatRelativeDate(d)→ "today" / "yesterday" / "3 days ago" / "May 9"
 *
 * All accept Date | string | number | null | undefined; null/undefined
 * returns "—" so callers don't need null-guards. Locale pinned to
 * en-US so the format doesn't drift on operator-locale changes.
 */
export function formatDate(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return "—";
  const date = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return "—";
  const date = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export function formatRelativeDate(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return "—";
  const date = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return formatDate(date); // future
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDate(date); // older — show absolute
}

/**
 * Compact "time since" for live/streaming admin panels (audit log, snap feed).
 * Output: "5s ago" / "12m ago" / "3h ago" / "4d ago". Prefer formatRelativeDate
 * for human calendar phrasing ("today" / "yesterday" / "May 9").
 */
export function timeAgoShort(d: Date | string | number): string {
  const date = new Date(d);
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
