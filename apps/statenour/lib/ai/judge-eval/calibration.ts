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
  perClass: Record<Winner, ClassStats>;
  /** Below this many labels the numbers are directional, not trustworthy. */
  minTrustedLabels: number;
  trusted: boolean;
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
    perClass,
    minTrustedLabels: MIN_TRUSTED_LABELS,
    trusted: labeled >= MIN_TRUSTED_LABELS,
  };
}
