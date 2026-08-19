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
  /**
   * 2026-08-16 · true = the feature is LIVE when the env var is unset, and the
   * var acts as a kill-switch (set it to anything that is not `onValue` — by
   * convention "0" — to disable).
   *
   * Added because the registry previously had no way to express a graduated
   * flag: computeIsOn returned false for an empty value unconditionally, so a
   * default-ON feature had to bypass getFlag and read process.env directly.
   * That works, but it makes /system/migrations report the flag as OFF while
   * the code runs it — a status surface that lies. Model it here instead.
   */
  defaultOn?: boolean;
  /** Optional · linked migration in docs/migrations/. */
  relatedMigration?: string;
  /** Optional · ADR or doc path that captures the trade-off. */
  ownerDoc?: string;
  /** Runtime reads a raw env var directly; the settings board must not offer
   * controls that imply a database override can change behavior. */
  readOnly?: boolean;
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
    description: "Routes image generation through Replicate's flux-schnell (~$0.003/img · 4-step distilled). lib/ai/gemini-image.ts checks this flag and delegates to lib/ai/replicate-flux.ts when ON. Requires REPLICATE_API_KEY. (Venice was the comparison point when this flag was written; Venice is RETIRED — lib/ai/venice-image.ts no longer exists and `venice` is not in RUNTIME_PROVIDERS.)",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "With the flag off, image generation falls through the Gemini chain (direct Gemini, then OpenRouter). Replicate is reached only when this flag is on AND REPLICATE_API_KEY is set.",
    ownerDoc: "docs/runbooks/replicate-flux-cutover.md",
  },

  // ── v-truth · Next-level intelligence pass (2026-06-02) ──────────
  // Most capabilities below ship DEFAULT-OFF. Flip the env var on
  // Railway to enable; surfaced on /system/migrations. Built so the
  // default code path is byte-for-byte unchanged when off.
  // EXCEPTION (2026-08-16): NICK_NOVELTY_RECALL carries defaultOn:true —
  // it is LIVE unless explicitly killed with =0. Do not read this block
  // header as covering it.
  {
    key: "NICK_IMPORTANCE_RECALL",
    description: "Adds the Generative-Agents 'importance' axis (R+R+I) to brain recall ranking — weights memories by how much they MATTER (decision/commitment/insight/pain signals), not just confidence. Gentle 0.92-1.25x multiplier computed at recall time (no migration). OFF = recall ranking unchanged.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Recall ranks on relevance+recency+confidence+trust only (importance multiplier = 1.0).",
    ownerDoc: "lib/brain/contextual-recall.ts",
  },
  {
    key: "NICK_NOVELTY_RECALL",
    description:
      "Adds a NOVELTY axis to brain recall — penalizes a memory for repeating what the higher-ranked picks already say, using the embeddings getSemanticScores already parses (zero extra queries). Fixes the structural bias that makes recall recite known facts: BrainMemory confidence is a re-sighting COUNT (0.5 +0.1/sighting), so a surprising one-off can never outrank a re-observed banality. Gentle 0.95-1.18x, applied AFTER the reranker so it is not overwritten. LIVE by default since 2026-08-16 on operator instruction — set NICK_NOVELTY_RECALL=0 to disable.",
    status: "experimental",
    onValue: "true",
    defaultOn: true,
    defaultBehavior:
      "LIVE: the novelty multiplier is applied. Kill-switch NICK_NOVELTY_RECALL=0 restores byte-for-byte pre-2026-08-16 ranking. NOTE: enabled on operator instruction WITHOUT a prior eval win — `pnpm eval:recall` has never been run against a real (non-synthetic) corpus, so this is an accepted-risk default, not a measured one.",
    ownerDoc: "lib/brain/contextual-recall.ts",
  },
  // ── Memory-write gateway kill-switches (registered 2026-08-19) ────
  // Both were LIVE-by-default via raw `process.env.X !== "0"` reads in
  // memory-manager.ts and appeared NOWHERE on the flag board — the two
  // most consequential memory switches were invisible, the exact
  // failure mode this registry exists to prevent. Registration here is
  // OBSERVATIONAL: the runtime check stays the raw env read in
  // lib/brain/memory-manager.ts (do not "unify" it through getFlag
  // without re-verifying the fail-open catch semantics there).
  {
    key: "NICK_MEMORY_GATEWAY_PHASE1",
    description:
      "Memory commit gateway Phase-1: same-source + same-content repetition no longer reinforces confidence (noop verdict). Graduated after a 7-day shadow review (1,788 receipts, 0% legacy disagreement on noop). LIVE unless explicitly killed with =0. Runtime check is `process.env.NICK_MEMORY_GATEWAY_PHASE1 !== \"0\"` in lib/brain/memory-manager.ts — this entry is for board visibility.",
    status: "experimental",
    onValue: "1",
    defaultOn: true,
    defaultBehavior:
      "LIVE: repetition-noop enforced at remember(). Kill-switch =0 restores legacy always-reinforce. Probe: scripts/probe-gateway-agrees.ts.",
    ownerDoc: "lib/brain/memory-commit-gateway.ts",
    readOnly: true,
  },
  {
    key: "NICK_MEMORY_GATEWAY_PHASE2",
    description:
      "Memory commit gateway Phase-2: honors `update` (content refresh, no confidence bump) and `review_required` for weaker_evidence (parks to the Review queue). unknown_category deliberately falls through and writes. Flipped LIVE by explicit operator instruction 2026-08-16 WITHOUT the shadow review that graduated Phase-1 — accepted risk, not measured safety. LIVE unless killed with =0; runtime check is the raw env read in lib/brain/memory-manager.ts.",
    status: "experimental",
    onValue: "1",
    defaultOn: true,
    defaultBehavior:
      "LIVE: update + weaker_evidence-review enforced at remember(). Kill-switch =0 FIRST if writes look wrong, then run scripts/probe-gateway-agrees.ts.",
    ownerDoc: "lib/brain/memory-commit-gateway.ts",
    readOnly: true,
  },
  {
    key: "NICK_VERIFIED_REGEN",
    description: "WIRED. On factual/decision/analytical/procedural/instructional turns, generates the reply non-streaming, runs the critic, and regenerates ONCE (critic-gated best-of-2) before shipping the winner as a stream. Persists via the normal pipeline. Falls through to the normal stream on any error. OFF = single-pass (today's behavior). Adds latency on the regen path only.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "shouldRegen is computed + logged but never acted on; reply ships single-pass.",
    ownerDoc: "lib/ai/chat/pre-stream-regen.ts",
  },
  {
    key: "NICK_DEPTH_UNCAP",
    description: "Removes the master-persona hard word-count ceilings (40-60 default / 150 on analysis) and the no-structure line so length + structure follow the question intent (deferring to the Response style section), instead of a fixed counter that — appended last — out-weighted it even in deep mode. OFF = today's capped master persona.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Master persona caps replies at 40-60 words (150 on analysis) and forbids sections/bullets.",
    ownerDoc: "app/api/ai/chat/finalize-system-prompt.ts",
  },
  {
    key: "NICK_KNOWN_TRUTH_BANNER",
    description: "Promotes HIGH-HARM known-truth guard flags (evidence-free status claims like 'deployed'/'tests passed' with no receipt, or retired-infra-as-current) from telemetry to a persisted-row correction banner on reload — the same mechanism as the action-receipt verifier. Never double-banners (skips if one already fired). OFF = telemetry-only (today).",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Known-truth flags are logged + folded into tokenUsage but the stored reply is not altered.",
    ownerDoc: "lib/services/chat/persist-assistant-turn.ts",
  },
  {
    key: "NICK_COVE",
    description: "Chain-of-Verification on factual/operator-facing answers: after drafting, Nick generates isolated verification questions, answers them, and revises — the isolation step kills rubber-stamped hallucinations. Gated to factual intents. OFF = no CoVe pass.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Answers ship without a verification pass.",
    ownerDoc: "lib/ai/chat/chain-of-verification.ts",
  },
  {
    key: "NICK_DEEP_REASONING",
    description: "WIRED + LIVE-DATA. Routes hard turns (complexity:complex + intent:decision/analytical) through the full reasoning engine (decompose -> plan -> critique -> refine). v-truth: now PRE-FETCHES a live business snapshot (getDashboardSummary: revenue/jobs/customers/reviews) and prepends it to the reasoning context, so it reasons from REAL current numbers instead of going tool-blind. Ships the answer as a stream + persists normally; falls through to the normal stream on error. OFF = single-pass. Adds latency on hard turns only.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Every turn uses the single-pass streamer; the reasoning engine is reachable only via /api/nick/reason.",
    ownerDoc: "lib/ai/reasoning/engine.ts",
  },
  {
    key: "NICK_AUTONOMY",
    description: "Enables the proactive autonomous-engine cron (22 built rules: revenue-pace, urgent-leads, drift, commitment enforcement, morning brief, etc.) + the nick-action propose->execute queue. ALL outputs route through the /qa Telegram approval gate FIRST — nothing auto-sends. OFF = no proactive proposals generated.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "runAutonomousActions + nick-action proposer never fire; the /qa approval queue stays empty.",
    ownerDoc: "lib/brain/autonomous-engine.ts",
  },
  {
    key: "NICK_CONTEXTUAL_RETRIEVAL",
    description: "Anthropic Contextual Retrieval on brain ingestion: prepends a one-line LLM-generated context header (who/when/what-doc) to each chunk before embedding, cutting retrieval failures 35-49%. One-time cost at ingest. OFF = chunks embedded as-is (today).",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Document chunks are embedded without a contextual header.",
    ownerDoc: "lib/brain/contextual-retrieval.ts",
  },

  // ── v-truth · 2nd-tier intelligence (2026-06-03) · all DEFAULT-OFF ──
  {
    key: "NICK_CONTRADICTION_CLEANUP",
    description: "When a contradiction is resolved, soft-deletes (deletedAt) the SUPERSEDED memory so the stale belief leaves the recall pool — Nick stops confidently citing outdated facts. Conservative: only the explicitly-losing side, soft-delete (reversible), never hard-delete. OFF = both contradicting rows stay in recall (today).",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Contradictions are surfaced as nudges only; the losing memory stays recallable.",
    ownerDoc: "lib/brain/contradiction-cleanup.ts",
  },
  {
    key: "NICK_EPISODIC_SPLIT",
    description: "Reserves recall slots for episodic ('what happened') vs semantic ('what's true') memories so a time-anchored query ('what did I do last week') isn't crowded out by timeless wisdom, and vice-versa (Generative-Agents episodic/semantic split). OFF = single ranked pool (today).",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Recall returns one ranked pool; wisdom can dominate time-anchored queries.",
    ownerDoc: "lib/brain/contextual-recall.ts",
  },
  {
    key: "NICK_REFLECTION_TREES",
    description: "Nightly synthesis of reflections-of-reflections: clusters recent low-level reflections into higher-order insights ('you consistently over-commit on Mondays') written as MemoryEdge chains — abstracted self-knowledge vs raw episodic rows (Generative-Agents memory stream). Additive (never overwrites sources). OFF = flat daily/weekly reflections only.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Reflection engine produces flat reflections; no higher-order synthesis.",
    ownerDoc: "lib/brain/reflection-trees.ts",
  },
  {
    key: "NICK_OUTCOME_LEARNING",
    description: "The autonomous-action proposer reads each rule's recent accepted/rejected rate from AutonomousAction history and reranks — chronically-rejected proposal types sink, accepted ones rise. Moves Nick from fixed rules to learning the operator's actual preferences. Ranking-only, never auto-executes. OFF = deterministic ranking (today).",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Proposer ranks by static rules with no memory of what the operator accepted/rejected.",
    ownerDoc: "lib/ai/propose-actions.ts",
  },
  {
    key: "NICK_ANTICIPATORY_RECALL",
    description: "Embedding-based anticipatory recall: in addition to today's keyword tool-prefetch, embeds the recent turn trajectory and pre-warms the memories Nick will likely need NEXT turn (topic pivots), so he doesn't 'forget what we were just discussing'. Additive lane; graceful timeout. OFF = keyword prefetch only (today).",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "predictive-prefetch is keyword-matched tool pre-routing only; no embedding anticipation.",
    ownerDoc: "lib/ai/predictive-prefetch.ts",
  },

  // ── v-truth · 3rd-tier (reasoning #3/#5 + autonomy U4/U5) · DEFAULT-OFF ──
  {
    key: "NICK_CONFIDENCE_TIER",
    description: "Confidence-gated auto-execute: provably-SAFE, reversible, NON-MESSAGING autonomous actions (hardcoded allowlist) with a high operator-acceptance history auto-execute without waiting for /qa approval; money/people/messaging actions ALWAYS stay human-gated. Removes friction on the safe 80%. OFF = everything waits for approval (today's fail-closed behavior).",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Every autonomous action waits for /qa approval (fail-closed); nothing auto-executes.",
    ownerDoc: "lib/ai/confidence-tier.ts",
  },
  {
    key: "NICK_SPAR_VS",
    description:
      "Verbalized Sampling in SPAR's DIVERGE step: the model verbalizes a probability per candidate and draws from the tail of its own distribution instead of returning N phrasings of its modal answer (arXiv 2510.01171, ICML 2026 — 1.6-2.1x diversity, training-free, orthogonal to temperature). Only step 1 changes; attack/tension/converge are byte-identical. EXPERIMENTAL because every published gain is frontier-model and Nick's fast lane is small — the same kill shot as BDN-201, so measure on the A/B harness before trusting it there. Also costs 5 candidate generations per diverge turn.",
    status: "experimental",
    onValue: "true",
    defaultBehavior:
      "SPAR uses the incumbent diverge step: asks for 3-5 distinct options with no sampling mechanism behind the request.",
    ownerDoc: "lib/ai/prompt/policy/spar-mode.ts",
  },
  {
    key: "NICK_EVENT_TRIGGERS",
    description: "Event-driven proactivity: an Inngest event-triggered function reacts to brain-bus events (e.g. a new urgent lead) in seconds instead of waiting for the next cron poll — proposing the action into the /qa approval queue immediately (fail-closed, nothing auto-sends). OFF = poll-only proactivity (today).",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Proactivity is cron-polled (every few hours); no real-time event reaction.",
    ownerDoc: "lib/inngest/functions/event-triggers.ts",
  },
  {
    key: "NICK_SELF_CONSISTENCY",
    description: "Difficulty-adaptive self-consistency: on HIGH-STAKES factual turns (revenue/customer claims), samples 2-3 answers and majority-votes on the extracted facts, keeping the consensus — catches fabricated numbers CoVe misses. Cost: N model calls on gated turns only. OFF = single answer (today).",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "One answer per turn; no multi-sample voting.",
    ownerDoc: "lib/ai/chat/self-consistency.ts",
  },
  {
    key: "NICK_MULTI_AGENT_AUTO",
    description: "Auto-decompose: when a turn is a multi-part / comparison / multi-entity question ('compare 3 X', 'audit Y across Z'), automatically fans out the existing multi-agent orchestrator instead of hoping the model picks the arsenal.multiAgent tool. OFF = model-discretion only (today, near-never fires).",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Multi-agent runs only if the model chooses the arsenal.multiAgent tool.",
    ownerDoc: "lib/ai/multi-agent-orchestrator.ts",
  },

  // ── Operational / routing flags ────────────────────────────────
  // These are read via raw `process.env.X` across the code; registered
  // here (Phase Q.2 coexistence pattern · call sites untouched) so the
  // /system/migrations board + getFlag() see them. 2026-06-04 · M1.
  {
    key: "NICK_PRIME_PROMPT",
    description: "DEPRECATED (2026-07-11 review) · v2 prompt cutover is complete and v2 is the SOLE builder. This flag is a no-op — isPromptV2Enabled() returns true unconditionally and buildSystemPrompt never consults it. There is no v1 builder to roll back to; do not treat this as a rollback lever.",
    status: "deprecated",
    onValue: "1",
    defaultBehavior: "No effect. v2 prompt assembler always active.",
    ownerDoc: "lib/ai/prompt/v2/index.ts",
  },
  {
    key: "ENABLE_SPECIALIST_ROUTING",
    description: "Activates the specialist-agent routing layer — routes a turn to a domain specialist instead of the general agent. Must literally equal `true`. OFF = every turn handled by the general agent.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Specialist routing bypassed; general agent handles all turns.",
    ownerDoc: "lib/ai/agents/router.ts",
  },
  {
    key: "NICK_MUTATION_LOCK",
    description: "Emergency global mutation lock. Denies registered tool writes and operator tRPC mutations while active.",
    status: "experimental",
    // Accepts true|1|on — an operator mid-incident fat-fingering
    // NICK_MUTATION_LOCK=1 must still freeze mutations, not silently
    // no-op. computeIsOn handles pipe-delimited onValue natively.
    onValue: "true|1|on",
    defaultBehavior: "Mutations proceed through their normal authorization and approval gates.",
    ownerDoc: "lib/tools/tool-policy.ts",
  },
  {
    key: "NICK_HIGH_SPEC_GATE",
    description: "Gates the high-spec model path in the chat route — when `on`, eligible turns use the higher-spec model tier. Default off, reversible.",
    status: "experimental",
    onValue: "on",
    defaultBehavior: "Standard model tier for all turns.",
    ownerDoc: "app/api/ai/chat/route.ts",
  },
  {
    key: "NICK_CHAT_INTENSITY",
    description: "Selects Nick's chat behavior-directive intensity: MINIMAL (MINIMAL/0/OFF) · STANDARD (default) · HIGH (HIGH/1/ON). Tunes how assertive the behavior directives are. Unset or STANDARD = baseline.",
    status: "experimental",
    onValue: "MINIMAL|HIGH|ON|OFF|0|1",
    defaultBehavior: "STANDARD intensity behavior directives.",
    ownerDoc: "lib/ai/knowledge/behavior-directive.ts",
  },
  {
    key: "INNGEST_MEGA_V2",
    description: "Activates the Inngest mega fan-out dispatcher — the daily morning/evening cron children fan out via Inngest instead of the Railway cron path. Must equal `true` (disable the Railway cron to avoid double-fire). OFF = mega fan-out returns skipped.",
    status: "canary",
    onValue: "true",
    defaultBehavior: "Mega fan-out skips; daily children run via the Railway cron path.",
    ownerDoc: "lib/inngest/functions/mega-fanout.ts",
  },
  {
    key: "NICK_ARRIVAL_INTELLIGENCE",
    description: "Activates the Nick's Tire & Auto Arrival Intelligence vehicle alerts pipeline. When enabled, vehicle_detected events send Telegram notifications in real-time.",
    status: "experimental",
    onValue: "true",
    defaultBehavior: "Events are logged to the database but no real-time Telegram notifications are sent.",
    ownerDoc: "lib/services/vehicle-detection.ts",
  },
  {
    key: "RECALL_FACT_AGE_DISABLED",
    description: "Kill-switch for the epistemic age stamp on recalled memories. The stamp renders each memory's TRUE age (created_at) with a STALE/verify-first marker past 120d (365d for wisdom); the legacy rendering used last_seen, which the recall path bumps on every hit, so frequently-recalled facts always read 'today'. Set to 1 only to restore the legacy (lying) rendering as a rollback.",
    status: "canary",
    onValue: "1",
    defaultBehavior: "Recall block shows fact age from created_at + STALE markers.",
    ownerDoc: "lib/brain/memory-recall.ts",
  },
  {
    key: "CALIBRATION_PROMPT_BLOCK_DISABLED",
    description: "Kill-switch for the prediction-calibration block in Prompt V2. The nightly brain-intelligence cron resolves predictions and rolls 30d Brier accuracy; the block feeds that track record back into the system prompt so stated confidence is conditioned on the measured record. Set to 1 only to suppress the block (rollback lever).",
    status: "canary",
    onValue: "1",
    defaultBehavior: "Calibration block is injected into Prompt V2 (fail-open: a failed stats query injects nothing).",
    ownerDoc: "lib/ai/outcome-calibration.ts",
  },
];

