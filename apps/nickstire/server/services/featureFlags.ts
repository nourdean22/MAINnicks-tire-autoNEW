/**
 * Feature Flag Service — Controls automated systems
 * All customer-contacting automations MUST check their flag before executing.
 * Flags start DISABLED and are enabled one-by-one after testing.
 */

import { eq } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const log = createLogger("feature-flags");

// In-memory cache for performance (refreshed every 60s)
let flagCache: Map<string, boolean> = new Map();
let lastCacheRefresh = 0;
const CACHE_TTL_MS = 60_000;

/** All known flags and their descriptions */
export const FLAG_DEFINITIONS = [
  // ─── SMS & COMMUNICATION ──────────────────────────
  { key: "sms_appointment_reminders", description: "Send 24h/2h appointment reminder SMS" },
  { key: "sms_review_requests", description: "Auto-send review request SMS 3 days after service" },
  { key: "sms_retention_sequences", description: "Send 90/180/365 day re-engagement SMS" },
  { key: "ai_receptionist_enabled", description: "AI phone answering via Twilio Voice" },
  { key: "drip_campaigns_enabled", description: "Multi-step automated drip campaigns" },
  { key: "auto_review_responses", description: "AI-generated review response drafts" },
  { key: "predictive_maintenance_alerts", description: "Predictive maintenance SMS alerts" },
  { key: "email_marketing_campaigns", description: "Bulk email campaign sending" },
  { key: "gbp_auto_posting", description: "Auto-post to Google Business Profile" },
  { key: "sms_blast_enabled", description: "Bulk SMS campaign sending" },
  { key: "smart_sms_auto_reply", description: "Auto-reply to inbound SMS based on intent" },
  { key: "sms_cross_sell_outreach", description: "Proactive cross-sell SMS based on service history patterns" },
  { key: "service_affinity_v2_compute", description: "Service Affinity v2 prediction cron · writes per-customer predictions to service_affinity_predictions w/ 50/50 A/B arm split (treatment eligible for SMS · control hold-out for closed-loop measurement). Disabled until migration 0061 applied + operator verifies v2 quality." },
  { key: "auto_revenue_correction", description: "Auto-trigger winback when revenue behind pace" },
  { key: "vip_auto_recognition", description: "Auto-SMS new VIP customers with 10% off perk" },
  { key: "referral_loop_closer", description: "Auto-SMS both parties when referral converts" },
  { key: "weather_triggered_sms", description: "Auto-SMS lapsed customers on weather events" },
  { key: "retention_7day", description: "wave-181.47 · post-visit D7 check-in SMS (warm, no pitch)" },
  { key: "retention_14day", description: "wave-181.47 · post-visit D14 reactivation SMS (re-check + relief haiku)" },
  { key: "retention_45day", description: "Auto-SMS 45-day retention maintenance tip" },
  { key: "sms_auto_quote", description: "Auto-respond to inbound SMS price questions" },
  { key: "churn_prediction_alerts", description: "Telegram alerts for high-risk churn customers" },
  { key: "pricing_intelligence_alerts", description: "Telegram alerts for raise/lower pricing" },
  { key: "safety_monitor_enabled", description: "Telegram alerts for non-critical safety monitor warnings" },

  // NOTE: the 19 engine_* "control" flags were removed (admin-excellence wave).
  // They were DECORATIVE — no code ever called isEnabled() for them; the
  // intelligence engines run unconditionally. Existing DB rows are dropped by
  // drizzle/0066_drop_engine_flags.sql (hand-applied).

  // ─── EXPERIENCE FLAGS ─────────────────────────────
  { key: "fomo_ticker_enabled", description: "Live activity ticker on public site (X just booked...)" },
  { key: "dynamic_social_proof", description: "Real-time review quotes on service pages" },
  { key: "smart_exit_intent", description: "Exit-intent popup with personalized offer" },
  { key: "financing_pre_approval", description: "Pre-approval CTA before customer arrives" },
  { key: "drop_off_sms_flow", description: "Automated drop-off → status → pickup SMS sequence" },
  { key: "uber_integration_cta", description: "Suggest Uber/Lyft after drop-off" },

  // ─── ADMIN / CEO FLAGS ────────────────────────────
  { key: "live_telegram_feed", description: "Real-time closed job notifications to Telegram" },
  { key: "daily_wins_digest", description: "End-of-day wins summary to Telegram" },
  { key: "master_intelligence_report", description: "Master intelligence report in morning brief" },
  { key: "safety_monitor_telegram", description: "Safety monitor Telegram alerts for non-critical items" },

  // ─── NICKGPT (fine-tuned SMS drafter) ─────────────
  // Wave AE · routes SMS draft requests through Ollama-hosted fine-tuned
  // Llama-3.2-3B trained on operator-approved replies. OFF by default;
  // requires NICKGPT_OLLAMA_URL + NICKGPT_MODEL_NAME env vars + a
  // running Ollama service. Falls back to Claude/Venice when OFF or
  // when Ollama is unreachable. See docs/runbooks/nickgpt-finetune.md.
  { key: "nickgpt_drafter_enabled", description: "Use fine-tuned NickGPT 3B (Ollama) as SMS-draft engine; falls back to Claude/Venice when disabled or unreachable" },

  // ─── HuggingFace classifier pre-filters ───────────
  // Wave AF · tiny HF specialist models that pre-filter customer input
  // before expensive LLM calls. FAIL-OPEN: a classifier outage never
  // blocks customer flow · the caller proceeds as if no signal arrived.
  // Requires HF_API_KEY env var. See docs/runbooks/classifiers.md.
  { key: "classifier_prompt_injection_enabled", description: "Pre-screen VAPI + chat input via protectai/deberta-v3-base-prompt-injection-v2; flags 'ignore previous instructions' style attacks at the input boundary (fail-open)" },
  { key: "classifier_intent_routing_enabled", description: "Pre-classify inbound SMS intent via MoritzLaurer/deberta-v3-large-zeroshot-v2.0 (price · scheduling · complaint · opt-out · off-topic); routes to existing keyword parser as fallback" },

  // ─── XTTS-v2 cloned-voice outbound voicemail (Wave AI) ─
  // Generates audio in operator's cloned voice via Replicate (XTTS-v2)
  // or self-hosted Modal endpoint. ONLY generates audio · does NOT
  // place calls. The full outbound voicemail pipeline (Twilio Voice +
  // TCPA compliance + DNC list + cohort selection) is documented in
  // docs/runbooks/voice-clone-setup.md as operator next-steps.
  { key: "outbound_voicemail_enabled", description: "Allow voice-clone.ts cloneVoice() to generate cloned-voice audio for outbound voicemails. Requires REPLICATE_API_KEY (or XTTS_MODAL_URL) + XTTS_VOICE_SAMPLE_URL. OFF by default · turn on AFTER recording sample + verifying via checkVoiceCloneHealth" },

  // ─── Photo-damage MMS (Wave AZ) ───────────────────
  // Customer texts a photo (tire/brake/vehicle) · vision-analyzer.ts
  // describes the damage via Replicate Qwen2-VL · photo-assess-pipeline.ts
  // optionally drafts a reply via NickGPT (Wave AE) · sends via shop
  // gateway with { via: "shop" }. New revenue channel · OFF default.
  // Wired into Twilio MMS (NumMedia ≥ 1) + Capevace gateway
  // attachments + admin manual route /api/admin/photo-assess.
  { key: "photo_assess_enabled", description: "Photo-damage MMS pipeline · vision-analyzer + auto-reply. Requires REPLICATE_API_KEY (or HF_API_KEY for fallback). OFF default · enable after testing via /api/admin/photo-assess with skipSmsSend=true to verify model quality on sample photos" },
  { key: "legacy_autopost_live", description: "Allow live posting for legacy IG/FB autoposter instead of dry-run only" },
  { key: "nickgpt_low_risk_autosend_enabled", description: "Allow auto-sending low-risk AI SMS replies directly" },
  // PAUSE-SEMANTICS, DELIBERATELY INVERTED. Every other flag here is an
  // "enable" that must be switched ON. This one is an OFF-SWITCH for behaviour
  // that is ALREADY LIVE, so its polarity is reversed on purpose.
  //
  // isEnabled() fails closed — a missing row or any DB error returns false. On
  // an enable-flag that means "feature dies"; retrofitting one onto a live path
  // would have silently switched off a working customer touchpoint in prod
  // until a row was hand-inserted, and re-killed it on every DB blip. Named as
  // a PAUSE, false (the failure value) means "not paused" → keeps sending →
  // current behaviour preserved. The safe state and the failure state match.
  { key: "vapi_forward_followup_paused", description: "OFF-SWITCH (inverted). Set TRUE to STOP the immediate follow-up SMS sent when a VAPI call is forwarded to a human. Leave FALSE for normal operation — this path ships live and false is the safe default. Unlike the missed_call_recovery cron this fires straight off the webhook, so this is the only way to stop it without a redeploy." },
  // GLOBAL SMS PAUSE — same inverted PAUSE polarity as vapi_forward_followup_paused,
  // same rationale. This is the shop-wide emergency stop for automated customer
  // SMS: sendSms() HOLDS (durably queues) customer_marketing/customer_followup
  // sends while TRUE, and the delayed-queue drain also holds. Internal alerts
  // and customer_confirmation replies keep flowing. Read fresh (5s cache) via
  // services/smsControl.ts, not through the 60s isEnabled cache — an emergency
  // stop must land in seconds. Nothing is dropped: lifting the pause drains
  // the held queue through the normal window machinery.
  { key: "sms_global_pause", description: "OFF-SWITCH (inverted). Set TRUE to PAUSE all automated customer SMS shop-wide (marketing + follow-ups are durably queued, not dropped; confirmations and internal alerts still send). The first real kill switch for the F25e path — SMS_KILL_SWITCH env only ever gated the dead Twilio fallback." },
  { key: "missed_call_recovery", description: "Proactively text unconverted VAPI missed callers (last 24h) a 'sorry we missed you' follow-up. MASTER enable. Even ON, the cron runs in SHADOW (logs+Telegrams the audience, sends nothing) unless env MISSED_CALL_RECOVERY_SEND=1. Reuses the vapi_forwarded_call_followup type → full opt-out/quiet-hours/STOP-footer/caps compliance. TCPA: relationship follow-up to people who just called the business." },

  // ─── CREATIVE SKILL PACKS ─────────────────────────
  { key: "skill_ad_creative_enabled", description: "Augments staging of Meta Ads with localized hook strategies" },
  { key: "skill_reel_script_enabled", description: "Augments brief generation with fast-paced visual storytelling instructions" },
  { key: "skill_trend_topics_enabled", description: "Augments topic selection with GSC/Service Affinity data" },
] as const;

