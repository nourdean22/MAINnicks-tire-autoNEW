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
  REPLY_TO_IMPROVE: "reply_to_improve",
  VOICE_LATENCY_ALERT: "voice_latency_alert",

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
  TRAJECTORY_JUDGMENT: "trajectory_judgment", // 2026-08-18 · GATE item #4 · action-sequence grades
  ADVERSARIAL_OBJECTION: "adversarial_objection", // v10.0.369 · counter-arguments to recommendations
  EVAL_RUN: "eval_run", // v10.0.370 · daily quality benchmark run results
  DOMAIN_KNOWLEDGE: "domain_knowledge", // v10.0.371 · extracted facts (semantic-kind in CoALA)
  SUGGESTION_LOOP: "suggestion_loop", // v10.0.529.97 · operator action + outcome on Nick suggestions · supervised signal for DPO
  SUGGESTION_HYPOTHESIS: "suggestion_hypothesis", // 2026-05-21 · suggestion-improve · per-kind improvement hypotheses derived from the suggestion-loop
  NUDGE_ACK: "nudge_ack",
  NUDGE_PIN_HYGIENE: "nudge_pin_hygiene",
  SEMANTIC_EDGE: "semantic_edge",
  RULE: "rule",
  WIN: "win",
  SCORE_EVENT: "score_event",
  TOKEN_AGE_PUSHED: "token_age_pushed",

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
  REFLECTION_EVENT: "reflection_event",

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
  REVENUE_MOVE: "revenue_move",
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
  PERSONAL: "personal",
  SOCIAL: "social",
  MIND: "mind",
  MASTERY: "mastery",
  DRIFT: "drift",
  PREDICTION: "prediction",
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
  // 2026-05-24 · Wave X.f · ingest-fireflies writes the raw string
  // "meeting_transcript" (not via this constant) and chat-recall
  // never read it. Adding the constant + wiring it through
  // ingest-fireflies + recall closes the loop.
  MEETING_TRANSCRIPT: "meeting_transcript",

  // ── Meta / archive / stale markers ──
  ANCIENT_DEVICE_EVENTS: "ancient_device_events",
  ARCHIVE_DOCUMENT: "archive_document",
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
  SYSTEM_ALERT: "system_alert",
  SYSTEM_DEDUPE: "system_dedupe",
  SCHEMA_DRIFT_ALERT: "schema_drift_alert",
  TELEMETRY_TEMPORAL_WARN: "telemetry_temporal_warn",
  TELEMETRY_TOOL_VERB: "telemetry_tool_verb",

  // ── Tech / content ──
  ARCHITECTURE: "architecture",
  CONTENT: "content",
  /** v10.0.529.106 · Wave 76 · content approval queue storage.
   *  metadata: { status, generatedAt, imageUrl, suggestedPlatforms,
   *  kind, approvedAt?, scheduledFor? }. status lifecycle: pending →
   *  approved → scheduled OR pending → rejected (soft-deletes). */
  CONTENT_DRAFT: "content_draft",
  /** AG-44 · weekly publish→performance rollup. Key = ISO date of the
   *  weekly run · content = top posts of the trailing 14d with REAL
   *  Meta Graph numbers (impressions/engagement). Consumed by
   *  buildGhostVoicePrompt's RECENT WINNERS block so the ghostwriter
   *  learns from what actually performed. 45d TTL. */
  CONTENT_WINNERS: "content_winners",
  DATA: "data",
  FILES: "files",
  LOCAL: "local",
  MACRO: "macro",
  OPERATIONAL: "operational",
  RESEARCH: "research",
  RESEARCH_PACK: "research_pack",
  RESEARCH_SOURCE: "research_source",
  RESEARCH_CLAIM: "research_claim",
  /**
   * Low-trust landing zone for pipeline-promoted IntelligenceClaims (the
   * belief_candidate pattern). Deliberately ABSENT from memory-recall.ts's
   * CONTEXT_CATEGORIES whitelist, so a promoted claim is queryable/reviewable
   * but can never leak into chat recall until a human promotes it
   * (research_claim_candidate -> research_claim). See lib/intelligence/promote.ts.
   */
  RESEARCH_CLAIM_CANDIDATE: "research_claim_candidate",
  RESEARCH_QUESTION: "research_question",
  RESEARCH_ACTION: "research_action",
  RESEARCH_CONTRADICTION: "research_contradiction",
  NOTEBOOKLM_PACK: "notebooklm_pack",
  TECH: "tech",
  UI: "ui",
  VIDEO: "video",
  REFERENCE: "reference",
  TOOL_TELEMETRY: "tool_telemetry",
  TOOL_EMBEDDING: "tool_embedding",

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
  TASK_COMPLETION: "task_completion",
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
  /** 2026-05-27 · operator-driven · weekly review snapshot per
   *  ISO week (key shape `YYYY-WNN`). Written by ReviewWizard's
   *  finishWizard → task.saveWeeklyReview mutation. Metadata
   *  carries the operator's "serve & surprise" commitments for
   *  the week plus the warnings actioned + pinned task IDs. Read
   *  by Monday-morning recall so Nick remembers what the operator
   *  committed to. Tim Challies' "Do More Better" framework
   *  (Get Clear → Get Current → Get Set → Get Going + Serve & Surprise). */
  WEEKLY_REVIEW: "weekly_review",
  /** 2026-05-27 · idempotency marker for the Sunday 6pm ET Telegram
   *  nudge that prompts the operator to open the ReviewWizard.
   *  Key shape `YYYY-WNN` matches WEEKLY_REVIEW so the two markers
   *  cross-reference per week. Written by cron:weekly-review-nudge. */
  WEEKLY_REVIEW_NUDGE: "weekly_review_nudge",

  // ── Power Atlas · 2026-05-27 ──
  /** Robert Greene corpus seed · 48 Laws + Mastery + Human Nature +
   *  Seduction + 33 Strategies of War. Key shape: `law_<N>` for laws,
   *  `dark_<trait>` for dark traits, `seducer_<type>` for seducer types,
   *  `mentor_<role>` for mentorship roles, `strategy_<name>` for war
   *  strategies. Content = JSON { title, summary, fullText, sourceBook,
   *  applicabilityPrompt }. Seeded once via scripts/seed-greene-corpus. */
  GREENE_LAW: "greene_law",
  /** Power-play execution trace · written by power-plays-runner on every
   *  arc_plan / message_draft / scarcity_play execution. Key shape:
   *  `play_<personId>_<timestamp>`. Content = JSON { kind, lawApplied,
   *  inputCtx, output, outcome? }. Surfaces in /relationships per-profile
   *  "Plays history" tab. */
  POWER_PLAY: "power_play",
  /** Sunday digest idempotency marker · one row per ISO week. Key =
   *  ISO-week string `YYYY-WNN`. Content = the digest text that was sent.
   *  Prevents double-sends on cron retries (Vercel at-least-once). */
  RELATIONSHIP_DIGEST_SENT: "relationship_digest_sent",
  /** Birthday push idempotency marker · key = `<personId>:YYYY-MM-DD`.
   *  Prevents double-pings on the same calendar date. 365d TTL. */
  RELATIONSHIP_BIRTHDAY_SENT: "relationship_birthday_sent",
  /** 2026-05-27 · Power Atlas Phase 2 · promise-extraction log.
   *  One row per extracted promise · key shape `<personId>:<chatMsgId>`.
   *  Content = JSON { promise, dueHint, extractedAt, status: "open"
   *  | "kept" | "broken", resolvedAt? }. Drives trust-score derivation
   *  via deriveTrustFromKeptWord. Written by cron:kept-word-scan. */
  KEPT_WORD: "kept_word",
  /** 2026-05-27 · Power Atlas Phase 2 · operator-pinned alpha moments
   *  on the relationship ledger. Key shape `<personId>:<ledgerId>`.
   *  Content = JSON { moment, ledgerId, pinnedAt, kind: "peak" |
   *  "shift" | "insight" }. Written by tRPC markAlphaMoment. */
  ALPHA_MOMENT: "alpha_moment",

  // ── Power Atlas · Dark Psychology extension (2026-06-20) ──
  /** 2026-06-20 · Dark psychology corpus · cognitive biases, manipulation
   *  techniques, social engineering patterns from P0WER handbook +
   *  external repos. Key shape: `dp_<topic>`. Metadata mirrors GreeneEntry
   *  shape: { title, summary, fullText, triggers[], actions[],
   *  relatedKeys[], applicabilityPrompt, sourceBook }. Seeded via
   *  scripts/seed-dark-psychology-corpus.ts. */
  DARK_PSYCHOLOGY: "dark_psychology",
  /** 2026-06-20 · Negotiation tactics · Voss "Never Split the Difference"
   *  patterns (mirroring, labeling, calibrated questions, accusation audit).
   *  Key shape: `neg_<pattern>`. Same metadata shape as DARK_PSYCHOLOGY. */
  NEGOTIATION_TACTIC: "negotiation_tactic",
  /** 2026-06-20 · Competitive intelligence · Chanakya Neeti principles for
   *  systematic exploitation of competitor vulnerabilities. Key shape:
   *  `ci_<principle>`. Same metadata shape as DARK_PSYCHOLOGY. */
  COMPETITIVE_INTEL: "competitive_intel",
  /** 2026-06-20 · Tactical playbook · concrete tactical patterns (anchoring,
   *  scarcity, illusion of choice, Trojan networking). Key shape:
   *  `tp_<pattern>`. Same metadata shape as DARK_PSYCHOLOGY. */
  TACTICAL_PLAYBOOK: "tactical_playbook",

  // ── Wave AA · Missions-led IA (2026-05-28) ──
  /** 2026-05-28 · Wave AA Phase 3 · per-mission retrospective captured
   *  when the operator completes a mission (last task ticked done OR
   *  explicit "complete mission" tap). Key shape: `<missionId>`. Content
   *  = the 2-line retro text. Metadata = { missionId, missionTitle,
   *  taskCount, finishedAt, retroText }. Feeds Nick's "what compounds
   *  across missions" reflection + WeeklySynthesis cron. */
  MISSION_RETRO: "mission_retro",
  /** 2026-05-28 · Wave AA Phase 2 · cached per-mission "Nick's pick"
   *  (the highest-leverage next task in that mission). Key shape:
   *  `<missionId>:<YYYY-MM-DD>`. Content = "{taskId} · {rationale}".
   *  Refreshes daily · /missions reads on mount to render the gold
   *  border on the picked row. */
  MISSION_NICKS_PICK: "mission_nicks_pick",
  /** 2026-05-28 · Wave AA Phase 2 · daily morning brief across all
   *  active missions. Key shape: `<YYYY-MM-DD>`. Content = 1-paragraph
   *  brief (max ~120 chars). Refreshes once per day at first /missions
   *  visit or on major mission state change. */
  MISSION_MORNING_BRIEF: "mission_morning_brief",
  /** 2026-05-28 · Wave AA Phase 4 · /missions surface telemetry · daily
   *  aggregated event counts written by /api/system/mission-surface-stats.
   *  Key shape: `surface_<YYYY-MM-DD>_<surface>`. Content = day summary
   *  string. Metadata = { counts: Record<event,count>, events: rolling
   *  200-event sample, version }. 30-day retention via standard
   *  BrainMemory decay. Feeds the telemetry-driven prune analysis. */
  MISSION_SURFACE_TELEMETRY: "mission_surface_telemetry",

  // ── Wave AB · /relationships Sam-led redesign (2026-05-28) ──
  /** 2026-05-28 · Wave AB Phase 1B · Nick's top 3 daily relationship
   *  outreach picks. Key shape: `<YYYY-MM-DD>`. Content = "Picks for
   *  YYYY-MM-DD · <name1>, <name2>, <name3>". Metadata = {
   *  picks: RelationshipPick[], candidateCount, generatedAt }.
   *  Invalidated on ledger write so just-logged outreach doesn't keep
   *  appearing. */
  RELATIONSHIPS_PICKS_TODAY: "relationships_picks_today",
  /** 2026-05-28 · Wave AB Phase 2 · daily morning brief across all
   *  active relationships. Key shape: `<YYYY-MM-DD>`. Mirror of
   *  MISSION_MORNING_BRIEF but scoped to people. */
  RELATIONSHIPS_MORNING_BRIEF: "relationships_morning_brief",
  /** 2026-05-28 · Wave AB Phase 3 · Sunday weekly synthesis · written
   *  by cron · key shape `<YYYY-WNN>`. Content = 3-paragraph synthesis
   *  of the week's relationship movement · lands in /journal too. */
  RELATIONSHIPS_WEEKLY_SYNTHESIS: "relationships_weekly_synthesis",
  /** 2026-05-28 · Wave AB Phase 2 · outreach log · operator hit "log
   *  outreach" on a Nick's pick · key shape `<personId>:<timestamp>`.
   *  Mirrors RelationshipLedger but with the AI rationale + draft text
   *  attached for future Nick reads. */
  RELATIONSHIPS_OUTREACH: "relationships_outreach",
  /** 2026-05-28 · Wave AB.b · contextual Greene law picks (top 3 of the
   *  Wave Z 144-entry corpus, ranked per-person + per-day). Key shape:
   *  `<personId>:<YYYY-MM-DD>`. Metadata = { personId, laws: ContextualLaw[],
   *  generatedAt }. Caches the AI rank for 24h so dossier opens don't burn
   *  tokens. The component reads metadata.laws directly. */
  GREENE_CONTEXTUAL_PICK: "greene_contextual_pick",

  // ── Wave AC · Sam-led home page (2026-05-28) ──
  /** 2026-05-28 · Wave AC Phase 2 · cross-surface daily brief on the
   *  home page · key shape `<YYYY-MM-DD>` · synthesis across missions,
   *  relationships, journal, brain. */
  HOME_BRIEF: "home_brief",
  /** 2026-05-28 · Wave AI · Sam-Altman-shaped goals brief on /goals ·
   *  key `<YYYY-MM-DD>` · synthesizes active LifeGoals + recent
   *  reflection activity into a 2-3 sentence brief that names the ONE
   *  goal that should compound most this week. */
  GOALS_BRIEF: "goals_brief",
  /** 2026-05-28 · Wave AP · Sam-Altman-shaped journal brief on /journal ·
   *  key `<YYYY-MM-DD>` · synthesizes the last 14 days of reflection +
   *  brain-dump + thread activity into 2-3 sentences naming what
   *  compounded + the open question + the stalled thread to revisit. */
  JOURNAL_BRIEF: "journal_brief",
  /** 2026-05-28 · Wave AQ · Sam-Altman-shaped scoreboard brief on
   *  /scoreboard · key `<YYYY-MM-DD>` · reads buildMetaScoreboard()
   *  anchors + anomalies · names the ONE number + the biggest risk +
   *  the concrete next move. Mirrors the other Nicks*Brief categories. */
  SCOREBOARD_BRIEF: "scoreboard_brief",
  /** 2026-05-28 · Wave AC Phase 1B · home one-tap moves shelf cache ·
   *  key shape `<YYYY-MM-DD>` · metadata.moves = OneTapMove[] (3 cards). */
  HOME_MOVES: "home_moves",

  // ── Wave AG · Nick Action Queue (2026-05-28) ──
  /** 2026-05-28 · Wave AG · idempotency marker. Written by the 8am
   *  cron `nick-action-proposal` after a daily batch of pending
   *  AutonomousAction rows has been generated + pushed to Telegram.
   *  Key shape: `<YYYY-MM-DD>`. Metadata = { count, ruleNames[], queuedIds[] }.
   *  Re-firing the cron the same day skips the work. */
  NICK_ACTION_PROPOSAL_SENT: "nick_action_proposal_sent",
  /** 2026-05-28 · Wave AG · execution result log. Written by the
   *  9am cron `nick-action-execute` after a batch of approved rows
   *  has been dispatched. Key shape: `<YYYY-MM-DD>`. Metadata =
   *  { executed, failed, skipped, durationMs, results: [{id, actionType,
   *  ok, summary}] }. Gives the operator a daily record of what Nick
   *  actually did under their sign-off. */
  NICK_ACTION_RESULTS: "nick_action_results",

  // ── Gmail ingest (existed as raw strings · registered 2026-05-27) ──
  /** Pre-2026-05-27 · raw string `gmail_thread` written by the existing
   *  ingest-gmail cron. Per-thread captured INBOUND mail. Key shape:
   *  `gmail_${messageId}`. Content = "Subject: ... From: ... Date: ...
   *  <body>". Metadata: { messageId, threadId, from, subject, account?,
   *  classification? (2026-05-27 enrichment: category, urgency,
   *  needsReply, summary, mentions[]) }. Embedded by embed-backfill so
   *  /brain semantic search returns captured emails. */
  GMAIL_THREAD: "gmail_thread",
  /** Pre-2026-05-27 · raw string `gmail_outgoing` for sent-mail
   *  capture. Same shape as GMAIL_THREAD but for in:sent · captures
   *  the operator's decisions + commitments + tone in real
   *  communication. Read by Nick to ground "did I commit to X" recall. */
  GMAIL_OUTGOING: "gmail_outgoing",

  /** 2026-05-27 · audit log for the fuzzy person-profile resolver
   *  (lib/brain/person-profile-fuzzy.ts). Written when an
   *  auto-create call site (conversation-memory · nick-agent
   *  person.update) finds a case-insensitive / Levenshtein /
   *  Jaro-Winkler match against an existing PersonProfile instead
   *  of creating a duplicate. Operator can grep these to verify
   *  no false merges happened. Key shape: `merge_<ts>_<matched>_<input>`. */
  PEOPLE_INTELLIGENCE_MERGE: "people_intelligence_merge",

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

  // ── Phase V · judge-eval (2026-05-18 PM) ──
  /** Phase V · prompt-comparison run record · stores prompt + V1 reply
   *  + V2 reply + LLM-judge verdict · the /system/judge-eval dashboard
   *  aggregates over these rows to compute win-rate trends per intent
   *  class. Unblocks Phase 0 of the agent-v1-to-v2 migration. */
  PROMPT_COMPARISON_RUN: "prompt_comparison_run",
  /** 2026-05-23 · Wave C+ · Q2 · shadow-judge queue.
   *  Pre-fix: the shadow path recorded char-count + section delta
   *  but no quality signal · V1→V2 cutover had no falsifiable check.
   *  Now: when shadow fires AND sample-rate hits, it writes v1Prompt
   *  + v2Prompt + sourceMessageId here · the existing judge-eval
   *  replay cron picks queued rows up, runs both prompts through
   *  the model, scores via the comparator, writes the result back
   *  to SystemMetric (prompt.shadow.judge_score_delta). Decouples
   *  judging latency from chat path. Idempotent · keyed by message id. */
  PROMPT_SHADOW_JUDGE_QUEUE: "prompt_shadow_judge_queue",
  /** 2026-05-23 · P4 · long-lived API tokens for the Chrome extension
   *  + future scripts. Content holds a sha256 of the token (raw
   *  token shown ONCE on issue · never re-readable). key = nanoid
   *  label. metadata: { label, createdAt, lastUsedAt, scope }.
   *  Revoked = deletedAt set. Future: dedicated ApiToken table when
   *  scope/quotas need real columns. */
  API_TOKEN: "api_token",
  /** 2026-05-24 · Wave T #2 · audit-trail for /settings autopilot
   *  toggles. Each flag flip writes a row with the prior-state
   *  duration · the optional 1-line "why?" note · the new state.
   *  Drives the "why was this disabled?" drawer. 90d retention via
   *  the existing soft-delete cron. */
  AUTOPILOT_FLAG_CHANGE: "autopilot_flag_change",

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
  /** 2026-08-19 · a frozen copy of a memory's PRIOR version, written the
   *  moment the commit gateway rules `supersede`. `remember()` upserts on
   *  (category, key), so a supersede overwrote the row in place and the
   *  previous claim was lost forever — which is why valid_from /
   *  valid_until / superseded_by_id (applied to prod 2026-08-14) had
   *  ZERO populated rows out of 18,527 when measured 2026-08-19.
   *  The snapshot carries validUntil = the moment it stopped being true
   *  and supersededById = the canonical row that replaced it, giving a
   *  walkable history chain without violating the (category, key) unique.
   *  EXCLUDED from recall — see RECALL_EXCLUDE_CATEGORIES. */
  SUPERSEDED_SNAPSHOT: "superseded_snapshot",
  /** Phase A.1 (Goals page) · Nick-flagged stale goal candidates.
   *  Key = LifeGoal.id · content = human-readable summary ·
   *  metadata = { goalId, goalTitle, horizon, daysSinceActivity }.
   *  Written by goal-pruner Inngest cron · read by /goals page +
   *  /api/goals/snapshot. Soft-deleted when activity resumes. */
  GOAL_PRUNE_CANDIDATE: "goal_prune_candidate",
  /** 2026-05-26 · Mastery Layer Stage A · Unified Coach Channel.
   *  ONE store for all "system noticed something the operator should
   *  see" events. Replaces the 5 separate alert mechanisms across
   *  /tasks (Proactive Nick) · /goals (pruneCandidates) · /scoreboard
   *  (anomalies + PricingAdvisory) · /journal (BrainSignalsChip) ·
   *  /brain (ActiveAlertsCard).
   *
   *  Key format: `coach:${kind}:${subjectId}` · doubles as the
   *  10-minute dedup window (writer upserts on same key).
   *  Metadata shape: { eventId, kind, priority: "P0"|"P1"|"P2",
   *  title, body?, deepLink?, surfaces: string[], expiresAt?,
   *  ackedAt?, dismissable?, subjectId? }.
   *
   *  Writers: lib/services/coach-events.ts (recordCoachEvent helper).
   *  Reader:  lib/services/coach-events.ts (getActiveCoachEvents). */
  COACH_EVENT: "coach_event",
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
  // 2026-08-16 · MAKING A COMMENT TRUE. lib/intelligence/ingest.ts and
  // promote.ts both stated these rows were "quarantined from chat recall
  // until a human promotes them". They were not: this list was the only
  // quarantine mechanism and never contained the category, while candidates
  // are minted at confidence 0.3 against contextual-recall's `gte: 0.3`
  // floor — so they passed the filter exactly. Un-promoted external claims,
  // whose only grounding is cosine similarity to our own memory, were
  // retrievable into the chat prompt as `[research_claim_candidate] (30%)`.
  // Promotion to the trusted `research_claim` category is what makes a claim
  // recallable; until then it belongs to /brain, not to the model.
  BRAIN_CATEGORIES.RESEARCH_CLAIM_CANDIDATE,
  // 2026-08-19 · frozen prior versions of superseded memories. These are
  // history, not belief — the whole point is that the system STOPPED
  // holding them. Recalling one would feed the model a claim we have
  // explicitly replaced, which is worse than not remembering it at all.
  BRAIN_CATEGORIES.SUPERSEDED_SNAPSHOT,
];

