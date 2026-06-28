/**
 * Cron: Retention Sequences — 45/90/180/365 day re-engagement SMS
 *
 * Sends personalized SMS to customers who haven't visited in a while.
 * Each tier has a unique message with the customer's name and vehicle.
 *
 * Rules:
 * - Only customers with a phone number
 * - Only between 9am-6pm ET
 * - Skip customers with a pending booking
 * - Skip customers who opted out of SMS
 * - Track which tier was sent (don't double-send same tier)
 * - Gated behind sms_retention_sequences feature flag
 * - Logged to sms_messages table
 */
import { createLogger } from "../../lib/logger";
import { eq, and, isNotNull, sql, isNull, or, inArray } from "drizzle-orm";
import { STORE_PHONE } from "@shared/const";
import { withOptOut } from "../../sms";
import type { FlagKey } from "../../services/featureFlags";

import { BUSINESS } from "@shared/business";
const log = createLogger("cron:retention");

// ─── RETENTION TIERS ─────────────────────────────────
interface MessageVariant {
  /** Bucket label persisted to sms_messages.variantKey ("v1" / "v2" / etc.) */
  key: string;
  /** Message builder — receives firstName and vehicle string */
  build: (firstName: string, vehicle: string) => string;
}

interface RetentionTier {
  days: number;
  /** Day range: match customers whose last visit was between minDays..maxDays ago */
  minDays: number;
  maxDays: number;
  /** Feature flag(s) that must be enabled */
  flags: FlagKey[];
  /**
   * Message copy. EITHER:
   *   `message` — single fixed string (no A/B test)
   *   `variants` — array of {key, build}; we hash customerId to pick.
   *                When set, the selected variant key is persisted to
   *                sms_messages.variantKey for read-out in the admin tile.
   * Exactly one of these must be set.
   */
  message?: (firstName: string, vehicle: string) => string;
  variants?: MessageVariant[];
}

// wave-181.46 brand-voice tightening per .claude/brand-voice-guidelines.md:
//   - "free inspection" (KILL LIST) → "free check"
//   - "same great service" (KILL LIST "great") → "same shop, same line, same fair price"
//   - Added the Repair Haiku ("you don't pay until you say yes") to D180
//     where the customer's resistance is highest (long gap → assume bad memory)
//   - Tightened openers: "Hey {name}" (warmer, matches Brian's VAPI cadence)
//     dropped exclamation marks (less "marketing-y", more shop-floor)
//
// wave-181.47 — added D7 + D14 tiers per growth-engine onboarding framework.
// The first 14 days post-visit had ZERO touchpoints (next was D45) — that's
// the highest-recall window and we were silent. D7 = post-work check-in (warm,
// no pitch). D14 = active reactivation if anything didn't take ("free re-check,
// you don't pay until you say yes"). Both gated by separate flags so Nour can
// roll out cautiously then promote to the main sequence flag.
const RETENTION_TIERS: RetentionTier[] = [
  {
    days: 7,
    minDays: 5,
    maxDays: 9,
    flags: ["sms_retention_sequences", "retention_7day"],
    message: (name, _vehicle) =>
      `Hey ${name.split(" ")[0] || "there"}, quick check-in from Nick's Tire & Auto. How's everything running after the work? We stand behind it, so reply here if you need anything.`,
  },
  {
    days: 14,
    minDays: 12,
    maxDays: 16,
    flags: ["sms_retention_sequences", "retention_14day"],
    message: (name, _vehicle) =>
      `Hey ${name.split(" ")[0] || "there"}, two weeks in. Want a second look at anything from the work? The check is free and you don't pay until you say yes. ${STORE_PHONE}`,
  },
  {
    days: 45,
    minDays: 40,
    maxDays: 50,
    flags: ["sms_retention_sequences", "retention_45day"],
    message: (name, _vehicle) =>
      `Hey ${name.split(" ")[0] || "there"}, about that time for an oil change or tire check? conventional is $49, synthetic is $80. Walk in any day, first-come, first-served. ${STORE_PHONE}\n\nReply STOP to opt out.`,
  },
  {
    days: 90,
    minDays: 85,
    maxDays: 95,
    flags: ["sms_retention_sequences"],
    message: (name, _vehicle) =>
      `Hey ${name.split(" ")[0] || "there"}, been about 3 months. Worth a quick check whenever it's easy — free check, written quote, you don't pay until you say yes. Drop it off any day. (216) 862-0005\n\nReply STOP to opt out.`,
  },
  {
    days: 180,
    minDays: 175,
    maxDays: 185,
    flags: ["sms_retention_sequences"],
    message: (name, _vehicle) =>
      `Hey ${name.split(" ")[0] || "there"}, six months since we saw you. Free check, written quote, you don't pay until you say yes. Pull up any day. ${STORE_PHONE}\n\nReply STOP to opt out.`,
  },
  {
    days: 365,
    minDays: 360,
    maxDays: 370,
    flags: ["sms_retention_sequences"],
    message: (name, _vehicle) =>
      `Hey ${name.split(" ")[0] || "there"}, been about a year — worth a once-over whenever you're ready. Same shop, same fair pricing, walk in any day. ${STORE_PHONE}\n\nReply STOP to opt out.`,
  },
];

