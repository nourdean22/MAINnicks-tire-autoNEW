/**
 * BrainMemory category registry — the single source of truth for every
 * `category:` string used with `prisma.brainMemory.*` across the app.
 *
 * Pre-registry reality: 138 distinct category strings were hand-typed
 * across 700+ files. No typo protection, no discoverability, no way to
 * find all writers for a given category. Every new feature invented its
 * own category string and hoped nobody else had picked it.
 *
 * Post-registry contract:
 *   1. Every category MUST appear in `BRAIN_CATEGORIES` below.
 *   2. Call sites import the const (`BRAIN_CATEGORIES.ANTI_PATTERN`)
 *      instead of hand-typing the string. Typos become compile errors.
 *   3. `brainMemory.remember()` validates the category at runtime via
 *      `isKnownCategory()` — unknown values emit `console.warn` in dev
 *      so drift is caught early (does NOT throw — silent degradation
 *      would be worse than a warning).
 *   4. Deprecated categories are kept in the registry with
 *      `@deprecated` JSDoc + a migration hint so the codemod can
 *      rewrite them without breaking live data.
 *
 * Domain groups (alphabetical within each group):
 *   • AI / Nick
 *   • Brain · identity + beliefs
 *   • Brain · insights + patterns
 *   • Brain · memory + learning
 *   • Brain · decisions
 *   • Brain · predictions + calibration
 *   • Business / commerce
 *   • Chat / conversation
 *   • Domains · personal life
 *   • Domains · relationships + people
 *   • Legacy · chatgpt import (to be retired)
 *   • Meta · archive / stale markers
 *   • System / ops
 *   • Tech / content / ui
 *   • Tasks / projects
 */

