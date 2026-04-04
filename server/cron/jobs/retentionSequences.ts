/**
 * Cron: Retention Sequences — 90/180/365 day re-engagement
 * Sends SMS to customers who haven't visited in a while.
 * Uses exact-day matching so each customer is contacted exactly once per window.
 */
import { createLogger } from "../../lib/logger";
import { eq, and, isNotNull, sql } from "drizzle-orm";

const log = createLogger("cron:retention");

async function sendRetentionSms(
  dayThreshold: number,
  messageBuilder: (firstName: string) => string
): Promise<number> {
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

export async function processRetention90Day(): Promise<{ recordsProcessed: number; details?: string }> {
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("sms_retention_sequences"))) return { recordsProcessed: 0, details: "Feature disabled" };

  const processed = await sendRetentionSms(
    90,
    (firstName) =>
      `Hi ${firstName}, it's been 3 months since your last visit at Nick's Tire & Auto! Your vehicle may be due for maintenance. Schedule at (216) 862-0005.`
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
      `Hi ${firstName}, it's been 6 months since we've seen you at Nick's Tire & Auto! We'd love to help keep your vehicle running. Call (216) 862-0005 to schedule.`
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
      `Hi ${firstName}, we haven't seen you at Nick's Tire & Auto in a year! Come back — reply YES for a free tire rotation on your next visit. (216) 862-0005`
  );

  if (processed > 0) log.info(`Retention 365-day: contacted ${processed} customers`);
  return { recordsProcessed: processed, details: `${processed} customers contacted (365d)` };
}
