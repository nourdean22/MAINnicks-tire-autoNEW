/**
 * Cron: Stale Lead Follow-Up
 * Auto-contacts leads not responded to within 2 hours.
 * Speed-to-lead is the #1 conversion factor for service businesses.
 */
import { createLogger } from "../../lib/logger";
import { and, eq, gte, lte, isNull } from "drizzle-orm";

const log = createLogger("cron:stale-leads");

export async function processStaleLeadFollowUp(): Promise<{ recordsProcessed: number }> {
  try {
    // Only during business hours
    const hour = new Date().getHours();
    if (hour < 8 || hour > 18) return { recordsProcessed: 0 };

    const { isEnabled } = await import("../../services/featureFlags");
    if (!(await isEnabled("smart_sms_auto_reply"))) return { recordsProcessed: 0 };

    const { getDb } = await import("../../db");
    const { leads } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0 };

    // Find leads created 2-6 hours ago that are still 'new' (no contact attempt)
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

    const staleLeads = await db.select().from(leads)
      .where(
        and(
          eq(leads.status, "new"),
          gte(leads.createdAt, sixHoursAgo),
          lte(leads.createdAt, twoHoursAgo),
        )
      )
      .limit(20);

    if (staleLeads.length === 0) return { recordsProcessed: 0 };

    const { sendSms } = await import("../../sms");
    let processed = 0;

    for (const lead of staleLeads) {
      if (!lead.phone) continue;

      const firstName = lead.name?.split(" ")[0] || "there";
      const service = lead.service || "your vehicle";
      const message = `Hi ${firstName}, we got your request about ${service} at Nick's Tire & Auto. Want us to call you? Reply YES or call (216) 862-0005.`;

      const result = await sendSms(lead.phone, message);
      if (result.success) {
        // Update status to contacted
        await db.update(leads)
          .set({ status: "contacted" })
          .where(eq(leads.id, lead.id));
        processed++;
      }
    }

    if (processed > 0) {
      log.info(`Stale lead follow-up: contacted ${processed} leads`);
    }
    return { recordsProcessed: processed };
  } catch (err) {
    log.error("Stale lead follow-up failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0 };
  }
}
