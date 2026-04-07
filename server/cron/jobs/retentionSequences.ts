/**
 * Cron: Retention Sequences — 90/180/365 day re-engagement
 * Sends SMS to customers who haven't visited in a while.
 * Uses exact-day matching so each customer is contacted exactly once per window.
 */
import { createLogger } from "../../lib/logger";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { STORE_PHONE } from "@shared/const";

const log = createLogger("cron:retention");

async function sendRetentionSms(
  dayThreshold: number,
  messageBuilder: (firstName: string) => string
): Promise<number> {
  // Check Twilio is configured before doing any DB work
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    return 0;
  }
  const { getDb } = await import("../../db");
  const { customers } = await import("../../../drizzle/schema");
  const { sendSms } = await import("../../sms");
  const db = await getDb();
  if (!db) return 0;

  // Match customers whose last visit was exactly on this threshold day
  const targets = await db.select({
    id: customers.id,
    firstName: customers.firstName,
    phone: customers.phone,
  }).from(customers).where(
    and(
      isNotNull(customers.lastVisitDate),
      eq(customers.smsOptOut, 0),
      sql`DATEDIFF(CURDATE(), ${customers.lastVisitDate}) = ${dayThreshold}`
    )
  ).limit(100);

  let processed = 0;
  for (const c of targets) {
    if (!c.phone) continue;
    const firstName = c.firstName || "there";
    const result = await sendSms(c.phone, messageBuilder(firstName));
    if (result.success) {
      processed++;
    } else {
      log.warn(`Retention ${dayThreshold}d SMS failed for customer #${c.id}`);
    }
  }
  return processed;
}

export async function processRetention45Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("retention_45day"))) return { recordsProcessed: 0, details: "Feature disabled" };
  if (!(await isEnabled("sms_retention_sequences"))) return { recordsProcessed: 0, details: "Feature disabled" };

  // 45-day retention: customers who visited 40-50 days ago (wider window for daily cron)
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    return { recordsProcessed: 0, details: "Twilio not configured" };
  }
  const { getDb } = await import("../../db");
  const { customers } = await import("../../../drizzle/schema");
  const { sendSms } = await import("../../sms");
  const db = await getDb();
  if (!db) return { recordsProcessed: 0, details: "No DB" };

  // Match customers whose last visit was 40-50 days ago, have valid phone, not opted out
  const targets = await db.select({
    id: customers.id,
    firstName: customers.firstName,
    phone: customers.phone,
  }).from(customers).where(
    and(
      isNotNull(customers.lastVisitDate),
      eq(customers.smsOptOut, 0),
      sql`DATEDIFF(CURDATE(), ${customers.lastVisitDate}) BETWEEN 40 AND 50`
    )
  ).limit(100);

  // Generate a seasonal tip based on current month
  const month = new Date().getMonth(); // 0-indexed
  const seasonalTips: Record<number, string> = {
    0: "winter tires and battery checks keep you safe in the cold",
    1: "salt and ice can damage your undercarriage — worth an inspection",
    2: "pothole season is brutal on alignments — a quick check prevents bigger issues",
    3: "spring is perfect for a full vehicle checkup after winter wear",
    4: "summer is coming — AC check and coolant top-off keep you comfortable",
    5: "hot weather is hard on batteries and tires — quick inspection keeps you safe",
    6: "summer heat stresses tires and AC systems — stay ahead of breakdowns",
    7: "back-to-school time — make sure the family car is road-ready",
    8: "fall prep: tire rotation and brake check before winter hits",
    9: "first freeze is around the corner — winter tires and battery test recommended",
    10: "winter is here — make sure your heater, defroster, and wipers are ready",
    11: "holiday travel season — full inspection gives you peace of mind on the road",
  };
  const tip = seasonalTips[month] || "regular maintenance prevents costly surprises";

  let processed = 0;
  for (const c of targets) {
    if (!c.phone) continue;
    const firstName = c.firstName || "there";
    const result = await sendSms(
      c.phone,
      `Hi ${firstName}! It's been about 6 weeks since your last visit at Nick's. Quick reminder: ${tip}. Drop off anytime — ${STORE_PHONE}`
    );
    if (result.success) {
      processed++;
    } else {
      log.warn(`Retention 45d SMS failed for customer #${c.id}`);
    }
  }

  if (processed > 0) log.info(`Retention 45-day: contacted ${processed} customers`);
  return { recordsProcessed: processed, details: `${processed} customers contacted (45d)` };
}

export async function processRetention90Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("sms_retention_sequences"))) return { recordsProcessed: 0, details: "Feature disabled" };

  const processed = await sendRetentionSms(
    90,
    (firstName) =>
      `Hi ${firstName}, it's been 3 months since your last visit at Nick's Tire & Auto! Your vehicle may be due for maintenance. Schedule at ${STORE_PHONE}.`
  );

  if (processed > 0) log.info(`Retention 90-day: contacted ${processed} customers`);
  return { recordsProcessed: processed, details: `${processed} customers contacted (90d)` };
}

export async function processRetention180Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("sms_retention_sequences"))) return { recordsProcessed: 0, details: "Feature disabled" };

  const processed = await sendRetentionSms(
    180,
    (firstName) =>
      `Hi ${firstName}, it's been 6 months since we've seen you at Nick's Tire & Auto! We'd love to help keep your vehicle running. Call ${STORE_PHONE} to schedule.`
  );

  if (processed > 0) log.info(`Retention 180-day: contacted ${processed} customers`);
  return { recordsProcessed: processed, details: `${processed} customers contacted (180d)` };
}

export async function processRetention365Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("sms_retention_sequences"))) return { recordsProcessed: 0, details: "Feature disabled" };

  const processed = await sendRetentionSms(
    365,
    (firstName) =>
      `Hi ${firstName}, we haven't seen you at Nick's Tire & Auto in a year! Come back — reply YES for a free tire rotation on your next visit. ${STORE_PHONE}`
  );

  if (processed > 0) log.info(`Retention 365-day: contacted ${processed} customers`);
  return { recordsProcessed: processed, details: `${processed} customers contacted (365d)` };
}
