/**
 * When is an urgent review CLOSED?
 *
 * THE DEFECT, measured against production 2026-08-25.
 *
 * Two tables mirror the same seven Google reviews:
 *
 *   review_pipeline  - what the daily "URGENT REVIEWS" Telegram reads.
 *                      Its clear-condition is `reviewed = 0`.
 *   review_replies   - where the draft lives and where the admin's
 *                      approve / mark-posted workflow writes `posted_at`.
 *
 * Those are different tables, and nothing bridges them. Grepped repo-wide:
 * every reference to `review_pipeline.reviewed` and `.responseSent` is a READ.
 * No code path assigns either one. Confirmed against prod rather than trusted
 * from the grep - all 7 rows are `reviewed = 0, responseSent = 0`, and 0 of 7
 * review_replies rows have ever been approved or posted, the oldest 256 days.
 *
 * The consequence is not "an alert nobody reads". It is an alert that CANNOT
 * BE CLEARED. Replying on Google and marking the reply posted - using the
 * product exactly as designed - leaves `reviewed = 0`, so the same 1-star
 * review is re-announced every day forever. An alert with no off switch is
 * training, and what it trains is dismissal.
 *
 * This module supplies the missing bridge as a pure decision, so it can be
 * tested without a database and cannot disagree with itself across callers.
 */

/**
 * The star cut for "urgent". NOT a new number: it is the bound already used
 * by getUrgentReviews(), hoisted so the reader and this closure rule cannot
 * drift apart. Note that `<= 2` and `<= 3` currently select the same single
 * row - production holds no 2-star or 3-star review at all - so the cut point
 * is undertested by data. Stated rather than implied.
 */
export const URGENT_MAX_STARS = 2;

/** A posted reply, reduced to the fields that identify which review it answers. */
export interface PostedReply {
  reviewerName: string | null;
  reviewRating: number | null;
}

/** The pipeline row being judged. */
export interface UrgentCandidate {
  authorName: string | null;
  rating: number | null;
}

export type Closure = "open" | "posted" | "ambiguous";

/** Case- and whitespace-insensitive; Google echoes display names inconsistently. */
function nameKey(n: string | null | undefined): string {
  return (n ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Has this review already been answered?
 *
 * The two tables share no key - review_pipeline carries no Google review id,
 * only author name, rating and text - so the correlation is (author, rating).
 *
 * That is imprecise by construction, which is why more than one match returns
 * "ambiguous" and is treated as still OPEN by the caller. Two customers with
 * the same display name and the same star rating must not let one posted reply
 * silence the other's review: a false "closed" hides a real 1-star complaint,
 * which is strictly worse than one extra day of alert.
 */
export function closureFor(candidate: UrgentCandidate, posted: PostedReply[]): Closure {
  const key = nameKey(candidate.authorName);
  if (key === "") return "open";
  const hits = posted.filter(
    (p) => nameKey(p.reviewerName) === key && p.reviewRating === candidate.rating,
  );
  if (hits.length > 1) return "ambiguous";
  return hits.length === 1 ? "posted" : "open";
}

/** Only a confident "posted" suppresses an alert. Ambiguity stays loud. */
export function suppressesAlert(c: Closure): boolean {
  return c === "posted";
}
