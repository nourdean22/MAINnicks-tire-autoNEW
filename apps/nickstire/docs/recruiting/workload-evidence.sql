-- Workload evidence — READ-ONLY queries behind "we keep techs busy".
--
-- WHY (docs/recruiting/RECRUITING-ENGINE-2026-09.md Sec. 6): the careers page
-- used to claim "one of Cleveland's busiest shops ... your hours are full".
-- The ShopDriver invoice mirror recorded 104-143 paid invoices a month
-- (Mar-Jul 2026, docs/CURRENT-TRUTH.md:293), which does not obviously support
-- that. Before ANY workload number goes on a public page, run these, and
-- reconcile each against the shop's own system (ShopDriver reports, the
-- tire-sales log). Publish weekly MEDIANS with a date and a methodology note,
-- never peaks, never revenue.
--
-- SAFETY: every statement is a SELECT (plus one session-only SET). Run in the
-- TiDB console (read-only user if one exists) or via `railway run` per the
-- prod-db-guard skill.
-- Times: stored TIMESTAMPs are bucketed in SQL, America/New_York, never in JS.
-- CONVERT_TZ(x, '+00:00', ...) assumes the SESSION is UTC — the default is
-- SYSTEM (UTC here) but a console can override it, so pin it first.
--
-- Queries 1-3 return a coverage column. A week with zero rows is "no data
-- captured", not "no work" — read the coverage before the number.
--
-- Checked 2026-09-23 with TiDB's own parser (pingcap/tidb/pkg/parser, build
-- 2026-09-22): all 8 statements in this file parse. Control: `COUNT(*) AS
-- lines` fails to parse (`lines` is reserved in TiDB), which is why query 4's
-- alias is line_count.

SET time_zone = '+00:00';

-- 0a. Control: must return 08:00:00, not NULL. NULL means the named zone did
--     not resolve and every ET bucket below is wrong.
SELECT @@session.time_zone AS session_tz,
       TIME(CONVERT_TZ('2026-07-01 12:00:00', '+00:00', 'America/New_York')) AS expect_08_00;

-- 0b. Is invoiceDate a real time or a bare date? The ShopDriver mirror writes
--     new Date(ri.date) (services/shopDriverMirror.ts). If ALG sends date-only
--     strings, every row sits at 00:00:00 UTC, CONVERT_TZ moves it to the
--     previous evening ET, and every Monday invoice lands in the prior ISO
--     week. If this shows (nearly) all rows at 00:00:00, drop CONVERT_TZ from
--     query 1 for source = 'shopdriver'.
SELECT TIME(invoiceDate) AS time_of_day, COUNT(*) AS invoices
FROM invoices
WHERE source = 'shopdriver'
GROUP BY time_of_day
ORDER BY invoices DESC
LIMIT 10;

-- 1. Paid invoices per week (ShopDriver mirror), last 26 weeks.
--    Coverage caveat: cash/walk-in tire sales may never reach ShopDriver.
SELECT
  YEARWEEK(CONVERT_TZ(invoiceDate, '+00:00', 'America/New_York'), 3) AS iso_week,
  COUNT(*)                                        AS paid_invoices,
  COUNT(DISTINCT DATE(CONVERT_TZ(invoiceDate, '+00:00', 'America/New_York'))) AS days_with_any_invoice
FROM invoices
WHERE paymentStatus = 'paid'
  AND invoiceDate >= DATE_SUB(NOW(), INTERVAL 26 WEEK)
GROUP BY iso_week
ORDER BY iso_week;

-- 2. Completed work orders per week, and how many carry labor hours at all.
--    If labor_rows is near zero, work_order_items is not a usable hours source.
SELECT
  YEARWEEK(CONVERT_TZ(wo.completed_at, '+00:00', 'America/New_York'), 3) AS iso_week,
  COUNT(DISTINCT wo.id)                                                   AS completed_work_orders,
  COUNT(woi.id)                                                           AS labor_rows,
  ROUND(SUM(woi.labor_hours), 1)                                          AS labor_hours_sold
FROM work_orders wo
LEFT JOIN work_order_items woi
  ON woi.work_order_id = wo.id AND woi.type = 'labor' AND woi.labor_hours IS NOT NULL
WHERE wo.completed_at >= DATE_SUB(NOW(), INTERVAL 26 WEEK)
  AND wo.status <> 'cancelled'
GROUP BY iso_week
ORDER BY iso_week;

-- 3. Clocked hours per technician per week (time_clock_entries).
--    open_punches > 0 means someone never clocked out: those hours are missing,
--    not zero.
SELECT
  t.id                                                                     AS technician_id,
  t.name                                                                   AS technician,
  YEARWEEK(CONVERT_TZ(tce.clock_in_at, '+00:00', 'America/New_York'), 3)   AS iso_week,
  ROUND(SUM(TIMESTAMPDIFF(MINUTE, tce.clock_in_at, tce.clock_out_at)) / 60, 1) AS clocked_hours,
  SUM(tce.clock_out_at IS NULL)                                            AS open_punches
FROM time_clock_entries tce
JOIN technicians t ON t.id = tce.technician_id
WHERE tce.clock_in_at >= DATE_SUB(NOW(), INTERVAL 26 WEEK)
GROUP BY t.id, t.name, iso_week
ORDER BY t.name, iso_week;

-- 4. Job mix over the last 90 days (what a master tech would actually do),
--    by work-order line type. Proves or disproves "mostly bread-and-butter".
SELECT
  woi.type                   AS line_type,
  COUNT(*)                   AS line_count,
  COUNT(DISTINCT woi.work_order_id) AS work_orders
FROM work_order_items woi
JOIN work_orders wo ON wo.id = woi.work_order_id
WHERE wo.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND wo.status <> 'cancelled'
GROUP BY line_type
ORDER BY line_count DESC;

-- 5. Review-volume standing — RETIRED 2026-09-23 (Q-48). competitor_snapshots
--    no longer stores review counts or ratings: Google Maps Platform Terms allow
--    caching a place_id, not Places content, so the table is a place_id registry
--    (source = 'place_id') and its rating/review_count columns are defaults (0),
--    not data. A "most-reviewed nearby" claim now needs a same-day ON-DEMAND read
--    (server/services/competitorMonitor.ts fetchCompetitorSnapshot), cited with
--    the date it was read — never a stored snapshot.