export const BRAIN_CATEGORIES = {
  // ── AI / Nick ──
  AI: "ai",
  AI_ANALYSIS: "ai_analysis",
  AI_CONFIG: "ai_config",
  NICK_ADVICE: "nick_advice",
  NICK_QUALITY: "nick_quality",
  REPLY_QUALITY: "reply_quality",
  NARRATOR_FEEDBACK: "narrator_feedback",

  // ── Brain · identity + beliefs ──
  BELIEF: "belief",
  BELIEF_CANDIDATE: "belief_candidate",
  BELIEF_MANUAL: "belief_manual",
  BELIEF_REFRESH_REPORT: "belief_refresh_report",
  IDENTITY_SNAPSHOT: "identity_snapshot",
  QUALITATIVE_IDENTITY: "qualitative_identity",

  // ── Brain · insights + patterns ──
  ANOMALY: "anomaly",
  ANTI_PATTERN: "anti_pattern",
  BLIND_SPOT: "blind_spot",
  CAUSATION: "causation",
  CONTRADICTION: "contradiction",
  CORRELATION_ALERT: "correlation_alert",
  COUNTER_INTUITIVE: "counter_intuitive",
  HIDDEN_CORRELATION: "hidden_correlation",
  PATTERN: "pattern",
  TEACHING_MOMENT: "teaching_moment",
  WISDOM: "wisdom",
  WISDOM_CANDIDATE: "wisdom_candidate", // v10.0.356 · gated wisdom · review queue
  WISDOM_CONTRADICTION: "wisdom_contradiction",
  REPLY_JUDGMENT: "reply_judgment", // v10.0.366 · LLM-as-judge eval scores
  ADVERSARIAL_OBJECTION: "adversarial_objection", // v10.0.369 · counter-arguments to recommendations
  EVAL_RUN: "eval_run", // v10.0.370 · daily quality benchmark run results
  DOMAIN_KNOWLEDGE: "domain_knowledge", // v10.0.371 · extracted facts (semantic-kind in CoALA)
  SUGGESTION_LOOP: "suggestion_loop", // v10.0.529.97 · operator action + outcome on Nick suggestions · supervised signal for DPO
  SUGGESTION_HYPOTHESIS: "suggestion_hypothesis", // 2026-05-21 · suggestion-improve · per-kind improvement hypotheses derived from the suggestion-loop
  NUDGE_ACK: "nudge_ack",
  NUDGE_PIN_HYGIENE: "nudge_pin_hygiene",

  // ── Brain · memory + learning ──
  BRAIN: "brain",
  BRAIN_DUMP_IMPORTANCE: "brain_dump_importance",
  EMOTIONAL_ARC: "emotional_arc",
  LEARNING_JOURNAL: "learning_journal",
  LEARNING_VELOCITY: "learning_velocity",
  LESSON: "lesson",
  REFLECTION: "reflection",
  SKILL: "skill",
  SKILL_PENDING: "skill_pending",
  TIMELINE: "timeline",

  // ── Brain · patterns (temporal + statistical) ──
  ACTION_FREQUENCY: "action_frequency",
  DAY_OF_WEEK: "day_of_week",
  EFFORT_BAND_AVG: "effort_band_avg",
  SEASONAL: "seasonal",
  TIME_PATTERN: "time_pattern",

  // ── Brain · decisions ──
  DECISION_DRIFT: "decision_drift",
  DECISION_LOG: "decision_log",
  DECISION_MANUAL: "decision_manual",
  DECISION_PATTERN: "decision_pattern",
  DECISION_QUALITY: "decision_quality",
  DECISION_TIMING: "decision_timing",

  // ── Brain · predictions + calibration ──
  GHOST_ACCURACY: "ghost_accuracy",
  GHOST_PREDICTION: "ghost_prediction",
  PREDICTION_CALIBRATION: "prediction_calibration",
  PREDICTION_LESSON: "prediction_lesson",
  PREDICTION_STREAK: "prediction_streak",
  /** v10.0.529.106 · Wave 60 · simulation engine writes · was missing
   *  from the registry · memory-consolidation health-stats now counts
   *  these instead of the Wave 58 Promise.resolve(0) placeholder. */
  SIMULATION: "simulation",

  // ── Brain · cross-session state (Wave 60) ──
  /** v10.0.529.106 · Wave 60 · rolling "Nick's current concerns"
   *  aggregate · session-distiller writes this on every distill ·
   *  permanent (per category-ttl) so cross-session continuity survives. */
  NICK_CURRENT_CONCERNS: "nick_current_concerns",

  // ── Brain · proactive delivery markers (Wave 66 + 68 + 69) ──
  /** v10.0.529.106 · Wave 66/68/69 · idempotency markers for the
   *  proactive Telegram push pipeline · per-slot-per-day for the
   *  3-slot router · per-event for premeeting cards · per-week for
   *  wealth brief. 2-14d TTL depending on use case. */
  PROACTIVE_PUSH_SENT: "proactive_push_sent",

  // ── Business / commerce ──
  BUSINESS: "business",
  CRM: "crm",
  FINANCIAL: "financial",
  FINANCIAL_FORECAST: "financial_forecast",
  HABIT_REVENUE_CORRELATION: "habit_revenue_correlation",
  INDUSTRY: "industry",
  INVOICE: "invoice",
  LEADS: "leads",
  LIVE_SHOP: "live_shop",
  MARKET: "market",
  MARKETING: "marketing",
  PRICING: "pricing",
  REVENUE: "revenue",
  REVENUE_TIMING: "revenue_timing",
  SALES: "sales",
  SERVICE: "service",
  SHOP: "shop",
  STAFF_EFFICIENCY: "staff_efficiency",

  // ── Chat / conversation ──
  CHAT_IMPORTANCE: "chat_importance",
  CHAT_PATTERN: "chat_pattern",
  CHAT_SUMMARY: "chat_summary",
  CONVERSATION_SUMMARY: "conversation_summary",
  PINNED_USER: "pinned_user",
  ENGAGEMENT: "engagement",
  RESPONSE_TIMING: "response_timing",

  // ── Personal life ──
  CODING_PREFERENCE: "coding_preference",
  DISCIPLINE: "discipline",
  FEEDBACK: "feedback",
  FOOD: "food",
  HEALTH: "health",
  MENTAL: "mental",
  MIT: "mit",
  PERSONAL_DEVELOPMENT: "personal_development",
  PHYSICAL: "physical",
  PREFERENCE: "preference",
  ROUTINES: "routines",
  SPIRITUAL: "spiritual",
  TOMORROW_NOTE: "tomorrow_note",
  WEEKLY_TARGET: "weekly_target",

  // ── Relationships + people ──
  RELATIONSHIPS: "relationships",
  COMMS: "comms",
  MEETINGS: "meetings",

  // ── Meta / archive / stale markers ──
  ANCIENT_DEVICE_EVENTS: "ancient_device_events",
  HQ_PIN_CANDIDATE: "hq_pin_candidate",
  ORPHAN_CONVERSATIONS: "orphan_conversations",
  OVERDUE_DECISIONS_REVIEWS: "overdue_decisions_reviews",

  // ── System / ops ──
  API: "api",
  AUTOMATION: "automation",
  BACKLOG_TRIAGE: "backlog_triage",
  BROWSER: "browser",
  CRONS: "crons",
  ENV: "env",
  /**
   * v10.0.338 · operator one-tap "this is broken" capture from /chat.
   * Per docs/glitch-taxonomy.md cross-cutting prevention tool C. Each
   * row carries the conversation id + the failure category guess + the
   * user's note + a snapshot of recent message ids. Drives the weekly
   * system-health digest and feeds new test fixtures.
   */
  GLITCH_CAPTURE: "glitch_capture",
  NOTIFICATIONS: "notifications",
  SYSTEM_HEALTH_DIGEST: "system_health_digest",
  TASK_SESSION: "task_session",
  TOOLS: "tools",

  // ── Tech / content ──
  ARCHITECTURE: "architecture",
  CONTENT: "content",
  /** v10.0.529.106 · Wave 76 · content approval queue storage.
   *  metadata: { status, generatedAt, imageUrl, suggestedPlatforms,
   *  kind, approvedAt?, scheduledFor? }. status lifecycle: pending →
   *  approved → scheduled OR pending → rejected (soft-deletes). */
  CONTENT_DRAFT: "content_draft",
  DATA: "data",
  FILES: "files",
  LOCAL: "local",
  MACRO: "macro",
  OPERATIONAL: "operational",
  RESEARCH: "research",
  TECH: "tech",
  UI: "ui",
  VIDEO: "video",

  // ── Tasks + strategy ──
  PLANNING: "planning",
  PROJECT_MANAGEMENT: "project_management",
  STRATEGIC_PLAN: "strategic_plan",
  STRATEGY: "strategy",
  /** 2026-05-23 · task #17 · raw per-task observation lane · written
   *  by auto-learn (LLM + heuristic), brain-domain, today-compound.
   *  3-5 rows/day at steady state. Reflection cron synthesizes these
   *  into higher-level task_pattern rows weekly. Was hand-typed in 4+
   *  files for months — registering closes the typo-protection gap. */
  TASK_INSIGHT: "task_insight",
  /** 2026-05-23 · task #17 · synthesized pattern lane · written by
   *  pattern-clusterer + nick-suggestions. Read by next-move +
   *  NickSuggestions UI. Cross-pattern meta-themes (e.g. "your
   *  morning patterns all converge on review-then-deep-block") get
   *  surfaced by the reflection cron. */
  TASK_PATTERN: "task_pattern",
  /** 2026-05-23 · task #17 · stale-loop nudge marker · per-loop key ·
   *  written by nick-suggestions when an active loop hasn't moved in
   *  N days. Already in production · registering closes the gap. */
  ORPHAN_TASKS_NUDGE: "orphan_tasks_nudge",
  /** 2026-05-23 · task #23/#24 · multi-advisor board consultation
   *  record. Written by brain.consultBoard tRPC mutation. Key shape:
   *  `board:<boardId>:<ranAtIso>`. Metadata carries the full
   *  consultation (takes + synthesis + boardId + question) so the
   *  /brain/board surface can replay any past consultation. Read by
   *  a future "board history" card. */
  BOARD_CONSULTATION: "board_consultation",

  // ── H-series · reasoning engine (2026-05-18 PM) ──
  /** Phase H.2.2 · persisted reasoning_trace rows · 30d age + 500-row cap. */
  REASONING_TRACE: "reasoning_trace",
  /** Phase H.6.1 · mega-tier timed-out source completed late · wasted spend. */
  REASONING_ORPHAN: "reasoning_orphan",
  /** Phase H.6.2 · in-flight budget reservation · closes TOCTOU on cap. */
  REASONING_IN_FLIGHT: "reasoning_in_flight",
  /** Phase N.1 · idempotency key store · prevents double-tap charges. */
  REASONING_IDEMPOTENCY: "reasoning_idempotency",
  /** Phase N.6 · persona usage telemetry · feeds the scorer. */
  PERSONA_USAGE: "persona_usage",

  // ── Phase F · wisdom display tracking ──
  /** Phase F · pill UI shown-recently tracker · 24h cooldown. */
  WISDOM_SHOWN: "wisdom_shown",
  /** Phase F · OperatorPulse wisdom cooldown · 6h. */
  PULSE_WISDOM_SHOWN: "pulse_wisdom_shown",

  // ── Phase K · operator review pipeline (2026-05-18 PM) ──
  /** Phase K · sanitized error log mirror (alongside the runtime
   *  log) so the /system/reviews errorId lookup can grep them. */
  SANITIZED_ERROR: "sanitized_error",
  /** Phase K · weekly pnpm-audit critical/high CVE findings ·
   *  surfaces in the existing /system/logs unified tail. */
  DEPENDENCY_CVE: "dependency_cve",

  // ── Phase V · AGENT_V1 → AGENT_V2 judge-eval (2026-05-18 PM) ──
  /** Phase V · prompt-comparison run record · stores prompt + V1 reply
   *  + V2 reply + LLM-judge verdict · the /system/judge-eval dashboard
   *  aggregates over these rows to compute win-rate trends per intent
   *  class. Unblocks Phase 0 of the agent-v1-to-v2 migration. */
  PROMPT_COMPARISON_RUN: "prompt_comparison_run",

  // ── WAVE-200 (2026-05-17) ──
  /** Wave-200 Phase 5 · daily operator brief composer output. Indexed
   *  per ET-date in `key`. Content is brief HTML. ~2KB typical. */
  MORNING_BRIEF: "morning_brief",
  /** Wave-200 Phase 5 · Cartesia-TTS audio for the morning brief,
   *  stored as base64. Indexed per ET-date in `key`. ~100-300KB.
   *  EXCLUDED from contextual recall (see RECALL_EXCLUDE_CATEGORIES
   *  below) because the binary payload would saturate the recall
   *  query without semantic value. */
  MORNING_BRIEF_AUDIO: "morning_brief_audio",
  /** Wave-200 Phase 6 · per-customer inferred preferences. Indexed
   *  per customerId in `key`. Metadata is the structured payload. */
  CUSTOMER_PREFERENCE: "customer_preference",
  /** Phase A.1 (Goals page) · Nick-flagged stale goal candidates.
   *  Key = LifeGoal.id · content = human-readable summary ·
   *  metadata = { goalId, goalTitle, horizon, daysSinceActivity }.
   *  Written by goal-pruner Inngest cron · read by /goals page +
   *  /api/goals/snapshot. Soft-deleted when activity resumes. */
  GOAL_PRUNE_CANDIDATE: "goal_prune_candidate",
  /** Phase A.3 · daily meta-scoreboard snapshot pinned at brief-time
   *  (10:00 UTC via morning-brief Inngest). Key = YYYY-MM-DD ·
   *  metadata = { numbers: ScoreboardNumber[], state }. Read by
   *  meta-scoreboard composer to show "as of 6am" baseline · live
   *  page-render adds runtime-detected anomalies on top. */
  SCOREBOARD_PINNED: "scoreboard_pinned",
  /** Phase D · ADR-0013 · journal pattern-radar convergence candidate.
   *  Key = clusterHash · metadata = { size, coherence, members[],
   *  nameSuggestions[], detectedAt }. Written by journal-convergence
   *  Inngest cron · read by /journal page ThreadRadar card · soft-
   *  deleted when operator names the cluster (becomes a JournalThread)
   *  or dismisses it. */
  JOURNAL_CONVERGENCE_CANDIDATE: "journal_convergence_candidate",
  /** Phase D · auto-join suggestion (similarity in 0.65-0.80 band).
   *  Key = `${threadId}:${entrySource}:${entryId}` · written by
   *  capture-write post-hook · read by /journal page · operator
   *  confirms/rejects through the ThreadRail UI. */
  JOURNAL_THREAD_SUGGESTION: "journal_thread_suggestion",

  // ═══ DEPRECATED — kept so old data still reads; codemod migrates writes ═══

  /** @deprecated use RELATIONSHIPS (plural). Typo-split migration target. */
  RELATIONSHIP: "relationship",

  /** @deprecated use SKILL. Singular is the canonical form. */
  SKILLS: "skills",

  /** @deprecated use BUSINESS. CQRS split never caught on. */
  BUSINESS_READ: "business_read",
  /** @deprecated use BUSINESS. CQRS split never caught on. */
  BUSINESS_WRITE: "business_write",

  /** @deprecated use PERSONAL_DEVELOPMENT. CQRS split never caught on. */
  PERSONAL_READ: "personal_read",
  /** @deprecated use PERSONAL_DEVELOPMENT. CQRS split never caught on. */
  PERSONAL_WRITE: "personal_write",

  /** @deprecated use specific category. One-time ChatGPT import bucket. */
  CHATGPT_CONVERSATION: "chatgpt_conversation",
  /** @deprecated use DECISION_LOG. One-time ChatGPT import bucket. */
  CHATGPT_DECISION: "chatgpt_decision",
  /** @deprecated use PREFERENCE. One-time ChatGPT import bucket. */
  CHATGPT_PREFERENCE: "chatgpt_preference",
  /** @deprecated use CONVERSATION_SUMMARY. One-time ChatGPT import bucket. */
  CHATGPT_SUMMARY: "chatgpt_summary",

  /** @deprecated catch-all — always route to a real category. */
  UNCATEGORIZED: "uncategorized",
  /** @deprecated same as UNCATEGORIZED. */
  RANDOM: "random",
} as const;

