/**
 * /api/cron/update-spike-detect · v8.11 BATCH 62 · Apr 29.
 *
 * Folded into mega-evening. Daily scan of entity_audits for
 * unusually high update rates per entity-type vs trailing 7d
 * median. Sibling of v8.10 creation-spike-detect.
 */

import { cronHandler } from "@/lib/utils/http";
import { runUpdateSpikeDetect } from "@/lib/db/update-spike-detector";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runUpdateSpikeDetect();
    return { ok: true, durationMs: Date.now() - started, ...report };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "update-spike-detect failed",
    };
  }
});
