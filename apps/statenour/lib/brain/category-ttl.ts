/**
 * Category-specific TTL policy · v10.0.89 · 2026-05-02.
 *
 * Centralizes per-category memory expiry rules. Used by
 * memory-manager.remember() and the audit-retention pass to set
 * `expiresAt` consistently instead of every caller hand-picking
 * a number.
 *
 * Rules of thumb:
 *   · Permanent (null TTL): wisdom, identity_snapshot, qualitative_
 *     identity, strategic_plan, decision_pattern, blind_spot,
 *     belief, contradiction, brain_dump (the brain's "long memory")
 *   · Long (180d): nick_advice, insight, pattern, counter_intuitive,
 *     meta_pattern (durable but reviewable)
 *   · Medium (90d): industry_intel, customer_stories, content_
 *     performance (operational reference)
 *   · Short (30d): chat_summary, conversation_summary, emotional_
 *     state, daily_synthesis, learning_velocity (rolls over)
 *   · Telemetric (7d): system_alert, system_health_
 *     digest history beyond keep window, tool_embedding (rotate
 *     fast — recent state matters)
 *   · Marker rows (1d): alert_pushed, error_pushed, token_age_
 *     pushed, bus_exhaustion_pushed, memory_of_day_pick (idempotency
 *     dedup, not knowledge)
 *
 * Returns null for permanent categories so the upsert path can
 * leave expiresAt = null.
 */

const DAY = 86_400_000;

export interface CategoryTtlPolicy {
  /** Days until expiry; null = permanent */
  days: number | null;
  notes: string;
}