export type BrainCategory =
  (typeof BRAIN_CATEGORIES)[keyof typeof BRAIN_CATEGORIES];

/** Set for fast runtime lookup. */
export const KNOWN_BRAIN_CATEGORIES: ReadonlySet<string> = new Set(
  Object.values(BRAIN_CATEGORIES),
);

/**
 * Categories the codemod will rewrite on write. Keep the KEYS as the
 * OLD string (what's in the DB today) and VALUES as the canonical
 * target. Only one-way migrations — never collapse data that's lost
 * semantic distinction.
 */
export const DEPRECATED_CATEGORY_MAP: Readonly<Record<string, string>> = {
  relationship: BRAIN_CATEGORIES.RELATIONSHIPS,
  skills: BRAIN_CATEGORIES.SKILL,
  business_read: BRAIN_CATEGORIES.BUSINESS,
  business_write: BRAIN_CATEGORIES.BUSINESS,
  personal_read: BRAIN_CATEGORIES.PERSONAL_DEVELOPMENT,
  personal_write: BRAIN_CATEGORIES.PERSONAL_DEVELOPMENT,
  chatgpt_preference: BRAIN_CATEGORIES.PREFERENCE,
  chatgpt_summary: BRAIN_CATEGORIES.CONVERSATION_SUMMARY,
  // Note: chatgpt_conversation + chatgpt_decision are kept as-is
  // because their write-site context matters (specific ChatGPT import
  // run — migrating them would lose provenance).
};

