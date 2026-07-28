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
export const BRIDGE_UNKNOWN_QUERY_SENTINEL = "Unknown query";
// ─── ALG probe outcomes (nickstire) ─────────────────────────────────
// Source: apps/nickstire/server/services/algProbeBudget.ts +
// server/lib/adminActivity.ts (strike-1). AUTH_ATTEMPTING outcomes are
// the ones that kicked the shop counter's ShopDriver session — the
// throttle counts exactly these.
export const PROBE_OUTCOMES = [
    "success",
    "auth_failed",
    "empty",
    "dedup",
    "skipped_recent",
    "error",
];
export const AUTH_ATTEMPTING_PROBE_OUTCOMES = [
    "success",
    "empty",
    "auth_failed",
    "error",
];
// ─── Revenue opportunity queue (nickstire, roadmap Wave-4) ──────────
// Source: apps/nickstire/server/services/opportunityQueue.ts. `won` is
// only reachable via recordOutcome with a match-verified invoice.
export const OPPORTUNITY_STATES = [
    "new",
    "assigned",
    "attempted",
    "contacted",
    "scheduled",
    "walk_in_expected",
    "arrived",
    "won",
    "lost",
    "no_response",
    "do_not_contact",
    "duplicate",
];
export const OUTCOME_MATCH_METHODS = ["direct", "strong", "manual"];
// ─── Capability artifact states (statenour spine-7) ─────────────────
// Source: apps/statenour/app/api/cron/inngest-liveness/route.ts. A
// probe failure reports "unknown", never healthy.
export const ARTIFACT_STATES = ["fresh", "stale", "never_produced", "unknown"];
// ─── Memory commit gateway (statenour spine-2) ──────────────────────
// Source: apps/statenour/lib/brain/memory-commit-gateway.ts.
export const MEMORY_EVIDENCE_CLASSES = [
    "operator_stated",
    "direct_observation",
    "system_receipt",
    "external_source",
    "supported_inference",
    "weak_inference",
    "prediction",
    "generated_summary",
];
export const MEMORY_DECISIONS = [
    "add",
    "reinforce",
    "update",
    "supersede",
    "review_required",
    "noop",
];
// ─── Task triage (statenour spine-5) ────────────────────────────────
// Source: apps/statenour/lib/services/task-triage.ts — five mandatory
// exits mapped onto the existing TaskStatus vocabulary.
export const TRIAGE_DECISIONS = ["do_today", "schedule", "available", "someday", "kill"];
// ─── Guards ─────────────────────────────────────────────────────────
const setOf = (arr) => new Set(arr);
const probeSet = setOf(PROBE_OUTCOMES);
const oppSet = setOf(OPPORTUNITY_STATES);
const artifactSet = setOf(ARTIFACT_STATES);
export const isProbeOutcome = (v) => probeSet.has(v);
export const isOpportunityState = (v) => oppSet.has(v);
export const isArtifactState = (v) => artifactSet.has(v);
//# sourceMappingURL=contracts.js.map