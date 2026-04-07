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
const AUTO_ENABLE_FLAGS: string[] = [
  "sms_review_requests",
  "sms_retention_sequences",
  "drip_campaigns_enabled",
  "auto_review_responses",
  "gbp_auto_posting",
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

  // Auto-enable high-value flags that were previously seeded as disabled
  let enabled = 0;
  for (const key of AUTO_ENABLE_FLAGS) {
    const current = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    if (current.length > 0 && !current[0].value) {
      await db.update(featureFlags).set({ value: true, updatedAt: new Date() }).where(eq(featureFlags.key, key));
      flagCache.set(key, true);
      enabled++;
      log.info(`Feature flag auto-enabled: ${key}`);
    }
  }

  log.info(`Feature flags: ${seeded} new, ${skipped} existing, ${enabled} auto-enabled`);
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
