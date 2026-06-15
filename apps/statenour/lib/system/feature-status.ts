/**
 * Feature status registry · v10.0.121 · 2026-05-02.
 *
 * Course-correction documentation. After a 7-feature wave in v10.0.91
 * + 4-feature wave in v10.0.92, sampled the actual data and found
 * many endpoints were dormant scaffolding waiting for data that
 * doesn't exist yet. This registry surfaces each feature's status
 * + the trigger that activates it.
 *
 * Why this matters: the Karpathy lesson — "ship without sampling
 * data" leads to features that work mechanically but deliver nothing.
 * This file is the honest map. Every Settings UI surface that
 * consumes one of these endpoints should check the status before
 * rendering, OR show a "waiting for data" placeholder.
 *
 * Categories:
 *   · LIVE — actively delivering value with current data
 *   · DORMANT — endpoint works, scaffolding ready, but no data yet
 *   · PARTIAL — works but produces low-signal output
 */

export type FeatureStatus = "LIVE" | "DORMANT" | "PARTIAL";

export interface FeatureMeta {
  name: string;
  endpoint?: string;
  status: FeatureStatus;
  activationTrigger?: string;
  notes?: string;
}

export const FEATURE_REGISTRY: FeatureMeta[] = [
  // ── LIVE features (verified delivering value) ─────────────────
  {
    name: "Hybrid memory recall",
    endpoint: "/api/brain/recall",
    status: "LIVE",
    notes: "Returns 3+ semantic hits on real queries. KNN + recency + confidence weighting. Wired into chat route as system-prompt block.",
  },
  {
    name: "Memory-of-the-day",
    endpoint: "/api/brain/memory-of-the-day",
    status: "LIVE",
    notes: "Picks high-conf nick_advice / wisdom / insight rows. Idempotent per day. v10.0.97 also surfaced as 'wisdom' kind in BottomPulseTicker via personal-pulse.",
  },
  {
    name: "Time-travel snapshot",
    endpoint: "/api/brain/time-travel?date=YYYY-MM-DD",
    status: "LIVE",
    notes: "Today returns 100+ memories. Useful immediately on dates with activity.",
  },
  {
    name: "Memory health rollup",
    endpoint: "/api/brain/memory-health",
    status: "LIVE",
    notes: "62 categories · 98.3% vectorized · category-level decay flags.",
  },
  {
    name: "Hybrid search (BM25+KNN+RRF)",
    endpoint: "/api/brain/search-hybrid",
    status: "LIVE",
    notes: "1.07s · combines tsvector @@ + KNN cosine. v10.0.100 added /brain/search interactive UI + v10.0.104 hardened parameter binding (was vulnerable to malformed embedding values).",
  },
  {
    name: "Self-critique cron",
    endpoint: "/api/cron/self-critique",
    status: "LIVE",
    notes: "84 real replies critiqued, avg 84.8/100. v10.0.105 added /brain/critique surface. v10.0.112 added small-cohort/all-tied skip guard so n=1 or all-identical-score runs don't write meaningless 'bottom 10%' flags (skipReason field on the report).",
  },
  {
    name: "Cost-anomaly z-score",
    endpoint: "/api/cron/cost-anomaly",
    status: "LIVE",
    notes: "z=-1.12 today · status=normal · would alert at |z|>2 with Telegram via alert-telegram-push.",
  },
  {
    name: "Token-age watch",
    endpoint: "/api/system/token-ages",
    status: "LIVE",
    notes: "7 tokens tracked · Meta token 55d to expiry · pushed 3 alerts on first run today.",
  },
  {
    name: "Bus-exhaustion watch",
    endpoint: "/api/cron/bus-exhaustion-watch",
    status: "LIVE",
    notes: "All clear · 30-min cadence · would alert pending>1000 / dead>50 / stuck-processing.",
  },
  {
    name: "Brain-bus DLQ inspector",
    endpoint: "/api/system/brain-bus/dead",
    status: "LIVE",
    notes: "0 dead, 36 done, 0 pending. POST /revive ready when needed.",
  },
  {
    name: "Per-topic retry policy",
    endpoint: "/api/system/brain-bus/policies",
    status: "LIVE",
    notes: "9 policies registered · embedding-warm 8/escalate · chat-importance 3/silently_drop · etc.",
  },
  {
    name: "Test-connection per integration",
    endpoint: "POST /api/integrations/[name]/test",
    status: "LIVE",
    notes: "Provider-specific fallbacks for telegram, openai, venice, anthropic, resend, stripe, twilio.",
  },
  {
    name: "Health digest 7d trend",
    endpoint: "/api/system/health-trend",
    status: "LIVE",
    notes: "4 days of history · direction=improving · ready for sparkline render on /settings.",
  },
  {
    name: "Per-route error rate",
    endpoint: "/api/system/error-rate-by-route",
    status: "LIVE",
    notes: "464 req · 0 errors · 20 routes · score = errorRate × log10(req).",
  },
  {
    name: "Reply provenance",
    endpoint: "/api/brain/provenance/[messageId]",
    status: "LIVE",
    notes: "Hybrid-recall against any chat message's content + prior user turn for context. v10.0.98 surfaced top-3 hits inline in the chat MessageInfoCard via lazy-fetch on first card open.",
  },
  {
    name: "Time-travel snapshot UI",
    endpoint: "/brain/time-travel (consumes /api/brain/time-travel)",
    status: "LIVE",
    notes: "v10.0.99 page · pick any date → 8-counter grid + category bar viz + 5 activity columns (chats / brain dumps / reflections / decisions / emotional states) + URL ?date= sync.",
  },
  {
    name: "Memory health rollup UI",
    endpoint: "/brain?tab=health (consumes /api/brain/memory-health)",
    status: "LIVE",
    notes: "v10.0.100 page · per-category vectorization% · decay flags · dormant-30d markers · sibling to /brain/categories.",
  },
  {
    name: "Recall preview UI",
    endpoint: "/brain/recall (consumes /api/brain/recall)",
    status: "LIVE",
    notes: "v10.0.101 page · type a query → see what chat would inject as system-prompt context · optional 'preview the prompt block' shows the literal text.",
  },
  {
    name: "Memory graph (nodes+edges)",
    endpoint: "/api/brain/graph",
    status: "PARTIAL",
    activationTrigger: "First mega-evening run populates semantic_edge rows (KNN-driven)",
    notes: "20-200 nodes today · 0 edges (semantic-link cron hasn't fired yet).",
  },

  // ── DORMANT features (waiting for data) ───────────────────────
  {
    name: "Predictive task timing",
    endpoint: "/api/personal/task-timing",
    status: "DORMANT",
    activationTrigger: "Need ≥10 completed tasks in last 90d",
    notes: "Endpoint works but `withHint: 0` until task completion history accumulates. Cron-runs / daily-report won't surface anything until activation.",
  },
  {
    name: "Photo embedding + KNN search",
    endpoint: "/api/brain/photo-embed",
    status: "PARTIAL",
    activationTrigger: "Generate any image via /api/ai/image — auto-embed hook wired in venice-image (v10.0.94). Activates on first generation.",
    notes: "Pipeline ready: qwen3-vl describe → Venice embed → vector_embeddings (sourceType=photo) with HNSW. Auto-fires per generation; the prompt itself is used as description (skips qwen3-vl round-trip).",
  },
  {
    name: "Calibrated confidence (advice → past accuracy)",
    endpoint: "/api/brain/calibrate",
    status: "DORMANT",
    activationTrigger: "Need ≥3 chat_messages with feedbackScore set on similar-topic replies",
    notes: "Wilson lower-bound math + KNN ready. Today: returns sampleSize=0 / confidence=0 because no graded similar replies exist yet.",
  },
  {
    name: "Predictions outcome auto-grader",
    endpoint: "/api/cron/predictions-grader",
    status: "DORMANT",
    activationTrigger: "Need MasteryDecisions with reviewDate < today AND actualOutcome=null",
    notes: "Cron folded into mega-evening. When you log decisions on /tasks with predictedOutcome + reviewDate, the grader auto-finds evidence and writes BrainMemory category=prediction_grade. Closes Ghost Nour 0/0/null.",
  },
  {
    name: "Per-integration cost/quota probes",
    endpoint: "/api/system/integration-quotas",
    status: "PARTIAL",
    activationTrigger: "Set provider API keys (TWILIO, STRIPE, RESEND tokens)",
    notes: "Venice probe works (147ms). Resend errored (token issue). Twilio/Stripe return 'missing' until keys set.",
  },
];

export function summarize() {
  const live = FEATURE_REGISTRY.filter((f) => f.status === "LIVE").length;
  const dormant = FEATURE_REGISTRY.filter((f) => f.status === "DORMANT").length;
  const partial = FEATURE_REGISTRY.filter((f) => f.status === "PARTIAL").length;
  return {
    total: FEATURE_REGISTRY.length,
    live,
    dormant,
    partial,
    livePct: Math.round((live / FEATURE_REGISTRY.length) * 100),
    activationsNeeded: FEATURE_REGISTRY.filter(
      (f) => f.status === "DORMANT" || f.status === "PARTIAL",
    ).map((f) => ({
      name: f.name,
      trigger: f.activationTrigger,
    })),
  };
}
