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
 * Resolve the entries the ticker may display. Real server activity only —
 * never fabricated. Returns `[]` for missing/empty/invalid input so the
 * component hides instead of inventing social proof.
 */
export function resolveFomoEntries(realActivity: FomoEntry[] | null | undefined): FomoEntry[] {
  if (!Array.isArray(realActivity) || realActivity.length === 0) return [];
  return realActivity.slice(0, MAX_FOMO_ENTRIES);
}
