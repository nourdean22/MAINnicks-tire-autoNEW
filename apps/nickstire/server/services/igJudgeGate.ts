/**
 * Independent-judge publish gate for the autonomous IG publisher
 * (operator flip 2026-08-07).
 *
 * The self-eval gate's measured blind spot: the 25-post retro-tournament
 * found 5/25 posts that passed self-eval >= 0.7 while the independent
 * tournament judge scored them < 60 or hard-rejected — unanimous signature
 * "generic mechanic imagery any shop could run unchanged" (captions fine,
 * image generic). The judge verdict already exists inline BEFORE the publish
 * decision (shadow lane, live in prod since 2026-08-05), so this gate is
 * pure decision logic over a verdict that is already paid for.
 *
 * Fail-closed by house precedent for unattended publishers ("automated" =
 * fail CLOSED when a switch state cannot be read — the kill-switch note in
 * igAutopost): nobody watches this run, so "the judge could not check" must
 * not mean "publish". The escape hatch is IG_SHADOW_JUDGE=false, which
 * disables the judge AND the gate together — self-eval-only publishing, the
 * pre-flip behavior.
 */

export interface ShadowJudgeVerdict {
  total: number;
  rejected: boolean;
  note: string;
}

/** Mirrors IgEvalScores["shadowJudge"] — verdict, lane error, or never ran. */
export type ShadowJudgeRecord = ShadowJudgeVerdict | { error: string } | undefined;

/**
 * The measured disagreement predicate, verbatim from the retro-tournament
 * and content.shadowJudgeReadout: self-pass counts as a blind-spot row when
 * the judge scored < 60 or hard-rejected. The gate blocks exactly that set.
 */
export const JUDGE_GATE_MIN_TOTAL = 60;

export interface JudgeGateDecision {
  block: boolean;
  reason: string;
}

export function shadowJudgeGate(verdict: ShadowJudgeRecord, judgeEnabled: boolean): JudgeGateDecision {
  if (!judgeEnabled) {
    return { block: false, reason: "judge disabled (IG_SHADOW_JUDGE=false) — self-eval gate only" };
  }
  if (!verdict) {
    return { block: true, reason: "judge enabled but no verdict recorded — failing closed" };
  }
  if ("error" in verdict) {
    return { block: true, reason: `judge lane failed — failing closed: ${verdict.error}` };
  }
  if (verdict.rejected) {
    return { block: true, reason: `judge hard-rejected: ${verdict.note || "no note"}` };
  }
  if (verdict.total < JUDGE_GATE_MIN_TOTAL) {
    return { block: true, reason: `judge total ${verdict.total} < ${JUDGE_GATE_MIN_TOTAL}: ${verdict.note || "no note"}` };
  }
  return { block: false, reason: `judge total ${verdict.total} — clear` };
}
