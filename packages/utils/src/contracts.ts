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

// ─── Bridge (statenour ⇄ nickstire) ─────────────────────────────────
// Source: apps/statenour/lib/nickstire/query.ts (queryNick) +
// apps/nickstire/server/_core/bridge-routes.ts. The bridge replies
// with a data payload or an error string; "Unknown query" is the
// contract-drift sentinel (NICKSTIRE-QUERY-CONTRACT.md).

export interface BridgeQueryRequest {
  query: string;
  filters?: Record<string, unknown>;
}

export interface BridgeQueryResponse<T = unknown> {
  data?: T;
  error?: string;
}

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
] as const;
export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

export const AUTH_ATTEMPTING_PROBE_OUTCOMES = [
  "success",
  "empty",
  "auth_failed",
  "error",
] as const satisfies readonly ProbeOutcome[];

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
] as const;
export type OpportunityState = (typeof OPPORTUNITY_STATES)[number];

export const OUTCOME_MATCH_METHODS = ["direct", "strong", "manual"] as const;
export type OutcomeMatchMethod = (typeof OUTCOME_MATCH_METHODS)[number];

/** Honest collector telemetry (strike-2): re-touches are never production. */
export interface CollectorStats {
  scanned: number;
  inserted: number;
  refreshed: number;
}

// ─── Capability artifact states (statenour spine-7) ─────────────────
// Source: apps/statenour/app/api/cron/inngest-liveness/route.ts. A
// probe failure reports "unknown", never healthy.

export const ARTIFACT_STATES = ["fresh", "stale", "never_produced", "unknown"] as const;
export type ArtifactState = (typeof ARTIFACT_STATES)[number];

export interface CapabilityArtifact {
  capability: string;
  state: ArtifactState;
  ageH: number | null;
}

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
] as const;
export type MemoryEvidenceClass = (typeof MEMORY_EVIDENCE_CLASSES)[number];

export const MEMORY_DECISIONS = [
  "add",
  "reinforce",
  "update",
  "supersede",
  "review_required",
  "noop",
] as const;
export type MemoryDecision = (typeof MEMORY_DECISIONS)[number];

// ─── Task triage (statenour) ────────────────────────────────────────
// Source: apps/statenour/lib/trpc/routers/task.ts `triage` mutation —
// the Things-style one-item flow InboxTasksTriage drives on Home.
// (A spine-5 parallel contract briefly existed with different words and
// was deleted 2026-07-28 when the incumbent was rediscovered — this
// registry exists precisely so that stops happening.)

export const TRIAGE_DECISIONS = ["today", "schedule", "anytime", "someday", "kill", "snooze"] as const;
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];

// ─── Execution classes (WP-15, 2026-07-28) ──────────────────────────
// Every background or foreground operation belongs to EXACTLY ONE of
// these. The classes were MEASURED first (blueprint job-ownership
// census: request-time services, worker node-cron, Inngest scheduled +
// event-driven, mega fan-out, post-turn outbox) and named second — the
// vocabulary follows the census, not the other way around. Consumers:
// cron manifest annotations, capability registry, future scorecards.

export const EXECUTION_CLASSES = [
  "query", // read-only, fast, request-time
  "command", // immediate mutation with receipt
  "job", // background operation with progress (outbox, drains)
  "workflow", // multi-step deterministic process (Inngest step fns)
  "agent_task", // adaptive delegated work (research-on-demand)
  "schedule", // time-triggered execution (crons, fan-outs)
  "watch", // condition-triggered monitoring (liveness, watchdogs)
] as const;
export type ExecutionClass = (typeof EXECUTION_CLASSES)[number];

// ─── Commitment lifecycle (WP-13, 2026-07-28) ───────────────────────
// Source: apps/statenour prisma `Commitment` (status String, default
// "active" — pre-existing writers: Telegram /commit, weekly-review,
// commit-sweep). The lifecycle EXTENDS the legacy states rather than
// replacing them: "active"/"completed"/"stale" rows predate this
// vocabulary and remain valid. New flow: proposed → accepted → active
// → verified | abandoned, with blocked as a parking state. A proposed
// commitment is machine-suggested (e.g. a journal nextAction) and has
// NO standing until the operator accepts it.

export const COMMITMENT_STATUSES = [
  "proposed",
  "accepted",
  "active",
  "blocked",
  "verified",
  "abandoned",
  // legacy states still present in prod rows — readers must tolerate:
  "completed",
  "stale",
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

// ─── Guards ─────────────────────────────────────────────────────────

const setOf = (arr: readonly string[]) => new Set(arr);
const probeSet = setOf(PROBE_OUTCOMES);
const oppSet = setOf(OPPORTUNITY_STATES);
const artifactSet = setOf(ARTIFACT_STATES);
const execSet = setOf(EXECUTION_CLASSES);
const commitSet = setOf(COMMITMENT_STATUSES);

export const isProbeOutcome = (v: string): v is ProbeOutcome => probeSet.has(v);
export const isOpportunityState = (v: string): v is OpportunityState => oppSet.has(v);
export const isArtifactState = (v: string): v is ArtifactState => artifactSet.has(v);
export const isExecutionClass = (v: string): v is ExecutionClass => execSet.has(v);
export const isCommitmentStatus = (v: string): v is CommitmentStatus => commitSet.has(v);
