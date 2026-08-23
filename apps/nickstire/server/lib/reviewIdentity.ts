/**
 * Stable identity for an inbound Google review.
 *
 * --- The defect this removes ------------------------------------------
 *
 * Two sites derived the dedup key like this:
 *
 *   const reviewId = review.time?.toString() || `${author_name}_${Date.now()}`
 *
 * and then used it as the existence check:
 *
 *   .where(eq(reviewReplies.reviewId, reviewId))   // -> if found, `continue`
 *
 * When `review.time` is absent the key embeds `Date.now()`, so it is a NEW
 * identity on every pass and the existence check can never match a prior row.
 * The same review would be inserted again every run, re-dispatch a
 * `review_detected` event (which reaches the NOUR OS bridge, Telegram, the
 * learning loop and statenour), and re-count toward the low-rating alert
 * email - every 6 hours, forever.
 *
 * This is the same shape as the statenour Discover defect fixed the same week,
 * where a `blind_spot_${domain}_${Date.now()}` key erased the operator's whole
 * verdict history nightly. Grepping for readers scores it GREEN: the readers
 * are fine. The producer's key is what is unstable.
 *
 * --- Honesty about the trigger ----------------------------------------
 *
 * It has NOT fired in production. Measured 2026-08-23: `review_replies` holds
 * 7 rows, 7 distinct `review_id`s, and 0 ids matching a trailing 13-digit
 * timestamp. The Places API documents `time` as always present, and `reviews`
 * is typed `any[]` so nothing enforces that. This is defence in depth against
 * an unproven trigger, not a repair of observed damage - the audit that found
 * it could not prove the firing condition and this comment should not pretend
 * otherwise.
 *
 * --- Why the with-time path is byte-identical -------------------------
 *
 * The 7 live rows are keyed by the Unix-second string. Changing that
 * derivation would orphan every one of them and re-insert all 7 as new. So the
 * present branch reproduces the old expression exactly, including its two
 * quirks: `time === 0` yields "0" (truthy as a string, so the old `||` never
 * fired), and a non-number `time` is stringified rather than rejected. Only
 * the FALLBACK changes.
 */
import { createHash } from "crypto";

export interface ReviewIdentityInput {
  /** Unix seconds from the Places API. Documented as always present; not typed as such. */
  time?: number | string | null;
  author_name?: string | null;
  text?: string | null;
}

/** Marks a key derived without a provider timestamp, so these are greppable. */
export const NO_TIME_PREFIX = "notime_";

export function stableReviewId(review: ReviewIdentityInput): string {
  // Exact reproduction of `review.time?.toString()`: any non-nullish value is
  // stringified, and only an empty result falls through - matching the old
  // `|| fallback`. Do NOT "improve" this into a typeof check; `time` arrives
  // untyped and a stricter test would re-key the existing rows.
  if (review.time !== null && review.time !== undefined) {
    const asString = String(review.time);
    if (asString !== "") return asString;
  }

  // Derive from CONTENT so the same review yields the same id on every pass.
  // Author alone is not enough - one reviewer can leave reviews on different
  // days - so the text participates. Two reviews identical in both author and
  // text are indistinguishable to us and collapsing them is the correct
  // outcome, not a loss.
  // JSON.stringify, NOT a delimiter join. Caught in review on the first PR:
  // joining on a separator makes distinct reviews collide whenever a field
  // contains that separator - {author: "a|b", text: "c"} and
  // {author: "a", text: "b|c"} both produce "a|b|c". The consequence is a
  // review silently treated as already-seen: no draft, no event dispatch, no
  // low-rating alert. That is precisely the failure this helper exists to
  // remove, reintroduced inside the fix. JSON escapes the quotes and the array
  // structure carries the field boundary, so no field content can forge one.
  const material = JSON.stringify([review.author_name ?? "", review.text ?? ""]);
  const digest = createHash("sha1").update(material, "utf8").digest("hex").slice(0, 32);
  return `${NO_TIME_PREFIX}${digest}`;
}
