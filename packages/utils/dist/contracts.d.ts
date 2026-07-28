/**
 * @nour/utils/contracts — the cross-app vocabulary registry (NL-2).
 *
 * These shapes are EXTRACTED from running code, not invented: each block
 * names its source of truth. The rule this module enforces socially:
 * when two apps (or an app and the worker) exchange a shape, the shape's
 * name and enum values live HERE, so drift becomes a type error instead
 * of a 2 a.m. incident. Dependency-free by design (no zod) — plain
 * const-arrays + type guards, so consuming it never changes any app's
 * dependency graph.
 *
 * Additive-only. Changing an existing value is a cross-app breaking
 * change and needs both consumers in the same PR.
 */
export interface BridgeQueryRequest {
    query: string;
    filters?: Record<string, unknown>;
}
export interface BridgeQueryResponse<T = unknown> {
    data?: T;
    error?: string;
}
export declare const BRIDGE_UNKNOWN_QUERY_SENTINEL = "Unknown query";
export declare const PROBE_OUTCOMES: readonly ["success", "auth_failed", "empty", "dedup", "skipped_recent", "error"];
export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];
export declare const AUTH_ATTEMPTING_PROBE_OUTCOMES: readonly ["success", "empty", "auth_failed", "error"];
export declare const OPPORTUNITY_STATES: readonly ["new", "assigned", "attempted", "contacted", "scheduled", "walk_in_expected", "arrived", "won", "lost", "no_response", "do_not_contact", "duplicate"];
export type OpportunityState = (typeof OPPORTUNITY_STATES)[number];
export declare const OUTCOME_MATCH_METHODS: readonly ["direct", "strong", "manual"];
export type OutcomeMatchMethod = (typeof OUTCOME_MATCH_METHODS)[number];
/** Honest collector telemetry (strike-2): re-touches are never production. */
export interface CollectorStats {
    scanned: number;
    inserted: number;
    refreshed: number;
}
export declare const ARTIFACT_STATES: readonly ["fresh", "stale", "never_produced", "unknown"];
export type ArtifactState = (typeof ARTIFACT_STATES)[number];
export interface CapabilityArtifact {
    capability: string;
    state: ArtifactState;
    ageH: number | null;
}
export declare const MEMORY_EVIDENCE_CLASSES: readonly ["operator_stated", "direct_observation", "system_receipt", "external_source", "supported_inference", "weak_inference", "prediction", "generated_summary"];
export type MemoryEvidenceClass = (typeof MEMORY_EVIDENCE_CLASSES)[number];
export declare const MEMORY_DECISIONS: readonly ["add", "reinforce", "update", "supersede", "review_required", "noop"];
export type MemoryDecision = (typeof MEMORY_DECISIONS)[number];
export declare const TRIAGE_DECISIONS: readonly ["today", "schedule", "anytime", "someday", "kill", "snooze"];
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];
export declare const isProbeOutcome: (v: string) => v is ProbeOutcome;
export declare const isOpportunityState: (v: string) => v is OpportunityState;
export declare const isArtifactState: (v: string) => v is ArtifactState;
//# sourceMappingURL=contracts.d.ts.map