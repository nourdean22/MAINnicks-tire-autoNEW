/**
 * Cron: Daily Revenue Report — Sends summary to owner at 7 PM ET
 */
import { createLogger } from "../../lib/logger";
import { sendSms } from "../../sms";
const log = createLogger("cron:daily-report");

export async function generateDailyReport(): Promise<{ recordsProcessed: number; details: string }> {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  if (!ownerPhone) {
    log.warn("No OWNER_PHONE_NUMBER — skipping daily report");
    return { recordsProcessed: 0, details: "No owner phone configured" };
  }

  try {
    // Only send at evening (after 6 PM ET) — skip morning run
    const etHour = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
    if (etHour < 18) return { recordsProcessed: 0, details: "Not yet evening — skipped" };

    const { getDb } = await import("../../db");
    const { bookings } = await import("../../../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No database" };

    // Gather full intelligence for a rich daily report
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const rawBookings = await db.execute(sql`SELECT COUNT(*) as cnt FROM bookings WHERE DATE(createdAt) = ${today}`);
    const bookingRows = Array.isArray(rawBookings) && Array.isArray(rawBookings[0]) ? rawBookings[0] : rawBookings;
    const bookingCount = (bookingRows as any)?.[0]?.cnt || 0;

    let revenue = 0;
    let leadCount = 0;
    let reviewCount = 0;
    try {
      const { getShopPulse } = await import("../../services/nickIntelligence");
      const pulse = await getShopPulse();
      revenue = pulse.today.revenue;
    } catch (e) { console.warn("[jobs/dailyReport] operation failed:", e); }
    try {
      const rawLeads = await db.execute(sql`SELECT COUNT(*) as cnt FROM leads WHERE DATE(createdAt) = ${today}`);
      const leadRows = Array.isArray(rawLeads) && Array.isArray(rawLeads[0]) ? rawLeads[0] : rawLeads;
      leadCount = (leadRows as any)?.[0]?.cnt || 0;
    } catch (e) { console.warn("[jobs/dailyReport] operation failed:", e); }

    // Send rich Telegram summary instead of thin SMS
    try {
      const { sendDailySummary } = await import("../../services/telegram");
      await sendDailySummary({
        leads: leadCount,
        bookings: bookingCount,
        revenue,
        reviews: reviewCount,
      });
    } catch (e) { console.warn("[jobs/dailyReport] operation failed:", e); }

    // Still send SMS as backup
    const message = `Daily: ${bookingCount} bookings, ${leadCount} leads, $${revenue} revenue. — Nick's Tire & Auto`;
    await sendSms(ownerPhone, message);

    log.info("Daily report sent", { bookingCount, leadCount, revenue });
    return { recordsProcessed: 1, details: `Bookings: ${bookingCount}, Leads: ${leadCount}, Revenue: $${revenue}` };
  } catch (err) {
    log.error("Daily report failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0, details: "Error generating report" };
  }
}
