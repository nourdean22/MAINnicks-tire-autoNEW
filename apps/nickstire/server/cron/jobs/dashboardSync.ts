/**
 * Cron: Dashboard Google Sheets Sync
 * Writes daily metrics to the "Dashboard" tab in Google Sheets CRM.
 * Runs every 15 min during business hours to keep the spreadsheet current.
 */
import { createLogger } from "../../lib/logger";
import { gte, sql, count } from "drizzle-orm";

import { BUSINESS } from "@shared/business";
import { countActionableLeads } from "@shared/leadSource";
const log = createLogger("cron:dashboard-sync");

export async function processDashboardSync(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { bookings, leads, callbackRequests } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0 };

    // Only sync during business hours (8am-7pm ET)
    const etHour = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false });
    const hour = parseInt(etHour, 10);
    if (hour < 8 || hour > 19) return { recordsProcessed: 0, details: "Outside business hours" };

    // Use ET timezone for "today" — shop is in Cleveland
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });

    // Query today's metrics
    const [todayBookings] = await db
      .select({ count: count() })
      .from(bookings)
      .where(gte(bookings.createdAt, sql`${todayStr}`));

    // Actionable-lead definition (shared/leadSource): exclude web-callback leads already
    // counted as callbacks so this Sheets metric matches the morning brief + Money Risks.
    const todayLeadRows = await db
      .select({ source: leads.source, callbackId: leads.callbackId })
      .from(leads)
      .where(gte(leads.createdAt, sql`${todayStr}`));
    const todayLeadsCount = countActionableLeads(todayLeadRows);

    const [todayCallbacks] = await db
      .select({ count: count() })
      .from(callbackRequests)
      .where(gte(callbackRequests.createdAt, sql`${todayStr}`));

    // ALG invoice data — the real shop floor numbers
    let invoiceCount = 0;
    let todayRevenue = 0;
    try {
      const { invoices } = await import("../../../drizzle/schema");
      const [invMetrics] = await db.execute(sql`
        SELECT COUNT(*) as cnt, COALESCE(SUM(totalAmount), 0) as rev
        FROM invoices WHERE DATE(invoiceDate) = ${todayStr}
      `);
      const inv = (invMetrics as Record<string, unknown>[])?.[0];
      if (inv) {
        invoiceCount = Number(inv.cnt) || 0;
        todayRevenue = Math.round((Number(inv.rev) || 0) / 100); // cents → dollars
      }
    } catch (e) { log.warn("[jobs/dashboardSync] operation failed:", e); }

    const metrics = {
      date: new Date().toLocaleDateString("en-US", { timeZone: BUSINESS.timezone }),
      time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: BUSINESS.timezone }),
      bookings: todayBookings?.count || 0,
      leads: todayLeadsCount,
      callbacks: todayCallbacks?.count || 0,
      invoices: invoiceCount,
      revenue: todayRevenue,
    };

    // Write to Google Sheets Dashboard tab
    try {
      const sheetsSync = await import("../../sheets-sync") as any;
      if (typeof sheetsSync.syncDashboardToSheet === "function") {
        await sheetsSync.syncDashboardToSheet(metrics);
      }
    } catch (e) {
      log.warn("[jobs/dashboardSync] operation failed:", e);
      // Sheets sync is optional — don't fail the cron job
      log.warn("Dashboard sheets sync skipped — function not available");
    }

    return { recordsProcessed: 1, details: JSON.stringify(metrics) };
  } catch (err) {
    log.error("Dashboard sync failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0 };
  }
}
