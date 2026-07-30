/**
 * Retention policy — documents + lightly extends the policy enforced by
 * `app/api/cron/data-cleanup/route.ts` (Sunday 3am UTC).
 *
 * The cron is the authoritative executor. This file is the human-readable
 * map of WHAT is retained and WHY so future changes are conscious.
 *
 * Philosophy:
 *   · `forever` — never delete (brain, conversations, audit).
 *   · N days    — truncate where createdAt < now - N.
 *   · `keep:`   — guardrails for specific rows (e.g. last success per cron).
 */

export type Retention = {
  model: string;
  days: number | "forever";
  why: string;
  keep?: string;
  enforcedBy: "data-cleanup" | "none" | "confidence-decay";
};

export const RETENTION: Retention[] = [
  // ── NEVER prune (brain + audit) ───────────────────────────────────
  { model: "BrainMemory",      days: "forever", why: "Brain long-term memory. Decays via confidence, not deletion. GC runs on expiresAt / confidence<0.1 after 30d stale.", enforcedBy: "confidence-decay" },
  { model: "ChatMessage",      days: "forever", why: "Conversation corpus — the brain's primary training signal.", enforcedBy: "none" },
  { model: "ChatConversation", days: "forever", why: "Conversation headers must outlive any of their messages.", enforcedBy: "none" },
  { model: "AutonomousAction", days: "forever", why: "Audit trail of autonomous Nick actions. Delete only via explicit rollback UI.", enforcedBy: "none" },
  { model: "SessionReport",    days: "forever", why: "Weekly/monthly review snapshots. Small volume, high value.", enforcedBy: "none" },
  { model: "DecisionReplay",   days: "forever", why: "Decision history drives Ghost-Nour calibration.", enforcedBy: "none" },
  { model: "IdentitySnapshot", days: "forever", why: "8-axis self-model timeline.", enforcedBy: "none" },

  // ── Cron: enforced by data-cleanup ─────────────────────────────────
  { model: "SystemMetric",     days: 90,  why: "Hot metrics window. Roll-ups feed /system/ai-cost + /system/requests.", enforcedBy: "data-cleanup" },
  { model: "ApiRequestLog",    days: 30,  why: "Debugging window. Volume aggregates live in SystemMetric beyond this.", enforcedBy: "data-cleanup" },
  { model: "ErrorLog",         days: 30,  why: "Recurring-error detection window.", enforcedBy: "data-cleanup" },
  { model: "DeviceEvent",      days: 90,  why: "Device anomaly detection. Shorter = blind to weekly patterns.", enforcedBy: "data-cleanup" },
  { model: "NotificationQueue", days: 30, why: "Delivered/failed/cancelled only. PENDING rows never deleted.", enforcedBy: "data-cleanup", keep: "status not in (sent, failed, cancelled)" },
  { model: "IntegrationSyncLog", days: 90, why: "Integration health over 90d.", enforcedBy: "data-cleanup" },
  { model: "LocalSyncLog",     days: 90,  why: "Bridge sync receipts.", enforcedBy: "data-cleanup" },
  { model: "AuditEvent",       days: 90,  why: "Tiered: noisy heartbeat 14d, cron:* 60d, brain_insight 180d, default 90d.", enforcedBy: "data-cleanup", keep: "tiered by eventType" },

  // ── Cron: NEW in v11.0 ────────────────────────────────────────────
  { model: "CronJobLog",       days: 30,  why: "30d history drives /system/crons success-rate calc.", enforcedBy: "data-cleanup", keep: "last success + last failure per jobName forever" },
  { model: "StateLog",         days: 30,  why: "State transitions beyond 30d roll into IdentitySnapshot.", enforcedBy: "data-cleanup" },
  { model: "SituationLog",     days: 90,  why: "Ultron situation history — 90d covers trend widgets.", enforcedBy: "data-cleanup" },
  { model: "DeviceCommand",    days: 30,  why: "Completed commands only. PENDING/FAILED rows kept forever.", enforcedBy: "data-cleanup", keep: "status != completed" },
  { model: "RecoveryActionLog", days: 90, why: "Recovery pattern analysis window.", enforcedBy: "data-cleanup" },
  { model: "ReviewLog",        days: 365, why: "One year of recency for rhythm analysis.", enforcedBy: "data-cleanup" },

  // ── v10.0.199 · TTL retention pass ────────────────────────────────
  { model: "AgentTrace",       days: 30,  why: "Per-AI-call trace. 30d hot covers all dashboards.", enforcedBy: "data-cleanup" },
  { model: "AutonomousEvent",  days: 90,  why: "Per-rule-fire event log (extracted v10.0.198).", enforcedBy: "data-cleanup" },
  { model: "ToolVerbRatio",    days: 30,  why: "Per-turn fab-defense signal (extracted v10.0.197).", enforcedBy: "data-cleanup" },
];

/**
 * BrainMemory category retention — these are ROW-level sweeps within
 * the BrainMemory table, not table-level. Useful categories grow
 * fast but are only valuable in a windowed view (30-90d). The
 * durable categories (identity_snapshot, beliefs, decisions, pinned)
 * are ABSENT from this list — they persist forever via confidence-
 * decay, not time-based truncation.
 *
 * enforcedBy: "data-cleanup" cron (Sunday 3am UTC). Each sweep
 * writes its deletion count to CronJobLog via deletedByTable.
 */
export interface BrainMemoryRetention {
  category: string;
  days: number;
  why: string;
}

export const BRAIN_MEMORY_RETENTION: BrainMemoryRetention[] = [
  { category: "reply_quality",   days: 60,  why: "low-score post-stream logs, trend window only" },
  { category: "nick_quality",    days: 90,  why: "all-critic scorecards, 90d feeds /system/quality" },
  { category: "reply_scorecard", days: 90,  why: "legacy alias for nick_quality" },
  { category: "cron_control",    days: 365, why: "kill-switch history — 1yr is plenty" },
  { category: "power_panel",     days: 365, why: "settings snapshots — keep last year only" },
  // NEVER in this list (compounds forever):
  //   identity_snapshot · brain_insight · anti_pattern · decision_pattern
  //   spaced_review · pinned · belief · contradiction
];

export function retentionCutoff(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}
