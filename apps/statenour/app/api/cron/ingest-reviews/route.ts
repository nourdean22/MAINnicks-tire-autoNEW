import { cronHandler } from "@/lib/utils/http";
import { fetchAndStoreReviews } from "@/lib/integrations/google-reviews";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/ingest-reviews");

export const maxDuration = 60;

/**
 * GET /api/cron/ingest-reviews
 *
 * WHY THIS ROUTE EXISTS: `fetchAndStoreReviews()` is the ONLY writer in
 * lib/integrations/google-reviews.ts and it had ZERO callers — a grep returned
 * two hits, both inside its own file. Meanwhile the READ side (`getReviewStats`,
 * `getUnrespondedReviews`) is wired across 8+ files, including the chat snapshot
 * in app/api/ai/chat/alternate-paths.ts. So Nick has been served whatever was
 * last written to `BrainMemory(google_review)`, indefinitely.
 *
 * #1312 made that staleness VISIBLE (`ok` / `stale` / `ageDays` /
 * `freshnessNote`). This closes the other half: something now actually writes.
 *
 * DELIBERATELY NOT ERROR-SWALLOWING. fetchAndStoreReviews throws when
 * GOOGLE_PLACE_ID / GOOGLE_PLACES_API_KEY are unset, and the Places API can
 * return REQUEST_DENIED inside an HTTP 200 body. Letting both propagate makes
 * cronHandler persist a FAILED CronJobLog row that /system/crons surfaces —
 * which is the entire point. A `catch` here would recreate the silent-zero the
 * nickstire side spent a PR removing (#1298).
 *
 * Daily cadence: Google Places returns at most the 5 most recent reviews for a
 * place, and a tire shop does not accumulate reviews faster than that in a day.
 * More frequent polling would spend quota to re-read the same five rows.
 */
export const GET = cronHandler(async () => {
  const result = await fetchAndStoreReviews();
  log.info("reviews ingested", { fetched: result.fetched, newCount: result.newCount });

  // ZERO FETCHED IS AN OUTAGE, NOT A QUIET DAY.
  // A live Place ID always re-reads its most recent five reviews, so `fetched: 0`
  // means the call came back empty. NOT from REQUEST_DENIED — google-reviews.ts:78
  // THROWS on that (`status !== "OK" && status !== "ZERO_RESULTS"`), and an earlier
  // draft of this comment had that exactly backwards. What line 78 lets through as
  // a non-error is `ZERO_RESULTS` and a MISSING status field, and `data.result
  // ?.reviews ?? []` turns either into an empty array. Those are the two shapes
  // that reach here as a silent zero.
  //
  // Keyed on `fetched`, NEVER on `newCount`. `newCount` is rows WRITTEN and is
  // legitimately 0 on most days (the same five reviews, already stored) — the
  // route comment above records that as a deliberate decision. Asserting on it
  // would page nightly and get the assertion deleted within a week.
  //
  // Residual honesty gap, stated rather than discovered later: a shop that
  // genuinely has no Google reviews would now throw every day. That is the right
  // trade for THIS shop, which has them; it is the wrong default to copy blindly
  // into a route for a place that might not.
  if (result.fetched === 0) {
    throw new Error(
      "ingest-reviews: Places returned 0 reviews for the configured place. " +
        "A live Place ID always re-reads its most recent five, so zero means the " +
        "feed is broken: ZERO_RESULTS, or a 200 whose body carries no `status` and " +
        "no `result.reviews`. A REQUEST_DENIED would have thrown upstream with a " +
        "different message, so do not go looking for one.",
    );
  }
  // `resultCount` is the explicit claim cron-manager's countFrom() records into
  // cron_job_logs. It is `fetched`, not `newCount`: the count that answers "did the feed
  // return anything", which is the question the table could not represent before
  // 2026-08-22. Rows written is a different question and a legitimately-zero one.
  return { ...result, resultCount: result.fetched };
});
