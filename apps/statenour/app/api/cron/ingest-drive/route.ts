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
 * Each item keys on the Drive file ID. External document text goes through
 * the shared memory quarantine first; only reviewed/allowed content reaches
 * BrainMemory and becomes eligible for embedding/recall.
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
    quarantined: result.quarantined ?? 0,
    skipped: result.skippedCount,
    categoryCounts: result.categoryCounts,
    errorCount: result.errors.length,
    durationMs: result.durationMs,
  };
});