export function isKnownCategory(category: string): boolean {
  return KNOWN_BRAIN_CATEGORIES.has(category);
}

/**
 * Categories whose ROWS must NEVER be pulled into contextual recall
 * (Nick's per-turn system prompt). These hold payloads that are NOT
 * semantic memory · including them would pollute recall and inflate
 * payload size with no benefit.
 *
 * Use case · the Wave-200 Phase 5 morning brief audio stores 100-300KB
 * base64 mp3 in `content`. The default recall query pulls 300 rows
 * by confidence · adding the audio category there would push 30-90MB
 * of base64 into the prompt builder for zero retrieval value.
 *
 * Consumers should add `category: { notIn: [...RECALL_EXCLUDE_CATEGORIES] }`
 * to their findMany where-clauses. The contextual-recall.ts hot path
 * uses this exact filter.
 */
export const RECALL_EXCLUDE_CATEGORIES: readonly string[] = [
  BRAIN_CATEGORIES.MORNING_BRIEF_AUDIO,
  // 2026-05-21 · operator-facing meta-analysis · must not leak into chat recall
  BRAIN_CATEGORIES.SUGGESTION_HYPOTHESIS,
];

/**
 * Return the canonical category for a value — passes through for
 * known non-deprecated values; rewrites deprecated values to their
 * replacement. Used by the runtime guard + codemod.
 */
