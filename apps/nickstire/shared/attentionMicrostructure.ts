/**
 * Attention Microstructure — the swipe-file correlation layer.
 *
 * `hookSignals.ts` (stage 1, shipped) already does exactly this for beat-1
 * signals against skip rate, with the discipline this file inherits
 * unchanged: MEASURE, DON'T JUDGE. A comparison below MIN_GROUP_N prints as
 * "insufficient", never as a finding dressed up to look like one.
 *
 * Two things `hookSignals.ts` alone did not cover, both asked for
 * explicitly (ScanFinish NT-012):
 *
 *  1. BEAT STRUCTURE, not just the opening — beat count, total length, CTA.
 *     `beatStructureSignals.ts` extracts these from the same
 *     `reel_jobs.payload` beat 1 already comes from.
 *  2. SAVES/SHARES as the outcome metric, not skip rate — both are real
 *     columns on `ig_metric_snapshots` (migrations 0106/0108),
 *     `compareSignals` in hookSignals.ts just never read them.
 *
 * `compareBooleanSignal` below is the metric-agnostic version of that
 * function: same MIN_GROUP_N gate, same null-excludes-don't-zero rule,
 * generalized to run against ANY boolean signal and ANY reported metric —
 * which is what lets ONE comparator serve hook signals, beat-structure
 * signals, and any future signal family without a copy per metric.
 *
 * CALLS ARE DELIBERATELY ABSENT. The brief that requested this asked for
 * "saves/shares/calls". `calls` and `booking_actions` are registered metric
 * NAMES in shared/contentExperiments.ts's METRIC_SPECS and referenced by
 * franchise/objective definitions — but `ig_metric_snapshots` (the only
 * table any ArmObservation is ever built from) has no column for either,
 * and Instagram's organic Graph API does not attribute a phone call to the
 * specific post that drove it. There is no data source to log against
 * without new paid call-tracking-number infrastructure and an operator
 * decision to fund it — fabricating a "calls" column here would be exactly
 * the confident-guess-dressed-as-a-fact this project's evidence discipline
 * exists to prevent.
 */
import { HOOK_BOOLEAN_SIGNALS, type HookBooleanSignal, type HookSignals, MIN_GROUP_N } from "./hookSignals";
import { BEAT_STRUCTURE_BOOLEAN_SIGNALS, type BeatStructureBooleanSignal, type BeatStructureSignals } from "./beatStructureSignals";

/** Saves and shares are COUNTS; comparing them as a per-reach RATE (not a
 *  raw count) is what makes a highly-distributed post and a barely-seen one
 *  comparable — the same COUNT_PER_REACH convention contentExperiments.ts
 *  already established for shares_per_reach/saves_per_reach. */
export type SwipeFileMetric = "savesPerReach" | "sharesPerReach" | "skipRate";

export interface SwipeFileSample {
  jobId: number;
  hook: HookSignals;
  beatStructure: BeatStructureSignals;
  /** null means NOT REPORTED for this metric — excluded, never coerced to 0. */
  metrics: Partial<Record<SwipeFileMetric, number | null>>;
}

export interface SignalMetricComparison {
  family: "hook" | "beatStructure";
  signal: HookBooleanSignal | BeatStructureBooleanSignal;
  metric: SwipeFileMetric;
  withN: number;
  withoutN: number;
  withAvg: number | null;
  withoutAvg: number | null;
  /** Positive = posts WITH this signal scored HIGHER on this metric. Sign
   *  carries no "good/bad" meaning here — skipRate is better LOW, saves/
   *  shares are better HIGH. Read direction against the metric, not the sign. */
  delta: number | null;
  sufficient: boolean;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * Metric-agnostic generalization of hookSignals.ts's compareSignals: same
 * MIN_GROUP_N gate, same null-excludes rule, works for any boolean signal
 * key against any reported metric.
 */
export function compareBooleanSignal<TSignals>(
  samples: SwipeFileSample[],
  family: "hook" | "beatStructure",
  signal: HookBooleanSignal | BeatStructureBooleanSignal,
  metric: SwipeFileMetric,
  signalsOf: (s: SwipeFileSample) => TSignals,
): SignalMetricComparison {
  const usable = samples.filter((s) => s.metrics[metric] !== null && s.metrics[metric] !== undefined);
  const withIt = usable.filter((s) => Boolean((signalsOf(s) as Record<string, unknown>)[signal])).map((s) => s.metrics[metric] as number);
  const without = usable.filter((s) => !(signalsOf(s) as Record<string, unknown>)[signal]).map((s) => s.metrics[metric] as number);
  const a = mean(withIt);
  const b = mean(without);
  return {
    family,
    signal,
    metric,
    withN: withIt.length,
    withoutN: without.length,
    withAvg: a,
    withoutAvg: b,
    delta: a !== null && b !== null ? a - b : null,
    sufficient: withIt.length >= MIN_GROUP_N && without.length >= MIN_GROUP_N,
  };
}

/** Runs every registered hook + beat-structure boolean signal against one
 *  metric. The caller (a script or an admin query) decides which metric —
 *  this stays pure so a decay-curve horizon choice never leaks into it. */
export function compareAllSignals(samples: SwipeFileSample[], metric: SwipeFileMetric): SignalMetricComparison[] {
  return [
    ...HOOK_BOOLEAN_SIGNALS.map((signal) => compareBooleanSignal(samples, "hook", signal, metric, (s) => s.hook)),
    ...BEAT_STRUCTURE_BOOLEAN_SIGNALS.map((signal) => compareBooleanSignal(samples, "beatStructure", signal, metric, (s) => s.beatStructure)),
  ];
}

/**
 * Calibration-ledger conviction for a comparison, in this project's own
 * vocabulary (NICKSTIRE-SCAN-LEDGER.md's calibration rules) — a comparison
 * with enough samples to be reportable is still only MED/INFERRED (a
 * candidate to test deliberately, per hookSignals.ts's own framing); it
 * graduates to HIGH/OBSERVED only once a DELIBERATE experiment
 * (shared/contentExperiments.ts, which already enforces this exact
 * distinction) confirms it — never from a correlation alone, however large.
 */
export function swipeFileConviction(c: SignalMetricComparison): "insufficient" | "MED/INFERRED" {
  return c.sufficient ? "MED/INFERRED" : "insufficient";
}
