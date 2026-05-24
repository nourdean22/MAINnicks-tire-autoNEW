/**
 * Cron · Closed-Loop Wave Measurement (daily)
 *
 * Tier A · wave-181.x · the feedback signal that tells us which
 * waves actually moved the needle. Reads pending wave_metrics rows
 * past their measure_at, resolves the current value via registered
 * resolver, writes lift/no-lift/regression status, fires a Telegram
 * digest if any waves were measured.
 *
 * Silent on days with no measurements due · only speaks when there's
 * signal to report.
 */

import { createLogger } from "../../lib/logger";

const log = createLogger("cron:closed-loop");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

export async function processClosedLoopMeasure(): Promise<ProcessResult> {
  const start = Date.now();
  log.info("[closed-loop] start");

  const { measureDueWaves } = await import("../../services/closedLoop");
  const r = await measureDueWaves();

  const durMs = Date.now() - start;
  log.info(`[closed-loop] done in ${durMs}ms`, r);

  return {
    recordsProcessed: r.measured,
    details: `measured=${r.measured} lifted=${r.lifted} no_lift=${r.noLift} regression=${r.regression} errors=${r.errors}`,
  };
}