export type FlagKey = (typeof FLAG_DEFINITIONS)[number]["key"];

/** Check if a feature flag is enabled */
export async function isEnabled(key: FlagKey): Promise<boolean> {
  // Check cache first
  if (Date.now() - lastCacheRefresh < CACHE_TTL_MS && flagCache.has(key)) {
    return flagCache.get(key) || false;
  }

  try {
    await refreshCache();
    return flagCache.get(key) || false;
  } catch (err) {
    log.error("Failed to check feature flag", { key, error: (err as Error).message });
    return false; // Fail closed — disabled if we can't check
  }
}

/** Refresh the in-memory cache from DB */
async function refreshCache(): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { featureFlags } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return;

    const rows = await db.select().from(featureFlags);
    flagCache = new Map(rows.map((r: any) => [r.key, r.value]));
    lastCacheRefresh = Date.now();
  } catch (err) {
    // Use stale cache — log for visibility
    log.warn("[FeatureFlags] Cache refresh failed, using stale:", err instanceof Error ? err.message : err);
  }
}

/**
 * Flags that auto-enable on seed. These all have built-in safety:
 * - sms_review_requests: opt-out check + 1-per-customer cooldown
 * - sms_retention_sequences: opt-out + segment-based + 90/180/365 day gaps
 * - drip_campaigns_enabled: opt-out + step delays + max per run
 * - auto_review_responses: drafts only (admin approves before posting)
 * - gbp_auto_posting: generates to Telegram for manual post (no direct API)
 */
