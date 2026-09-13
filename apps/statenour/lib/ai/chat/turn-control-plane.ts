/**
 * NICK TURN CONTROL PLANE — 2026-09-13.
 *
 * One small vocabulary for facts the chat runtime already knows but used to
 * expose through unrelated logs/panels: response obligations, capability
 * availability, read/evidence state, and side-effect completion state.
 *
 * IMPORTANT: this module does not decide truth with an LLM. Every state here
 * is derived from deterministic runtime evidence. Numeric confidence is
 * deliberately absent.
 */

import type { ResponseContract } from "@/lib/ai/response-contract";

export type ReadState = "OK" | "EMPTY" | "ERROR" | "UNMEASURED" | "STALE";

export interface ResponseBudget {
  /** Normal target, not a claim that generation will hit it exactly. */
  targetWords: number;
  /** The contract ceiling the final-answer layer should enforce. */
  hardMaxWords: number;
  /** Why this budget differs from the default operator contract. */
  reason: string;
}

/**
 * The operator contract is <=80 words by default. Expansion is opt-in: an
 * explicitly detailed turn or a copy/paste prompt may be longer. This is kept
 * separate from model maxOutputTokens because thinking-model reasoning can
 * consume completion tokens before visible prose; using an 80-word token cap
 * there would recreate the historical empty/truncated-response bug.
 */
export function responseBudgetFor(contract: ResponseContract): ResponseBudget {
  if (contract.length === "ultra_concise") {
    return { targetWords: 12, hardMaxWords: 30, reason: "operator requested ultra-concise output" };
  }
  if (contract.length === "concise") {
    return { targetWords: 45, hardMaxWords: 80, reason: "operator requested concise output" };
  }
  if (contract.answerMode === "copy_paste_prompt") {
    return { targetWords: 700, hardMaxWords: 2_000, reason: "copy/paste prompt is an explicit long-form artifact" };
  }
  if (contract.length === "detailed") {
    return { targetWords: 600, hardMaxWords: 1_200, reason: "operator explicitly requested detailed output" };
  }
  return { targetWords: 60, hardMaxWords: 80, reason: "default operator contract" };
}

export interface CapabilityPlanInput {
  registered: readonly string[];
  surfaced: readonly string[];
  disabled?: readonly string[];
  forced?: Readonly<Record<string, string>>;
  recoveryTools?: readonly string[];
}

export interface CapabilityPlan {
  registeredCount: number;
  discoverableCount: number;
  surfacedCount: number;
  registered: string[];
  discoverable: string[];
  surfaced: string[];
  disabled: string[];
  /** tool name -> deterministic reason it was force-surfaced */
  forced: Record<string, string>;
  recoveryTools: string[];
}

function uniqSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

/**
 * Registered != surfaced. A pruner is allowed to reduce prompt/tool-schema
 * load, but it must never make the runtime unable to say whether a capability
 * existed. `discoverable` therefore means registered and not operator-disabled;
 * `surfaced` is the exact subset handed to the model this turn.
 */
export function buildCapabilityPlan(input: CapabilityPlanInput): CapabilityPlan {
  const registered = uniqSorted(input.registered);
  const disabled = uniqSorted(input.disabled ?? []);
  const disabledSet = new Set(disabled);
  const discoverable = registered.filter((name) => !disabledSet.has(name));
  const discoverableSet = new Set(discoverable);
  const surfaced = uniqSorted(input.surfaced).filter((name) => discoverableSet.has(name));
  const recoveryTools = uniqSorted(input.recoveryTools ?? []).filter((name) => surfaced.includes(name));

  const forced: Record<string, string> = {};
  for (const [name, reason] of Object.entries(input.forced ?? {})) {
    if (surfaced.includes(name) && reason) forced[name] = reason;
  }

  return {
    registeredCount: registered.length,
    discoverableCount: discoverable.length,
    surfacedCount: surfaced.length,
    registered,
    discoverable,
    surfaced,
    disabled,
    forced,
    recoveryTools,
  };
}

export type OperationState =
  | "NOT_ATTEMPTED"
  | "FAILED_KNOWN"
  | "UNKNOWN_COMPLETION"
  | "PROVIDER_ACCEPTED"
  | "VERIFIED";

export interface OperationEvidence {
  attempted: boolean;
  /** A deterministic failure was returned before/while executing. */
  knownFailure?: boolean;
  /** The request may have left our process but no terminal receipt arrived. */
  completionUnknown?: boolean;
  /** Provider acknowledged the mutation, but no independent postcondition read ran. */
  providerAccepted?: boolean;
  /** Independent postcondition/read-back confirms the intended world state. */
  verified?: boolean;
}

/**
 * Exactly-once cannot be inferred from a timeout. UNKNOWN_COMPLETION is a
 * first-class state so callers reconcile before retrying rather than turning a
 * dropped response into a duplicate mutation.
 */
export function operationStateFrom(e: OperationEvidence): OperationState {
  if (!e.attempted) return "NOT_ATTEMPTED";
  if (e.verified) return "VERIFIED";
  if (e.completionUnknown) return "UNKNOWN_COMPLETION";
  if (e.knownFailure) return "FAILED_KNOWN";
  if (e.providerAccepted) return "PROVIDER_ACCEPTED";
  return "UNKNOWN_COMPLETION";
}

export interface TurnExecutionPhase {
  traceId: string;
  phase: "CAPABILITY_PLAN" | "EVIDENCE" | "FINALIZE";
  at: string;
  responseBudget?: ResponseBudget;
  capabilityPlan?: CapabilityPlan;
  recall?: { state: ReadState; reason?: string; hitCount?: number };
  tools?: Array<{ name: string; ok: boolean; resultObserved: boolean }>;
  final?: {
    receiptOk?: boolean;
    evidenceVerdict?: string;
    replyGateSeverity?: number;
    wordCount?: number;
  };
}

/**
 * Produces a JSON-safe phase receipt. Persistence is intentionally left to the
 * caller so this module stays deterministic and testable.
 */
export function buildTurnExecutionPhase(
  phase: Omit<TurnExecutionPhase, "at"> & { at?: string },
): TurnExecutionPhase {
  return {
    ...phase,
    at: phase.at ?? new Date().toISOString(),
  };
}
