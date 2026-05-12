/**
 * NOUR OS Query API — On-demand data access for statenour COO
 *
 * POST /api/nour-os/query
 * Header: x-sync-key (required)
 * Body: { query: string, filters?: Record<string, unknown> }
 *
 * Gives statenour real-time data access instead of waiting for 15-min sync dumps.
 * The statenour AI COO can call this to answer Nour's questions with live data.
 */

import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { createLogger } from "../lib/logger";

const log = createLogger("nour-os-query");

// v1.7 audit fix · was using `provided !== syncKey` non-timing-safe.
// Sibling routes use timingSafeEqual via safeCompare; this one was the
// outlier. Aligned with the rest of the codebase.
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

interface QueryRequest {
  query: string;
  filters?: Record<string, unknown>;
}

type QueryHandler = (filters: Record<string, unknown>) => Promise<unknown>;

const QUERY_HANDLERS: Record<string, QueryHandler> = {
  // ─── Revenue ──────────────────────────────────
  "revenue_today": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    // v1.7.6 · ET-anchored "today". Prior code used CURDATE() which
    // runs in the DB server's timezone (UTC). Cleveland is ET — late
    // evening ET, UTC has already rolled to the next day, so the
    // query missed all of "today's" invoices and Nour's daily-driver
    // showed $0. CONVERT_TZ pins the comparison to America/New_York
    // for both sides of the equation; matches the controlCenter.ts
    // getTodayET() pattern used elsewhere in the codebase.
    const [rows] = await d.execute(sql`
      SELECT COALESCE(SUM(totalAmount), 0) as totalCents, COUNT(*) as invoiceCount
      FROM invoices
      WHERE DATE(CONVERT_TZ(invoiceDate, '+00:00', 'America/New_York'))
          = DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))
    `);
    const r = (rows as Record<string, unknown>[])?.[0] || rows as Record<string, unknown>;
    return { totalCents: Number(r.totalCents || 0), totalDollars: Number(r.totalCents || 0) / 100, invoiceCount: Number(r.invoiceCount || 0) };
  },

  "revenue_range": async (filters) => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const from = String(filters.from || new Date().toISOString().split("T")[0]);
    const to = String(filters.to || new Date().toISOString().split("T")[0]);
    const [rows] = await d.execute(sql`
      SELECT COALESCE(SUM(totalAmount), 0) as totalCents, COUNT(*) as invoiceCount,
             AVG(totalAmount) as avgTicketCents
      FROM invoices WHERE invoiceDate BETWEEN ${from} AND ${to}
    `);
    const r = (rows as Record<string, unknown>[])?.[0] || rows as Record<string, unknown>;
    return {
      from, to,
      totalDollars: Number(r.totalCents || 0) / 100,
      invoiceCount: Number(r.invoiceCount || 0),
      avgTicket: Number(r.avgTicketCents || 0) / 100,
    };
  },

  // ─── Leads ────────────────────────────────────
  "leads_today": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    // v1.7.6 · ET-anchored "today" — same fix as revenue_today.
    const [rows] = await d.execute(sql`
      SELECT id, name, phone, source, status, urgencyScore, createdAt
      FROM leads
      WHERE DATE(CONVERT_TZ(createdAt, '+00:00', 'America/New_York'))
          = DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))
      ORDER BY createdAt DESC LIMIT 50
    `);
    return { leads: rows, count: (rows as unknown[]).length };
  },

  "leads_pipeline": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const [rows] = await d.execute(sql`
      SELECT status, COUNT(*) as cnt FROM leads
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY status
    `);
    return { pipeline: rows };
  },

  "leads_urgent": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const [rows] = await d.execute(sql`
      SELECT id, name, phone, urgencyScore, urgencyReason, status, createdAt
      FROM leads WHERE urgencyScore >= 4 AND status = 'new'
      ORDER BY urgencyScore DESC, createdAt ASC LIMIT 20
    `);
    return { urgentLeads: rows, count: (rows as unknown[]).length };
  },

  // ─── Bookings ─────────────────────────────────
  "bookings_today": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    // v1.7.6 · ET-anchored "today" — same fix as revenue_today.
    // preferredDate is a DATE column (no time), compared against the
    // ET-anchored current date string directly.
    const [rows] = await d.execute(sql`
      SELECT id, name, phone, service, vehicle, status, preferredDate, urgency, referenceCode, createdAt
      FROM bookings
      WHERE DATE(CONVERT_TZ(createdAt, '+00:00', 'America/New_York'))
          = DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))
        OR preferredDate = DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))
      ORDER BY createdAt DESC LIMIT 50
    `);
    return { bookings: rows, count: (rows as unknown[]).length };
  },

  "bookings_status": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const [rows] = await d.execute(sql`
      SELECT status, COUNT(*) as cnt FROM bookings
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY status
    `);
    return { statusBreakdown: rows };
  },

  // ─── Customers ────────────────────────────────
  "customer_search": async (filters) => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const term = String(filters.term || "");
    if (!term) return { error: "Search term required" };
    const [rows] = await d.execute(sql`
      SELECT id, firstName, lastName, phone, vehicleYear, vehicleMake, vehicleModel,
             segment, totalVisits, totalSpent, lastVisitDate
      FROM customers
      WHERE firstName LIKE ${`%${term}%`} OR lastName LIKE ${`%${term}%`} OR phone LIKE ${`%${term}%`}
      ORDER BY totalSpent DESC LIMIT 20
    `);
    return { customers: rows, count: (rows as unknown[]).length };
  },

  // ─── Callbacks ────────────────────────────────
  "callbacks_pending": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const [rows] = await d.execute(sql`
      SELECT id, name, phone, context AS reason, status, createdAt
      FROM callback_requests WHERE status = 'new'
      ORDER BY createdAt ASC LIMIT 20
    `);
    return { pending: rows, count: (rows as unknown[]).length };
  },

  // ─── Work Orders ──────────────────────────────
  "work_orders_active": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    // work_orders DB uses snake_case columns. Alias back to camelCase for API shape.
    // customer/vehicle info live on joined tables or denormalized vehicle_* columns.
    const [rows] = await d.execute(sql`
      SELECT id,
             order_number AS orderNumber,
             customer_id AS customerId,
             CONCAT_WS(' ', vehicle_year, vehicle_make, vehicle_model) AS vehicleInfo,
             status,
             promised_at AS promisedAt,
             created_at AS createdAt
      FROM work_orders WHERE status NOT IN ('completed', 'cancelled')
      ORDER BY created_at DESC LIMIT 30
    `);
    return { activeOrders: rows, count: (rows as unknown[]).length };
  },

  // ─── Alerts / What needs attention ────────────
  "attention_needed": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };

    const alerts: Array<{ level: "critical" | "warning" | "info"; message: string; count: number }> = [];

    // Stale leads (new > 24h)
    const [stale] = await d.execute(sql`SELECT COUNT(*) as cnt FROM leads WHERE status = 'new' AND createdAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
    const staleCount = Number((stale as Record<string, unknown>[])?.[0]?.cnt || (stale as Record<string, unknown>)?.cnt || 0);
    if (staleCount > 0) alerts.push({ level: "critical", message: `${staleCount} leads untouched >24h`, count: staleCount });

    // Unanswered callbacks
    const [cbs] = await d.execute(sql`SELECT COUNT(*) as cnt FROM callback_requests WHERE status = 'new' AND createdAt < DATE_SUB(NOW(), INTERVAL 4 HOUR)`);
    const cbCount = Number((cbs as Record<string, unknown>[])?.[0]?.cnt || (cbs as Record<string, unknown>)?.cnt || 0);
    if (cbCount > 0) alerts.push({ level: "critical", message: `${cbCount} callbacks unanswered >4h`, count: cbCount });

    // Pending invoices (estimates not converted)
    const [pending] = await d.execute(sql`SELECT COUNT(*) as cnt FROM invoices WHERE paymentStatus = 'pending' AND invoiceDate < DATE_SUB(NOW(), INTERVAL 3 DAY)`);
    const pendingCount = Number((pending as Record<string, unknown>[])?.[0]?.cnt || (pending as Record<string, unknown>)?.cnt || 0);
    if (pendingCount > 0) alerts.push({ level: "warning", message: `${pendingCount} invoices pending >3 days`, count: pendingCount });

    // Overdue work orders
    const [overdue] = await d.execute(sql`SELECT COUNT(*) as cnt FROM work_orders WHERE status NOT IN ('completed','cancelled') AND promised_at IS NOT NULL AND promised_at < NOW()`);
    const overdueCount = Number((overdue as Record<string, unknown>[])?.[0]?.cnt || (overdue as Record<string, unknown>)?.cnt || 0);
    if (overdueCount > 0) alerts.push({ level: "warning", message: `${overdueCount} work orders past promised time`, count: overdueCount });

    return { alerts, totalCritical: alerts.filter(a => a.level === "critical").length, totalWarning: alerts.filter(a => a.level === "warning").length };
  },

  // ─── Shop pulse (live snapshot) ───────────────
  "shop_pulse": async () => {
    try {
      const { getShopPulse, projectRevenue } = await import("../services/nickIntelligence");
      const [pulse, revenue] = await Promise.all([
        getShopPulse().catch(() => null),
        projectRevenue().catch(() => null),
      ]);
      return { pulse, revenue };
    } catch { return { error: "Intelligence unavailable" }; }
  },

  // ─── Feature flags ────────────────────────────
  "feature_flags": async () => {
    const { getAllFlags } = await import("../services/featureFlags");
    const flags = await getAllFlags();
    return { flags: flags.map(f => ({ key: f.key, enabled: Boolean(f.value) })), count: flags.length };
  },

  // ─── GSC / Search Console (added 2026-05-09) ──────────────
  // Backs the statenour-os AI COO so it stops fabricating GSC numbers.
  // Both actions delegate to helpers in pipelines/gsc-data.ts so the
  // bridge + admin-tRPC routes share a single source of truth.
  // Pipeline at server/pipelines/gsc-data.ts populates search_performance
  // nightly via Google Service Account.
  "gsc_summary": async (filters) => {
    const { getGscSummary } = await import("../pipelines/gsc-data");
    const today = new Date().toISOString().slice(0, 10);
    const thirtyAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    return getGscSummary({
      startDate: String(filters.from || thirtyAgo),
      endDate: String(filters.to || today),
    });
  },

  "gsc_top_queries": async (filters) => {
    const { getTopQueries } = await import("../pipelines/gsc-data");
    const today = new Date().toISOString().slice(0, 10);
    const thirtyAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const limit = Math.min(50, Math.max(1, Number(filters.limit || 10)));
    const from = String(filters.from || thirtyAgo);
    const to = String(filters.to || today);
    const queries = await getTopQueries({
      startDate: from,
      endDate: to,
      limit,
    });
    return { from, to, queries, count: queries.length };
  },

  // ─── Marketing attribution (added 2026-05-12 · ADR-0011 Tier 3) ──
  // Closes Nour's most-asked-and-vague category: "what's actually
  // working for lead-gen?" Source-by-source breakdown of leads +
  // booking/invoice conversions + revenue. leads table already has
  // source enum + utmSource + invoiceId FK (wave-125), so the join
  // is real, not a stub.
  //
  // Returns ranked source attribution for the operator's most-asked
  // question. statenour-side tool registration mirrors the GSC
  // pattern at v10.0.487.
  "marketing_attribution": async (filters) => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const today = new Date().toISOString().slice(0, 10);
    const thirtyAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const from = String(filters.from || thirtyAgo);
    const to = String(filters.to || today);

    // Per-source rollup of leads + conversion + revenue. Joins
    // leads → invoices via the invoiceId FK (set on conversion).
    // Cents → dollars done in JS to keep SQL readable.
    const [rows] = await d.execute(sql`
      SELECT
        l.source                                            AS source,
        l.utmSource                                         AS utmSource,
        COUNT(*)                                            AS leadCount,
        SUM(CASE WHEN l.status = 'booked' THEN 1 ELSE 0 END) AS bookedCount,
        SUM(CASE WHEN l.status = 'completed' THEN 1 ELSE 0 END) AS completedCount,
        SUM(CASE WHEN l.status = 'lost' THEN 1 ELSE 0 END)   AS lostCount,
        COUNT(DISTINCT l.invoiceId)                          AS conversionCount,
        COALESCE(SUM(i.totalAmount), 0)                      AS totalCents,
        COALESCE(AVG(i.totalAmount), 0)                      AS avgTicketCents
      FROM leads l
      LEFT JOIN invoices i ON i.id = l.invoiceId
      WHERE l.createdAt BETWEEN ${from} AND ${to}
      GROUP BY l.source, l.utmSource
      ORDER BY totalCents DESC, leadCount DESC
      LIMIT 50
    `);

    // Format rows so the model sees dollars and conversion rates,
    // not raw cents and ratios. Each row becomes a citeable fact.
    const sources = (rows as Record<string, unknown>[]).map((r) => {
      const leadCount = Number(r.leadCount || 0);
      const conversionCount = Number(r.conversionCount || 0);
      const totalCents = Number(r.totalCents || 0);
      const avgTicketCents = Number(r.avgTicketCents || 0);
      return {
        source: String(r.source ?? "(unknown)"),
        utmSource: r.utmSource ? String(r.utmSource) : null,
        leadCount,
        bookedCount: Number(r.bookedCount || 0),
        completedCount: Number(r.completedCount || 0),
        lostCount: Number(r.lostCount || 0),
        conversionCount,
        conversionRate: leadCount > 0 ? Math.round((conversionCount / leadCount) * 1000) / 10 : 0,
        totalDollars: Math.round(totalCents) / 100,
        avgTicketDollars: Math.round(avgTicketCents) / 100,
      };
    });

    const totals = sources.reduce(
      (acc, s) => ({
        leadCount: acc.leadCount + s.leadCount,
        conversionCount: acc.conversionCount + s.conversionCount,
        totalDollars: acc.totalDollars + s.totalDollars,
      }),
      { leadCount: 0, conversionCount: 0, totalDollars: 0 },
    );

    return {
      from,
      to,
      sources,
      totals: {
        leadCount: totals.leadCount,
        conversionCount: totals.conversionCount,
        conversionRate:
          totals.leadCount > 0
            ? Math.round((totals.conversionCount / totals.leadCount) * 1000) / 10
            : 0,
        totalDollars: Math.round(totals.totalDollars * 100) / 100,
      },
      topSource: sources[0]?.source ?? null,
      note:
        sources.length === 0
          ? "No leads in the window · operator should pick a wider range or seed leads"
          : `${sources.length} source rows · top by revenue: ${sources[0]?.source} ($${sources[0]?.totalDollars})`,
    };
  },
};

export function registerNourOsQueryRoute(app: Express): void {
  app.post("/api/nour-os/query", async (req: Request, res: Response) => {
    const syncKey = process.env.STATENOUR_SYNC_KEY || "";
    const provided = req.headers["x-sync-key"] as string;

    if (!syncKey || !provided || !safeCompare(provided, syncKey)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { query, filters } = req.body as QueryRequest;
    if (!query) {
      return res.status(400).json({ error: "Missing query field", available: Object.keys(QUERY_HANDLERS) });
    }

    const handler = QUERY_HANDLERS[query];
    if (!handler) {
      return res.status(400).json({ error: `Unknown query: ${query}`, available: Object.keys(QUERY_HANDLERS) });
    }

    try {
      const result = await handler(filters || {});
      log.info(`Query: ${query}`, { filters });
      return res.json({ query, timestamp: new Date().toISOString(), data: result });
    } catch (err) {
      log.error(`Query failed: ${query}`, { error: err instanceof Error ? err.message : String(err) });
      return res.status(500).json({ error: "Query execution failed" });
    }
  });
}
