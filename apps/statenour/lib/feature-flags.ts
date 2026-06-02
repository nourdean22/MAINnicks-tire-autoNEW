/**
 * Feature flag registry · Phase Q.2 · 2026-05-18 PM.
 *
 * Typed wrapper around the env-flag patterns scattered across the
 * codebase. Single source of truth for:
 *
 *   · which flags exist
 *   · what each one toggles
 *   · what the current resolved value is at request time
 *   · activation status (experimental / canary / stable / deprecated)
 *
 * Why this exists: pre-Q the operator had to grep the codebase to
 * answer "what flags are flippable right now and which one switches
 * what?" — AGENT_V2 (Mastra agent cutover) lived in 5 places ·
 * AUTH_ALLOW_MOCK_IN_PROD (security bypass) lived in 1 · CRON_SECRET
 * presence lived in 3 · etc. /system/migrations consumes this so the
 * board shows a single truth.
 *
 * Coexistence pattern: every flag retains its `process.env.X` read
 * site untouched. This registry is purely additive · the legacy call
 * sites keep working. New code MUST use `getFlag()` so we centralize.
 *
 * NOT a feature-flag service — there's no Redis, no
 * percentage-based rollout, no per-user override. That belongs in
 * Statsig or Unleash when we need it. This is just typed env reads.
 */

export type FlagStatus =
  | "experimental"  // safe to flip · feature still in development · low blast radius
  | "canary"        // currently being rolled out · live in prod but pre-stable
  | "stable"        // default-on · flipping off is a rollback
  | "deprecated";   // scheduled for removal · do not adopt in new code

export interface FeatureFlag {
  /** The env var key. */
  key: string;
  /** Human-readable purpose · what does flipping this do? */
  description: string;
  /** Lifecycle stage. */
  status: FlagStatus;
  /**
   * The value that means "feature ON". Most flags use `"true"` or
   * `"1"` · some use a specific string (e.g. `MASTRA_MEMORY_BACKEND=pg`).
   */
  onValue: string;
  /** What the default behavior is when the env var is unset. */
  defaultBehavior: string;
  /** Optional · linked migration in docs/migrations/. */
  relatedMigration?: string;
  /** Optional · ADR or doc path that captures the trade-off. */
  ownerDoc?: string;
}

export const FLAG_REGISTRY: FeatureFlag[] = [
  // ── Auth bypasses ──────────────────────────────────────────────
  {
    key: "AUTH_ALLOW_MOCK_IN_PROD",
    description: "Permits the mock operator session even in production. Intended ONLY for emergency operator access when OAuth is broken. Logs a SECURITY warning every request when active.",
    status: "experimental",
    onValue: "1",
    defaultBehavior: "Production requires real Google OAuth · no mock fallback.",
    ownerDoc: "lib/auth-guard.ts",
  },
  {
    key: "LOCAL_DEV_BYPASS_AUTH",
    description: "Skips auth checks entirely in local dev / preview. Never honored in production.",
    status: "stable",
    onValue: "1",
    defaultBehavior: "Auth enforced in dev too · use Google OAuth.",
    ownerDoc: "lib/auth-guard.ts",
  },

  // ── AI provider pinning ────────────────────────────────────────
  {
    key: "AI_PROVIDER",
    description: "Pins the active AI provider · bypasses the routing matrix. Use for incident triage when one provider is misbehaving.",
    status: "stable",
    onValue: "venice|openai|anthropic|gemini",
    defaultBehavior: "Routing matrix picks per task profile (preferLargeContext promotes Ollama Cloud Pro · etc.)",
    ownerDoc: "lib/ai/policy.ts",
  },

  // ── Telemetry / observability ──────────────────────────────────
  {
    key: "QUIET_DB_LOG",
    description: "Suppresses Prisma query logs in dev. Useful when iterating on UI and the query stream drowns out application logs.",
    status: "stable",
    onValue: "1",
    defaultBehavior: "Prisma query logs printed in dev.",
    ownerDoc: "lib/prisma.ts",
  },

  // ── Wave-200 substrates · pending activation ────────────────
  {
    key: "BRAINTRUST_API_KEY",
    description: "Enables Mastra agent trace export to Braintrust dashboard. Present-implies-on (no truthy check) · just needs the key.",
    status: "experimental",
    onValue: "<any-non-empty-string>",
    defaultBehavior: "Traces stay local · no Braintrust export.",
    ownerDoc: "lib/ai/braintrust-wrap.ts",
  },

  // ── Wave AG · BGE rerank backend (HF Inference) ────────────────
  {
    key: "BGE_RERANK",
    description: "Routes brain rerank through BAAI/bge-reranker-v2-m3 on HuggingFace Inference API ($0.0001/call · ~250ms) instead of Cohere ($2/1000 calls · ~150ms). The orchestrator in lib/brain/rerank.ts handles fallback to Cohere when BGE fails OR when this flag is OFF. Requires HF_API_KEY.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Cohere is preferred · BGE is the fallback when COHERE_API_KEY is unset.",
    ownerDoc: "docs/runbooks/bge-rerank-cutover.md",
  },

  // ── Wave AJ · Replicate FLUX image generation backend ────────
  {
    key: "REPLICATE_FLUX",
    description: "Routes image generation through Replicate's flux-schnell (~$0.003/img · 4-step distilled) instead of Venice flux-2-pro ($0.04/img). 12-20x cost reduction at comparable quality for marketing/OG/programmatic-SEO images. lib/ai/venice-image.ts checks this flag and delegates to lib/ai/replicate-flux.ts when ON; falls back to Venice on Replicate failure. Requires REPLICATE_API_KEY.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Venice flux-2-pro is the primary; Replicate is only reached when this flag is on AND REPLICATE_API_KEY is set.",
    ownerDoc: "docs/runbooks/replicate-flux-cutover.md",
  },
];

