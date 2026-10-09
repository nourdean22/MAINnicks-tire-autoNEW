/**
 * kpi-snapshot — the writer `kpi_snapshots` never had (2026-09-01 audit, F-4).
 *
 * `kpi.history` ("historical KPI snapshots for trend charts") read this table
 * for the life of the schema and no code anywhere wrote it, so it returned []
 * to every caller. One row per completed shop week, computed IN SQL in the
 * shop's timezone (America/New_York) — never from driver-parsed dates
 * (nickstire AGENTS.md §5 Time).
 *
 * Idempotent: a week that already has a row is skipped, so oncePerShopDay
 * scheduling can re-run safely and a missed day is caught up by the next run
 * (the job fills the most recent completed week only; older gaps are left for
 * an explicit backfill).
 *
 * Fail LOUD: any read/write error rethrows so cron_log records `failed`.
 */
import { createLogger } from "../../lib/logger";

const log = createLogger("kpi-snapshot");

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => (Array.isArray(r) && Array.isArray(r[0]) ? (r[0] as Row[]) : Array.isArray(r) ? (r as Row[]) : []);
const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

export async function processKpiSnapshot(): Promise<{ recordsProcessed: number; details: string }> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { recordsProcessed: 0, details: "Skipped · no DB" };

  // Most recent COMPLETED Monday-start week in shop time.
  const weekRows = rows(await db.execute(sql`
    SELECT DATE_FORMAT(
      DATE_SUB(DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')),
               INTERVAL (WEEKDAY(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')) + 7) DAY),
      '%Y-%m-%d') AS weekStart
  `));
  const weekStart = String(weekRows[0]?.weekStart ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new Error(`kpi-snapshot: could not compute weekStart (got ${weekStart})`);

  const existing = rows(await db.execute(sql`SELECT id FROM kpi_snapshots WHERE weekStart = ${weekStart} LIMIT 1`));
  if (existing.length > 0) return { recordsProcessed: 0, details: `Skipped · week ${weekStart} already snapshotted` };

  // All windows are [weekStart, weekStart + 7 days) in shop time. The UTC columns below
  // (createdAt, sentAt, created_at) compare with the bounds converted to UTC; `invoiceDate` is the
  // stored shop-local day (2026-10-09), so it compares with them as they are. Converting them for
  // invoices too dropped Monday's date-only tickets and took the next Monday's.
  const rev = rows(await db.execute(sql`
    SELECT COALESCE(SUM(totalAmount), 0) AS revenue, COUNT(*) AS jobs,
           CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(totalAmount) / COUNT(*)) ELSE 0 END AS avgTicket
    FROM invoices
    WHERE paymentStatus = 'paid'
      AND invoiceNumber NOT LIKE 'Estimate#%'
      AND invoiceDate >= ${weekStart}
      AND invoiceDate <  DATE_ADD(${weekStart}, INTERVAL 7 DAY)
  `))[0] ?? {};
  const newCust = rows(await db.execute(sql`
    SELECT COUNT(*) AS c FROM customers
    WHERE createdAt >= CONVERT_TZ(${weekStart}, 'America/New_York', '+00:00')
      AND createdAt <  CONVERT_TZ(DATE_ADD(${weekStart}, INTERVAL 7 DAY), 'America/New_York', '+00:00')
  `))[0] ?? {};
  const leads = rows(await db.execute(sql`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status IN ('booked', 'completed') THEN 1 ELSE 0 END) AS converted
    FROM leads
    WHERE createdAt >= CONVERT_TZ(${weekStart}, 'America/New_York', '+00:00')
      AND createdAt <  CONVERT_TZ(DATE_ADD(${weekStart}, INTERVAL 7 DAY), 'America/New_York', '+00:00')
  `))[0] ?? {};
  const reviews = rows(await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM review_requests
        WHERE sentAt >= CONVERT_TZ(${weekStart}, 'America/New_York', '+00:00')
          AND sentAt <  CONVERT_TZ(DATE_ADD(${weekStart}, INTERVAL 7 DAY), 'America/New_York', '+00:00')) AS sent,
      -- created_at, NOT createdAt. This table is snake_case and the one above
      -- it is camelCase (review_requests.sentAt), which is why the mismatch
      -- reads as a typo rather than a bug: both spellings are correct in this
      -- schema, just not on the same table.
      --
      -- Consequence, measured 2026-09-09: kpi-snapshot had run 5 times and
      -- succeeded 0 times since it first fired on 2026-09-03. It did not
      -- degrade - it never once worked. A raw SQL identifier is invisible to
      -- tsc and to Drizzle's typing, so nothing upstream could catch it.
      (SELECT COUNT(*) FROM review_replies
        WHERE created_at >= CONVERT_TZ(${weekStart}, 'America/New_York', '+00:00')
          AND created_at <  CONVERT_TZ(DATE_ADD(${weekStart}, INTERVAL 7 DAY), 'America/New_York', '+00:00')) AS received
  `))[0] ?? {};

  const totalLeads = n(leads.total);
  const conversionRate = totalLeads > 0 ? Math.round((n(leads.converted) / totalLeads) * 10000) : 0;

  await db.execute(sql`
    INSERT INTO kpi_snapshots (weekStart, revenue, jobsCompleted, newCustomers, avgTicket, conversionRate, satisfactionScore, reviewsSent, reviewsReceived)
    VALUES (${weekStart}, ${n(rev.revenue)}, ${n(rev.jobs)}, ${n(newCust.c)}, ${n(rev.avgTicket)}, ${conversionRate}, 0, ${n(reviews.sent)}, ${n(reviews.received)})
  `);

  const details = `week ${weekStart}: $${Math.round(n(rev.revenue) / 100)} · ${n(rev.jobs)} paid jobs · ${n(newCust.c)} new customers · ${totalLeads} leads (${(conversionRate / 100).toFixed(1)}% converted)`;
  log.info(`kpi-snapshot ${details}`);
  return { recordsProcessed: 1, details };
}
