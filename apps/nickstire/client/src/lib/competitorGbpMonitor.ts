/**
 * Competitor GBP monitor — the watch list + what to record weekly.
 *
 * 2026-06-10 GBP growth wave. There IS a server-side competitor poller
 * (services/competitorMonitor writes competitor_snapshots + Telegram
 * alerts), but no admin read surface — the operator can't see trends.
 * This module is the read-side model + the manual collection schema so
 * the data has a home until a richer admin view ships.
 *
 * No scraping happens here. The baseline figures below are the
 * audit-captured snapshot (2026-06, source: operator GBP review) — they
 * are a STARTING POINT to compare against, explicitly dated, never
 * presented as live. Do not fabricate movement; only the owner (or the
 * existing poller) updates real numbers.
 */

export interface CompetitorBaseline {
  name: string;
  /** As captured in the 2026-06 audit snapshot. */
  rating: number;
  reviewCount: number;
  note?: string;
}

export const COMPETITOR_BASELINE_DATE = "2026-06";

export const COMPETITORS: CompetitorBaseline[] = [
  { name: "Moe's Tire Center", rating: 4.3, reviewCount: 639, note: "Largest review volume in the set." },
  { name: "Moe's Tire Center 3", rating: 4.2, reviewCount: 379 },
  { name: "St.Clair Tire", rating: 4.9, reviewCount: 156, note: "Highest rating — the bar to beat on quality signal." },
  { name: "Bro's Tires", rating: 4.4, reviewCount: 267 },
  { name: "EJ'S Tire & Auto Repair", rating: 4.7, reviewCount: 81 },
];

/** What to record for each competitor on the weekly check. */
export const WEEKLY_CHECK_FIELDS = [
  "Review count (vs last week / vs baseline)",
  "Star rating",
  "New GBP posts since last check",
  "New photos since last check",
  "Q&A activity (new questions/answers)",
  "Owner response presence (do they reply to reviews?)",
  "Visible service emphasis (what they're pushing)",
  "Profile completeness (categories, hours, attributes)",
] as const;

/** A single weekly observation row (owner-entered or poller-fed). */
export interface CompetitorObservation {
  name: string;
  weekOf: string; // YYYY-MM-DD
  rating: number | null;
  reviewCount: number | null;
  newPosts: number | null;
  newPhotos: number | null;
  ownerResponds: boolean | null;
  notes: string;
}

/**
 * Where Nick's stands vs the set on review VOLUME (the gap most worth
 * closing). Pure helper for the read surface — takes Nick's current
 * count and returns the volume gap to each competitor.
 */
export function reviewVolumeGaps(nicksReviewCount: number): Array<{ name: string; gap: number }> {
  return COMPETITORS.map((c) => ({ name: c.name, gap: c.reviewCount - nicksReviewCount }))
    .sort((a, b) => b.gap - a.gap);
}
