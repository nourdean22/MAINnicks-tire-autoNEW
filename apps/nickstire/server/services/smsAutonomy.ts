/**
 * SMS Autonomy Ladder — the ONE central policy declaring how much freedom
 * every SMS automation has (2026-07-29, SMS Revenue Agent OS).
 *
 * THE LADDER
 *   0 observe_only   — may log/shadow; may not draft or send
 *   1 draft_only     — may produce drafts a human approves; never sends
 *   2 auto_reply     — may auto-send SAFE replies to a customer's own inbound
 *                      text (1:1 answer, never an initiation)
 *   3 auto_followup  — may initiate approved follow-up types (reminders,
 *                      confirmations, recovery touches) inside caps/gates
 *   4 armed_campaign — bulk/campaign sends; runs ONLY when explicitly armed
 *                      by the operator for that campaign (never on by default)
 *
 * WHAT THIS FILE IS
 * A typed registry: every automation declares its level, send class, evidence
 * requirement, caps, quiet-hours posture, opt-out behavior, human-takeover
 * behavior, and fallback. `smsAutonomyPolicy.test.ts` pins the invariants
 * (every declared automation has a valid level; nothing above its ceiling;
 * every level-3+ entry declares caps and fail-closed opt-out). The runtime
 * enforcement points are the existing rails — orchestrator rollout modes,
 * sendSms chokepoint gates (pause / global cap / per-phone cap / opt-out /
 * quiet hours / takeover), and per-automation feature flags. This registry is
 * the declared CEILING those rails must respect: `maxRolloutModeForLevel` is
 * consumed by the setRolloutMode router so an event type can never be flipped
 * to live_send above its declared autonomy.
 *
 * Registry edits are policy changes: PR-review them like one.
 */

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export type RolloutMode = "off" | "shadow" | "draft_only" | "live_send" | "legacy_passthrough";

export interface SmsAutomationPolicy {
  /** stable key — orchestrator event type or cron/service name */
  key: string;
  /** where the sends actually originate */
  path: "orchestrator" | "direct_sendSms" | "campaign_router";
  level: AutonomyLevel;
  sendClass: "customer_marketing" | "customer_followup" | "customer_confirmation" | "internal";
  /** what evidence must exist before this automation may act */
  evidenceRequirement: string;
  /** per-run / per-day bounds beyond the global rails */
  caps: string;
  /** true = held to the 8AM–8PM ET window (queue, not drop) */
  quietHours: boolean;
  /** how opt-out is honored (all customer classes ride sendSms's fail-closed index) */
  optOutBehavior: "fail_closed_index" | "not_applicable_internal";
  /** what happens when a human holds the thread */
  takeoverBehavior: "suppressed_at_chokepoint" | "drafts_for_operator" | "exempt_human_initiated" | "not_applicable_internal";
  /** what happens when the automation cannot run its happy path */
  fallback: string;
  /** feature flag / env gate that arms it, if any */
  armedBy?: string;
}

/**
 * Ceiling: the most permissive orchestrator rollout mode a level allows.
 * legacy_passthrough is deliberately capped at level 3 — it bypasses the
 * planner stack, so nothing campaign-grade may use it.
 */
export function maxRolloutModeForLevel(level: AutonomyLevel): RolloutMode {
  switch (level) {
    case 0: return "shadow";
    case 1: return "draft_only";
    case 2: return "live_send";
    case 3: return "live_send";
    case 4: return "live_send";
  }
}

const MODE_RANK: Record<RolloutMode, number> = {
  off: 0,
  shadow: 1,
  draft_only: 2,
  live_send: 3,
  legacy_passthrough: 3, // same privilege as live_send, different engine
};

/**
 * Privilege rank of a rollout mode — exported so consumers (the autonomy
 * census) compare modes with THIS table instead of keeping a copy that can
 * drift. Two copies of one policy list is two chances to be wrong.
 */
export function rolloutModeRank(mode: RolloutMode): number {
  return MODE_RANK[mode];
}

export function isRolloutModeAllowed(key: string, mode: RolloutMode): boolean {
  const policy = SMS_AUTOMATION_REGISTRY.find((p) => p.key === key);
  if (!policy) return true; // unknown event types keep legacy behavior; the parity test keeps this set complete
  return MODE_RANK[mode] <= MODE_RANK[maxRolloutModeForLevel(policy.level)];
}