// Overrides state cache
let overridesCache: Record<string, string> = {};
let lastFetchedAt = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds
let isFetchInFlight = false;

/**
 * Preloads the database-backed feature flag overrides.
 * This should be called at request/cron entrypoints to ensure overrides are fresh.
 */
export async function loadFeatureFlagOverrides(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastFetchedAt < CACHE_TTL_MS) {
    return;
  }

  // Prevent duplicate concurrent loads
  if (isFetchInFlight && !force) return;
  isFetchInFlight = true;

  try {
    const { prisma } = await import("@/lib/prisma");
    const preferences = await prisma.userPreference.findMany({
      where: { category: "feature_flags" },
      select: { key: true, value: true },
    });

    const nextOverrides: Record<string, string> = {};
    for (const pref of preferences) {
      nextOverrides[pref.key] = pref.value;
    }
    
    overridesCache = nextOverrides;
    lastFetchedAt = now;
  } catch (err) {
    console.error("Failed to load feature flag overrides from DB:", err);
  } finally {
    isFetchInFlight = false;
  }
}

/**
 * Helper to trigger a non-blocking background refresh if expired.
 */
function triggerBackgroundRefresh() {
  if (isFetchInFlight || Date.now() - lastFetchedAt < CACHE_TTL_MS) return;
  loadFeatureFlagOverrides().catch((err) => {
    console.error("Failed to background refresh feature flags:", err);
  });
}

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
  /** Override value set in database (null if using default env). */
  overrideValue?: string | null;
}

