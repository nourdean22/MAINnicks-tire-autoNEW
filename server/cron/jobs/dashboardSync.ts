/**
 * Cron: Dashboard Google Sheets Sync
 * Writes daily metrics to the "Dashboard" tab in Google Sheets CRM.
 * Runs every 15 min during business hours to keep the spreadsheet current.
 */
import { createLogger } from "../../lib/logger";
import { gte, sql, count } from "drizzle-orm";

const log = createLogger("cron:dashboard-sync");

export async function processDashboardSync(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { bookings, leads, callbackRequests } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0 };

    // Only sync during business hours (8am-7pm ET)
    const hour = new Date().getHours();
    if (hour < 8 || hour > 19) return { recordsProcessed: 0, details: "Outside business hours" };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];

    // Query today's metrics
    const [todayBookings] = await db
      .select({ count: count() })
      .from(bookings)
      .where(gte(bookings.createdAt, sql`${todayStr}`));

    const [todayLeads] = await db
      .select({ count: count() })
      .from(leads)
      .where(gte(leads.createdAt, sql`${todayStr}`));

    const [todayCallbacks] = await db
      .select({ count: count() })
      .from(callbackRequests)
      .where(gte(callbackRequests.createdAt, sql`${todayStr}`));

    const metrics = {
      date: new Date().toLocaleDateString("en-US"),
      time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      bookings: todayBookings?.count || 0,
      leads: todayLeads?.count || 0,
      callbacks: todayCallbacks?.count || 0,
    };

    // Write to Google Sheets Dashboard tab
    try {
      const { syncDashboardToSheet } = await import("../../sheets-sync");
      if (typeof syncDashboardToSheet === "function") {
        await syncDashboardToSheet(metrics);
      }
    } catch {
      // Sheets sync is optional — don't fail the cron job
      log.warn("Dashboard sheets sync skipped — function not available");
    }

    return { recordsProcessed: 1, details: JSON.stringify(metrics) };
  } catch (err) {
    log.error("Dashboard sync failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0 };
  }
}
