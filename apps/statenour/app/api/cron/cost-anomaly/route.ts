/**
 * GET /api/cron/cost-anomaly · v10.0.91 · 2026-05-02.
 *
 * Hourly z-score check on today's AI cost vs 7-day baseline.
 * Folded into mega-evening because AI cost only really matters
 * end-of-day. Returns the report so cron-runs surface dashboards.
 */

import { cronHandler } from "@/lib/utils/http";
import { detectCostAnomaly } from "@/lib/system/cost-anomaly";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  return await detectCostAnomaly();
});
