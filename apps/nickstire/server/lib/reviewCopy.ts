/**
 * getReviewCopy — the shop's rating and review count, ready to drop into
 * generated copy. Server-side twin of the client's `useReviewStats()`.
 *
 * WHY THIS EXISTS. Every AI prompt, GBP post, SMS template and invoice footer
 * that quotes these numbers read the static `BUSINESS.reviews.*` floor
 * directly, so a real change in the live count could never reach any of them.
 * The 2026-09-09 fix (#2257) wired four of them up and each hand-wrote the same
 * fetch-and-fall-back; the follow-up sweep would have added eight more copies.
 * One rule, one place.
 *
 * PRECEDENCE IS NOT DECIDED HERE. `getGoogleReviews()` already applies admin
 * override > live Google > static floor through `resolveReviewDisplay()`, and
 * caches for an hour, so this is cheap to call per generation. Calling the same
 * helper again supplies only the case the fetch cannot: a null return (failed
 * with no cache) lands on the floor.
 *
 * NOT IN google-reviews.ts ON PURPOSE. A call to `getGoogleReviews()` from
 * inside that module would bind lexically, so `vi.mock` could not intercept it
 * and a test would silently hit the live Places API and the shop_settings
 * table. Living in its own module keeps it mockable — see reviewCopy.test.ts.
 */
import { BUSINESS, resolveReviewDisplay } from "@shared/business";
import { getGoogleReviews } from "../google-reviews";

export interface ReviewCopy {
  /** Average star rating, e.g. 4.9 */
  rating: number;
  /** Resolved review count as a number, e.g. 1723 */
  count: number;
  /** Review count formatted for copy, e.g. "1,723+" */
  countDisplay: string;
}

export async function getReviewCopy(): Promise<ReviewCopy> {
  const data = await getGoogleReviews();
  const { numeric, countDisplay } = resolveReviewDisplay({
    googleCount: data?.totalReviews ?? null,
  });
  return {
    rating: data?.rating ?? BUSINESS.reviews.rating,
    count: numeric,
    countDisplay,
  };
}
