/**
 * Statenour Bridge Routes — v11.4 cross-ring contract.
 *
 * Owner-auth endpoints for the statenour-os HQ to ticker live shop data.
 * Contract is mirrored in this repo at docs/NICKSTIRE-QUERY-CONTRACT.md
 * and in statenour-os at docs/NICKSTIRE-QUERY-CONTRACT.md — both files
 * MUST match for cross-ring stability.
 *
 * v11.3 adds `scope=alg` option on the estimates endpoints:
 *   - scope=online (default) — uses estimates_log table (AI estimator,
 *     customer portal, website-sourced quotes — the ONLINE funnel).
 *   - scope=alg — uses the new alg_estimates table (physical walk-in
 *     quotes synced from ShopDriver Elite). An alg_estimates row without
 *     a matchedInvoiceId = declined work = recovery target.
 *
 * v11.4 adds POST /api/bridge/bulk-sms-send — see its doc comment below.
 * This endpoint MUTATES (creates a campaign + sends SMS), unlike every
 * other endpoint here which is a pure DB read. It lives in THIS file
 * (not routes/nour-os-query.ts) because that file is explicitly
 * documented as read-only-by-design ("Don't add actions that mutate").
 * This file already hosts the one other mutating bridge surface (Snap
 * Finance), so the pattern (statenourAuth + express.json()) matches.
 *
 * Endpoints (all GET, all require X-Statenour-Sync-Key header):
 *   GET /api/bridge/cars-today
 *   GET /api/bridge/estimates-conversion?range=7d|30d|90d&scope=online|alg
 *   GET /api/bridge/estimates-aging?scope=online|alg
 *   GET /api/bridge/drop-off-ratio?range=7d|30d|90d
 *
 * Mutating endpoints (POST, auth varies):
 *   POST /api/snap/application    — owner-auth, proxies to Snap's API
 *   POST /api/snap/webhook        — public (signature-verified), status updates
 *   POST /api/bridge/bulk-sms-send — owner-auth, creates + sends an SMS campaign
 */

import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { timingSafeEqual } from "crypto";
import { createLogger } from "../lib/logger";
import { BUSINESS } from "@shared/business";

const log = createLogger("statenour-bridge");

/**
 * forensic-audit MEDIUM · 'today' in the shop's timezone, not the TiDB server's
 * UTC day. Returns the ET date string (for the ET-stored preferredDate varchar)
 * plus the UTC instant bounds of the ET day (for UTC timestamp columns like
 * createdAt / invoiceDate). Previously these used CURDATE(), so after ~8pm ET
 * the HQ ticker showed 0 for a day that still had a full afternoon of work.
 */
function shopTodayBounds(): { todayET: string; startUtc: Date; endUtc: Date } {
  const tz = BUSINESS.timezone;
  const fmt = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz }); // "YYYY-MM-DD"
  const offsetMin = (instant: Date): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(instant);
    const m: Record<string, string> = {};
    for (const p of parts) m[p.type] = p.value;
    const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour === 24 ? 0 : +m.hour, +m.minute, +m.second);
    return (asUTC - instant.getTime()) / 60000;
  };
  const zonedMidnightUtc = (dateStr: string): Date => {
    const naive = new Date(`${dateStr}T00:00:00Z`);
    return new Date(naive.getTime() - offsetMin(naive) * 60000);
  };
  const now = new Date();
  const todayET = fmt(now);
  const tomorrowET = fmt(new Date(new Date(`${todayET}T12:00:00Z`).getTime() + 24 * 3600 * 1000));
  return { todayET, startUtc: zonedMidnightUtc(todayET), endUtc: zonedMidnightUtc(tomorrowET) };
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// ─── Auth middleware ───────────────────────────────────
function statenourAuth(req: Request, res: Response, next: NextFunction): void {
  const key = process.env.STATENOUR_SYNC_KEY;
  if (!key) {
    res.status(503).json({ error: "Statenour bridge not configured" });
    return;
  }
  const provided = req.headers["x-statenour-sync-key"];
  if (typeof provided !== "string" || !safeCompare(provided, key)) {
    log.warn("Statenour bridge auth failed", {
      path: req.path,
      ip: req.ip,
      hasHeader: !!provided,
    });
    res.status(401).json({ error: "Invalid sync key" });
    return;
  }
  next();
}

// ─── SQL exec helper that handles MySQL2's tuple return shape ───
async function exec(d: unknown, q: unknown): Promise<Record<string, unknown>[]> {
  // d.execute returns [rows, fields] tuple on mysql2; some code returns rows directly
  const result = (await (d as { execute: (q: unknown) => Promise<unknown> }).execute(q)) as unknown;
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as Record<string, unknown>[];
  }
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return [];
}

