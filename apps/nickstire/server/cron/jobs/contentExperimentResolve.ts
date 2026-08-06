/**
 * Content experiment resolver — the missing consumer that lets experiments
 * CONCLUDE.
 *
 * The 0108 registry shipped with assignment wired at enqueue but
 * startExperiment/attachPublishedMedia/recordVerdict at zero callers, so every
 * "running" experiment was structurally unable to begin or end. This job is
 * the daily verdict half: for each running experiment it gathers 72h-horizon
 * observations from igMetricSnapshots and records a verdict. Refusals
 * (insufficient_data / no_signal / invalid_design) are results too — they
 * persist and leave the experiment running; only winner/tie concludes it.
 *
 * Deliberately quiet: with no running experiments (the default state) this is
 * a one-SELECT no-op whose details string says so — a completed-empty run must
 * be distinguishable from a completed-productive one (cross-sell lesson).
 */
import { createLogger } from "../../lib/logger";

const log = createLogger("cron:content-experiment-resolve");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

/**
 * def.primaryMetric names come from the DISTRIBUTION_OBJECTIVE_METRICS
 * vocabulary; the snapshot gatherer reads typed columns. A metric with no
 * snapshot column (dms, calls, comments…) is unmeasurable by this resolver
 * and is reported as such, never guessed at.
 */
const GATHERABLE_METRIC: Record<string, "shares" | "saved" | "views" | "reach" | "avgWatchTimeMs"> = {
  shares: "shares",
  shares_per_reach: "shares",
  saved: "saved",
  saves_per_reach: "saved",
  views: "views",
  reach: "reach",
  avg_watch_time: "avgWatchTimeMs",
  ig_reels_avg_watch_time: "avgWatchTimeMs",
};

export async function processContentExperimentResolve(): Promise<ProcessResult> {
  const { loadRunningExperiments, recordVerdict } = await import("../../services/contentExperimentStore");

  const running = await loadRunningExperiments();
  if (!running.length) {
    return { recordsProcessed: 0, details: "no running experiments" };
  }

  const outcomes: string[] = [];
  let resolved = 0;

  for (const def of running) {
    const column = GATHERABLE_METRIC[def.primaryMetric];
    if (!column) {
      log.warn("experiment metric has no snapshot column — cannot resolve", {
        experimentId: def.experimentId,
        primaryMetric: def.primaryMetric,
      });
      outcomes.push(`${def.experimentId}: unmeasurable metric ${def.primaryMetric}`);
      continue;
    }
    try {
      const verdict = await recordVerdict(def, column, 72);
      resolved++;
      outcomes.push(`${def.experimentId}: ${verdict?.status ?? "no verdict"}`);
    } catch (error) {
      outcomes.push(`${def.experimentId}: ERROR`);
      log.warn("experiment verdict failed", {
        experimentId: def.experimentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    recordsProcessed: resolved,
    details: `${running.length} running · ${outcomes.join(" · ")}`,
  };
}
