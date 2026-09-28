/**
 * THE LANE THAT MAKES `publish_ambiguous` STOP BEING A HUMAN-ONLY STATE.
 *
 * A reel whose `media_publish` was dispatched with no response is parked in
 * `publish_ambiguous` (dailyReelPost) — correct, because Instagram exposes no
 * idempotency key, no request id and no "already published" error code, so a
 * blind retry double-posts on the owner's account.
 *
 * Parking it was only half the job. Nothing resolved it: `reconcileAttempt` had
 * exactly one caller, the operator tRPC mutation, so an ambiguous publish sat
 * until a human opened the Action Center. That is a technical recovery with a
 * known procedure, which is precisely the class that should never reach a
 * person.
 *
 * This runs the SAME `reconcileAttempt` the operator button runs and applies
 * its verdict through the SAME `applyReconciliation` writer. It invents no
 * judgement of its own:
 *
 *   resolved_published      -> apply. The reconciler matched the post and has
 *                              its real id; recording it is bookkeeping.
 *   resolved_not_published  -> apply. The reconciler only returns this after
 *                              proving the fetched page actually reached back
 *                              past the attempt (its page-coverage guard), so
 *                              absence is evidence and a retry is safe.
 *   needs_operator          -> LEAVE PARKED. Two matching posts in the window
 *                              means it may have published twice; deciding
 *                              which to keep is a judgement call.
 *   cannot_check            -> LEAVE PARKED. Not knowing is not a verdict.
 *
 * Bounded, and it never throws into the cron: a failure leaves every attempt
 * exactly as parked as it was.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:publish-reconcile-lane");

/** Attempts younger than this may still be settling; do not touch them. */
export const RECONCILE_MIN_AGE_MINUTES = 20;

/** Per-run cap. Reconciling reads the Instagram account once per attempt. */
export const RECONCILE_MAX_PER_RUN = 5;

export interface ReconcileLaneOutcome {
  checked: number;
  resolvedPublished: number[];
  resolvedNotPublished: number[];
  leftForOperator: Array<{ jobId: number | null; why: string }>;
}

export async function reconcileAmbiguousPublishes(
  maxPerRun = RECONCILE_MAX_PER_RUN,
): Promise<ReconcileLaneOutcome> {
  const out: ReconcileLaneOutcome = {
    checked: 0,
    resolvedPublished: [],
    resolvedNotPublished: [],
    leftForOperator: [],
  };

  const { findUnreconciledAttempts, recordPublishOutcome, OUTCOME } = await import("./publishAttemptLedger");
  const { reconcileAttempt, applyReconciliation } = await import("./publishReconciler");

  const open = await findUnreconciledAttempts(RECONCILE_MIN_AGE_MINUTES);
  // Reel jobs only. A scheduled post is a different target with its own
  // closure path, and reconciling it from here would write the wrong table.
  const reelAttempts = open
    .filter((a) => a.kind === "reel_job" && a.jobId != null && !a.operatorRequired)
    .slice(0, maxPerRun);

  for (const attempt of reelAttempts) {
    out.checked++;
    // Narrowed by the filter above; applyReconciliation requires a number.
    const jobId = attempt.jobId as number;
    try {
      const verdict = await reconcileAttempt({
        attemptId: attempt.attemptId,
        attemptedAt: attempt.occurredAt,
        expectedCaption: attempt.expectedCaption,
      });

      if (verdict.status === "resolved_published") {
        const res = await applyReconciliation({
          kind: attempt.kind,
          jobId,
          attemptId: attempt.attemptId,
          decision: "published",
          igPostId: verdict.igPostId,
          operatorNote: `auto-reconciled: ${verdict.detail}`.slice(0, 500),
        });
        if (res.ok) {
          out.resolvedPublished.push(jobId);
          log.info("ambiguous publish auto-resolved as PUBLISHED", {
            jobId: attempt.jobId, attemptId: attempt.attemptId, igPostId: verdict.igPostId,
          });
        } else {
          out.leftForOperator.push({ jobId: attempt.jobId, why: `apply_refused:${res.detail}`.slice(0, 160) });
        }
        continue;
      }

      if (verdict.status === "resolved_not_published") {
        const res = await applyReconciliation({
          kind: attempt.kind,
          jobId,
          attemptId: attempt.attemptId,
          decision: "not_published",
          operatorNote: `auto-reconciled: ${verdict.detail}`.slice(0, 500),
        });
        if (res.ok) {
          out.resolvedNotPublished.push(jobId);
          log.info("ambiguous publish auto-resolved as NOT published — safe to retry", {
            jobId: attempt.jobId, attemptId: attempt.attemptId,
          });
        } else {
          out.leftForOperator.push({ jobId: attempt.jobId, why: `apply_refused:${res.detail}`.slice(0, 160) });
        }
        continue;
      }

      // A true judgement case, or a history window that can never become wider,
      // is a durable HANDOFF — not a reason to spend another Graph read every
      // 15 minutes forever. OPERATOR_REQUIRED deliberately does not resolve the
      // attempt, so Action Center keeps showing it until a person settles it.
      const permanentlyNeedsOperator =
        verdict.status === "needs_operator"
        || (verdict.status === "cannot_check" && verdict.reason === "history_window_exhausted");
      if (permanentlyNeedsOperator) {
        await recordPublishOutcome(attempt.attemptId, OUTCOME.operatorRequired, {
          error: `auto-reconcile handed to operator: ${verdict.detail}`.slice(0, 500),
          platformResults: {
            detail: verdict.detail,
            candidates: verdict.status === "needs_operator" ? verdict.candidates : [],
            handoffReason: verdict.status === "cannot_check" ? verdict.reason : verdict.status,
          },
        });
        out.leftForOperator.push({ jobId: attempt.jobId, why: verdict.status });
        log.warn("ambiguous publish handed to human resolution", {
          jobId: attempt.jobId, attemptId: attempt.attemptId, status: verdict.status, detail: verdict.detail,
        });
        continue;
      }

      // Transient read failure: DO retry on a future pulse. Turning token/API
      // unavailability into OPERATOR_REQUIRED would freeze a case automation
      // may be able to settle as soon as Meta recovers.
      out.leftForOperator.push({ jobId: attempt.jobId, why: "retry_later" });
      log.warn("ambiguous publish temporarily unverifiable; will retry", {
        jobId: attempt.jobId, attemptId: attempt.attemptId, status: verdict.status, detail: verdict.detail,
      });
    } catch (err) {
      out.leftForOperator.push({ jobId: attempt.jobId, why: "reconcile_error" });
      log.warn("reconcile lane: attempt failed, leaving it parked", {
        jobId: attempt.jobId, attemptId: attempt.attemptId,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }

  return out;
}
