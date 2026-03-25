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
    flagCache = new Map(rows.map(r => [r.key, r.value]));
    lastCacheRefresh = Date.now();
  } catch {
    // Silent — use stale cache
  }
}

/** Seed all flags as DISABLED — idempotent (skips existing) */
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

    await db.insert(featureFlags).values({
      key: flag.key,
      value: false,
      description: flag.description,
    });
    seeded++;
    log.info(`Feature flag seeded: ${flag.key} = DISABLED`);
  }

  log.info(`Feature flags seeded: ${seeded} new, ${skipped} already existed`);
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
