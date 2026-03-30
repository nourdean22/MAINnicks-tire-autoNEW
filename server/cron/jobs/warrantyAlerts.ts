/**
 * Cron: Warranty Expiration Alerts
 * Notifies customers when their service warranty is about to expire.
 * Runs daily — checks for warranties expiring in 14 days.
 */
import { createLogger } from "../../lib/logger";
import { and, eq, gte, lte, sql } from "drizzle-orm";

const log = createLogger("cron:warranty");

export async function processWarrantyAlerts(): Promise<{ recordsProcessed: number }> {
  try {
    const { isEnabled } = await import("../../services/featureFlags");
    if (!(await isEnabled("predictive_maintenance_alerts"))) return { recordsProcessed: 0 };

    const { getDb } = await import("../../db");
    const { warranties, customers } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0 };

    // Find warranties expiring in 12-16 days that haven't been alerted yet
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() + 12);
    const to = new Date(now);
    to.setDate(to.getDate() + 16);

    const expiring = await db
      .select()
      .from(warranties)
      .where(
        and(
          eq(warranties.status, "active"),
          gte(warranties.expiresAt, sql`${from.toISOString().split("T")[0]}`),
          lte(warranties.expiresAt, sql`${to.toISOString().split("T")[0]}`),
          eq(warranties.reminderSent, false)
        )
      )
      .limit(50);

    if (expiring.length === 0) return { recordsProcessed: 0 };

    const { sendSms } = await import("../../sms");
    let processed = 0;

    for (const w of expiring) {
      // warranties.customerId is the ALS external ID — match via alsCustomerId
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.alsCustomerId, w.customerId))
        .limit(1);

      if (!customer?.phone) continue;
      if (customer.smsOptOut) {
        await db.update(warranties).set({ reminderSent: true }).where(eq(warranties.id, w.id));
        continue;
      }

      const firstName = customer.firstName || "there";
      const message = `Hi ${firstName}, your warranty on ${w.serviceDescription || "your service"} at Nick's Tire & Auto expires on ${w.expiresAt}. Schedule a check before it's up: (216) 862-0005`;

      const result = await sendSms(customer.phone, message);
      if (result.success) {
        await db.update(warranties)
          .set({ reminderSent: true })
          .where(eq(warranties.id, w.id));
        processed++;
      }
    }

    log.info(`Warranty alerts sent: ${processed}`);
    return { recordsProcessed: processed };
  } catch (err) {
    log.error("Warranty alert processing failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0 };
  }
}