// ─── TIME GUARD ──────────────────────────────────────
/** Only send retention SMS between 9am-6pm ET */
function isWithinRetentionHours(): boolean {
  const etHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }),
    10,
  );
  return etHour >= 9 && etHour < 18;
}

// ─── SMS LOGGING ─────────────────────────────────────
// wave-181.51 — delegate to the shared smsInstrumentation.logOutboundSms
// so retention, declined-recovery, and cross-sell all write the same
// shape (incl. variantKey). Keep this thin wrapper for call-site clarity.
async function logRetentionSms(
  phone: string,
  body: string,
  result: { success?: boolean; sid?: string | null; queued?: boolean } | null | undefined,
  variantKey?: string,
): Promise<void> {
  const { logOutboundSms } = await import("../../services/smsInstrumentation");
  await logOutboundSms(phone, body, result, variantKey);
}

// ─── CORE PROCESSOR ──────────────────────────────────
/**
 * Process a single retention tier.
 * Returns count of customers contacted.
 */
async function processRetentionTier(tier: RetentionTier): Promise<number> {
  // wave-181.60-followup (audit-181.58 finding · 2026-05-18 PM) · the
  // legacy Twilio env guard was blocking all 6 retention tiers in prod
  // because Twilio is dead per operator and env vars are intentionally
  // unset on Railway. All actual sends below use `{ via: "shop" }` →
  // F25e directly · no Twilio creds needed. Guard removed.

  // 2. Check feature flags
  const { isEnabled } = await import("../../services/featureFlags");
  for (const flag of tier.flags) {
    if (!(await isEnabled(flag))) return 0;
  }

  // 3. Check sending hours (9am-6pm ET)
  if (!isWithinRetentionHours()) {
    log.info(`Retention ${tier.days}d: outside sending hours (9am-6pm ET), skipping`);
    return 0;
  }

  const { getDb } = await import("../../db");
  const { customers, bookings } = await import("../../../drizzle/schema");
  const { sendSms } = await import("../../sms");
  const db = await getDb();
  if (!db) return 0;

  // 4. Find eligible customers:
  //    - Has phone, has lastVisitDate
  //    - Not opted out of SMS
  //    - Last visit in the right day range
  //    - Haven't already received this tier (or a higher tier)
  //    Note: lastRetentionTier < tier.days means they haven't hit this tier yet.
  //    NULL lastRetentionTier means never contacted for retention.
  const targets = await db
    .select({
      id: customers.id,
      firstName: customers.firstName,
      phone: customers.phone,
      vehicleYear: customers.vehicleYear,
      vehicleMake: customers.vehicleMake,
      vehicleModel: customers.vehicleModel,
      lastRetentionTier: customers.lastRetentionTier,
    })
    .from(customers)
    .where(
      and(
        isNotNull(customers.lastVisitDate),
        isNotNull(customers.phone),
        eq(customers.smsOptOut, 0),
        sql`DATEDIFF(CURDATE(), ${customers.lastVisitDate}) BETWEEN ${tier.minDays} AND ${tier.maxDays}`,
        // Only send if they haven't already received this tier or higher
        or(
          isNull(customers.lastRetentionTier),
          sql`${customers.lastRetentionTier} < ${tier.days}`,
        ),
      ),
    )
    .limit(100);

  if (targets.length === 0) return 0;

  // 5. Batch-check for pending bookings — exclude customers who already have one
  //    A "pending" booking = status is new or confirmed
  const targetPhones: string[] = targets.map((t: { phone: string }) => t.phone);
  const pendingBookingsResult = await db
    .select({ phone: bookings.phone })
    .from(bookings)
    .where(
      and(
        inArray(bookings.phone, targetPhones),
        inArray(bookings.status, ["new", "confirmed"]),
      ),
    );

  const phonesWithPendingBooking = new Set(
    pendingBookingsResult.map((b: { phone: string }) => b.phone.replace(/\D/g, "").slice(-10)),
  );

  let processed = 0;
  let perRowErrors = 0;
  for (const c of targets) {
    // wave-117 — per-customer try/catch. Was: a Twilio error on customer
    // N (e.g. invalid number, network blip) threw and aborted ALL
    // remaining customers in the loop, leaving high-value retention
    // candidates unprocessed silently. Now contained per row: log +
    // continue.
    try {
      if (!c.phone) continue;

      // Skip customers with a pending booking
      const normalizedPhone = c.phone.replace(/\D/g, "").slice(-10);
      if (phonesWithPendingBooking.has(normalizedPhone)) {
        continue;
      }

      // Build vehicle string
      const vehicleParts = [c.vehicleYear, c.vehicleMake, c.vehicleModel].filter(Boolean);
      const vehicle = vehicleParts.length > 0 ? vehicleParts.join(" ") : "vehicle";

      const firstName = c.firstName || "there";

      // wave-181.51 — pick A/B variant when tier.variants is set, else use
      // the legacy single-message path. variantKey is persisted to
      // sms_messages.variantKey for the /admin SMS Performance tile.
      //
      // variantKey doubles as the per-tier campaign label:
      //   no A/B test   → "retention_d7"           (just the tier)
      //   with A/B test → "retention_d7_v1" / "_v2" (tier + bucket)
      // The admin tile groups by prefix so per-tier stats roll up cleanly.
      const tierKey = `retention_d${tier.days}`;
      let messageBody: string;
      let variantKey: string;
      if (tier.variants && tier.variants.length > 0) {
        const { selectVariant } = await import("../../services/smsInstrumentation");
        const picked = selectVariant(c.id, tier.variants.map((v) => ({ key: v.key, payload: v.build })));
        // TCPA/CTIA: retention SMS is bulk promo — append the STOP footer
        // (idempotent; withOptOut no-ops if the body already carries one).
        messageBody = withOptOut(picked.payload(firstName, vehicle));
        variantKey = `${tierKey}_${picked.key}`;
      } else if (tier.message) {
        messageBody = withOptOut(tier.message(firstName, vehicle));
        variantKey = tierKey;
      } else {
        // Misconfigured tier — skip rather than send empty SMS
        log.warn(`Retention ${tier.days}d tier has neither message nor variants, skipping customer #${c.id}`);
        continue;
      }

      // At-most-once claim — advance the retention marker BEFORE sending.
      // If the run crashes (or this UPDATE fails) after the text goes out,
      // the row is already advanced, so the next daily run won't re-text
      // the customer. The conditional WHERE also makes two overlapping
      // runs safe — only one wins the claim.
      const claimRes = await db
        .update(customers)
        .set({ lastRetentionTier: tier.days, lastRetentionDate: new Date() })
        .where(and(
          eq(customers.id, c.id),
          or(isNull(customers.lastRetentionTier), sql`${customers.lastRetentionTier} < ${tier.days}`),
        ));
      if (((claimRes as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 0) {
        continue; // already claimed by an overlapping run — never re-send
      }

      // wave-181.46 · route through F25e gateway (operator decision: Twilio
      // is dead, Android phone is THE path). { via: "shop" } bypasses the
      // SMS_KILL_SWITCH (Twilio-only) and sends through the F25e on Verizon
      // so customers see the text from the shop's real number 216-862-0005.
      const result = await sendSms(c.phone, messageBody, { via: "shop", skipPersist: true, variantKey });

      // Log to sms_messages table. wave-2026-06 (telemetry dedup) — when the
      // send was QUEUED (outside-hours / gateway-offline) queueForLater
      // already wrote ONE durable row carrying `variantKey`; logging again
      // here would double-count it (untagged twin → "Untagged (pre-181.51)").
      // Only log for the non-queued (online) path, where skipPersist made
      // logOutboundSms the sole writer.
      if (!result.queued) {
        await logRetentionSms(c.phone, messageBody, result, variantKey);
      }

      if (result.success) {
        processed++;
      } else {
        log.warn(`Retention ${tier.days}d SMS failed for customer #${c.id}`, {
          error: result.error,
        });
      }
    } catch (rowErr) {
      perRowErrors++;
      log.warn(`Retention ${tier.days}d row failed for customer #${c.id}`, {
        error: rowErr instanceof Error ? rowErr.message : String(rowErr),
      });
      // continue — don't kill the whole tier on one bad customer
    }
  }

  if (perRowErrors > 0) {
    log.warn(`Retention ${tier.days}d: ${perRowErrors} customers errored — see logs above`);
  }

  if (processed > 0) {
    log.info(`Retention ${tier.days}-day: contacted ${processed} customers`);
  }

  return processed;
}

// ─── EXPORTED PROCESSORS ─────────────────────────────
// Individual tier exports (used by both index.ts registerAllJobs and scheduler.ts)

// wave-181.58 · D7 + D14 added in wave-181.47 but the processor functions were
// never exported and the scheduler never called them — code-review audit
// caught this. Zero D7/D14 messages were sent. Wiring them now.
export async function processRetention7Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const tier = RETENTION_TIERS.find((t) => t.days === 7)!;
  const processed = await processRetentionTier(tier);
  return { recordsProcessed: processed, details: `${processed} customers contacted (7d check-in)` };
}

export async function processRetention14Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const tier = RETENTION_TIERS.find((t) => t.days === 14)!;
  const processed = await processRetentionTier(tier);
  return { recordsProcessed: processed, details: `${processed} customers contacted (14d reactivation)` };
}

export async function processRetention45Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const tier = RETENTION_TIERS.find((t) => t.days === 45)!;
  const processed = await processRetentionTier(tier);
  return { recordsProcessed: processed, details: `${processed} customers contacted (45d)` };
}

export async function processRetention90Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const tier = RETENTION_TIERS.find((t) => t.days === 90)!;
  const processed = await processRetentionTier(tier);
  return { recordsProcessed: processed, details: `${processed} customers contacted (90d)` };
}

export async function processRetention180Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const tier = RETENTION_TIERS.find((t) => t.days === 180)!;
  const processed = await processRetentionTier(tier);
  return { recordsProcessed: processed, details: `${processed} customers contacted (180d)` };
}

export async function processRetention365Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const tier = RETENTION_TIERS.find((t) => t.days === 365)!;
  const processed = await processRetentionTier(tier);
  return { recordsProcessed: processed, details: `${processed} customers contacted (365d)` };
}
