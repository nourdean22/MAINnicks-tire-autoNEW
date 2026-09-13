/**
 * OPERATION RETRY POLICY — 2026-09-13.
 *
 * Distributed side effects have one dangerous state: the request may have
 * committed but the caller never received the terminal response. Treating that
 * as a normal failure and retrying is how an agent sends two messages, creates
 * two tasks, or applies the same mutation twice.
 *
 * This module turns the control-plane OperationState into a deterministic next
 * action. It does not execute anything and it does not ask an LLM to judge
 * safety.
 */

import type { OperationState } from "./turn-control-plane";

export type RetryDecision =
  | "NO_ACTION"
  | "MAY_RETRY"
  | "VERIFY_BEFORE_CLAIM"
  | "RECONCILE_BEFORE_RETRY"
  | "DO_NOT_RETRY";

export interface RetryPolicyDecision {
  decision: RetryDecision;
  mayRetryNow: boolean;
  mayClaimDone: boolean;
  requiresReconciliation: boolean;
  reason: string;
}

/**
 * `effectClass` is included because a failed READ is cheap to retry while a
 * failed WRITE may need a stable idempotency key/provider contract. Unknown
 * effects fail closed to reconciliation rather than being treated as reads.
 */
export function retryPolicyFor(
  state: OperationState,
  effectClass: "read" | "write" | "unknown",
): RetryPolicyDecision {
  if (state === "NOT_ATTEMPTED") {
    return {
      decision: "NO_ACTION",
      mayRetryNow: false,
      mayClaimDone: false,
      requiresReconciliation: false,
      reason: "operation was never attempted",
    };
  }

  if (state === "VERIFIED") {
    return {
      decision: "DO_NOT_RETRY",
      mayRetryNow: false,
      mayClaimDone: true,
      requiresReconciliation: false,
      reason: "independent postcondition already verified the intended state",
    };
  }

  if (state === "PROVIDER_ACCEPTED") {
    return {
      decision: "VERIFY_BEFORE_CLAIM",
      mayRetryNow: false,
      mayClaimDone: false,
      requiresReconciliation: true,
      reason: "provider acknowledged the operation but the world state has not been independently verified",
    };
  }

  if (state === "UNKNOWN_COMPLETION") {
    return {
      decision: "RECONCILE_BEFORE_RETRY",
      mayRetryNow: false,
      mayClaimDone: false,
      requiresReconciliation: true,
      reason: "completion is ambiguous; retrying now could duplicate a side effect",
    };
  }

  // FAILED_KNOWN. A read can be retried by the caller's bounded retry policy.
  // Writes are also eligible only when failure is definitively known; the
  // operation layer must still reuse the SAME operation/idempotency identity.
  if (state === "FAILED_KNOWN") {
    if (effectClass === "unknown") {
      return {
        decision: "RECONCILE_BEFORE_RETRY",
        mayRetryNow: false,
        mayClaimDone: false,
        requiresReconciliation: true,
        reason: "tool effect is unclassified, so a reported failure is not enough to prove retry safety",
      };
    }
    return {
      decision: "MAY_RETRY",
      mayRetryNow: true,
      mayClaimDone: false,
      requiresReconciliation: false,
      reason:
        effectClass === "read"
          ? "read failure is known; a bounded retry is safe"
          : "write failure is known; retry only with the same durable operation/idempotency identity",
    };
  }

  // Exhaustiveness guard for runtime data crossing version boundaries.
  return {
    decision: "RECONCILE_BEFORE_RETRY",
    mayRetryNow: false,
    mayClaimDone: false,
    requiresReconciliation: true,
    reason: "unrecognized operation state fails closed",
  };
}