/**
 * Pull the ALG mirror's last-successful-sync timestamp WITHOUT triggering
 * any network probe. This is a pure in-process getter — zero risk of
 * kicking the shop's ShopDriver session.
 *
 * Returns:
 *   - dataAsOf: ISO timestamp of the last successful ALG pull, or null
 *   - staleness: "live" (<5min), "recent" (<30min), "stale" (<2h),
 *                "very_stale" (>2h), or "uncollected" (null)
 *
 * Statenour uses this to render an "as of Xm ago" footer on each card
 * so operators know how fresh the numbers are.
 */
async function getMirrorFreshness(): Promise<{
  dataAsOf: string | null;
  ageMinutes: number | null;
  staleness: "live" | "recent" | "stale" | "very_stale" | "uncollected";
}> {
  try {
    const { getLastSuccessfulSync } = await import("../services/shopDriverMirror");
    const last = getLastSuccessfulSync();
    if (!last) {
      return { dataAsOf: null, ageMinutes: null, staleness: "uncollected" };
    }
    const ageMs = Date.now() - last.getTime();
    const ageMinutes = Math.round(ageMs / 60000);
    let staleness: "live" | "recent" | "stale" | "very_stale";
    if (ageMinutes < 5) staleness = "live";
    else if (ageMinutes < 30) staleness = "recent";
    else if (ageMinutes < 120) staleness = "stale";
    else staleness = "very_stale";
    return { dataAsOf: last.toISOString(), ageMinutes, staleness };
  } catch {
    return { dataAsOf: null, ageMinutes: null, staleness: "uncollected" };
  }
}

/**
 * Same shape as getMirrorFreshness() but sourced from the ALG ESTIMATE
 * sync (shopDriverEstimateSync.ts). Used by scope=alg bridge endpoints
 * so the "as of" footer reflects the estimate sync's own cadence, not
 * the invoice mirror's.
 */
async function getEstimateMirrorFreshness(): Promise<{
  dataAsOf: string | null;
  ageMinutes: number | null;
  staleness: "live" | "recent" | "stale" | "very_stale" | "uncollected";
}> {
  try {
    const { getLastEstimateSync } = await import("../services/shopDriverEstimateSync");
    const last = getLastEstimateSync();
    if (!last) {
      return { dataAsOf: null, ageMinutes: null, staleness: "uncollected" };
    }
    const ageMs = Date.now() - last.getTime();
    const ageMinutes = Math.round(ageMs / 60000);
    let staleness: "live" | "recent" | "stale" | "very_stale";
    if (ageMinutes < 5) staleness = "live";
    else if (ageMinutes < 30) staleness = "recent";
    else if (ageMinutes < 120) staleness = "stale";
    else staleness = "very_stale";
    return { dataAsOf: last.toISOString(), ageMinutes, staleness };
  } catch {
    return { dataAsOf: null, ageMinutes: null, staleness: "uncollected" };
  }
}

function rangeToDays(range: string | undefined): number {
  switch (range) {
    case "7d": return 7;
    case "90d": return 90;
    case "30d":
    default: return 30;
  }
}

/**
 * wave-165: defense-in-depth integer guard before any sql.raw(String(days))
 * interpolation. Even though rangeToDays() currently can't return anything
 * else, this prevents a future contributor from accidentally widening the
 * switch and introducing an INTERVAL-NaN-DAY DB crash (or worse). Throws
 * loudly rather than silently returning a default so the bug is found at
 * test time, not in production.
 */
function safeDays(d: number): number {
  if (!Number.isInteger(d) || d < 1 || d > 730) {
    throw new Error(`statenour-bridge: invalid days=${d}`);
  }
  return d;
}

