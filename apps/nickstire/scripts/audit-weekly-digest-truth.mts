/**
 * READ-ONLY audit: prove every number the weekly digest emits against the
 * live mirror, and check the other consumers of the same columns.
 *
 * Written 2026-08-08 after the digest was caught rendering a fabricated
 * "Margin 100%". The defect passed 18 green tests because the fixtures
 * assumed populated columns. This script asserts against PRODUCTION, which
 * is the only thing that could have caught it.
 *
 * SELECTs only. Writes nothing. Sends nothing.
 *   pnpm exec tsx scripts/audit-weekly-digest-truth.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* shell may carry them */ }

const { getDb } = await import("../server/db.js");
const { sql } = await import("drizzle-orm");
const d = await getDb();
if (!d) { console.error("no db"); process.exit(1); }

const rows = (r: unknown): any[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : (r as any[])) ?? [];
const q = async (s: any) => rows(await d.execute(s));
const hdr = (s: string) => console.log(`\n${"═".repeat(72)}\n${s}\n${"═".repeat(72)}`);

const now = new Date();
const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const prevStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

// ── A · Does paymentStatus='paid' silently drop money? ──────────────────
hdr("A · paymentStatus distribution (is the 'paid' filter dropping revenue?)");
console.table(await q(sql`
  SELECT paymentStatus, COUNT(*) AS n, SUM(totalAmount)/100 AS dollars,
         MIN(DATE(invoiceDate)) AS firstSeen, MAX(DATE(invoiceDate)) AS lastSeen
  FROM invoices GROUP BY paymentStatus ORDER BY n DESC`));
console.log("LAST 14 DAYS by status:");
console.table(await q(sql`
  SELECT paymentStatus, COUNT(*) AS n, SUM(totalAmount)/100 AS dollars
  FROM invoices WHERE invoiceDate >= ${prevStart} GROUP BY paymentStatus`));

// ── B · invoiceDate shape — does the rolling window clip? ───────────────
hdr("B · invoiceDate shape (time components? midnight-only dates clip a rolling window)");
console.table(await q(sql`
  SELECT
    SUM(CASE WHEN TIME(invoiceDate) = '00:00:00' THEN 1 ELSE 0 END) AS midnightExact,
    SUM(CASE WHEN TIME(invoiceDate) <> '00:00:00' THEN 1 ELSE 0 END) AS hasClockTime,
    COUNT(*) AS total, MIN(invoiceDate) AS earliest, MAX(invoiceDate) AS latest
  FROM invoices WHERE paymentStatus='paid'`));
console.log("last 14d, hour-of-day spread (a real import should look like shop hours):");
console.table(await q(sql`
  SELECT HOUR(invoiceDate) AS hr, COUNT(*) AS n FROM invoices
  WHERE paymentStatus='paid' AND invoiceDate >= ${prevStart}
  GROUP BY hr ORDER BY hr`));

// ── C · The digest's exact window vs neighbours ─────────────────────────
hdr("C · window boundary sensitivity (does ±1 day swing the headline?)");
for (const [label, start] of [["7d (digest)", windowStart], ["8d", new Date(now.getTime() - 8 * 864e5)], ["6d", new Date(now.getTime() - 6 * 864e5)]] as const) {
  const r = (await q(sql`
    SELECT COUNT(*) AS n, COALESCE(SUM(totalAmount),0)/100 AS dollars FROM invoices
    WHERE paymentStatus='paid' AND invoiceDate >= ${start} AND invoiceDate < ${now}`))[0];
  console.log(`${label.padEnd(12)} n=${r.n}  $${r.dollars}`);
}

// ── D · Repeat-revenue share — the headline number ─────────────────────
hdr("D · repeat-revenue share (the headline) — is 22% real?");
console.log("phone coverage on THIS week's paid invoices:");
console.table(await q(sql`
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(TRIM(customerPhone),'') <> '' THEN 1 ELSE 0 END) AS withPhone,
         SUM(CASE WHEN LENGTH(REGEXP_REPLACE(COALESCE(customerPhone,''),'[^0-9]','')) >= 10 THEN 1 ELSE 0 END) AS phone10plus
  FROM invoices WHERE paymentStatus='paid' AND invoiceDate >= ${windowStart} AND invoiceDate < ${now}`));

console.log("\nper-invoice repeat classification (what the digest actually computes):");
console.table(await q(sql`
  SELECT
    CASE WHEN cur.p10 IS NULL THEN 'no-phone'
         WHEN EXISTS (SELECT 1 FROM invoices prior WHERE prior.paymentStatus='paid'
                        AND prior.invoiceDate < ${windowStart}
                        AND RIGHT(REGEXP_REPLACE(COALESCE(prior.customerPhone,''),'[^0-9]',''),10) = cur.p10)
         THEN 'repeat' ELSE 'new' END AS bucket,
    COUNT(*) AS invoices, SUM(cur.totalAmount)/100 AS dollars
  FROM (SELECT totalAmount, NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(customerPhone,''),'[^0-9]',''),10),'') AS p10
        FROM invoices WHERE paymentStatus='paid' AND invoiceDate >= ${windowStart} AND invoiceDate < ${now}) cur
  GROUP BY bucket`));

console.log("\nDEFINITIONAL GAP CHECK — customers with 2+ invoices INSIDE this week");
console.log("(the digest calls their 2nd visit 'new' because the prior invoice is not before windowStart):");
console.table(await q(sql`
  SELECT p10, COUNT(*) AS invoicesThisWeek, SUM(totalAmount)/100 AS dollars FROM (
    SELECT NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(customerPhone,''),'[^0-9]',''),10),'') AS p10, totalAmount
    FROM invoices WHERE paymentStatus='paid' AND invoiceDate >= ${windowStart} AND invoiceDate < ${now}) x
  WHERE p10 IS NOT NULL GROUP BY p10 HAVING COUNT(*) > 1`));

