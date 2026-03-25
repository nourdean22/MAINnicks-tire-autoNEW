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
    const { getDb } = await import("../../db");
    const { bookings } = await import("../../../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No database" };

    // Count today's bookings
    const today = new Date().toISOString().split("T")[0];
    const [result] = await db.execute(sql`SELECT COUNT(*) as cnt FROM bookings WHERE DATE(createdAt) = ${today}`);
    const bookingCount = (result as any)?.cnt || 0;

    const message = `📊 Daily Report (${today}): ${bookingCount} bookings today. Check admin dashboard for full details. — Nick's Tire & Auto`;
    await sendSms(ownerPhone, message);

    log.info("Daily report sent", { bookingCount });
    return { recordsProcessed: 1, details: `Bookings: ${bookingCount}` };
  } catch (err) {
    log.error("Daily report failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0, details: "Error generating report" };
  }
}