// ─────────────────────────────────────────────────────────────────
// Runtime accessors
// ─────────────────────────────────────────────────────────────────

/**
 * Resolved view of a flag at the current request time.
 * Computed on read · never cached (env vars can be hot-swapped on
 * Railway without a redeploy).
 */
export interface ResolvedFlag extends FeatureFlag {
  /** Raw env value as a string · empty if unset. */
  rawValue: string;
  /** True iff the flag is currently in its "on" state. */
  isOn: boolean;
}

/**
 * Resolve a single flag by key. Returns null if the key is not
 * registered (forces caller to add it to FLAG_REGISTRY first).
 */
export function getFlag(key: string): ResolvedFlag | null {
  const spec = FLAG_REGISTRY.find((f) => f.key === key);
  if (!spec) return null;

  const rawValue = (process.env[key] ?? "").trim();
  const isOn = computeIsOn(spec, rawValue);

  return { ...spec, rawValue, isOn };
}

/**
 * Snapshot of every registered flag's current state. Used by
 * /api/system/migrations + any future operator UI that needs the
 * full board view.
 */
export function getAllFlags(): ResolvedFlag[] {
  return FLAG_REGISTRY.map((spec) => {
    const rawValue = (process.env[spec.key] ?? "").trim();
    return { ...spec, rawValue, isOn: computeIsOn(spec, rawValue) };
  });
}

/**
 * Computes the on-state for a spec given a raw env value.
 *
 * Handles three patterns:
 *   1. Pipe-delimited enum (e.g. `venice|openai|anthropic|gemini`)
 *      · on iff rawValue matches one of the options
 *   2. Present-implies-on placeholder (`<any-non-empty-string>`)
 *      · on iff rawValue is non-empty
 *   3. Literal match (e.g. `true`, `1`, `pg`)
 *      · on iff rawValue equals onValue (case-insensitive)
 */
function computeIsOn(spec: FeatureFlag, rawValue: string): boolean {
  if (!rawValue) return false;
  const lower = rawValue.toLowerCase();

  if (spec.onValue === "<any-non-empty-string>") return true;

  if (spec.onValue.includes("|")) {
    return spec.onValue
      .split("|")
      .map((s) => s.trim().toLowerCase())
      .includes(lower);
  }

  return lower === spec.onValue.trim().toLowerCase();
}

/**
 * Summary counts · used by the migrations tracker page.
 */
export interface FlagSummary {
  total: number;
  on: number;
  off: number;
  byStatus: Record<FlagStatus, number>;
}

export function summarizeFlags(flags: ResolvedFlag[] = getAllFlags()): FlagSummary {
  const summary: FlagSummary = {
    total: flags.length,
    on: 0,
    off: 0,
    byStatus: { experimental: 0, canary: 0, stable: 0, deprecated: 0 },
  };
  for (const f of flags) {
    if (f.isOn) summary.on++;
    else summary.off++;
    summary.byStatus[f.status]++;
  }
  return summary;
}
