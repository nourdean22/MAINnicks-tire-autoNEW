/**
 * lib/ai/judge-eval/calibration.ts — Wave-5 (2026-07-29).
 *
 * Judge-vs-operator agreement math over labeled comparison rows. Pure —
 * no DB, no LLM — so the numbers are testable and the tRPC layer just
 * feeds it rows. Practice basis: ~30-100 binary operator labels
 * calibrate a judge; on imbalanced labels report per-class
 * precision/recall, not raw agreement alone (Husain; MT-Bench's
 * position/verbosity bias findings motivate the label loop existing
 * at all).
 */
import type { Winner } from "./comparator";

export interface LabeledComparison {
  judgeWinner: Winner;
  operatorWinner: Winner;
}

export interface ClassStats {
  /** Of the times the judge said this class, how often the operator agreed. */
  precision: number | null;
  /** Of the times the operator said this class, how often the judge found it. */
  recall: number | null;
  judgeCount: number;
  operatorCount: number;
}

export interface JudgeCalibrationReport {
  labeled: number;
  agreement: number | null;
  /**
   * 2026-09-03 · Cohen's kappa - chance-corrected agreement.
   *
   * Raw `agreement` is the number that looks trustworthy and is not. With
   * three classes and a tie-heavy label distribution, two raters can agree
   * 70% of the time purely by both guessing the majority class; kappa for
   * that is ~0. Reporting agreement alone is how a worthless judge scores
   * "0.70, trusted: true".
   *
   * Scale (Landis & Koch): <=0 none · 0.01-0.20 slight · 0.21-0.40 fair ·
   * 0.41-0.60 moderate · 0.61-0.80 substantial · 0.81-1.00 almost perfect.
   * null when undefined (no labels, or perfect expected agreement).
   */
  kappa: number | null;
  perClass: Record<Winner, ClassStats>;
  /** Below this many labels the numbers are directional, not trustworthy. */
  minTrustedLabels: number;
  trusted: boolean;
}

/**
 * 2026-09-03 · One judged pair, run BOTH ways.
 *
 * The module header has always cited MT-Bench's position-bias finding as the
 * reason the label loop exists - but nothing here ever measured it. A judge
 * with high test-retest reliability can still be badly position-biased:
 * published production judges show >0.95 self-consistency alongside >0.10
 * position bias. Self-consistency is what you accidentally measure;
 * validity is what you need.
 */
export interface SwappedComparison {
  /** Winner when the candidate was presented SECOND (normal order). */
  normalWinner: Winner;
  /** Winner when the same pair was presented with the sides SWAPPED. */
  swappedWinner: Winner;
}

export interface PositionBiasReport {
  pairs: number;
  /**
   * Fraction of decisive pairs where the winning CONTENT changed when only
   * the presentation order changed.
   *
   * Note the label semantics: `v1`/`v2` are SLOTS, not identities. If the
   * same content wins both runs the labels must DIFFER (v2 normal ->
   * v1 swapped). Getting the SAME label twice means the same slot won
   * regardless of what was in it - that is the bias, not the consistency.
   *
   * A consistent judge scores 0. A purely positional judge scores 1.
   */
  inconsistencyRate: number | null;
  /**
   * Of the pairs that were position-driven, the fraction where the FIRST
   * slot won both times (v1,v1). The complement is second-slot preference.
   * Null when no pair was position-driven.
   */
  firstPositionRate: number | null;
  /** Below this the numbers are directional, not trustworthy. */
  minTrustedPairs: number;
  trusted: boolean;
}

export const MIN_TRUSTED_SWAP_PAIRS = 20;

/**
 * Cohen's kappa for two raters over the Winner classes.
 * k = (Po - Pe) / (1 - Pe), where Po is observed agreement and Pe is the
 * agreement expected from each rater's marginal distribution.
 */
export function cohensKappa(rows: readonly LabeledComparison[]): number | null {
  const n = rows.length;
  if (n === 0) return null;

  const po = rows.filter((r) => r.judgeWinner === r.operatorWinner).length / n;

  let pe = 0;
  for (const w of WINNERS) {
    const pJudge = rows.filter((r) => r.judgeWinner === w).length / n;
    const pOperator = rows.filter((r) => r.operatorWinner === w).length / n;
    pe += pJudge * pOperator;
  }

  // Both raters used exactly one class for everything: kappa is undefined,
  // not 1. Returning 1 here would be the confident-zero shape in reverse.
  if (pe >= 1) return null;

  return Math.round(((po - pe) / (1 - pe)) * 1000) / 1000;
}

/**
 * Measure position bias by comparing each pair judged in both orders.
 *
 * A verdict that changes when only the presentation order changed cannot
 * have been about quality. Run this before trusting any judge score.
 */
export function positionBias(rows: readonly SwappedComparison[]): PositionBiasReport {
  const pairs = rows.length;
  if (pairs === 0) {
    return {
      pairs: 0,
      inconsistencyRate: null,
      firstPositionRate: null,
      minTrustedPairs: MIN_TRUSTED_SWAP_PAIRS,
      trusted: false,
    };
  }

  // Only pairs where BOTH runs picked a side can show position bias.
  // A tie on either side is not evidence either way.
  const decisive = rows.filter(
    (r) => r.normalWinner !== "tie" && r.swappedWinner !== "tie"
  );

  // Same SLOT label twice => the same position won regardless of content.
  // (v1,v1) = first slot always; (v2,v2) = second slot always.
  const positionDriven = decisive.filter((r) => r.normalWinner === r.swappedWinner);
  const firstSlot = positionDriven.filter((r) => r.normalWinner === "v1").length;

  return {
    pairs,
    inconsistencyRate:
      decisive.length > 0
        ? Math.round((positionDriven.length / decisive.length) * 1000) / 1000
        : null,
    firstPositionRate:
      positionDriven.length > 0
        ? Math.round((firstSlot / positionDriven.length) * 1000) / 1000
        : null,
    minTrustedPairs: MIN_TRUSTED_SWAP_PAIRS,
    trusted: pairs >= MIN_TRUSTED_SWAP_PAIRS,
  };
}

export const MIN_TRUSTED_LABELS = 30;

const WINNERS: Winner[] = ["v1", "v2", "tie"];

export function judgeCalibration(rows: readonly LabeledComparison[]): JudgeCalibrationReport {
  const labeled = rows.length;
  const agree = rows.filter((r) => r.judgeWinner === r.operatorWinner).length;
  const perClass = {} as Record<Winner, ClassStats>;
  for (const w of WINNERS) {
    const judgeSaid = rows.filter((r) => r.judgeWinner === w);
    const operatorSaid = rows.filter((r) => r.operatorWinner === w);
    const truePos = judgeSaid.filter((r) => r.operatorWinner === w).length;
    perClass[w] = {
      precision: judgeSaid.length > 0 ? Math.round((truePos / judgeSaid.length) * 1000) / 1000 : null,
      recall:
        operatorSaid.length > 0 ? Math.round((truePos / operatorSaid.length) * 1000) / 1000 : null,
      judgeCount: judgeSaid.length,
      operatorCount: operatorSaid.length,
    };
  }
  return {
    labeled,
    agreement: labeled > 0 ? Math.round((agree / labeled) * 1000) / 1000 : null,
    kappa: cohensKappa(rows),
    perClass,
    minTrustedLabels: MIN_TRUSTED_LABELS,
    trusted: labeled >= MIN_TRUSTED_LABELS,
  };
}
