/**
 * GET /api/cron/change-detection — cron-gated external-change sensor.
 *
 * Runs the change-detection-lite loop (Firecrawl scrape -> hash -> compare ->
 * PageSnapshot). Observe-only: records + logs changes, takes NO autonomous
 * action. Fired daily via MORNING_JOBS (lib/inngest/jobs.ts) + registered in
 * the config/crons.ts manifest.
 */
import { apiHandler, jsonOk } from "@/lib/utils/http";
import { runChangeDetection } from "@/lib/intelligence/change-detection";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/change-detection");

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = apiHandler(
  async () => {
    const result = await runChangeDetection();
    if (result.changes.length > 0) {
      log.info("external_changes_detected", {
        count: result.changes.length,
        changes: result.changes,
      });
    }
    return jsonOk(result);
  },
  { auth: "cron" },
);