// ─── Registration ──────────────────────────────────────
export function registerStatenourBridgeRoutes(app: Express): void {

  // ─── 1. GET /api/bridge/cars-today ────────────────────
  app.get("/api/bridge/cars-today", statenourAuth, async (_req, res) => {
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      if (!d) {
        return res.status(503).json({ error: "DB unavailable" });
      }

      // forensic-audit MEDIUM · 'today' in the shop's timezone (Cleveland ET),
      // not the TiDB server's UTC day. preferredDate is an ET-stored varchar
      // (compare to the ET date string); createdAt / invoiceDate are UTC
      // timestamps (compare against the ET day's UTC bounds).
      const { todayET, startUtc, endUtc } = shopTodayBounds();
      const [bookingRows, invoiceRows] = await Promise.all([
        exec(d, sql`
          SELECT
            SUM(CASE WHEN stage = 'received' AND status != 'cancelled' THEN 1 ELSE 0 END) AS drop_off,
            SUM(CASE WHEN stage IN ('inspecting','waiting-parts','in-progress','quality-check') THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN stage = 'ready' THEN 1 ELSE 0 END) AS ready,
            COUNT(*) AS total_bookings
          FROM bookings
          WHERE ((createdAt >= ${startUtc} AND createdAt < ${endUtc}) OR preferredDate = ${todayET})
            AND status != 'cancelled'
        `),
        exec(d, sql`
          SELECT COUNT(*) AS paid, COALESCE(SUM(totalAmount), 0) AS totalCents, COALESCE(AVG(totalAmount), 0) AS avgCents
          FROM invoices
          WHERE invoiceDate >= ${startUtc} AND invoiceDate < ${endUtc}
            AND paymentStatus = 'paid'
        `),
      ]);

      const b = bookingRows[0] ?? {};
      const inv = invoiceRows[0] ?? {};
      const drop_off = Number(b.drop_off ?? 0);
      const in_progress = Number(b.in_progress ?? 0);
      const ready = Number(b.ready ?? 0);
      const paid = Number(inv.paid ?? 0);
      const totalBookings = Number(b.total_bookings ?? 0);
      const count = totalBookings + paid; // today's total cars touched
      const openTickets = drop_off + in_progress + ready;
      const avgTicket = Math.round(Number(inv.avgCents ?? 0)) / 100;

      // Split today's revenue by payment method so statenour can show
      // "snap vs acima vs koalafi vs cash/card" breakout instead of a
      // single blended "paid" number
      const paymentBreakdown = await exec(d, sql`
        SELECT paymentMethod, COUNT(*) AS cnt, COALESCE(SUM(totalAmount), 0) AS totalCents
        FROM invoices
        WHERE DATE(invoiceDate) = CURDATE() AND paymentStatus = 'paid'
        GROUP BY paymentMethod
      `);
      const byPayment = Object.fromEntries(
        paymentBreakdown.map((r) => [
          String(r.paymentMethod ?? "unknown"),
          {
            count: Number(r.cnt ?? 0),
            totalDollars: Math.round(Number(r.totalCents ?? 0)) / 100,
          },
        ]),
      );

      const freshness = await getMirrorFreshness();
      res.json({
        count,
        openTickets,
        avgTicket,
        byStatus: { drop_off, in_progress, ready, paid },
        byPayment,
        generatedAt: new Date().toISOString(),
        dataAsOf: freshness.dataAsOf,
        ageMinutes: freshness.ageMinutes,
        staleness: freshness.staleness,
        source: {
          bookings: "nickstire.org bookings table (DB-resident)",
          invoices: "ALG mirror (see dataAsOf for freshness)",
          note: "Counts reflect last-synced ALG state, not the live shop ShopDriver screen.",
        },
      });
    } catch (err) {
      log.error("cars-today failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ─── 2. GET /api/bridge/estimates-conversion ──────────
  app.get("/api/bridge/estimates-conversion", statenourAuth, async (req, res) => {
    try {
      const days = rangeToDays(typeof req.query.range === "string" ? req.query.range : undefined);
      const scope = (typeof req.query.scope === "string" ? req.query.scope : "online").toLowerCase();
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      if (!d) return res.status(503).json({ error: "DB unavailable" });

      // scope=alg: walk-in quotes from ShopDriver Elite (alg_estimates table)
      if (scope === "alg") {
        const [algSummary, algUnmatched] = await Promise.all([
          exec(d, sql`
            SELECT
              COUNT(*) AS given,
              SUM(CASE WHEN matched_invoice_id IS NOT NULL THEN 1 ELSE 0 END) AS converted,
              AVG(CASE
                WHEN matched_invoice_id IS NOT NULL
                THEN TIMESTAMPDIFF(MINUTE, estimate_date, matched_at)
                ELSE NULL
              END) / 60 AS avgHours,
              COALESCE(SUM(CASE WHEN matched_invoice_id IS NULL THEN estimated_amount ELSE 0 END), 0) AS declinedCents
            FROM alg_estimates
            WHERE estimate_date >= DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(safeDays(days)))} DAY)
          `),
          exec(d, sql`
            SELECT customer_name AS name, service_description AS service,
              estimated_amount AS amountCents,
              TIMESTAMPDIFF(DAY, estimate_date, NOW()) AS daysOld
            FROM alg_estimates
            WHERE matched_invoice_id IS NULL
              AND estimate_date >= DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(safeDays(days)))} DAY)
            ORDER BY estimated_amount DESC
            LIMIT 5
          `),
        ]);
        const s = algSummary[0] ?? {};
        const given = Number(s.given ?? 0);
        const converted = Number(s.converted ?? 0);
        const rate = given > 0 ? Math.round((converted / given) * 1000) / 10 : 0;
        const avgTimeToConvertHours = Math.round(Number(s.avgHours ?? 0) * 10) / 10;
        const declinedValueDollars = Math.round(Number(s.declinedCents ?? 0)) / 100;
        const topUnmatched = algUnmatched.map((r) => ({
          name: String(r.name ?? "Unknown"),
          service: String(r.service ?? ""),
          amount: Math.round(Number(r.amountCents ?? 0)) / 100,
          daysOld: Number(r.daysOld ?? 0),
        }));

        const freshness = await getEstimateMirrorFreshness();
        return res.json({
          range: `${days}d`,
          given,
          converted,
          rate,
          avgTimeToConvertHours,
          declinedCount: given - converted,
          declinedValue: declinedValueDollars,
          topUnmatched,
          generatedAt: new Date().toISOString(),
          dataAsOf: freshness.dataAsOf,
          ageMinutes: freshness.ageMinutes,
          staleness: freshness.staleness,
          scope: "alg",
          source: {
            estimates: "alg_estimates table — walk-in quotes synced from ShopDriver Elite via shopDriverEstimateSync.ts",
            match: "phone + invoice amount within ±10% + invoiceDate within 30d of estimateDate",
            note: "This is the OFFLINE/WALK-IN funnel. A row without matched_invoice_id = declined work, targeted by the declined-work-recovery cron.",
          },
        });
      }

      // scope=online (default): estimates_log (AI + portal + website-sourced)
      const [summary, byServiceRows] = await Promise.all([
        exec(d, sql`
          SELECT
            COUNT(*) AS given,
            SUM(CASE WHEN converted = 1 THEN 1 ELSE 0 END) AS converted,
            AVG(CASE
              WHEN converted = 1 AND invoiceId IS NOT NULL
              THEN TIMESTAMPDIFF(
                MINUTE,
                estimates_log.createdAt,
                (SELECT invoiceDate FROM invoices WHERE invoices.id = estimates_log.invoiceId)
              )
              ELSE NULL
            END) / 60 AS avgHours
          FROM estimates_log
          WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(safeDays(days)))} DAY)
        `),
        exec(d, sql`
          SELECT service,
            COUNT(*) AS given,
            SUM(CASE WHEN converted = 1 THEN 1 ELSE 0 END) AS converted
          FROM estimates_log
          WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(safeDays(days)))} DAY)
          GROUP BY service
          ORDER BY given DESC
          LIMIT 10
        `),
      ]);

      const s = summary[0] ?? {};
      const given = Number(s.given ?? 0);
      const converted = Number(s.converted ?? 0);
      const rate = given > 0 ? Math.round((converted / given) * 1000) / 10 : 0;
      const avgTimeToConvertHours = Math.round(Number(s.avgHours ?? 0) * 10) / 10;

      const byService = byServiceRows.map((r) => ({
        service: String(r.service ?? "unknown"),
        given: Number(r.given ?? 0),
        converted: Number(r.converted ?? 0),
        rate: Number(r.given ?? 0) > 0
          ? Math.round((Number(r.converted ?? 0) / Number(r.given ?? 1)) * 1000) / 10
          : 0,
      }));

      const freshness = await getMirrorFreshness();
      res.json({
        range: `${days}d`,
        given,
        converted,
        rate,
        avgTimeToConvertHours,
        byService,
        generatedAt: new Date().toISOString(),
        dataAsOf: freshness.dataAsOf,
        ageMinutes: freshness.ageMinutes,
        staleness: freshness.staleness,
        scope: "online",
        source: {
          estimates: "estimates_log table — AI estimator + customer portal + ShopDriver-synced rows",
          invoices: "ALG mirror (via shopDriverMirror)",
          note: "Does NOT include counter-only quotes written by hand in ALG that never hit our systems. This is the ONLINE funnel. Pass scope=alg for walk-in quotes.",
        },
      });
    } catch (err) {
      log.error("estimates-conversion failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ─── 3. GET /api/bridge/estimates-aging ───────────────
  app.get("/api/bridge/estimates-aging", statenourAuth, async (req, res) => {
    try {
      const scope = (typeof req.query.scope === "string" ? req.query.scope : "online").toLowerCase();
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      if (!d) return res.status(503).json({ error: "DB unavailable" });

      // scope=alg: age unmatched ALG walk-in estimates (declined work)
      if (scope === "alg") {
        const [algBuckets, algStalestRows, algTotalValueRows] = await Promise.all([
          exec(d, sql`
            SELECT
              SUM(CASE WHEN TIMESTAMPDIFF(HOUR, estimate_date, NOW()) < 24 THEN 1 ELSE 0 END) AS bucket_lt24h,
              SUM(CASE WHEN TIMESTAMPDIFF(HOUR, estimate_date, NOW()) BETWEEN 24 AND 72 THEN 1 ELSE 0 END) AS bucket_1d_3d,
              SUM(CASE WHEN TIMESTAMPDIFF(HOUR, estimate_date, NOW()) BETWEEN 73 AND 168 THEN 1 ELSE 0 END) AS bucket_3d_7d,
              SUM(CASE WHEN TIMESTAMPDIFF(HOUR, estimate_date, NOW()) > 168 THEN 1 ELSE 0 END) AS bucket_gt7d,
              COUNT(*) AS total
            FROM alg_estimates
            WHERE matched_invoice_id IS NULL
          `),
          exec(d, sql`
            SELECT id, customer_name AS name, customer_phone AS phone, service_description AS service,
              estimated_amount AS amountCents,
              TIMESTAMPDIFF(DAY, estimate_date, NOW()) AS days
            FROM alg_estimates
            WHERE matched_invoice_id IS NULL
            ORDER BY estimate_date ASC
            LIMIT 1
          `),
          exec(d, sql`
            SELECT COALESCE(SUM(estimated_amount), 0) AS totalDeclinedCents
            FROM alg_estimates
            WHERE matched_invoice_id IS NULL
              AND estimate_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
          `),
        ]);

        const b = algBuckets[0] ?? {};
        const row = algStalestRows[0];
        const stalest = row ? {
          id: Number(row.id),
          customer: String(row.name ?? "Unknown"),
          service: String(row.service ?? ""),
          days: Number(row.days ?? 0),
          amount: Math.round(Number(row.amountCents ?? 0)) / 100,
        } : null;
        const totalDeclinedValue = Math.round(Number(algTotalValueRows[0]?.totalDeclinedCents ?? 0)) / 100;

        const freshness = await getEstimateMirrorFreshness();
        return res.json({
          total: Number(b.total ?? 0),
          bucket_lt24h: Number(b.bucket_lt24h ?? 0),
          bucket_1d_3d: Number(b.bucket_1d_3d ?? 0),
          bucket_3d_7d: Number(b.bucket_3d_7d ?? 0),
          bucket_gt7d: Number(b.bucket_gt7d ?? 0),
          stalest,
          totalDeclinedValue,
          generatedAt: new Date().toISOString(),
          dataAsOf: freshness.dataAsOf,
          ageMinutes: freshness.ageMinutes,
          staleness: freshness.staleness,
          scope: "alg",
          source: {
            estimates: "alg_estimates WHERE matched_invoice_id IS NULL — walked customers with no matching invoice.",
            totalDeclinedValue: "Sum of estimated_amount for unmatched quotes in last 60d (dollars).",
          },
        });
      }

      // scope=online (default): estimates_log aging
      const [buckets, stalestRows] = await Promise.all([
        exec(d, sql`
          SELECT
            SUM(CASE WHEN TIMESTAMPDIFF(HOUR, createdAt, NOW()) < 24 THEN 1 ELSE 0 END) AS bucket_lt24h,
            SUM(CASE WHEN TIMESTAMPDIFF(HOUR, createdAt, NOW()) BETWEEN 24 AND 72 THEN 1 ELSE 0 END) AS bucket_1d_3d,
            SUM(CASE WHEN TIMESTAMPDIFF(HOUR, createdAt, NOW()) BETWEEN 73 AND 168 THEN 1 ELSE 0 END) AS bucket_3d_7d,
            SUM(CASE WHEN TIMESTAMPDIFF(HOUR, createdAt, NOW()) > 168 THEN 1 ELSE 0 END) AS bucket_gt7d,
            COUNT(*) AS total
          FROM estimates_log
          WHERE converted = 0
        `),
        exec(d, sql`
          SELECT id, name, phone, service,
            estimatedAmountCents,
            TIMESTAMPDIFF(DAY, createdAt, NOW()) AS days
          FROM estimates_log
          WHERE converted = 0
          ORDER BY createdAt ASC
          LIMIT 1
        `),
      ]);

      const b = buckets[0] ?? {};
      const stalestRow = stalestRows[0];
      const stalest = stalestRow ? {
        id: Number(stalestRow.id),
        customer: String(stalestRow.name ?? "Unknown"),
        service: String(stalestRow.service ?? ""),
        days: Number(stalestRow.days ?? 0),
        amount: Number(stalestRow.estimatedAmountCents ?? 0) / 100,
      } : null;

      const freshness = await getMirrorFreshness();
      res.json({
        total: Number(b.total ?? 0),
        bucket_lt24h: Number(b.bucket_lt24h ?? 0),
        bucket_1d_3d: Number(b.bucket_1d_3d ?? 0),
        bucket_3d_7d: Number(b.bucket_3d_7d ?? 0),
        bucket_gt7d: Number(b.bucket_gt7d ?? 0),
        stalest,
        generatedAt: new Date().toISOString(),
        dataAsOf: freshness.dataAsOf,
        ageMinutes: freshness.ageMinutes,
        staleness: freshness.staleness,
        scope: "online",
        source: {
          estimates: "estimates_log WHERE converted = 0 — online funnel only. Pass scope=alg for walk-in quotes.",
        },
      });
    } catch (err) {
      log.error("estimates-aging failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ─── 4. GET /api/bridge/drop-off-ratio ────────────────
  app.get("/api/bridge/drop-off-ratio", statenourAuth, async (req, res) => {
    try {
      const days = rangeToDays(typeof req.query.range === "string" ? req.query.range : undefined);
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      if (!d) return res.status(503).json({ error: "DB unavailable" });

      // Heuristic for drop-off vs walk-in:
      //   drop-off = booking has preferredDate (customer planned ahead)
      //   walk-in  = no preferredDate or came in same-day
      // This is the best signal we have without adding a schema column.
      const [rows, uberRows] = await Promise.all([
        exec(d, sql`
          SELECT
            SUM(CASE
              WHEN preferredDate IS NOT NULL AND preferredDate != ''
              THEN 1 ELSE 0
            END) AS drop_offs,
            SUM(CASE
              WHEN preferredDate IS NULL OR preferredDate = ''
              THEN 1 ELSE 0
            END) AS walk_ins
          FROM bookings
          WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(safeDays(days)))} DAY)
            AND status != 'cancelled'
        `),
        // Count Uber-out trackings from audit_log (requires uber-code endpoint to log there)
        exec(d, sql`
          SELECT COUNT(*) AS cnt FROM audit_log
          WHERE action = 'customer.uber_requested'
            AND created_at >= DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(safeDays(days)))} DAY)
        `),
      ]);

      const r = rows[0] ?? {};
      const dropOffs = Number(r.drop_offs ?? 0);
      const walkIns = Number(r.walk_ins ?? 0);
      const total = dropOffs + walkIns;
      const ratio = total > 0 ? Math.round((dropOffs / total) * 1000) / 10 : 0;
      const uberBackCount = Number(uberRows[0]?.cnt ?? 0);

      const freshness = await getMirrorFreshness();
      res.json({
        range: `${days}d`,
        dropOffs,
        walkIns,
        ratio,
        uberBackCount,
        generatedAt: new Date().toISOString(),
        dataAsOf: freshness.dataAsOf,
        ageMinutes: freshness.ageMinutes,
        staleness: freshness.staleness,
        source: {
          bookings: "bookings table — preferredDate heuristic (drop-off if set, walk-in if null).",
          uber: "audit_log customer.uber_requested — populated by /api/uber-code.",
          note: "Heuristic only — our data model doesn't explicitly flag drop-off vs walk-in yet.",
        },
      });
    } catch (err) {
      log.error("drop-off-ratio failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ─── 5a. POST /api/snap/application ───────────────────
  //     Owner-authed proxy. Stashes result in audit_log.
  app.post("/api/snap/application", statenourAuth, express.json(), async (req, res) => {
    try {
      const body = req.body as {
        customerName?: string;
        customerPhone?: string;
        customerEmail?: string;
        amount?: number;
        vehicle?: string;
        service?: string;
      };

      if (!body?.customerName || !body?.customerPhone) {
        return res.status(400).json({ error: "customerName and customerPhone are required" });
      }

      // Proxy to Snap's API — if credentials not set, record-only mode
      const snapApiKey = process.env.SNAP_FINANCE_API_KEY;
      const snapMerchantId = process.env.SNAP_FINANCE_MERCHANT_ID;

      let snapResponse: Record<string, unknown> | null = null;
      let applicationId: string | null = null;
      let status = "pending";

      if (snapApiKey && snapMerchantId) {
        // Attempt real Snap API call. If Snap's API surface changes, fail gracefully.
        try {
          const r = await fetch("https://api.snapfinance.com/v1/applications", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${snapApiKey}`,
              "X-Merchant-Id": snapMerchantId,
            },
            body: JSON.stringify({
              merchant_id: snapMerchantId,
              customer: {
                name: body.customerName,
                phone: body.customerPhone,
                email: body.customerEmail ?? null,
              },
              amount: body.amount ?? null,
              vehicle: body.vehicle ?? null,
              service_description: body.service ?? null,
            }),
            signal: AbortSignal.timeout(15_000),
          });
          snapResponse = (await r.json().catch(() => ({}))) as Record<string, unknown>;
          applicationId = (snapResponse.id ?? snapResponse.applicationId ?? null) as string | null;
          status = (snapResponse.status as string) ?? "pending";
        } catch (err) {
          log.warn("Snap API proxy failed — recording in local log only", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Always record locally in audit_log for admin visibility
      const { recordSnapApplication } = await import("../services/snapApplications");
      const localId = await recordSnapApplication({
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerEmail: body.customerEmail,
        amount: body.amount,
        vehicle: body.vehicle,
        service: body.service,
        externalApplicationId: applicationId,
        status,
        // Use req.ip (respects the configured trust proxy) rather than the
        // leftmost x-forwarded-for entry, which is client-controlled/spoofable.
        // Attribution metadata only, but keep it honest.
        ipAddress: req.ip || null,
      });

      res.json({
        success: true,
        localId,
        externalApplicationId: applicationId,
        status,
        proxyUsed: !!(snapApiKey && snapMerchantId),
      });
    } catch (err) {
      log.error("snap/application failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ─── 5b. POST /api/snap/webhook ───────────────────────
  //     Snap-side status callback. Verifies an HMAC signature if
  //     SNAP_FINANCE_WEBHOOK_SECRET is set. Otherwise accepts anonymously
  //     for initial rollout — document this publicly.
  app.post("/api/snap/webhook", express.json(), async (req, res) => {
    try {
      // v1.7 audit fix · pre-fix: when SNAP_FINANCE_WEBHOOK_SECRET was
      // unset the verify block was skipped and any caller could POST
      // forged "approved" application status / payment events into the
      // DB. The header-comment said "for initial rollout — document
      // this publicly" but there was no expiry. Fail-closed now.
      const secret = process.env.SNAP_FINANCE_WEBHOOK_SECRET;
      if (!secret) {
        log.warn("Snap webhook called but SNAP_FINANCE_WEBHOOK_SECRET unset — rejecting");
        return res.status(503).json({ error: "Snap webhook not configured" });
      }
      const signature = req.headers["x-snap-signature"];
      if (typeof signature !== "string" || !signature) {
        return res.status(401).json({ error: "Missing signature" });
      }
      const crypto = await import("crypto");
      const expected = crypto.createHmac("sha256", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");
      if (!safeCompare(expected, signature)) {
        log.warn("Snap webhook signature mismatch");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const body = req.body as {
        applicationId?: string;
        status?: string;
        amount?: number;
        customerName?: string;
      };
      if (!body?.applicationId || !body?.status) {
        return res.status(400).json({ error: "applicationId and status required" });
      }

      const { updateSnapApplicationStatus } = await import("../services/snapApplications");
      await updateSnapApplicationStatus({
        externalApplicationId: body.applicationId,
        status: body.status,
        amount: body.amount,
      });

      // If approved + amount, also record the Stripe-style revenue row
      if (body.status === "approved" && body.amount && body.customerName) {
        const { recordSnapPayment } = await import("../services/snapFinanceSync");
        await recordSnapPayment({
          customerName: body.customerName,
          customerPhone: "",
          amount: body.amount,
          snapApplicationId: body.applicationId,
          approvalDate: new Date(),
        });
      }

      res.json({ success: true });
    } catch (err) {
      log.error("snap/webhook failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ─── 6. POST /api/bridge/bulk-sms-send ────────────────
  //     Dispatch target for statenour's bulk-sms-approval Inngest
  //     workflow (apps/statenour/lib/inngest/functions/bulk-sms-approval.ts).
  //     By the time a request reaches here, the operator has already
  //     approved the campaign via the Telegram approval gate — this
  //     endpoint is the actual send, not a second approval point.
  //
  //     Reuses the EXACT pipeline the admin campaigns UI uses
  //     (routers/campaigns.ts: getSegmentCustomers + processCampaignSends)
  //     so a bridge-triggered campaign gets the same safety machinery as
  //     an admin-triggered one for free: resumable at-most-once claim,
  //     gateway-offline holding (never drops, holds until the F25e is
  //     back), 1 SMS/sec rate limiting, and — inside sendSms — the
  //     per-phone daily cap (8/day), 5-min cooldown, opt-out check, and
  //     TCPA "Reply STOP" footer.
  //
  //     Two independent safety layers on top of that pipeline:
  //       1. dryRun defaults to true. A dry run does DB reads only —
  //          no campaign row, no send — and returns the target count +
  //          a rendered message preview so the caller can sanity-check
  //          before ever risking a real send.
  //       2. A hard per-call recipient cap (BULK_BRIDGE_MAX_RECIPIENTS)
  //          well under the segment's natural size. Bridge-triggered
  //          campaigns are meant to be targeted (winback, a specific
  //          recovery push), not full-database blasts — an operator who
  //          needs a bigger blast should use the admin UI directly,
  //          where each send is a deliberate, visible click.
  //
  //     Segment is restricted to the same 3-value enum the admin UI
  //     uses (recent | lapsed | all) rather than an open filter object —
  //     an arbitrary cross-network filter is both a SQL-surface risk and
  //     a way to accidentally target more customers than intended. If a
  //     future caller needs different targeting, add a named segment
  //     here (mirroring getSegmentCustomers), don't accept raw SQL/filters.
  //
  //     variantKey is tagged `bulk_campaign:<statenour campaignId>` on
  //     every send (via smsMessages.variantKey) so per-campaign
  //     attribution round-trips back to the statenour-side campaign id.
  const BULK_BRIDGE_MAX_RECIPIENTS = 300;
  const BULK_BRIDGE_SEGMENTS = ["recent", "lapsed", "all"] as const;

  app.post("/api/bridge/bulk-sms-send", statenourAuth, express.json(), async (req, res) => {
    try {
      const body = req.body as {
        campaignId?: unknown;
        segment?: unknown;
        messageTemplate?: unknown;
        maxRecipients?: unknown;
        dryRun?: unknown;
      };

      if (typeof body?.campaignId !== "string" || !body.campaignId.trim()) {
        return res.status(400).json({ error: "campaignId (non-empty string) is required" });
      }
      const campaignId = body.campaignId.trim().slice(0, 80);

      if (typeof body.segment !== "string" || !(BULK_BRIDGE_SEGMENTS as readonly string[]).includes(body.segment)) {
        return res.status(400).json({ error: `segment must be one of ${BULK_BRIDGE_SEGMENTS.join(", ")}` });
      }
      const segment = body.segment as (typeof BULK_BRIDGE_SEGMENTS)[number];

      if (typeof body.messageTemplate !== "string" || !body.messageTemplate.trim()) {
        return res.status(400).json({ error: "messageTemplate (non-empty string) is required" });
      }
      if (body.messageTemplate.length > 1600) {
        return res.status(400).json({ error: "messageTemplate exceeds 1600 chars" });
      }
      const messageTemplate = body.messageTemplate;

      const requestedCap = typeof body.maxRecipients === "number" && body.maxRecipients > 0
        ? Math.floor(body.maxRecipients)
        : BULK_BRIDGE_MAX_RECIPIENTS;
      const cap = Math.min(requestedCap, BULK_BRIDGE_MAX_RECIPIENTS);

      // dryRun defaults true — the caller must explicitly pass `dryRun: false`
      // to risk a real send. Any other value (undefined, missing, truthy) stays safe.
      const dryRun = body.dryRun !== false;

      const { getSegmentCustomers, processCampaignSends } = await import("../routers/campaigns");
      const { withOptOut } = await import("../sms");

      const allTargets = await getSegmentCustomers(segment);
      const truncated = allTargets.length > cap;
      const targets = allTargets.slice(0, cap);
      const variantKey = `bulk_campaign:${campaignId}`;

      const preview = targets[0]
        ? withOptOut(messageTemplate.replace(/\{firstName\}/g, targets[0].firstName))
        : withOptOut(messageTemplate);

      if (dryRun) {
        log.info("bulk-sms-send dry run", { campaignId, segment, targetCount: targets.length, truncated });
        try {
          const { sendTelegram } = await import("../services/telegram");
          await sendTelegram(
            `🧪 <b>Bulk SMS DRY RUN</b> · campaign <code>${campaignId}</code>\n` +
              `Segment: ${segment} · Targets: <b>${targets.length}</b>` +
              (truncated ? ` (capped from ${allTargets.length})` : "") + `\n` +
              `Preview: ${preview.slice(0, 200)}\n\n` +
              `No SMS sent. Re-send with dryRun:false to go live.`,
          );
        } catch (e) {
          log.warn("[bulk-sms-send] dry-run telegram notify failed:", e);
        }
        return res.json({ success: true, dryRun: true, targetCount: targets.length, truncated, preview, variantKey });
      }

      if (targets.length === 0) {
        return res.status(400).json({ error: "No customers in target segment" });
      }

      const { getDb } = await import("../db");
      const { eq } = await import("drizzle-orm");
      const { smsCampaigns, smsCampaignSends } = await import("../../drizzle/schema");
      const d = await getDb();
      if (!d) return res.status(503).json({ error: "DB unavailable" });

      const [campaignRow] = await d.insert(smsCampaigns).values({
        name: `Bridge · ${campaignId}`.slice(0, 255),
        // template is a required enum column but unused whenever customMessage
        // is set (see routers/campaigns.ts `send`) — placeholder value only.
        template: "special_offer",
        segment,
        customMessage: messageTemplate,
        targetCount: targets.length,
        status: "draft",
      }).$returningId();
      const campaignDbId = campaignRow.id;

      const sendRecords = targets.map((c) => ({
        campaignId: campaignDbId,
        customerId: c.id,
        phone: c.phone,
        messageBody: withOptOut(messageTemplate.replace(/\{firstName\}/g, c.firstName)),
        status: "pending" as const,
      }));
      for (let i = 0; i < sendRecords.length; i += 500) {
        await d.insert(smsCampaignSends).values(sendRecords.slice(i, i + 500));
      }

      // draft -> active, same atomic-claim shape as the admin `send` mutation
      // (single caller here, but keeps the two paths byte-consistent).
      await d.update(smsCampaigns)
        .set({ status: "active", startedAt: new Date() })
        .where(eq(smsCampaigns.id, campaignDbId));

      processCampaignSends(campaignDbId, 50, variantKey).catch((err) => {
        log.error("bulk-sms-send campaign processing failed", {
          campaignDbId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      try {
        const { sendTelegram } = await import("../services/telegram");
        await sendTelegram(
          `📤 <b>Bulk SMS LIVE</b> · campaign <code>${campaignId}</code> (db#${campaignDbId})\n` +
            `Segment: ${segment} · Sending to <b>${targets.length}</b>` +
            (truncated ? ` (capped from ${allTargets.length})` : "") + ` customers.`,
        );
      } catch (e) {
        log.warn("[bulk-sms-send] live-send telegram notify failed:", e);
      }

      res.json({ success: true, dryRun: false, campaignDbId, targetCount: targets.length, truncated, variantKey });
    } catch (err) {
      log.error("bulk-sms-send failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: "Internal error" });
    }
  });

  log.info("Statenour bridge routes registered (6 endpoints, contract v11.4)");
}
