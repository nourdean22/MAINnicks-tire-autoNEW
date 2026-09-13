/**
 * TURN EXECUTION SUMMARY — 2026-09-13.
 *
 * A normalized, JSON-safe view over the control-plane facts StateNour already
 * produces. This is intentionally a PURE compiler, not another persistence
 * system. Callers may store it in tokenUsage/system_metrics/trace metadata once
 * they have a safe write seam.
 *
 * Truth rule: absence of recall receipts is NEVER enough to infer EMPTY.
 */

import type { CapabilityPlan, OperationState, ReadState, ResponseBudget } from "./turn-control-plane";
import { retryPolicyFor, type RetryDecision } from "./operation-retry-policy";

export type RecallProvenanceState = "OK" | "ZERO" | "ERROR" | "UNMEASURED" | "STALE";

export interface RecallExecutionSummary {
  state: ReadState;
  hitCount: number;
  reason?: string;
  /** Why this state is justified, not merely what the state is. */
  basis: "EXPLICIT_PROVENANCE" | "OBSERVED_HITS" | "NO_MEASUREMENT";
}

export function summarizeRecall(input: {
  explicitState?: RecallProvenanceState | null;
  hitCount?: number | null;
  reason?: string | null;
}): RecallExecutionSummary {
  const hitCount = Math.max(0, input.hitCount ?? 0);
  if (input.explicitState) {
    const state: ReadState = input.explicitState === "ZERO" ? "EMPTY" : input.explicitState;
    return {
      state,
      hitCount,
      reason: input.reason || undefined,
      basis: "EXPLICIT_PROVENANCE",
    };
  }
  if (hitCount > 0) {
    return {
      state: "OK",
      hitCount,
      reason: input.reason || undefined,
      basis: "OBSERVED_HITS",
    };
  }
  return {
    state: "UNMEASURED",
    hitCount: 0,
    reason: input.reason || "recall provenance was not captured at this persistence seam",
    basis: "NO_MEASUREMENT",
  };
}

export interface OperationExecutionInput {
  name: string;
  ok: boolean;
  effectClass: "read" | "write" | "unknown";
  operationState: OperationState;
  resultObserved: boolean;
}

export interface OperationExecutionSummary {
  tool: string;
  effectClass: "read" | "write" | "unknown";
  state: OperationState;
  sdkOk: boolean;
  resultObserved: boolean;
  retryDecision: RetryDecision;
  mayRetryNow: boolean;
  mayClaimDoneStrict: boolean;
  requiresReconciliation: boolean;
}

export interface OperationIntegritySummary {
  operations: OperationExecutionSummary[];
  consequentialCount: number;
  legacySdkSuccesses: number;
  strictVerified: number;
  legacyStrictGap: number;
  /** null when the turn attempted no write/unknown-effect operation. */
  strictDoneEligible: boolean | null;
}

export function summarizeOperations(
  calls: ReadonlyArray<OperationExecutionInput>,
): OperationIntegritySummary {
  const consequential = calls.filter((c) => c.effectClass !== "read");
  const operations = consequential.map((c): OperationExecutionSummary => {
    const retry = retryPolicyFor(c.operationState, c.effectClass);
    return {
      tool: c.name,
      effectClass: c.effectClass,
      state: c.operationState,
      sdkOk: c.ok,
      resultObserved: c.resultObserved,
      retryDecision: retry.decision,
      mayRetryNow: retry.mayRetryNow,
      mayClaimDoneStrict: retry.mayClaimDone,
      requiresReconciliation: retry.requiresReconciliation,
    };
  });
  const legacySdkSuccesses = operations.filter((o) => o.sdkOk).length;
  const strictVerified = operations.filter((o) => o.mayClaimDoneStrict).length;
  const legacyStrictGap = operations.filter((o) => o.sdkOk && !o.mayClaimDoneStrict).length;
  return {
    operations,
    consequentialCount: operations.length,
    legacySdkSuccesses,
    strictVerified,
    legacyStrictGap,
    strictDoneEligible:
      operations.length === 0 ? null : operations.every((o) => o.mayClaimDoneStrict),
  };
}

export interface TurnExecutionSummary {
  version: 1;
  traceId: string;
  responseBudget: ResponseBudget;
  capability?: Pick<
    CapabilityPlan,
    | "registeredCount"
    | "discoverableCount"
    | "surfacedCount"
    | "disabled"
    | "forced"
    | "recoveryTools"
  >;
  recall: RecallExecutionSummary;
  operationIntegrity: OperationIntegritySummary;
  final?: {
    wordCount?: number;
    evidenceVerdict?: string;
    replyGateSeverity?: number;
    entityProvenanceViolations?: number;
  };
}

export function buildTurnExecutionSummary(input: Omit<TurnExecutionSummary, "version">): TurnExecutionSummary {
  return { version: 1, ...input };
}
