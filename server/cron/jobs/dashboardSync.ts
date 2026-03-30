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
    const etHour = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
    const hour = parseInt(etHour, 10);
    if (hour < 8 || hour > 19) return { recordsProcessed: 0, details: "Outside business hours" };

    // Use ET timezone for "today" — shop is in Cleveland
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

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
      date: new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" }),
      time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }),
      bookings: todayBookings?.count || 0,
      leads: todayLeads?.count || 0,
      callbacks: todayCallbacks?.count || 0,
    };

    // Write to Google Sheets Dashboard tab
    try {
      const sheetsSync = await import("../../sheets-sync") as any;
      if (typeof sheetsSync.syncDashboardToSheet === "function") {
        await sheetsSync.syncDashboardToSheet(metrics);
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
