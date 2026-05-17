/**
 * /api/cron/creation-spike-detect · v8.10 BATCH 59 · Apr 29.
 *
 * Folded into mega-evening. Daily scan of entity_audits for
 * unusually high create rates per entity-type vs trailing 7d
 * median.
 */

import { cronHandler } from "@/lib/utils/http";
import { runCreationSpikeDetect } from "@/lib/db/creation-spike-detector";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runCreationSpikeDetect();
    return { ok: true, durationMs: Date.now() - started, ...report };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "creation-spike-detect failed",
    };
  }
});
