/**
 * GET /api/cron/experiment-measure — cron-gated closed-loop Experiment resolver.
 *
 * Resolves DUE experiments (accepted opportunities past their measurement horizon),
 * scores whether each hypothesis held up, and feeds a bounded+reversible nudge into
 * the attributed source's authScore. Observe + learn only — takes NO autonomous
 * action. Fired daily via EVENING_JOBS (lib/inngest/jobs.ts) + registered in the
 * config/crons.ts manifest.
 */
import { cronHandler, jsonOk } from "@/lib/utils/http";
import { resolveDueExperiments } from "@/lib/intelligence/experiment-measure";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/experiment-measure");

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = cronHandler(
  async () => {
    const result = await resolveDueExperiments();
    if (result.resolved > 0) {
      log.info("experiments_resolved", {
        resolved: result.resolved,
        feedbackWrites: result.feedbackWrites,
      });
    }
    return jsonOk(result);
  },
);
