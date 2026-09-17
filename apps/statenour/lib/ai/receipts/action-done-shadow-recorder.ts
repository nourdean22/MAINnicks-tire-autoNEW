/**
 * Records the PROSE-AWARE strict-Done shadow verdict. Shadow only — this
 * changes no behaviour, it makes a decision measurable.
 *
 * WHY IT IS A MODULE AND NOT AN INLINE BLOCK. Its only caller is
 * `runDeferredBackgroundWork`, a ~700-line function with no test harness of
 * its own. An inline block there would be wired and unprovable: the mandate's
 * "built-tested-unwired" failure with the last two words swapped. Extracted and
 * dependency-injected, the contract below is directly assertable, and the seam
 * keeps one readable call.
 *
 * WHY IT EXISTS ALONGSIDE `summarizeClaimDoneShadow`. That one summarises
 * RECEIPTS and never reads the assistant's text, answering "were all receipts
 * verified?". `compareActionDoneShadow` reads the prose, answering the question
 * promotion actually turns on: "did Nick claim Done while strict verification
 * was absent?" — `legacyStrictGap`. Different questions, not duplicates.
 *
 * THE DEFECT THIS CLOSES. `compareActionDoneShadow` shipped with tests and ZERO
 * production call sites, so `legacyStrictGap` had never been observed on a real
 * turn. A shadow nobody evaluates cannot inform a promotion decision — the same
 * shape as the tool-surfacing census (#2359), which rendered "no surfacing data
 * exists" for three weeks over 456 rows that did exist.
 */

import type { ActionDoneShadowVerdict } from "@/lib/ai/chat/action-result-verifier";
import type { MetricWriteReceipt } from "@/lib/services/metrics";

export const ACTION_DONE_SHADOW_METRIC = "action.done.shadow";

export type ActionDoneShadowOutcome =
  /** A completion claim was present and the verdict was recorded. */
  | "recorded"
  /** The prose made no completion claim, so there is nothing to judge. */
  | "skipped_no_claim"
  /** The instrument itself failed. Never silently — see below. */
  | "failed";

export interface ActionDoneShadowContext {
  traceId: string;
  conversationId: string | null;
}

export interface ActionDoneShadowDeps {
  /**
   * Must PROPAGATE a write failure — pass `recordMetricStrict`, never the
   * fail-soft `recordMetric`.
   *
   * 2026-09-16 · review caught this as a P1 and it was correct. This was typed
   * `=> Promise<void>`, and production passed `lib/services/metrics.ts`'s
   * `recordMetric`, which ends in `.catch(() => {})`. So the await below could
   * never reject, `recordActionDoneShadow` always returned "recorded", and the
   * non-silent catch this module advertises was DEAD CODE on the only path
   * that runs. The unit test passed solely because its injected mock rejected
   * where the real dependency does not — a test agreeing with itself.
   *
   * The receipt return type is the fix, not a comment: `Promise<void>` is not
   * assignable to `Promise<MetricWriteReceipt>`, so a writer that swallows its
   * own failure cannot be passed here at all. The next person to wire this
   * gets a compile error instead of a silent instrument.
   */
  recordMetric: (
    metric: string,
    value: number,
    options?: { unit?: string; tags?: Record<string, unknown>; source?: string },
  ) => Promise<MetricWriteReceipt>;
  logInfo?: (event: string, data: Record<string, unknown>) => void;
  logError?: (scope: string, err: unknown, meta: Record<string, unknown>) => void;
}

/**
 * DENOMINATOR DISCIPLINE. A row is written for EVERY turn whose prose claimed
 * completion — gap or not — so the rate has a denominator. Recording only gaps
 * would leave a numerator alone, and a measured zero would be indistinguishable
 * from an absent instrument. That confusion is precisely what the tool census
 * documents as its own worst failure.
 *
 * Turns with no completion claim are deliberately NOT recorded: they are not in
 * the population the promotion question applies to, and including them would
 * bury the signal under ordinary conversation.
 *
 * ⚠ THIS IS A CONTRACT ON THE CALLER, AND THE FIRST CALLER BROKE IT. Review
 * caught it as a P1 and was right: the call sat inside
 * `if (actions.length > 0)` in deferred-background-work.ts, so a turn that
 * claimed completion while emitting NO action block never reached this
 * function. That is precisely the phantom case — "Done — both profiles
 * created" with nothing attempted — which `phantomClaims` exists to classify.
 * The dataset therefore excluded the exact fabrications it was built to
 * measure, while this paragraph claimed a denominator of all completion-claim
 * turns. A zero-action turn must call in with an EMPTY result list, not be
 * skipped; `tests/ai/receipts/action-done-shadow-recorder.test.ts` pins that
 * the empty-results case still records.
 */
export async function recordActionDoneShadow(
  verdict: ActionDoneShadowVerdict,
  ctx: ActionDoneShadowContext,
  deps: ActionDoneShadowDeps,
): Promise<ActionDoneShadowOutcome> {
  if (!verdict.completionClaimDetected) return "skipped_no_claim";

  try {
    deps.logInfo?.("action_done_shadow", {
      site: "action-blocks-prose",
      traceId: ctx.traceId,
      gap: verdict.legacyStrictGap,
      strictRelevant: verdict.strictRelevant,
    });

    await deps.recordMetric(ACTION_DONE_SHADOW_METRIC, verdict.legacyStrictGap ? 1 : 0, {
      unit: "count",
      source: "action-done-shadow",
      tags: {
        traceId: ctx.traceId,
        conversationId: ctx.conversationId,
        // The disagreement itself.
        legacyDoneEligible: verdict.legacyDoneEligible,
        strictDoneEligible: verdict.strictDoneEligible,
        strictRelevant: verdict.strictRelevant,
        legacyStrictGap: verdict.legacyStrictGap,
        // WHY they disagreed — the classes a promotion decision must separate.
        // `providerAcceptedMutations` is the interesting one: the executor
        // reported success and nothing independently confirmed it. That is the
        // "accepted vs verified" distinction the whole strict rule rests on.
        failedMutations: verdict.failedMutations,
        providerAcceptedMutations: verdict.providerAcceptedMutations,
        verifiedMutations: verdict.verifiedMutations,
        phantomCount: verdict.phantomClaims.length,
      },
    });
    return "recorded";
  } catch (err) {
    // NOT a silent catch. #2359's `catch { return null }` made a query that
    // could never succeed indistinguishable from an empty dataset for three
    // weeks. A broken instrument must say so rather than read as "no gaps".
    deps.logError?.("chat.action-done-shadow", err, { stage: "record-shadow", traceId: ctx.traceId });
    return "failed";
  }
}