export function canonicalCategory(category: string): string {
  return DEPRECATED_CATEGORY_MAP[category] ?? category;
}

/**
 * Domain grouping for UI rendering (/brain/categories dashboard).
 * Mirrors the comment sections above — updated in lock-step.
 */
export const CATEGORY_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  "AI / Nick": [
    "ai", "ai_analysis", "ai_config", "nick_advice", "nick_quality",
    "reply_quality", "narrator_feedback",
  ],
  "Brain · identity + beliefs": [
    "belief", "belief_candidate", "belief_manual", "belief_refresh_report",
    "identity_snapshot", "qualitative_identity",
  ],
  "Brain · insights + patterns": [
    "anomaly", "anti_pattern", "blind_spot", "causation", "contradiction",
    "correlation_alert", "counter_intuitive", "hidden_correlation",
    "pattern", "teaching_moment", "wisdom", "wisdom_contradiction",
    "nudge_ack", "nudge_pin_hygiene",
  ],
  "Brain · memory + learning": [
    "brain", "brain_dump_importance", "emotional_arc", "learning_journal",
    "learning_velocity", "lesson", "reflection", "skill", "skill_pending",
    "timeline",
  ],
  "Brain · temporal patterns": [
    "action_frequency", "day_of_week", "effort_band_avg", "seasonal",
    "time_pattern",
  ],
  "Brain · decisions": [
    "decision_drift", "decision_log", "decision_manual", "decision_pattern",
    "decision_quality", "decision_timing",
  ],
  "Brain · predictions + calibration": [
    "ghost_accuracy", "ghost_prediction", "prediction_calibration",
    "prediction_lesson", "prediction_streak",
  ],
  "Business / commerce": [
    "business", "crm", "financial", "financial_forecast",
    "habit_revenue_correlation", "industry", "invoice", "leads",
    "live_shop", "market", "marketing", "pricing", "revenue",
    "revenue_timing", "sales", "service", "shop", "staff_efficiency",
  ],
  "Chat / conversation": [
    "chat_importance", "chat_pattern", "chat_summary",
    "conversation_summary", "pinned_user", "engagement", "response_timing",
  ],
  "Personal life": [
    "coding_preference", "discipline", "feedback", "food", "health",
    "mental", "mit", "personal_development", "physical", "preference",
    "routines", "spiritual", "tomorrow_note", "weekly_target",
  ],
  "Relationships + people": [
    "relationships", "comms", "meetings",
  ],
  "Meta · archive + stale": [
    "ancient_device_events", "hq_pin_candidate", "orphan_conversations",
    "overdue_decisions_reviews",
  ],
  "System / ops": [
    "api", "automation", "backlog_triage", "browser", "crons", "env",
    "notifications", "system_health_digest", "task_session", "tools",
  ],
  "Tech / content": [
    "architecture", "content", "data", "files", "local", "macro",
    "operational", "research", "tech", "ui", "video",
  ],
  "Tasks + strategy": [
    "planning", "project_management", "strategic_plan", "strategy",
    "task_insight", "task_pattern", "orphan_tasks_nudge",
    "board_consultation",
  ],
  "Legacy / deprecated": [
    "relationship", "skills", "business_read", "business_write",
    "personal_read", "personal_write", "chatgpt_conversation",
    "chatgpt_decision", "chatgpt_preference", "chatgpt_summary",
    "uncategorized", "random", "desc",
  ],
};
