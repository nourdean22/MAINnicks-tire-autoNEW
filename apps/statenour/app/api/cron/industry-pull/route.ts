/**
 * /api/cron/industry-pull — pull automotive industry RSS feeds.
 *
 * v6 · BATCH 5 · Apr 28. Daily at 5am Cleveland. Fetches recalls,
 * EV news, tire industry, shop trends, Cleveland local automotive,
 * AAA reports, etc. Dedupes + writes new items to BrainMemory under
 * category="industry_intel".
 *
 * Sources: lib/automotive/industry-sources.ts (~14 sources, weighted).
 *
 * Vercel cron schedule:
 *   "0 10 * * *"   // 5am Cleveland (UTC-5)
 */

import { cronHandler } from "@/lib/utils/http";
import { pullIndustryFeeds } from "@/lib/automotive/industry-monitor";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const result = await pullIndustryFeeds();
  return {
    ok: result.errors.length < result.sourcesAttempted / 2,
    ...result,
    summary: `${result.sourcesOk}/${result.sourcesAttempted} sources OK · ${result.itemsAdded} new items · ${result.itemsSkipped} duped · ${result.errors.length} errors`,
  };
});

export const POST = GET;
