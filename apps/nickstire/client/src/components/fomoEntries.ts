/**
 * fomoEntries — pure entry-selection for the FomoTicker social-proof toast.
 *
 * HONESTY GUARANTEE: the ticker shows ONLY real recent activity returned by
 * the server (`trpc.activity.recent` → real bookings, completed invoices, and
 * real >=4-star reviews; see server/routers/public.ts:166). There is NO
 * fabricated fallback. When the server has no real activity (early morning,
 * a slow day, or a failed query), this returns an empty list and the ticker
 * renders nothing — mirroring LiveVisitorCounter's "hide rather than fake"
 * compliance pattern. This function can NEVER inject content that wasn't in
 * its input, by construction.
 *
 * Removed 2026 public-UI-quality pass: the old hardcoded FALLBACK_ENTRIES
 * (invented bookings + invented 5-star review quotes with fake timestamps),
 * which violated the "no fake proof / no fake reviews" guardrail.
 */

export interface FomoEntry {
  type: "booking" | "completed" | "review";
  message: string;
  minutesAgo: number;
}

/** Max entries to cycle through, matching the server's own `.slice(0, 10)`. */
export const MAX_FOMO_ENTRIES = 10;

/**
 * Oldest an entry may be and still be shown as current activity (7 days).
 *
 * Defence in depth, not the primary fix. The root cause of the 2026-09-17
 * defect was server-side: `activity.recent`'s review branch filtered on
 * rating alone, so it returned the newest >=4-star review at any age and
 * labelled it "New N-star review" — live, that was a review ~83 days old.
 * That query is now date-bounded (see REVIEW_MAX_AGE_DAYS in
 * server/routers/public.ts). This bound exists so that if ANY future branch
 * leaks a stale row, a toast headed "just booked" / "New review" still cannot
 * render it as current. Dropping a stale entry is consistent with this
 * module's existing rule: hide rather than fake.
 */
export const MAX_ENTRY_AGE_MINUTES = 7 * 24 * 60;

/**
 * Relative age for display. Rolls over to days — the previous inline
 * formatter stopped at hours, so an 83-day-old entry rendered as "1987h ago".
 */
export function formatAgo(minutesAgo: number): string {
  const m = Math.max(0, Math.round(minutesAgo));
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const hours = Math.round(m / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Resolve the entries the ticker may display. Real server activity only —
 * never fabricated, and never stale enough to misrepresent as current.
 * Returns `[]` for missing/empty/invalid input so the component hides
 * instead of inventing social proof.
 */
export function resolveFomoEntries(realActivity: FomoEntry[] | null | undefined): FomoEntry[] {
  if (!Array.isArray(realActivity) || realActivity.length === 0) return [];
  return realActivity
    .filter((e) => typeof e?.minutesAgo === "number" && e.minutesAgo <= MAX_ENTRY_AGE_MINUTES)
    .slice(0, MAX_FOMO_ENTRIES);
}
