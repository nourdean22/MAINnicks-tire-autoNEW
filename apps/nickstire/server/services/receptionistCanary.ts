/**
 * Receptionist canary (job 2026-10-31-self-learning-nickstire, W3).
 *
 * After an auto-promotion, did callers do worse? Pre-registered, never tuned
 * after the fact:
 *   metric   success share of EVALUATED calls (eval_outcome hard_conversion,
 *            walk_in_directed or resolved_info), the same won-call set the
 *            offline success cohort uses (promptEvolution.ts);
 *   arms     AFTER = calls whose evidence names the promoted prompt
 *            (metadata.behavior.promptHash, stamped by the promotion PATCH);
 *            BEFORE = evaluated calls in the 14 days before the promotion;
 *   harm     one-sided two-proportion z test, z <= -1.645 (alpha 0.05) once
 *            AFTER has 60 evaluated calls; z <= -2.576 (alpha 0.005) earlier;
 *   deadline 14 days: fewer than 60 calls by then rolls back (an unproven
 *            prompt is never kept);
 *   baseline fewer than 100 evaluated BEFORE calls rolls back (unmeasurable).
 * A read that failed is UNKNOWN, never a zero: the canary stays open.
 *
 * Before/after is weaker than a concurrent split (time confounds it); the
 * concurrent 50/50 split through assistant-request overrides is the 10x
 * follow-up, blocked on proving the inbound number routes through it.
 * Repeated nightly looks inflate false ROLLBACKS only, the safe direction.
 *
 * Benchmarked against: LaunchDarkly guarded rollouts (sequential regression
 * test, rollback when the sample is too small by the end), Argo Rollouts
 * (inconclusive never promotes), Kayenta (compare against a baseline per metric).
 */

export const CANARY = Object.freeze({
  minCalls: 60,
  minBaseline: 100,
  maxDays: 14,
  baselineDays: 14,
  harmZ: -1.645,
  earlyHarmZ: -2.576,
});

export interface CallCounts {
  evaluated: number;
  success: number;
}

export type CanaryVerdict =
  | { verdict: "watching"; z: number | null; after: number }
  | { verdict: "passed"; z: number; after: number }
  | { verdict: "rollback"; reason: "harm" | "early_harm" | "too_few_calls" | "no_baseline"; z: number | null; after: number }
  | { verdict: "unknown"; reason: "read_failed" };

/** One-sided two-proportion z (after minus before); null when either arm is empty or the pooled share is 0 or 1. */
function zScore(before: CallCounts, after: CallCounts): number | null {
  if (before.evaluated === 0 || after.evaluated === 0) return null;
  const p1 = before.success / before.evaluated;
  const p2 = after.success / after.evaluated;
  const pooled = (before.success + after.success) / (before.evaluated + after.evaluated);
  if (pooled <= 0 || pooled >= 1) return null;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / before.evaluated + 1 / after.evaluated));
  return (p2 - p1) / se;
}

export function evaluateCanary(input: { now: Date; promotedAt: Date; before: CallCounts | null; after: CallCounts | null }): CanaryVerdict {
  if (!input.before || !input.after) return { verdict: "unknown", reason: "read_failed" };
  const { before, after } = input;
  const n = after.evaluated;
  if (before.evaluated < CANARY.minBaseline) return { verdict: "rollback", reason: "no_baseline", z: null, after: n };
  const z = zScore(before, after);
  if (n >= CANARY.minCalls) {
    if (z !== null && z <= CANARY.harmZ) return { verdict: "rollback", reason: "harm", z, after: n };
    return { verdict: "passed", z: z ?? 0, after: n };
  }
  if (z !== null && z <= CANARY.earlyHarmZ) return { verdict: "rollback", reason: "early_harm", z, after: n };
  const deadline = input.promotedAt.getTime() + CANARY.maxDays * 24 * 3_600_000;
  if (input.now.getTime() > deadline) return { verdict: "rollback", reason: "too_few_calls", z, after: n };
  return { verdict: "watching", z, after: n };
}
