/**
 * Database Backup — Automated daily export to statenour + Telegram.
 *
 * Exports critical tables as JSON snapshots and pushes to:
 * 1. statenour-os.vercel.app/api/sync/backup (cloud archive)
 * 2. Telegram as document (immediate access)
 *
 * Tables backed up: leads, bookings, invoices, customers, tireOrders
 * Runs daily via the daily tier.
 */

import { createLogger } from "../lib/logger";
import { sql } from "drizzle-orm";

const log = createLogger("db-backup");

export async function runDailyBackup(): Promise<{ recordsProcessed?: number; details?: string }> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return { details: "DB not available" };

  try {
    const { leads, bookings, invoices, customers, tireOrders } = await import("../../drizzle/schema");
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];

    // Get counts for each critical table
    const [leadCount, bookingCount, invoiceCount, customerCount, tireOrderCount] = await Promise.all([
      d.select({ count: sql<number>`count(*)` }).from(leads),
      d.select({ count: sql<number>`count(*)` }).from(bookings),
      d.select({ count: sql<number>`count(*)` }).from(invoices),
      d.select({ count: sql<number>`count(*)` }).from(customers),
      d.select({ count: sql<number>`count(*)` }).from(tireOrders),
    ]);

    // Get recent records (last 24h) for incremental backup
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [recentLeads, recentBookings, recentInvoices] = await Promise.all([
      d.select().from(leads).where(sql`${leads.createdAt} >= ${yesterday}`),
      d.select().from(bookings).where(sql`${bookings.createdAt} >= ${yesterday}`),
      d.select().from(invoices).where(sql`${invoices.invoiceDate} >= ${yesterday}`),
    ]);

    const snapshot = {
      date: dateStr,
      timestamp: now.toISOString(),
      counts: {
        leads: leadCount[0]?.count ?? 0,
        bookings: bookingCount[0]?.count ?? 0,
        invoices: invoiceCount[0]?.count ?? 0,
        customers: customerCount[0]?.count ?? 0,
        tireOrders: tireOrderCount[0]?.count ?? 0,
      },
      recent24h: {
        leads: recentLeads.length,
        bookings: recentBookings.length,
        invoices: recentInvoices.length,
        leadsData: recentLeads,
        bookingsData: recentBookings,
        invoicesData: recentInvoices,
      },
    };

    // Push to statenour cloud archive
    const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-web-production.up.railway.app";
    const syncKey = process.env.STATENOUR_SYNC_KEY || "";
    // This POST is the ONLY durable copy this job produces. If it does not land,
    // nothing has been backed up — so its outcome is tracked and reported
    // honestly rather than assumed.
    //
    // Pre-fix this was a bare `await fetch()` with no res.ok check inside a
    // catch that only log.warn'd. A 401 from a rotated STATENOUR_SYNC_KEY, or a
    // 404/500 from the archive, is a RESOLVED promise — so a total archive
    // outage looked identical to a successful upload, and the job still
    // reported success for months.
    let archived = false;
    let archiveError = "";
    try {
      const res = await fetch(`${statenourUrl}/api/sync/backup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(syncKey ? { Authorization: `Bearer ${syncKey}` } : {}),
        },
        body: JSON.stringify(snapshot),
      });
      // fetch only rejects on transport failure — an HTTP error status resolves.
      if (!res.ok) throw new Error(`archive responded ${res.status} ${res.statusText}`);
      archived = true;
      log.info("Backup pushed to statenour");
    } catch (err) {
      archiveError = err instanceof Error ? err.message : String(err);
      log.error("Statenour backup push FAILED — no durable copy was written", { error: archiveError });
    }

    // Send summary to Telegram
    try {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `📦 DAILY BACKUP — ${dateStr}\n\n` +
        `DB Totals:\n` +
        `• ${snapshot.counts.leads} leads\n` +
        `• ${snapshot.counts.bookings} bookings\n` +
        `• ${snapshot.counts.invoices} invoices\n` +
        `• ${snapshot.counts.customers} customers\n` +
        `• ${snapshot.counts.tireOrders} tire orders\n\n` +
        `Last 24h:\n` +
        `• ${snapshot.recent24h.leads} new leads\n` +
        `• ${snapshot.recent24h.bookings} new bookings\n` +
        `• ${snapshot.recent24h.invoices} new invoices\n\n` +
        // Was hardcoded to the success line regardless of what happened.
        (archived
          ? `✅ Backup archived to cloud`
          : `🚨 ARCHIVE FAILED — NOTHING WAS SAVED\n${archiveError}\n\nThe counts above were read, but no copy left this server.`)
      );
    } catch (e) { log.warn("[services/dbBackup] operation failed:", e); }

    // Throw so scheduler.ts records status='failed'. checkDataSafety derives
    // "last successful backup" from cron_log status='completed', so returning
    // normally here would reset the data-at-risk clock every single day while
    // no bytes reached the archive — the alarm could never fire.
    if (!archived) {
      throw new Error(`Backup archive failed — no durable copy written: ${archiveError}`);
    }

    const totalRecent = snapshot.recent24h.leads + snapshot.recent24h.bookings + snapshot.recent24h.invoices;
    return { recordsProcessed: totalRecent, details: `Backup: ${totalRecent} recent records, ${Object.values(snapshot.counts).reduce((a, b) => a + b, 0)} total` };
  } catch (err) {
    // RETHROW, do not return. Returning made the scheduler log 'completed' even
    // when the whole handler blew up, which is the second independent way this
    // job reported success while backing nothing up.
    log.error("Daily backup failed:", { error: err instanceof Error ? err.message : String(err) });
    throw err instanceof Error ? err : new Error(String(err));
  }
}
