/**
 * Daily digest (cron job name kept as "db-backup" so cron_log history,
 * safetyMonitor's freshness check and the loop-shape contract stay continuous).
 *
 * Q-29 · This is NOT a restorable backup and never was. It reads row COUNTS for
 * the critical tables (totals + the last 24 h) and pushes them to:
 * 1. StateNour /api/sync/backup (stored as a `daily_backup` audit event)
 * 2. Telegram (a counts-only summary)
 *
 * Until Q-29 it also copied every lead, booking and invoice row from the last
 * 24 h into StateNour's audit_events: customer names, phones and amounts in a
 * second store with no reader. It now sends counts only; the StateNour
 * receiver independently whitelists the same count keys, so a stale sender
 * cannot land rows either. The real restore path is TiDB Cloud's native
 * backups (estate architecture §5.4).
 *
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

    // New rows in the last 24h: COUNTS only. Selecting the rows themselves is
    // what used to copy customer PII into StateNour (Q-29).
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [recentLeads, recentBookings, recentInvoices] = await Promise.all([
      d.select({ count: sql<number>`count(*)` }).from(leads).where(sql`${leads.createdAt} >= ${yesterday}`),
      d.select({ count: sql<number>`count(*)` }).from(bookings).where(sql`${bookings.createdAt} >= ${yesterday}`),
      d.select({ count: sql<number>`count(*)` }).from(invoices).where(sql`${invoices.invoiceDate} >= ${yesterday}`),
    ]);

    // count(*) can come back as a string from the driver; the digest carries numbers.
    const n = (rows: Array<{ count: number | string }>): number => Number(rows[0]?.count ?? 0) || 0;

    const snapshot = {
      kind: "daily_digest" as const,
      date: dateStr,
      timestamp: now.toISOString(),
      counts: {
        leads: n(leadCount),
        bookings: n(bookingCount),
        invoices: n(invoiceCount),
        customers: n(customerCount),
        tireOrders: n(tireOrderCount),
      },
      recent24h: {
        leads: n(recentLeads),
        bookings: n(recentBookings),
        invoices: n(recentInvoices),
      },
    };

    // Push to statenour cloud archive
    const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-web-production.up.railway.app";
    const syncKey = process.env.STATENOUR_SYNC_KEY || "";
    // This POST is the ONLY durable record this job produces. If it does not
    // land, nothing was archived — so its outcome is tracked and reported
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
      log.info("Daily digest pushed to statenour");
    } catch (err) {
      archiveError = err instanceof Error ? err.message : String(err);
      log.error("Statenour digest push FAILED — nothing was archived", { error: archiveError });
    }

    // Send summary to Telegram
    try {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `📦 DAILY DIGEST — ${dateStr}\n` +
        `Counts only — not a restorable backup (TiDB Cloud's native backups are).\n\n` +
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
          ? `✅ Digest archived to StateNour`
          : `🚨 DIGEST ARCHIVE FAILED\n${archiveError}\n\nThe counts above were read, but no record left this server.`)
      );
    } catch (e) { log.warn("[services/dbBackup] operation failed:", e); }

    // Throw so scheduler.ts records status='failed'. checkDataSafety derives
    // "last successful backup" from cron_log status='completed', so returning
    // normally here would reset the data-at-risk clock every single day while
    // no bytes reached the archive — the alarm could never fire.
    if (!archived) {
      throw new Error(`Digest archive failed — nothing archived: ${archiveError}`);
    }

    const totalRecent = snapshot.recent24h.leads + snapshot.recent24h.bookings + snapshot.recent24h.invoices;
    return { recordsProcessed: totalRecent, details: `Digest (counts only): ${totalRecent} new in 24h, ${Object.values(snapshot.counts).reduce((a, b) => a + b, 0)} total` };
  } catch (err) {
    // RETHROW, do not return. Returning made the scheduler log 'completed' even
    // when the whole handler blew up, which is the second independent way this
    // job reported success while backing nothing up.
    log.error("Daily digest failed:", { error: err instanceof Error ? err.message : String(err) });
    throw err instanceof Error ? err : new Error(String(err));
  }
}
