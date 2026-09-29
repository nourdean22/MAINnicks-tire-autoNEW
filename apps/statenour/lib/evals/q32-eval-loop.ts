/**
 * Q-32 · deterministic eval-loop primitives.
 *
 * Purpose:
 * - choose turns for ONE Langfuse annotation queue using persisted signals;
 * - never treat advisory context-budget drops as real drops;
 * - compute a prediction-powered paired delta with an uncertainty interval.
 *
 * No DB, no network, no model calls. Pure so CI can pin the release gate.
 */

export type Q32SelectionReason =
  | "thumb_down"
  | "l2_banner"
  | "evidence_gate_block"
  | "dropped_context";

export interface Q32ContextReceiptEntry {
  kept?: boolean;
  reason?: string;
}

export interface Q32ContextReceipt {
  enforced?: boolean;
  entries?: Q32ContextReceiptEntry[];
}

export interface Q32TurnSignals {
  feedbackScore?: number | null;
  verifierBanner?: boolean;
  evidenceGateVerdict?: unknown;
  contextReceipt?: Q32ContextReceipt | null;
}

const PASSING_EVIDENCE = new Set(["", "pass", "ok", "allow"]);

export function q32SelectionReasons(input: Q32TurnSignals): Q32SelectionReason[] {
  const reasons: Q32SelectionReason[] = [];
  if (input.feedbackScore === -1) reasons.push("thumb_down");
  if (input.verifierBanner === true) reasons.push("l2_banner");

  const verdict = String(input.evidenceGateVerdict ?? "").trim().toLowerCase();
  if (!PASSING_EVIDENCE.has(verdict)) reasons.push("evidence_gate_block");

  // ContextReceipt is partly counterfactual while enforced=false. Only
  // below_threshold is an ACTUAL drop today: the reranker already removed it.
  // over_budget/redundant are advisory until context-budget enforcement ships.
  const entries = Array.isArray(input.contextReceipt?.entries)
    ? input.contextReceipt!.entries!
    : [];
  if (entries.some((e) => e?.reason === "below_threshold" && e?.kept === false)) {
    reasons.push("dropped_context");
  }
  return [...new Set(reasons)];
}

export function shouldQueueQ32Annotation(input: Q32TurnSignals): boolean {
  return q32SelectionReasons(input).length > 0;
}

export interface PredictionPoweredDeltaInput {
  /** Judge/model deltas for the broad experiment population. candidate - baseline. */
  predictionDeltas: readonly number[];
  /** Human-labeled deltas for the calibration subset. */
  labeledHumanDeltas: readonly number[];
  /** Judge/model deltas on those exact labeled items. */
  labeledPredictionDeltas: readonly number[];
  z?: number;
}

export interface PredictionPoweredDelta {
  estimate: number | null;
  lower: number | null;
  upper: number | null;
  predictedN: number;
  labeledN: number;
  standardError: number | null;
}

function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sampleVariance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

/**
 * Prediction-powered estimator for a mean paired delta:
 *
 *   E[Y] ~= mean(model delta over broad set)
 *          + mean(human delta - model delta on labeled subset)
 *
 * Variance is the independent-sample plug-in estimate for the broad prediction
 * mean plus the calibration-residual mean. This is intentionally conservative
 * and returns null until both arms have evidence.
 */
export function predictionPoweredPairedDelta(
  input: PredictionPoweredDeltaInput,
): PredictionPoweredDelta {
  const pred = input.predictionDeltas.filter(Number.isFinite);
  const human = input.labeledHumanDeltas.filter(Number.isFinite);
  const labeledPred = input.labeledPredictionDeltas.filter(Number.isFinite);
  if (pred.length === 0 || human.length === 0 || human.length !== labeledPred.length) {
    return {
      estimate: null,
      lower: null,
      upper: null,
      predictedN: pred.length,
      labeledN: Math.min(human.length, labeledPred.length),
      standardError: null,
    };
  }

  const residuals = human.map((y, i) => y - labeledPred[i]);
  const estimate = mean(pred) + mean(residuals);
  const variance =
    sampleVariance(pred) / pred.length +
    sampleVariance(residuals) / residuals.length;
  const se = Math.sqrt(Math.max(0, variance));
  const z = Number.isFinite(input.z) ? Math.abs(input.z as number) : 1.96;
  return {
    estimate,
    lower: estimate - z * se,
    upper: estimate + z * se,
    predictedN: pred.length,
    labeledN: human.length,
    standardError: se,
  };
}

export interface Q32GateInput {
  ppi: PredictionPoweredDelta;
  judgeKappa: number | null;
  labeledCount: number;
  minLabels?: number;
  minKappa?: number;
  /** Largest tolerated true regression. Default 0: interval must not cross below zero. */
  regressionTolerance?: number;
}

export interface Q32GateVerdict {
  pass: boolean;
  reason: string;
}

export function q32ReleaseGate(input: Q32GateInput): Q32GateVerdict {
  const minLabels = input.minLabels ?? 30;
  const minKappa = input.minKappa ?? 0.6;
  const tolerance = Math.max(0, input.regressionTolerance ?? 0);

  if (input.labeledCount < minLabels) {
    return { pass: false, reason: `UNMEASURED: ${input.labeledCount}/${minLabels} human labels` };
  }
  if (input.judgeKappa == null || input.judgeKappa < minKappa) {
    return {
      pass: false,
      reason: `UNTRUSTED_JUDGE: kappa=${input.judgeKappa ?? "null"} < ${minKappa}`,
    };
  }
  if (input.ppi.lower == null || input.ppi.upper == null) {
    return { pass: false, reason: "UNMEASURED: paired PPI interval unavailable" };
  }
  if (input.ppi.lower < -tolerance) {
    return {
      pass: false,
      reason: `REGRESSION: PPI lower bound ${input.ppi.lower.toFixed(4)} < -${tolerance.toFixed(4)}`,
    };
  }
  return {
    pass: true,
    reason: `PASS: PPI [${input.ppi.lower.toFixed(4)}, ${input.ppi.upper.toFixed(4)}], kappa=${input.judgeKappa}`,
  };
}
