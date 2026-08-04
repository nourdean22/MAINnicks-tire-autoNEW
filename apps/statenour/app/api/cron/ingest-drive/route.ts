import { cronHandler } from "@/lib/utils/http";
import { runDriveIngest } from "@/lib/brain/drive-ingest";

export const maxDuration = 300;

/**
 * GET /api/cron/ingest-drive
 *
 * Headless Google Drive ingest. Runs twice a week (Sunday + Wednesday
 * 2:30am per vercel.json). Delegates to the shared runDriveIngest
 * engine in lib/brain/drive-ingest.ts so the same pipeline powers
 * the manual /api/drive/sync endpoint and the syncDriveMemory tool.
 *
 * Each memory keys on the Drive file ID so re-runs reinforce rather
 * than duplicate. Embeddings are stored async by brainMemory.remember
 * so the first searchColdMemory call after ingest sees fresh vectors.
 *
 * Exits gracefully if OAuth isn't set up yet.
 */
export const GET = cronHandler(async () => {
  const result = await runDriveIngest({
    limit: 25,
    actor: "drive_ingest_cron",
    source: "drive_cron",
  });

  // A skip is filed as a SUCCESSFUL cron run. That is right for "the operator
  // has not granted consent yet" — nothing is wrong and a daily `failed` row
  // would be noise. It is wrong for "the integration table could not be read":
  // that is a real outage, and reporting it as a green run blaming a
  // configuration that is correct is exactly the class #1348 closed on the
  // calendar cron. cronHandler records a throw as failed.
  if (result.probeFailed) {
    throw new Error(
      `Drive ingest could not determine OAuth status — ${result.hint ?? result.reason}`,
    );
  }

  if (result.skipped) {
    return {
      skipped: true,
      reason: result.reason,
      hint: result.hint,
    };
  }

  return {
    stored: result.stored,
    skipped: result.skippedCount,
    categoryCounts: result.categoryCounts,
    errorCount: result.errors.length,
    durationMs: result.durationMs,
  };
});
