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
import { createLogger } from "../lib/logger";

const log = createLogger("nour-os-query");

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
    const [rows] = await d.execute(sql`
      SELECT COALESCE(SUM(totalAmount), 0) as totalCents, COUNT(*) as invoiceCount
      FROM invoices WHERE DATE(invoiceDate) = CURDATE()
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
    const [rows] = await d.execute(sql`
      SELECT id, name, phone, source, status, urgencyScore, createdAt
      FROM leads WHERE DATE(createdAt) = CURDATE()
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
    const [rows] = await d.execute(sql`
      SELECT id, name, phone, service, vehicle, status, preferredDate, urgency, referenceCode, createdAt
      FROM bookings WHERE DATE(createdAt) = CURDATE() OR preferredDate = CURDATE()
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
      SELECT id, name, phone, reason, status, createdAt
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
    const [rows] = await d.execute(sql`
      SELECT id, orderNumber, customerName, vehicleInfo, status, promisedTime, createdAt
      FROM work_orders WHERE status NOT IN ('completed', 'cancelled')
      ORDER BY createdAt DESC LIMIT 30
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
    const [overdue] = await d.execute(sql`SELECT COUNT(*) as cnt FROM work_orders WHERE status NOT IN ('completed','cancelled') AND promisedTime IS NOT NULL AND promisedTime < NOW()`);
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
};

export function registerNourOsQueryRoute(app: Express): void {
  app.post("/api/nour-os/query", async (req: Request, res: Response) => {
    const syncKey = process.env.STATENOUR_SYNC_KEY || "";
    const provided = req.headers["x-sync-key"] as string;

    if (!syncKey || provided !== syncKey) {
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