/**
 * Resolve a single flag by key. Returns null if the key is not
 * registered (forces caller to add it to FLAG_REGISTRY first).
 */
export function getFlag(key: string): ResolvedFlag | null {
  const spec = FLAG_REGISTRY.find((f) => f.key === key);
  if (!spec) return null;

  // Trigger background refresh if cache is expired (non-blocking)
  triggerBackgroundRefresh();

  // Resolve override or environment variable
  const dbOverride = overridesCache[key];
  const rawValue = (dbOverride !== undefined ? dbOverride : (process.env[key] ?? "")).trim();
  const isOn = computeIsOn(spec, rawValue);

  return { ...spec, rawValue, isOn, overrideValue: dbOverride ?? null };
}

/**
 * Snapshot of every registered flag's current state. Used by
 * /api/system/migrations + any future operator UI that needs the
 * full board view.
 */
export function getAllFlags(): ResolvedFlag[] {
  triggerBackgroundRefresh();
  return FLAG_REGISTRY.map((spec) => {
    const dbOverride = overridesCache[spec.key];
    const rawValue = (dbOverride !== undefined ? dbOverride : (process.env[spec.key] ?? "")).trim();
    return { ...spec, rawValue, isOn: computeIsOn(spec, rawValue), overrideValue: dbOverride ?? null };
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
  // Unset → the flag's declared default. Only graduated flags set defaultOn.
  if (!rawValue) return spec.defaultOn === true;
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
