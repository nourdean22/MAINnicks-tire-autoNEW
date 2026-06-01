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
