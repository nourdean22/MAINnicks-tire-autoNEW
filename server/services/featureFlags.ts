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
  { key: "auto_revenue_correction", description: "Auto-trigger winback when revenue behind pace" },
  { key: "vip_auto_recognition", description: "Auto-SMS new VIP customers with 10% off perk" },
  { key: "referral_loop_closer", description: "Auto-SMS both parties when referral converts" },
  { key: "weather_triggered_sms", description: "Auto-SMS lapsed customers on weather events" },
  { key: "retention_45day", description: "Auto-SMS 45-day retention maintenance tip" },
  { key: "sms_auto_quote", description: "Auto-respond to inbound SMS price questions" },
  { key: "churn_prediction_alerts", description: "Telegram alerts for high-risk churn customers" },
  { key: "pricing_intelligence_alerts", description: "Telegram alerts for raise/lower pricing" },
  { key: "safety_monitor_enabled", description: "Telegram alerts for non-critical safety monitor warnings" },

  // ─── ENGINE CONTROL: CUSTOMER INTELLIGENCE ────────
  { key: "engine_churn_prediction", description: "Churn prediction engine (5-factor model)" },
  { key: "engine_repeat_visit_predictor", description: "Predict when customers are due back" },
  { key: "engine_customer_risk_scores", description: "Unified 0-100 customer risk scoring" },
  { key: "engine_value_trend", description: "Track customer ticket size trends" },
  { key: "engine_service_affinity", description: "Per-customer service preference mapping" },

  // ─── ENGINE CONTROL: REVENUE INTELLIGENCE ─────────
  { key: "engine_revenue_anomaly", description: "Detect unusual revenue spikes or dips" },
  { key: "engine_cash_flow_forecast", description: "7/30-day cash flow projections" },
  { key: "engine_profit_margins", description: "Gross margin analysis per service" },
  { key: "engine_pricing_intelligence", description: "Approval rate monitoring + raise/lower alerts" },
  { key: "engine_seasonal_demand", description: "Seasonal service demand forecasting" },

  // ─── ENGINE CONTROL: OPERATIONS INTELLIGENCE ──────
  { key: "engine_tech_efficiency", description: "Technician performance scoring" },
  { key: "engine_capacity_forecast", description: "Tomorrow/next week shop load prediction" },
  { key: "engine_turnaround_time", description: "Service completion time tracking" },
  { key: "engine_no_show_predictor", description: "Booking no-show risk scoring" },

  // ─── ENGINE CONTROL: MARKETING INTELLIGENCE ───────
  { key: "engine_channel_roi", description: "Lead source ROI analysis" },
  { key: "engine_review_velocity", description: "Review growth rate tracking" },
  { key: "engine_lead_response_time", description: "Speed-to-lead monitoring" },
  { key: "engine_content_performance", description: "Page-to-lead conversion tracking" },
  { key: "engine_competitor_monitor", description: "Competitor rating/review tracking" },

  // ─── EXPERIENCE FLAGS ─────────────────────────────
  { key: "fomo_ticker_enabled", description: "Live activity ticker on public site (X just booked...)" },
  { key: "dynamic_social_proof", description: "Real-time review quotes on service pages" },
  { key: "smart_exit_intent", description: "Exit-intent popup with personalized offer" },
  { key: "financing_pre_approval", description: "Pre-approval CTA before customer arrives" },
  { key: "drop_off_sms_flow", description: "Automated drop-off → status → pickup SMS sequence" },
  { key: "uber_integration_cta", description: "Suggest Uber/Lyft after drop-off" },

  // ─── AUTOMATION KILL SWITCHES ─────────────────────
  { key: "auto_invoice_on_completion", description: "Auto-create invoice when booking is marked completed" },

  // ─── ADMIN / CEO FLAGS ────────────────────────────
  { key: "live_telegram_feed", description: "Real-time closed job notifications to Telegram" },
  { key: "daily_wins_digest", description: "End-of-day wins summary to Telegram" },
  { key: "master_intelligence_report", description: "Master intelligence report in morning brief" },
  { key: "safety_monitor_telegram", description: "Safety monitor Telegram alerts for non-critical items" },
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
    console.warn("[FeatureFlags] Cache refresh failed, using stale:", err instanceof Error ? err.message : err);
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
 * Exception: auto_invoice_on_completion starts ENABLED (preserves existing behavior).
 * Nour can disable it instantly from the Feature Flags panel if invoicing breaks.
 */
const AUTO_ENABLE_FLAGS: string[] = ["auto_invoice_on_completion"];

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

  await db.update(featureFlags).set({ value, updatedAt: new Date() }).where(eq(featureFlags.key, key));
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
