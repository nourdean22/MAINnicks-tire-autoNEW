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
import type { FlagKey } from "../../services/featureFlags";

const log = createLogger("cron:retention");

// ─── RETENTION TIERS ─────────────────────────────────
interface RetentionTier {
  days: number;
  /** Day range: match customers whose last visit was between minDays..maxDays ago */
  minDays: number;
  maxDays: number;
  /** Feature flag(s) that must be enabled */
  flags: FlagKey[];
  /** Message builder — receives firstName and vehicle string */
  message: (firstName: string, vehicle: string) => string;
}

const RETENTION_TIERS: RetentionTier[] = [
  {
    days: 45,
    minDays: 40,
    maxDays: 50,
    flags: ["sms_retention_sequences", "retention_45day"],
    message: (name, vehicle) =>
      `Hi ${name}, it's been a while! Your ${vehicle} might be due for an oil change or tire rotation. Stop by Nick's Tire — no appointment needed. ${STORE_PHONE}`,
  },
  {
    days: 90,
    minDays: 85,
    maxDays: 95,
    flags: ["sms_retention_sequences"],
    message: (name, vehicle) =>
      `Hey ${name}, we haven't seen your ${vehicle} in 3 months. Problems get worse over time — let us take a look before it gets expensive. Drop off anytime Mon-Sat 8-6.`,
  },
  {
    days: 180,
    minDays: 175,
    maxDays: 185,
    flags: ["sms_retention_sequences"],
    message: (name, vehicle) =>
      `Hi ${name}, it's been 6 months since we worked on your ${vehicle}. We miss you! Come back for a free inspection — just pull up, we'll come to you. ${STORE_PHONE}`,
  },
  {
    days: 365,
    minDays: 360,
    maxDays: 370,
    flags: ["sms_retention_sequences"],
    message: (name, vehicle) =>
      `${name}, it's been a year! Your ${vehicle} deserves some attention. Nick's Tire — same great service, same location. Pull up anytime. \uD83D\uDEDE ${STORE_PHONE}`,
  },
];

// ─── TIME GUARD ──────────────────────────────────────
/** Only send retention SMS between 9am-6pm ET */
function isWithinRetentionHours(): boolean {
  const etHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10,
  );
  return etHour >= 9 && etHour < 18;
}

// ─── SMS LOGGING ─────────────────────────────────────
/** Log a retention SMS send to the sms_messages table */
async function logRetentionSms(phone: string, body: string, sid?: string): Promise<void> {
  try {
    const { getDb } = await import("../../db");
    const { smsMessages, smsConversations } = await import("../../../drizzle/schema");
    const { eq: eqOp } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;

    // Find or create conversation for this phone
    let [conv] = await db
      .select({ id: smsConversations.id })
      .from(smsConversations)
      .where(eqOp(smsConversations.phone, phone))
      .limit(1);

    if (!conv) {
      const [inserted] = await db
        .insert(smsConversations)
        .values({ phone })
        .$returningId();
      conv = { id: inserted.id };
    }

    await db.insert(smsMessages).values({
      conversationId: conv.id,
      direction: "outbound",
      body,
      twilioSid: sid || null,
      status: sid ? "sent" : "failed",
    });
  } catch (err) {
    log.warn("Failed to log retention SMS to DB", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── CORE PROCESSOR ──────────────────────────────────
/**
 * Process a single retention tier.
 * Returns count of customers contacted.
 */
async function processRetentionTier(tier: RetentionTier): Promise<number> {
  // 1. Check Twilio config
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    return 0;
  }

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
  for (const c of targets) {
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
    const messageBody = tier.message(firstName, vehicle);

    const result = await sendSms(c.phone, messageBody);

    // Log to sms_messages table regardless of success
    await logRetentionSms(c.phone, messageBody, result.sid);

    if (result.success) {
      // Update the customer's retention tracking
      await db
        .update(customers)
        .set({
          lastRetentionTier: tier.days,
          lastRetentionDate: new Date(),
        })
        .where(eq(customers.id, c.id));
      processed++;
    } else {
      log.warn(`Retention ${tier.days}d SMS failed for customer #${c.id}`, {
        error: result.error,
      });
    }
  }

  if (processed > 0) {
    log.info(`Retention ${tier.days}-day: contacted ${processed} customers`);
  }

  return processed;
}

// ─── EXPORTED PROCESSORS ─────────────────────────────
// Individual tier exports (used by both index.ts registerAllJobs and scheduler.ts)

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