/**
 * 2026-07-12 · Categories the nightly Memory Consolidation Engine
 * (lib/brain/memory-consolidation.ts) must NEVER touch. The MERGE +
 * DISTILL stages ask an LLM to rewrite a category's rows into a single
 * PROSE "consolidated memory". That is correct for free-text belief
 * rows — but these categories store STRUCTURED payloads (JSON configs,
 * identity snapshots, skill queues, base64 audio) that downstream code
 * JSON.parses. Consolidating them clobbered the keeper row's `content`
 * with prose → readers threw "Unexpected token … is not valid JSON"
 * every run (skill-extractor, identity-snapshot, legacy-shims). One
 * such prose row silently disabled the admin AI-config panel for a
 * week. Deleting the bad rows never held — the cron regenerated them.
 * Excluding the categories at the writer is the durable fix.
 */
export const CONSOLIDATION_EXCLUDE_CATEGORIES: readonly string[] = [
  BRAIN_CATEGORIES.AI_CONFIG,
  BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
  BRAIN_CATEGORIES.SKILL,
  BRAIN_CATEGORIES.SKILL_PENDING,
  BRAIN_CATEGORIES.CHAT_IMPORTANCE,
  BRAIN_CATEGORIES.CONTENT_DRAFT,
  BRAIN_CATEGORIES.MORNING_BRIEF_AUDIO,
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
    "reply_quality", "narrator_feedback", "reply_to_improve", "voice_latency_alert",
  ],
  "Brain · identity + beliefs": [
    "belief", "belief_candidate", "belief_manual", "belief_refresh_report",
    "identity_snapshot", "qualitative_identity",
  ],
  "Brain · insights + patterns": [
    "anomaly", "anti_pattern", "blind_spot", "causation", "contradiction",
    "correlation_alert", "counter_intuitive", "hidden_correlation",
    "pattern", "teaching_moment", "wisdom", "wisdom_contradiction",
    "nudge_ack", "nudge_pin_hygiene", "semantic_edge", "rule", "win",
    "score_event", "token_age_pushed",
  ],
  "Brain · memory + learning": [
    "brain", "brain_dump_importance", "emotional_arc", "learning_journal",
    "learning_velocity", "lesson", "reflection", "skill", "skill_pending",
    "timeline", "reflection_event",
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
    "revenue_move",
  ],
  "Chat / conversation": [
    "chat_importance", "chat_pattern", "chat_summary",
    "conversation_summary", "pinned_user", "engagement", "response_timing",
  ],
  "Personal life": [
    "coding_preference", "discipline", "feedback", "food", "health",
    "mental", "mit", "personal_development", "physical", "preference",
    "routines", "spiritual", "tomorrow_note", "weekly_target",
    "personal", "social", "mind", "mastery", "drift", "prediction",
  ],
  "Relationships + people": [
    "relationships", "comms", "meetings",
    "greene_law", "power_play", "relationship_digest_sent",
    "relationship_birthday_sent", "kept_word", "alpha_moment",
    "greene_contextual_pick", "relationships_picks_today",
    "relationships_morning_brief", "relationships_weekly_synthesis",
    "relationships_outreach",
    "dark_psychology", "negotiation_tactic",
    "competitive_intel", "tactical_playbook",
  ],
  "Meta · archive + stale": [
    "ancient_device_events", "archive_document", "hq_pin_candidate", "orphan_conversations",
    "overdue_decisions_reviews",
  ],
  "System / ops": [
    "api", "automation", "backlog_triage", "browser", "crons", "env",
    "notifications", "system_health_digest", "task_session", "tools",
    "system_alert", "system_dedupe", "schema_drift_alert",
    "telemetry_temporal_warn", "telemetry_tool_verb",
  ],
  "Tech / content": [
    "architecture", "content", "data", "files", "local", "macro",
    "operational", "research", "tech", "ui", "video",
    "research_pack", "research_source", "research_claim",
    "research_question", "research_action", "research_contradiction",
    "notebooklm_pack", "reference", "tool_telemetry", "tool_embedding",
  ],
  "Tasks + strategy": [
    "planning", "project_management", "strategic_plan", "strategy",
    "task_insight", "task_pattern", "orphan_tasks_nudge",
    "board_consultation", "task_completion",
  ],
  "Legacy / deprecated": [
    "relationship", "skills", "business_read", "business_write",
    "personal_read", "personal_write", "chatgpt_conversation",
    "chatgpt_decision", "chatgpt_preference", "chatgpt_summary",
    "uncategorized", "random", "desc",
  ],
};
