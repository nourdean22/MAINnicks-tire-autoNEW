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
  return result;
});
