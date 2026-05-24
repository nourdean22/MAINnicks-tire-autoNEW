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

  const { measureDueWaves, seedWaveBaselines } = await import("../../services/closedLoop");

  // wave-181.x · auto-seed wave baselines on every run. Idempotent ·
  // skips already-recorded (wave_id, metric_key) pairs. Means the
  // operator doesn't have to remember to run a seed script after
  // migration 0059 lands · the first cron run after migration auto-
  // seeds the 4 measurable compound loops shipped today.
  let seeded = 0;
  try {
    seeded = await seedWaveBaselines();
    if (seeded > 0) {
      log.info(`[closed-loop] seeded ${seeded} new baselines`);
    }
  } catch (err) {
    // Non-fatal · if seed fails, measurement still runs for already-recorded waves
    log.warn("[closed-loop] auto-seed failed (non-fatal)", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const r = await measureDueWaves();

  const durMs = Date.now() - start;
  log.info(`[closed-loop] done in ${durMs}ms`, { ...r, seeded });

  return {
    recordsProcessed: r.measured + seeded,
    details: `seeded=${seeded} measured=${r.measured} lifted=${r.lifted} no_lift=${r.noLift} regression=${r.regression} errors=${r.errors}`,
  };
}
