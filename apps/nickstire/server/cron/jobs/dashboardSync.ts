/**
 * Cron: Dashboard Google Sheets Sync + revenue reconciliation pulse.
 *
 * The parent scheduler invokes this every 15 minutes. Dashboard metrics refresh
 * each pass during business hours; revenue reconciliation self-gates to at most
 * once every two hours and uses its own durable run ledger.
 */
import { createLogger } from "../../lib/logger";
import { gte, sql, count } from "drizzle-orm";

import { BUSINESS } from "@shared/business";
import { countActionableLeads } from "@shared/leadSource";
const log = createLogger("cron:dashboard-sync");

type DatabaseClient = NonNullable<Awaited<ReturnType<(typeof import("../../db"))["getDb"]>>>;

async function runRevenueReconciliationIfDue(db: DatabaseClient): Promise<string> {
  try {
    const raw = await db.execute(sql`
      SELECT started_at AS startedAt
      FROM revenue_reconciliation_runs
      WHERE status IN ('running', 'completed')
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const rows = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] as Array<{ startedAt?: Date | string }> : [];
    const latest = rows[0]?.startedAt ? new Date(rows[0].startedAt).getTime() : 0;
    if (latest && Date.now() - latest < 2 * 60 * 60 * 1000) {
      return "reconciliation not due";
    }

    const until = new Date();
    const since = new Date(until.getTime() - 7 * 86_400_000);
    const { runRevenueReconciliation } = await import("../../services/revenueReconciliation");
    const result = await runRevenueReconciliation({ since, until, maxDays: 14 });
    return `reconciliation ${result.runId}: ${result.callsScanned} calls, ${result.verified} verified, ${result.inferred} review`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/revenue_reconciliation_runs|doesn't exist|does not exist/i.test(message)) {
      return "reconciliation migration 0074 not applied";
    }
    log.warn("Revenue reconciliation pulse failed", { error: message });
    return `reconciliation failed: ${message.slice(0, 160)}`;
  }
}

export async function processDashboardSync(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { bookings, leads, callbackRequests } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0 };

    const etHour = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false });
    const hour = parseInt(etHour, 10);
    if (hour < 8 || hour > 19) return { recordsProcessed: 0, details: "Outside business hours" };

    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });

    const [todayBookings] = await db
      .select({ count: count() })
      .from(bookings)
      .where(gte(bookings.createdAt, sql`${todayStr}`));

    const todayLeadRows = await db
      .select({ source: leads.source, callbackId: leads.callbackId })
      .from(leads)
      .where(gte(leads.createdAt, sql`${todayStr}`));
    const todayLeadsCount = countActionableLeads(todayLeadRows);

    const [todayCallbacks] = await db
      .select({ count: count() })
      .from(callbackRequests)
      .where(gte(callbackRequests.createdAt, sql`${todayStr}`));

    let invoiceCount = 0;
    let todayRevenue = 0;
    try {
      const [invMetrics] = await db.execute(sql`
        SELECT COUNT(*) as cnt, COALESCE(SUM(totalAmount), 0) as rev
        FROM invoices WHERE DATE(invoiceDate) = ${todayStr}
      `);
      const inv = (invMetrics as Record<string, unknown>[])?.[0];
      if (inv) {
        invoiceCount = Number(inv.cnt) || 0;
        todayRevenue = Math.round((Number(inv.rev) || 0) / 100);
      }
    } catch (error) {
      log.warn("Invoice metrics unavailable", { error: error instanceof Error ? error.message : String(error) });
    }

    const metrics = {
      date: new Date().toLocaleDateString("en-US", { timeZone: BUSINESS.timezone }),
      time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: BUSINESS.timezone }),
      bookings: todayBookings?.count || 0,
      leads: todayLeadsCount,
      callbacks: todayCallbacks?.count || 0,
      invoices: invoiceCount,
      revenue: todayRevenue,
    };

    try {
      const sheetsSync = await import("../../sheets-sync") as { syncDashboardToSheet?: (value: typeof metrics) => Promise<boolean> };
      if (typeof sheetsSync.syncDashboardToSheet === "function") {
        await sheetsSync.syncDashboardToSheet(metrics);
      }
    } catch (error) {
      log.warn("Dashboard sheets sync skipped", { error: error instanceof Error ? error.message : String(error) });
    }

    const reconciliation = await runRevenueReconciliationIfDue(db);

    // Expected arrivals: mark those matched to a paid invoice as 'arrived', and
    // stale unmet expectations as 'no_show'. Best-effort — never fails the sync.
    let arrivals = "";
    try {
      const { reconcileExpectedArrivals, expireStaleExpectedArrivals } = await import("../../services/expectedArrivals");
      const rec = await reconcileExpectedArrivals();
      const exp = await expireStaleExpectedArrivals(2);
      arrivals = `arrivals: ${rec.reconciled} arrived, ${exp.expired} no_show`;
    } catch (error) {
      log.warn("Expected-arrivals reconcile skipped", { error: error instanceof Error ? error.message : String(error) });
    }

    return { recordsProcessed: 1, details: `${JSON.stringify(metrics)}; ${reconciliation}; ${arrivals}` };
  } catch (error) {
    log.error("Dashboard sync failed", { error: error instanceof Error ? error.message : String(error) });
    return { recordsProcessed: 0 };
  }
}
