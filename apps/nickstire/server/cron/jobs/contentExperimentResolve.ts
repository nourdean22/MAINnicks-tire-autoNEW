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
import { isUnwiredExperimentId } from "@shared/contentExperiments";
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
const GATHERABLE_METRIC: Record<string, "shares" | "saved" | "views" | "reach" | "avgWatchTimeMs" | "skipRate"> = {
  shares: "shares",
  shares_per_reach: "shares",
  saved: "saved",
  saves_per_reach: "saved",
  views: "views",
  reach: "reach",
  avg_watch_time: "avgWatchTimeMs",
  ig_reels_avg_watch_time: "avgWatchTimeMs",
  // The snapshot column name itself — the live hook-style-2026-08 experiment
  // declares its metric this way (found 2026-08-06 when the resolver reported
  // the estate's one real experiment "unmeasurable").
  avgWatchTimeMs: "avgWatchTimeMs",
  // Skip rate is the metric a hook experiment exists to move. It was missing
  // here AND unreadable in the gatherer (DECIMAL arrives as a string) until
  // 2026-10-08, so hook experiments could only be judged on proxies.
  skip_rate: "skipRate",
  reels_skip_rate: "skipRate",
  skipRate: "skipRate",
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
    // An exposed preset started before 2026-10-08 gave both arms the same
    // content. Judging it would CONCLUDE it on noise and propose retiring a
    // variable that was never tested; it is reported and left for the operator.
    if (isUnwiredExperimentId(def.experimentId)) {
      log.warn("running experiment is not wired — not judged", { experimentId: def.experimentId });
      outcomes.push(`${def.experimentId}: not wired, not judged (stop it)`);
      continue;
    }
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
      // ACTUATOR SEAM (2026-08-06, propose-only): a decisive verdict is
      // worthless sitting in a column nobody reads. Winners are PROPOSED to
      // the operator — never auto-applied; changing what the lanes generate
      // stays an operator decision.
      if (verdict && (verdict.status === "winner" || verdict.status === "tie")) {
        const { sendTelegram } = await import("../../services/telegram");
        const line = verdict.status === "winner"
          ? `CONTENT EXPERIMENT CONCLUDED: ${def.experimentId} — winner "${verdict.variantValue}" (arm ${verdict.armId}, lift ${(verdict.lift * 100).toFixed(0)}% on ${def.primaryMetric}). Proposal: adopt the winning ${def.primaryVariable} as the lane default and start the next experiment. Nothing changes until you act.`
          : `CONTENT EXPERIMENT CONCLUDED: ${def.experimentId} — TIE on ${def.primaryMetric}. Proposal: retire this variable and test a different one. Nothing changes until you act.`;
        await sendTelegram(line).catch(() => undefined);
      }
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
