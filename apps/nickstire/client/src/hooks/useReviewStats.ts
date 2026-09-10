/**
 * useReviewStats — the shop's Google rating and review count, live where
 * available, static floor otherwise.
 *
 * WHY THIS EXISTS. The 2026-09-09 sweep (#2257) routed ~30 components off the
 * hardcoded `BUSINESS.reviews.countDisplay` / `.rating` floor and onto live
 * data, and every one of them hand-wrote the same three lines: the query with
 * its cache options, the `?? BUSINESS.reviews.*` fallback, and the
 * `toLocaleString("en-US") + "+"` format. Thirty copies of a precedence rule is
 * thirty places for it to drift — and the follow-up sweep was about to add
 * twenty more. The rule lives here now.
 *
 * PRECEDENCE IS NOT DECIDED HERE. `server/google-reviews.ts` already resolves
 * admin override > live Google > static floor through `resolveReviewDisplay()`
 * before the payload leaves the server, so `totalReviews` is never 0 and never
 * below the floor by accident. Calling the SAME helper here means the client
 * cannot invent a second, subtly different precedence — it only supplies the
 * one case the server cannot: the query has not resolved yet (first paint,
 * offline, retry exhausted), where `googleCount: null` yields the floor.
 *
 * PRERENDER. `scripts/prerender.mjs` drives Puppeteer against a real server and
 * waits for hydration before capturing, so a resolved query reaches the static
 * HTML that bots are served. An unresolved one degrades to the floor, which is
 * the same thing the page showed before any of this existed.
 */
import { trpc } from "@/lib/trpc";
import { BUSINESS, resolveReviewDisplay } from "@shared/business";

export interface ReviewStats {
  /** Average star rating as a number, e.g. 4.9 — use for math, not copy. */
  rating: number;
  /**
   * Rating formatted for copy, e.g. "4.9" — always one decimal.
   *
   * Copy must never interpolate the raw number: JS stringifies 4.0 as "4",
   * so a live rating that lands on a round value renders "4 stars" next to a
   * competitor's "4.0 stars". Caught in the browser on
   * /firestone-alternative-cleveland, where it read "sits at 4 stars".
   */
  ratingDisplay: string;
  /** Resolved review count as a number, e.g. 1723 */
  count: number;
  /** Review count formatted for copy, e.g. "1,723+" */
  countDisplay: string;
  /** True once live data has replaced the static floor. */
  isLive: boolean;
}

/** One hour — the server caches this call for the same window. */
const STALE_TIME_MS = 60 * 60 * 1000;

export function useReviewStats(): ReviewStats {
  const { data } = trpc.reviews.google.useQuery(undefined, {
    staleTime: STALE_TIME_MS,
    retry: 1,
  });

  const { numeric, countDisplay, provenance } = resolveReviewDisplay({
    googleCount: data?.totalReviews ?? null,
  });

  const rating = data?.rating ?? BUSINESS.reviews.rating;

  return {
    rating,
    ratingDisplay: rating.toFixed(1),
    count: numeric,
    countDisplay,
    isLive: provenance !== "business",
  };
}
