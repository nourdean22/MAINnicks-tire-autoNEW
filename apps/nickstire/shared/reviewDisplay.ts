/**
 * Which reviews may be shown as social proof.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * The server-side review queries already floor at 4 stars
 * (`gte(reviewReplies.reviewRating, 4)` in routers/public.ts), so
 * CityReviewsBlock and ServiceReviewsBlock were never at risk. NeighborhoodPage
 * is different: it renders the LIVE Google feed from `trpc.reviews.google` and
 * filtered it by TEXT LENGTH ONLY (40-400 characters), with no rating
 * condition at all.
 *
 * Measured against the live endpoint 2026-08-29, that feed's first entry is a
 * 1-star review opening "If I could rate 0 I would!!". It fails to render today
 * only because it happens to run past 400 characters. A shorter negative review
 * - or the same one edited down - renders as social proof across 59
 * neighborhood pages, on the surface a customer checks immediately before
 * deciding whether to call.
 *
 * Nobody would argue for showing a 1-star review as social proof, which is why
 * this needed no decision from the owner: it is a defect, not a policy.
 *
 * ── ONE FLOOR, NOT TWO ──────────────────────────────────────────────────────
 * The constant lives here so the client and the SQL cannot drift apart. A test
 * asserts the server's literal still matches this value - two independently
 * maintained floors is how one of them silently becomes 1.
 */

/**
 * Minimum star rating for a review used as social proof.
 *
 * 4, matching the existing server-side floor. Not 5: a considered 4-star review
 * reads as credible rather than curated, and the account's own rating is 4.9 -
 * a wall of nothing but 5s is less believable than the truth.
 */
export const MIN_DISPLAYABLE_REVIEW_RATING = 4;

/** Shortest review with enough substance to be worth the space. */
export const MIN_REVIEW_TEXT_CHARS = 40;
/** Longest review that still fits a card without truncation. */
export const MAX_REVIEW_TEXT_CHARS = 400;

/** The fields this module needs. Deliberately loose so any feed shape fits. */
export interface DisplayableReviewInput {
  text?: string | null;
  rating?: number | null;
}

/**
 * May this review be shown as social proof?
 *
 * A MISSING RATING IS NOT A PASS. An undefined rating means the feed did not
 * tell us, and "we could not determine the rating" is not evidence the review
 * is positive - that is precisely the assumption that lets a 1-star through
 * when an API changes shape.
 */
export function isDisplayableReview(r: DisplayableReviewInput): boolean {
  const text = String(r?.text ?? "");
  if (text.length < MIN_REVIEW_TEXT_CHARS || text.length > MAX_REVIEW_TEXT_CHARS) return false;
  if (typeof r?.rating !== "number" || Number.isNaN(r.rating)) return false;
  return r.rating >= MIN_DISPLAYABLE_REVIEW_RATING;
}