export const SMS_AUTOMATION_REGISTRY: readonly SmsAutomationPolicy[] = [
  // ─── Orchestrated event types (rollout-mode governed) ─────────────
  {
    key: "inbound_sms",
    path: "orchestrator",
    level: 2,
    sendClass: "customer_followup",
    evidenceRequirement: "customer's own inbound text + loaded context; router risk must be deterministic/human_assisted with confidence ≥0.85; safety/complaint/legal intents force human",
    caps: "per-phone 8/day (5-min cooldown waived for 1:1 replies) · global 24h cap",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "drafts_for_operator",
    fallback: "draft to human review queue (sms_response_jobs keeps the obligation alive)",
  },
  {
    key: "vapi_confirmation",
    path: "orchestrator",
    level: 3,
    sendClass: "customer_confirmation",
    evidenceRequirement: "a real VAPI call the customer just made (vapiCallId)",
    caps: "1 per call event",
    quietHours: false, // transactional confirmation of the customer's own action
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "exempt_human_initiated",
    fallback: "assistant reads the info aloud on the call (degraded path)",
  },
  {
    key: "vapi_forwarded_call_followup",
    path: "orchestrator",
    level: 3,
    sendClass: "customer_followup",
    evidenceRequirement: "a forwarded VAPI call record",
    caps: "1 per call · pausable via vapi_forward_followup_paused",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "no send; call log remains the record",
    armedBy: "vapi_forward_followup_paused (inverted pause)",
  },
  {
    key: "after_hours_capture",
    path: "orchestrator",
    level: 3,
    sendClass: "customer_followup",
    evidenceRequirement: "lead/booking/callback row the customer just created after hours",
    caps: "1 per capture",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "queued to next window; the captured row is the durable obligation",
  },
  {
    key: "stale_lead_followup",
    path: "orchestrator",
    level: 3,
    sendClass: "customer_followup",
    evidenceRequirement: "lead row 2–24h old, uncontacted, non-careers, opt-out filtered; at-most-once claim (new→contacted)",
    caps: "20 per run · business hours 8–18 ET · flag smart_sms_auto_reply",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: ">24h leads go to the Decision Inbox as stale_lead opportunities (collectStaleLeads) — surfaced, never surprise-texted",
    armedBy: "smart_sms_auto_reply",
  },
  {
    key: "abandoned_form_recovery",
    path: "orchestrator",
    level: 3,
    sendClass: "customer_followup",
    evidenceRequirement: "abandoned form row with the customer's own phone",
    caps: "1 per abandonment",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "no send",
  },
  {
    key: "booking_reminder",
    path: "orchestrator",
    level: 3,
    sendClass: "customer_confirmation",
    evidenceRequirement: "a real booking row (bookingId); maintenance-reminder variant is customer_marketing-classed",
    caps: "per reminder type per booking",
    quietHours: false, // confirmation class; maintenance variant queues via marketing class
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "no send; booking stands",
  },
  {
    key: "review_request",
    path: "orchestrator",
    level: 3,
    sendClass: "customer_marketing",
    evidenceRequirement: "completed service; no gating/incentives (FTC); cooldown per customer",
    caps: "daily cap + cooldown + settings.enabled + flag sms_review_requests",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "skipped; complaint replies create review_recovery opportunities instead",
    armedBy: "sms_review_requests",
  },
  {
    key: "manual_admin_reply",
    path: "orchestrator",
    level: 1, // human IS the sender; the automation only drafts/relays
    sendClass: "customer_followup",
    evidenceRequirement: "operator typed/approved the exact message",
    caps: "operator-driven",
    quietHours: false,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "exempt_human_initiated",
    fallback: "error surfaced to operator",
  },
  {
    key: "photo_assess_reply",
    path: "orchestrator",
    level: 1, // vision pipeline drafts; live send requires photo_assess_enabled arming
    sendClass: "customer_followup",
    evidenceRequirement: "customer-sent MMS photo + vision analysis",
    caps: "1 per photo · flag photo_assess_enabled",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "drafts_for_operator",
    fallback: "draft only",
    armedBy: "photo_assess_enabled",
  },

  // ─── Direct-sendSms crons/services (flag-armed) ───────────────────
  {
    key: "missed_call_recovery",
    path: "direct_sendSms",
    level: 3,
    sendClass: "customer_followup",
    evidenceRequirement: "unconverted VAPI call in the last 24h (tested pure eligibility); shadow unless MISSED_CALL_RECOVERY_SEND=1",
    caps: "cron batch cap · durable claim-before-send",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "shadow mode (logs + Telegram, no sends)",
    armedBy: "missed_call_recovery + MISSED_CALL_RECOVERY_SEND=1",
  },
  {
    key: "declined_work_recovery",
    path: "direct_sendSms",
    level: 3,
    sendClass: "customer_followup",
    evidenceRequirement: "unresolved ALG estimate; evidence-routed track (stated_concern beats profiles); 15% holdout never contacted; closed signals stop the sequence",
    caps: "1–3 adaptive touches per estimate · FEATURE_DECLINED_RECOVERY=1",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "dry-run + daily Telegram nag when unarmed",
    armedBy: "FEATURE_DECLINED_RECOVERY=1",
  },
  {
    key: "cross_sell_outreach",
    path: "direct_sendSms",
    level: 3,
    sendClass: "customer_marketing",
    evidenceRequirement: "service-affinity prediction ≥0.5 (treatment arm only); honest soft copy — deliberately not a diagnosis",
    caps: "10 per run · 30d per-customer cooldown · flag sms_cross_sell_outreach",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "no send; impression rows still close the loop",
    armedBy: "sms_cross_sell_outreach",
  },
  {
    key: "retention_sequences",
    path: "direct_sendSms",
    level: 3,
    sendClass: "customer_marketing",
    evidenceRequirement: "real prior visit at the 7/14/45/90/180/365-day mark",
    caps: "per-segment gaps · flags retention_* / sms_retention_sequences",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "no send",
    armedBy: "sms_retention_sequences",
  },
  {
    key: "drip_campaigns",
    path: "direct_sendSms",
    level: 4,
    sendClass: "customer_marketing",
    evidenceRequirement: "operator-created campaign with explicit audience; step delays",
    caps: "max-per-run + step delays · flag drip_campaigns_enabled",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "campaign pauses",
    armedBy: "drip_campaigns_enabled",
  },
  {
    key: "winback_bulk",
    path: "campaign_router",
    level: 4,
    sendClass: "customer_marketing",
    evidenceRequirement: "operator-armed winback with Telegram gate; 300 cap (bulk-sms bridge contract)",
    caps: "300 per campaign · Telegram-gated arming",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "pause = unset flag",
    armedBy: "operator arming (bulk-sms bridge)",
  },
  {
    key: "sms_blast",
    path: "campaign_router",
    level: 4,
    sendClass: "customer_marketing",
    evidenceRequirement: "operator-composed campaign; campaignEligiblePhoneSql audience",
    caps: "flag sms_blast_enabled · per-campaign audience",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "suppressed_at_chokepoint",
    fallback: "not sent",
    armedBy: "sms_blast_enabled",
  },
  {
    key: "opportunity_draft_bridge",
    path: "direct_sendSms",
    level: 1,
    sendClass: "customer_followup",
    evidenceRequirement: "a live Decision-Inbox opportunity with consent_ok=1; draft runs preflight guard + humanize; operator edits/approves EVERY send",
    caps: "operator-tapped, one at a time; all chokepoint gates apply on send",
    quietHours: true,
    optOutBehavior: "fail_closed_index",
    takeoverBehavior: "exempt_human_initiated",
    fallback: "draft only — no approve, no send",
  },

  // ─── Internal (operator-facing, zero TCPA surface) ────────────────
  {
    key: "internal_alerts",
    path: "direct_sendSms",
    level: 3,
    sendClass: "internal",
    evidenceRequirement: "operational event (gateway offline, safety alert, daily digest)",
    caps: "none — an outage must not silence its own alarm",
    quietHours: false,
    optOutBehavior: "not_applicable_internal",
    takeoverBehavior: "not_applicable_internal",
    fallback: "Telegram",
  },
] as const;

export function getAutomationPolicy(key: string): SmsAutomationPolicy | undefined {
  return SMS_AUTOMATION_REGISTRY.find((p) => p.key === key);
}

/** Ops-surface summary: level + arming per automation, one line each. */
export function summarizeAutonomy(): Array<{
  key: string;
  level: AutonomyLevel;
  path: SmsAutomationPolicy["path"];
  sendClass: SmsAutomationPolicy["sendClass"];
  armedBy: string | null;
}> {
  return SMS_AUTOMATION_REGISTRY.map((p) => ({
    key: p.key,
    level: p.level,
    path: p.path,
    sendClass: p.sendClass,
    armedBy: p.armedBy ?? null,
  }));
}
