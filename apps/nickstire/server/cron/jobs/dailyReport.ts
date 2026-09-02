/**
 * Cron: Daily Revenue Report — Sends summary to owner at 7 PM ET
 */
import { createLogger } from "../../lib/logger";
import { sendSms } from "../../sms";
import { BUSINESS } from "@shared/business";
import { countActionableLeads } from "@shared/leadSource";
const log = createLogger("cron:daily-report");

export async function generateDailyReport(): Promise<{ recordsProcessed: number; details: string }> {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  if (!ownerPhone) {
    log.warn("No OWNER_PHONE_NUMBER — skipping daily report");
    return { recordsProcessed: 0, details: "No owner phone configured" };
  }

  try {
    // Only send at evening (after 6 PM ET) — skip morning run
    const etHour = parseInt(new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }), 10);
    if (etHour < 18) return { recordsProcessed: 0, details: "Not yet evening — skipped" };

    const { getDb } = await import("../../db");
    const { bookings } = await import("../../../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No database" };

    // Gather full intelligence for a rich daily report
    const today = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
    const rawBookings = await db.execute(sql`SELECT COUNT(*) as cnt FROM bookings WHERE DATE(createdAt) = ${today}`);
    const bookingRows = Array.isArray(rawBookings) && Array.isArray(rawBookings[0]) ? rawBookings[0] : rawBookings;
    const bookingCount = (bookingRows as any)?.[0]?.cnt || 0;

    // null = the pulse read failed. Artifact 4 §7 (M-5): the owner's daily
    // text used to say "$0 revenue" on a failed read — unknown is not $0.
    let revenue: number | null = null;
    let leadCount = 0;
    let reviewCount = 0;
    try {
      const { getShopPulse } = await import("../../services/nickIntelligence");
      const pulse = await getShopPulse();
      revenue = pulse.today.revenue;
    } catch (e) { log.warn("[jobs/dailyReport] operation failed:", e); }
    try {
      // Actionable-lead definition (shared/leadSource): exclude web-callback leads already
      // counted as a callback_requests row (same person, two rows) so this matches the morning
      // brief + Money Risks. Voice rack-check leads (callbackId null) + real web leads still count.
      const rawLeads = await db.execute(sql`SELECT source, callbackId FROM leads WHERE DATE(createdAt) = ${today}`);
      const leadRows = (Array.isArray(rawLeads) && Array.isArray(rawLeads[0]) ? rawLeads[0] : rawLeads) as unknown as Array<{ source?: string | null; callbackId?: number | null }>;
      leadCount = countActionableLeads(leadRows);
    } catch (e) { log.warn("[jobs/dailyReport] operation failed:", e); }

    // Send rich Telegram summary instead of thin SMS
    try {
      const { sendDailySummary } = await import("../../services/telegram");
      await sendDailySummary({
        leads: leadCount,
        bookings: bookingCount,
        revenue,
        reviews: reviewCount,
      });
    } catch (e) { log.warn("[jobs/dailyReport] operation failed:", e); }

    // Still send SMS as backup
    const revenueText = revenue === null ? "revenue unknown (read failed)" : `$${revenue} revenue`;
    const message = `Daily: ${bookingCount} bookings, ${leadCount} leads, ${revenueText}. — Nick's Tire & Auto`;
    // messageClass "internal" is REQUIRED, not decorative. sendSms refuses
    // automated sends aimed at a shop/operator line, and the escape hatch is
    // the caller's declared INTENT, never the destination. This report is a
    // staff report by definition; without the declaration it would silently
    // stop arriving the day OWNER_PHONE_NUMBER is set to a number in the
    // internal registry — which is the correct value for it to hold.
    await sendSms(ownerPhone, message, { via: "shop", messageClass: "internal" });

    log.info("Daily report sent", { bookingCount, leadCount, revenue });
    return { recordsProcessed: 1, details: `Bookings: ${bookingCount}, Leads: ${leadCount}, Revenue: ${revenue === null ? "unknown (read failed)" : `$${revenue}`}` };
  } catch (err) {
    // 2026-09-01 (audit F-9): rethrow — "Error generating report" was recorded as `completed`.
    log.error("Daily report failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