const POLICIES: Record<string, CategoryTtlPolicy> = {
  // ── PERMANENT ───────────────────────────────────────────────
  wisdom: { days: null, notes: "distilled principles · keep forever" },
  identity_snapshot: { days: null, notes: "who Nour is" },
  // v10.0.529.106 · Wave 60 · the rolling cross-session aggregate
  // that surfaces Nour's open threads from past chats into every new
  // session. One row · upserted by session-distiller · permanent
  // because losing it would break Nick's cross-session continuity.
  nick_current_concerns: { days: null, notes: "Wave 60 · rolling open-threads aggregate · session-distiller writes" },
  qualitative_identity: { days: null, notes: "8-axis self-model" },
  strategic_plan: { days: null, notes: "long-horizon plans" },
  decision_pattern: { days: null, notes: "graded outcomes inform Ghost Nour" },
  blind_spot: { days: null, notes: "things Nour misses repeatedly" },
  belief: { days: null, notes: "harvested from chat_importance" },
  contradiction: { days: null, notes: "until resolved by user" },
  brain_dump: { days: null, notes: "raw thoughts · pruned via dedup, not TTL" },
  meta_pattern: { days: null, notes: "patterns about patterns" },
  customer_stories: { days: null, notes: "anonymized invoice → content" },

  // ── LONG (180d) ──────────────────────────────────────────────
  nick_advice: { days: 180, notes: "Nick's responses · long-tail recall" },
  insight: { days: 180, notes: "AI-distilled insight" },
  pattern: { days: 180, notes: "detected behavioral pattern" },
  counter_intuitive: { days: 180, notes: "things Nour does opposite of advice" },

  // ── MEDIUM (90d) ─────────────────────────────────────────────
  // 2026-08-18 · explicit policy (was silently on the 90d default).
  // reply_judgment rows are one-shot records (`judge_<messageId>` is
  // never re-seen), so remember()'s 24h-until-reinforced probation was
  // erasing every judgment within a day — witnessed: only 22 of the 200
  // most-recent replies still had rows, starving the persona-lane
  // census. memory-manager's ONE_SHOT_RECORD_CATEGORIES routes these
  // through this policy instead of the probation.
  reply_judgment: { days: 90, notes: "LLM-judge scores · one-shot records, no reinforcement path" },
  trajectory_judgment: { days: 90, notes: "GATE #4 · action-sequence grades · same one-shot shape as reply_judgment" },
  industry_intel: { days: 90, notes: "RSS pulls · still relevant for content" },
  content_performance: { days: 90, notes: "post engagement metrics" },
  // v10.0.529.106 · Wave 76 · content approval queue · 90d covers
  // the full publish cadence + lookback window for "what did I draft
  // last quarter" queries · rejected drafts soft-delete immediately
  // so the 90d only applies to approved/scheduled/published rows.
  content_draft: { days: 90, notes: "Wave 76 · approval queue · pending/approved/scheduled/published" },
  customer_lang_pref: { days: 90, notes: "language preference per customer" },
  customer_winback: { days: 90, notes: "winback message templates" },
  customer_cohort: { days: 90, notes: "RFM segmentation" },
  meeting_transcript: { days: 90, notes: "Fireflies pulls" },

  // ── SHORT (30d) ──────────────────────────────────────────────
  chat_summary: { days: 30, notes: "session distillation" },
  conversation_summary: { days: 30, notes: "rolling chat compression" },
  emotional_state: { days: 30, notes: "rolls over" },
  emotional_arc: { days: 30, notes: "per-week mood arc" },
  daily_synthesis: { days: 30, notes: "daily roll-up" },
  learning_velocity: { days: 30, notes: "skill-graduation rate" },
  prediction_streak: { days: 30, notes: "Ghost Nick win/loss streaks" },
  feedback: { days: 30, notes: "thumbs up/down on Nick replies" },
  narrator_feedback: { days: 30, notes: "narrator-specific feedback" },
  ai_assist: { days: 30, notes: "AI-assist invocations" },
  backlog_triage: { days: 30, notes: "weekly backlog decisions" },
  operating_rhythm: { days: 30, notes: "checkpoint adherence" },
  belief_refresh_report: { days: 30, notes: "weekly belief refresh stats" },
  data_source_probe: { days: 30, notes: "ingest cron probe results" },

  // ── TELEMETRIC (7d) ──────────────────────────────────────────
  system_alert: { days: 7, notes: "in-flight alerts · resolved or rolled" },
  system_health_digest: { days: 30, notes: "kept 30d for sparkline" },
  tool_embedding: { days: 7, notes: "tool catalog hash · rebuilt on changes" },
  schema_drift_alert: { days: 7, notes: "auto-resolves on next probe" },
  storage_quota_alert: { days: 7, notes: "rolls fast" },
  creation_spike_alert: { days: 7, notes: "rolls fast" },
  update_spike_alert: { days: 7, notes: "rolls fast" },
  brain_bus_alert: { days: 7, notes: "rolls fast" },
  correlation_alert: { days: 7, notes: "rolls fast" },
  decision_quality_drift: { days: 7, notes: "rolls fast" },

  // ── MARKER ROWS (1d) — idempotency only ──────────────────────
  alert_pushed: { days: 1, notes: "Telegram dedup marker" },
  error_pushed: { days: 1, notes: "Telegram dedup marker" },
  token_age_pushed: { days: 1, notes: "Telegram dedup marker" },
  bus_exhaustion_pushed: { days: 1, notes: "Telegram dedup marker" },
  memory_of_day_pick: { days: 1, notes: "daily pick anchor" },
  // v10.0.529.106 · Wave 66 · proactive-push idempotency markers ·
  // 2d TTL keeps a small window for retroactive debugging then ages out.
  proactive_push_sent: { days: 2, notes: "Wave 66 · per-slot per-day Telegram push dedup" },

  // ── DEPRECATED · cut over to typed tables · prune legacy rows ──
  // v10.0.529.106 · Wave 53 · these categories had Phase 1 dual-write
  // to typed tables from v10.0.194-198. As of Wave 53 the BrainMemory
  // writes have stopped · reads now go to the typed tables. The
  // historical rows here just need to age out · 7d is enough to keep
  // any rollback window alive without bloating the brain_memories
  // table forever. Once aged out, the rows hard-delete via the
  // data-cleanup cron's `purgeExpired` pass.
  tool_telemetry: { days: 7, notes: "v10.0.529.106 W53 · cut over to ToolTelemetry · pruning legacy rows" },
  autonomous_event: { days: 7, notes: "v10.0.529.106 W53 · cut over to AutonomousEvent · pruning legacy rows" },
  // provider_ping TTL entry removed 2026-07-30 — the category is extinct
  // (writer pruned wave-AE, typed table dropped #1228, zero live rows).
  telemetry_tool_verb: { days: 7, notes: "v10.0.529.106 W53 · cut over to ToolVerbRatio · pruning legacy rows" },
};

const DEFAULT_POLICY: CategoryTtlPolicy = {
  days: 90,
  notes: "default · 90d (override in POLICIES)",
};

/**
 * Get the TTL policy for a category. Returns the default if the
 * category isn't explicitly listed.
 */
export function getCategoryTtl(category: string): CategoryTtlPolicy {
  return POLICIES[category] ?? DEFAULT_POLICY;
}

/**
 * Compute the expiresAt date for a given category. null for
 * permanent categories.
 */
export function computeExpiresAt(category: string): Date | null {
  const p = POLICIES[category] ?? DEFAULT_POLICY;
  if (p.days === null) return null;
  return new Date(Date.now() + p.days * DAY);
}

/**
 * Bulk policy report for /api/system/ttl-policies (debugging).
 */
export function listAllPolicies(): Array<{
  category: string;
  days: number | null;
  notes: string;
}> {
  return Object.entries(POLICIES).map(([category, p]) => ({
    category,
    days: p.days,
    notes: p.notes,
  }));
}