console.log("\nCROSS-CHECK vs lifetime repeat rate (memory: 77% one-and-done ⇒ ~23% repeat customers):");
console.table(await q(sql`
  SELECT COUNT(*) AS distinctCustomers,
         SUM(CASE WHEN n > 1 THEN 1 ELSE 0 END) AS repeatCustomers,
         ROUND(100.0 * SUM(CASE WHEN n > 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS repeatPctOfCustomers
  FROM (SELECT RIGHT(REGEXP_REPLACE(COALESCE(customerPhone,''),'[^0-9]',''),10) AS p10, COUNT(*) AS n
        FROM invoices WHERE paymentStatus='paid'
          AND LENGTH(REGEXP_REPLACE(COALESCE(customerPhone,''),'[^0-9]','')) >= 10
        GROUP BY p10) t`));

// ── E · The arrivals receipt ───────────────────────────────────────────
hdr("E · expected_arrivals → invoice receipt (the closed loop)");
console.table(await q(sql`SELECT status, COUNT(*) AS n, MIN(DATE(createdAt)) AS firstSeen, MAX(DATE(createdAt)) AS lastSeen FROM expected_arrivals GROUP BY status`));
console.log("source breakdown:");
console.table(await q(sql`SELECT source, COUNT(*) AS n FROM expected_arrivals GROUP BY source`));
console.log("reconciled INSIDE the digest window (what the digest reports):");
console.table(await q(sql`
  SELECT ea.id, ea.source, DATE(ea.expectedDate) AS expected, ea.arrivedAt, i.totalAmount/100 AS dollars
  FROM expected_arrivals ea JOIN invoices i ON i.id = ea.reconciledInvoiceId
  WHERE ea.status='arrived' AND ea.arrivedAt >= ${windowStart} AND ea.arrivedAt < ${now}`));
// cron_log uses snake_case columns but `started_at` (there is no created_at) —
// guessing it cost one loud crash, which is the correct failure mode.
console.log("is the reconcile cron alive? (dashboard-sync in cron_log, last 7d):");
console.table(await q(sql`
  SELECT job_name, status, COUNT(*) AS runs, MAX(started_at) AS lastRun,
         SUM(records_processed) AS recordsTotal
  FROM cron_log WHERE started_at >= ${windowStart} AND job_name LIKE '%dashboard%'
  GROUP BY job_name, status`));
console.log("arrival PRODUCERS — expected_arrivals by source (voice vs sms):");
console.table(await q(sql`
  SELECT source, status, COUNT(*) AS n FROM expected_arrivals GROUP BY source, status ORDER BY source, status`));
console.log("arrival OUTCOME rate (no_show vs arrived — is the 3-day reconcile window too tight?):");
console.table(await q(sql`
  SELECT ea.id, ea.status, DATE(ea.expectedDate) AS expected, ea.customerPhone,
         (SELECT COUNT(*) FROM invoices i
            WHERE i.paymentStatus='paid'
              AND RIGHT(REGEXP_REPLACE(COALESCE(i.customerPhone,''),'[^0-9]',''),10) = ea.customerPhone
              AND i.invoiceDate >= ea.expectedDate) AS anyPaidInvoiceEverAfter
  FROM expected_arrivals ea WHERE ea.status='no_show' ORDER BY ea.expectedDate DESC LIMIT 12`));

// ── F · Demand line — is 0 bookings/0 callbacks normal or DEAD? ─────────
hdr("F · demand line — weekly counts over 8 weeks (0 = normal, or a dead lane?)");
console.log("bookings by week:");
console.table(await q(sql`
  SELECT YEARWEEK(createdAt,1) AS yw, MIN(DATE(createdAt)) AS weekOf, COUNT(*) AS n
  FROM bookings WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 8 WEEK) GROUP BY yw ORDER BY yw DESC`));
console.log("callback_requests by week:");
console.table(await q(sql`
  SELECT YEARWEEK(createdAt,1) AS yw, MIN(DATE(createdAt)) AS weekOf, COUNT(*) AS n
  FROM callback_requests WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 8 WEEK) GROUP BY yw ORDER BY yw DESC`));
console.log("leads by week (raw) + callback-duplicate share:");
console.table(await q(sql`
  SELECT YEARWEEK(createdAt,1) AS yw, MIN(DATE(createdAt)) AS weekOf, COUNT(*) AS raw,
         SUM(CASE WHEN source='callback' AND callbackId IS NOT NULL THEN 1 ELSE 0 END) AS excludedDupes
  FROM leads WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 8 WEEK) GROUP BY yw ORDER BY yw DESC`));

// ── G · Other consumers of the DEAD columns ────────────────────────────
hdr("G · other consumers of partsCost/laborCost — are they publishing the same artifact?");
console.log("getDailyRevenueTruth's grossMargin, recomputed per day for the last 10 days:");
console.table(await q(sql`
  SELECT DATE(invoiceDate) AS day, COUNT(*) AS jobs,
         SUM(totalAmount)/100 AS revenue, SUM(partsCost)/100 AS parts,
         ROUND(100.0*(SUM(totalAmount)-SUM(partsCost))/NULLIF(SUM(totalAmount),0),1) AS marginPctItWouldReport
  FROM invoices WHERE paymentStatus='paid' AND invoiceDate >= DATE_SUB(NOW(), INTERVAL 10 DAY)
  GROUP BY day ORDER BY day DESC`));

process.exit(0);