/**
 * All flags start DISABLED. Nour enables manually after QA review.
 * Use the admin Feature Flags panel (ShopDriver HQ) to toggle.
 */
const AUTO_ENABLE_FLAGS: string[] = [
  "skill_ad_creative_enabled",
  "skill_reel_script_enabled"
];

/** Seed all flags — idempotent (skips existing). High-value flags auto-enable. */
export async function seedFlags(): Promise<{ seeded: number; skipped: number }> {
  const { getDb } = await import("../db");
  const { featureFlags } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) return { seeded: 0, skipped: 0 };

  let seeded = 0;
  let skipped = 0;

  for (const flag of FLAG_DEFINITIONS) {
    const existing = await db.select().from(featureFlags).where(eq(featureFlags.key, flag.key)).limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const autoEnable = AUTO_ENABLE_FLAGS.includes(flag.key);
    await db.insert(featureFlags).values({
      key: flag.key,
      value: autoEnable,
      description: flag.description,
    });
    seeded++;
    log.info(`Feature flag seeded: ${flag.key} = ${autoEnable ? "ENABLED" : "DISABLED"}`);
  }

  log.info(`Feature flags: ${seeded} new, ${skipped} existing`);
  return { seeded, skipped };
}

/** Toggle a flag — admin use only */
export async function setFlag(key: FlagKey, value: boolean): Promise<void> {
  const { getDb } = await import("../db");
  const { featureFlags } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 2026-07-20 · This used to run the UPDATE and then set the cache
  // UNCONDITIONALLY. An UPDATE against a key with no row matches ZERO rows and
  // throws nothing, so a missing flag row produced a silent no-op that still
  // reported success AND poisoned the cache: the admin UI said "toggled", the
  // flag read as changed for up to CACHE_TTL_MS, then reverted on the next
  // refresh with no error anywhere.
  //
  // That is the failure mode of an off-switch — the operator believes an
  // outbound path is paused while it keeps sending. Insert the row if it is
  // missing (definitions are the source of truth), and only cache what was
  // actually persisted.
  const result = await db
    .update(featureFlags)
    .set({ value, updatedAt: new Date() })
    .where(eq(featureFlags.key, key));

  const affected = (result as unknown as { affectedRows?: number } | Array<{ affectedRows?: number }>);
  const rows = Array.isArray(affected) ? affected[0]?.affectedRows : affected?.affectedRows;

  if (rows === 0) {
    const def = FLAG_DEFINITIONS.find((f) => f.key === key);
    await db.insert(featureFlags).values({
      key,
      value,
      description: def?.description ?? null,
    });
    log.warn(`Feature flag row was MISSING and has been created: ${key} = ${value ? "ENABLED" : "DISABLED"}`);
  }

  flagCache.set(key, value);
  log.info(`Feature flag toggled: ${key} = ${value ? "ENABLED" : "DISABLED"}`);
}

/** Get all flags with current values */
export async function getAllFlags(): Promise<Array<{ key: string; value: boolean; description: string | null }>> {
  const { getDb } = await import("../db");
  const { featureFlags } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) return [];

  return db.select({ key: featureFlags.key, value: featureFlags.value, description: featureFlags.description }).from(featureFlags);
}
