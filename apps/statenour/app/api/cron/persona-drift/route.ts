/**
 * GET /api/cron/persona-drift · v10.0.529.32 · Arc B Feature 4
 *
 * Scans recent assistant chat replies for drift from the operator's
 * 8-axis identity snapshot. Drift events land in BrainMemory(category=
 * "persona_drift") for surfacing via the SituationCard + future
 * dedicated drift card. Detection-only · no regeneration · operator
 * decides whether to update the 8-axis or treat as false-positive.
 *
 * Cadence: every 4 hours. Cheap (cap 60 messages × 1 cosine each ·
 * milliseconds). Folded as a sibling to the decision-replay cron.
 */

import { cronHandler } from "@/lib/utils/http";
import { logger as rootLogger } from "@/lib/logger";
import { scanRecentReplies } from "@/lib/brain/persona-drift-detector";

const log = rootLogger.withSurface("cron/persona-drift");

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const t0 = Date.now();
  const result = await scanRecentReplies({ windowHours: 6 }).catch((err) => {
    log.warn("scan_threw", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { scanned: 0, drifted: 0, events: [] };
  });

  log.info("persona_drift_cron_complete", {
    scanned: result.scanned,
    drifted: result.drifted,
    durationMs: Date.now() - t0,
  });

  return {
    ok: true,
    scanned: result.scanned,
    drifted: result.drifted,
    durationMs: Date.now() - t0,
  };
});
