/**
 * Cron: Warranty Expiration Alerts
 * Notifies customers when their service warranty is about to expire.
 * Runs daily — checks for warranties expiring in 14 days.
 */
import { createLogger } from "../../lib/logger";
import { and, eq, gte, lte, sql, inArray } from "drizzle-orm";

import { BUSINESS } from "@shared/business";
const log = createLogger("cron:warranty");

export async function processWarrantyAlerts(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { isEnabled } = await import("../../services/featureFlags");
    if (!(await isEnabled("predictive_maintenance_alerts"))) return { recordsProcessed: 0 };

    const { getDb } = await import("../../db");
    const { warranties, customers } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0 };

    // Find warranties expiring in 12-16 days that haven't been alerted yet
    // Use ET timezone since shop is in Cleveland
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() + 12);
    const to = new Date(now);
    to.setDate(to.getDate() + 16);
    const fromStr = from.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
    const toStr = to.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });

    const expiring = await db
      .select()
      .from(warranties)
      .where(
        and(
          eq(warranties.status, "active"),
          gte(warranties.expiresAt, sql`${fromStr}`),
          lte(warranties.expiresAt, sql`${toStr}`),
          eq(warranties.reminderSent, false)
        )
      )
      .limit(50);

    if (expiring.length === 0) {
      log.info("[cron:warranty] no warranties due in next 12-16d");
      return { recordsProcessed: 0 };
    }

    // wave-165: batch the customer lookup. Previously did 1 DB query per
    // expiring warranty (up to 50 sequential round-trips inside the loop),
    // which would timeout the cron under load and delay all subsequent jobs.
    const alsIdsSet = new Set<string>();
    for (const w of expiring) {
      if (typeof w.customerId === "string" && w.customerId.length > 0) alsIdsSet.add(w.customerId);
    }
    const alsIds: string[] = Array.from(alsIdsSet);
    type CustomerRow = typeof customers.$inferSelect;
    const customerRows: CustomerRow[] = alsIds.length > 0
      ? await db.select().from(customers).where(inArray(customers.alsCustomerId, alsIds))
      : [];
    const customerByAlsId = new Map<string, CustomerRow>();
    for (const c of customerRows) {
      if (c.alsCustomerId) customerByAlsId.set(c.alsCustomerId, c);
    }

    // wave-181.3 silent-failure audit finding #3 · alarm if expiring
    // warranties exist but NO customers matched (data drift between
    // warranties.customerId and customers.alsCustomerId). Without this
    // every iteration would hit `continue` and 0 reminders go out
    // silently while the cron table says "completed".
    if (expiring.length > 0 && customerRows.length === 0) {
      log.error("[cron:warranty] expiring warranties have NO matching customers — likely customerId/alsCustomerId drift", {
        errorId: "WARRANTY_CUSTOMER_LOOKUP_MISMATCH",
        expiringCount: expiring.length,
        alsIdsCount: alsIds.length,
      });
    }

    const { sendSms } = await import("../../sms");
    let processed = 0;
    let queued = 0; // parked for the 8 AM window (audit F-3)
    let failed = 0;

    for (const w of expiring) {
      const customer = customerByAlsId.get(w.customerId);
      if (!customer?.phone) continue;
      if (customer.smsOptOut) {
        await db.update(warranties).set({ reminderSent: true }).where(eq(warranties.id, w.id));
        continue;
      }

      const firstName = customer.firstName || "there";
      const expiryDate = new Date(w.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: BUSINESS.timezone });
      const message = `Hi ${firstName}, your warranty on ${w.serviceDescription || "your service"} at Nick's Tire & Auto expires on ${expiryDate}. Schedule a check before it's up: (216) 862-0005`;

      // At-most-once claim — flip reminderSent BEFORE the send. If the run
      // crashes after the text goes out, the warranty is already marked,
      // so the next daily run won't re-text. Conditional WHERE keeps two
      // overlapping runs from both sending.
      const claimRes = await db.update(warranties)
        .set({ reminderSent: true })
        .where(and(eq(warranties.id, w.id), eq(warranties.reminderSent, false)));
      if (((claimRes as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 0) {
        continue; // already claimed by an overlapping run
      }

      // Wave-109: warranty reminder via shop gateway (1:1 transactional)
      const result = await sendSms(customer.phone, message, { via: "shop" });
      // 2026-09-01 (audit F-3): queued ≠ sent. Both reach the customer (the
      // claim above stays), but the receipt splits them.
      const { smsOutcome } = await import("../../lib/smsOutcome");
      const outcome = smsOutcome(result);
      if (outcome === "sent") processed++;
      else if (outcome === "queued") queued++;
      else failed++;
    }

    log.info(`Warranty alerts: ${processed} sent · ${queued} queued · ${failed} failed`);
    return { recordsProcessed: processed, details: `${processed} sent · ${queued} queued for 8 AM · ${failed} failed` };
  } catch (err) {
    // wave-181.3 silent-failure audit finding #3 · the previous catch
    // returned { recordsProcessed: 0 } which caused the cron runner to
    // mark the run "completed" with status=success — silent failure
    // invisible to ops. Rethrow so runJob writes status='failed' to
    // cron_log and the operator gets the alert.
    log.error("Warranty alert processing failed", {
      errorId: "WARRANTY_CRON_THREW",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
