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

  // ─── Recent active customer IDs (added 2026-05-17 · Wave-200 Phase 6) ──
  //
  // Drives statenour's customer-preferences-recompute Inngest function
  // (apps/statenour/src/inngest/functions/customer-preferences.ts).
  // The cron runs daily at 11:00 UTC · grabs the IDs of customers
  // touched in the last N days (default 90) · then fans out per-customer
  // recompute via customer_detail.
  //
  // Returns: { customerIds: string[] } · cap 500 (matches statenour-side
  // HARD_CAP) so a misbehaving caller can't blow out the fan-out budget.
  //
  // Filters:
  //   · sinceDays · number · default 90 · how far back to look
  //
  // Per ADR-0008 (statenour) follow-up.
  "recent_customer_ids": async (filters) => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const sinceDays = Math.max(1, Math.min(365, Number(filters.sinceDays ?? 90)));
    const [rows] = await d.execute(sql`
      SELECT id
      FROM customers
      WHERE lastVisitDate >= DATE_SUB(NOW(), INTERVAL ${sinceDays} DAY)
        AND lastVisitDate IS NOT NULL
      ORDER BY lastVisitDate DESC
      LIMIT 500
    `);
    const customerIds = (rows as Array<{ id: string }>).map((r) => String(r.id));
    return { customerIds, count: customerIds.length, sinceDays };
  },

  // ─── Customer 360 detail (added 2026-05-17 · Wave-200 Phase 6) ──
  //
  // Single per-customer timeline that surfaces everything the statenour
  // Customer 360 view needs. Returns:
  //   · the customer record
  //   · last 10 invoices (paid · counted as "wins")
  //   · last 5 estimates (online portal · pre-conversion or declined)
  //   · last 5 ALG walk-in estimates (declined-work pipeline)
  //   · last 5 callback requests
  //   · derived totals (matches customer_metrics if present)
  //
  // Filters:
  //   · customerId · required · the customers.id
  //
  // Used by /api/customer-360/[customerId] on statenour-web. Per
  // ADR-0008. Adding the rows here so the entire surface ships in one
  // statenour deploy without waiting for a separate nickstire wave.
  "customer_detail": async (filters) => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const customerId = String(filters.customerId || "");
    if (!customerId) return { error: "customerId required" };

    // Run the five queries in parallel · single customer = small set
    // each · OK to fan out without concurrency limit.
    const [
      customerRows,
      invoiceRows,
      estimateRows,
      algRows,
      callbackRows,
    ] = await Promise.all([
      d.execute(sql`
        SELECT id, firstName, lastName, phone, email,
               vehicleYear, vehicleMake, vehicleModel,
               segment, totalVisits, totalSpent, lastVisitDate, createdAt
        FROM customers WHERE id = ${customerId} LIMIT 1
      `),
      d.execute(sql`
        SELECT id, invoiceNumber, totalAmount, paymentStatus, invoiceDate, notes
        FROM invoices
        WHERE customerId = ${customerId}
        ORDER BY invoiceDate DESC LIMIT 10
      `),
      d.execute(sql`
        SELECT id, estimateNumber, totalAmount, status, createdAt, declineReason
        FROM estimates
        WHERE customerId = ${customerId}
        ORDER BY createdAt DESC LIMIT 5
      `),
      d.execute(sql`
        SELECT id, totalAmount, services, status, createdAt, scoreCard
        FROM alg_estimates
        WHERE customerId = ${customerId}
        ORDER BY createdAt DESC LIMIT 5
      `),
      d.execute(sql`
        SELECT id, name, context, status, createdAt, completedAt
        FROM callback_requests
        WHERE customerId = ${customerId} OR phone IN (
          SELECT phone FROM customers WHERE id = ${customerId} LIMIT 1
        )
        ORDER BY createdAt DESC LIMIT 5
      `),
    ]);

    const customer = (customerRows[0] as unknown[])?.[0] ?? null;
    if (!customer) return { error: "Customer not found", customerId };

    const invoices = (invoiceRows[0] as unknown[]) ?? [];
    const estimates = (estimateRows[0] as unknown[]) ?? [];
    const algEstimates = (algRows[0] as unknown[]) ?? [];
    const callbacks = (callbackRows[0] as unknown[]) ?? [];

    return {
      customer,
      timeline: { invoices, estimates, algEstimates, callbacks },
      counts: {
        invoices: invoices.length,
        estimates: estimates.length,
        algEstimates: algEstimates.length,
        callbacks: callbacks.length,
      },
    };
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

  // wave-181.x · v11.7 · Statenour /seo page (Wave 3 gap surface, #79).
  // Top pages by clicks · uses getPagePerformance which aggregates
  // search_performance over the date range. Filters are page-level
  // (no per-query breakdown) · combined with gsc_top_queries on the
  // /seo page they give the full query+page picture.
  "gsc_top_pages": async (filters) => {
    const { getPagePerformance } = await import("../pipelines/gsc-data");
    const thirtyAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const limit = Math.min(50, Math.max(1, Number(filters.limit || 10)));
    const startDate = String(filters.from || thirtyAgo);
    const pages = await getPagePerformance({
      startDate,
      limit,
    });
    return { from: startDate, pages, count: pages.length };
  },

  // wave-181.x · v11.8 · Service Affinity v2 status (post-migration check).
  // Answers "did the cron actually run / are predictions populated /
  // is the arm split healthy" without opening the DB. Resilient · if
  // service_affinity_predictions doesn't exist (operator hasn't run
  // the migration script yet) we return migrated:false instead of
  // throwing · clean signal for the operator's gate.
  //
  // Operator flow: after `pnpm tsx scripts/apply-wave-181-sa-v2.ts`
  // + flipping `service_affinity_v2_compute` ON · wait 2h for first
  // cron tick · then `curl /api/nour-os/query?q=service_affinity_v2_status`
  // confirms predictions are writing.
  "service_affinity_v2_status": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { ok: false, error: "no DB" };

    // Probe table existence first · zero-error path when migration not applied yet
    try {
      await d.execute(sql`SELECT 1 FROM service_affinity_predictions LIMIT 1`);
    } catch {
      return {
        ok: true,
        migrated: false,
        message: "service_affinity_predictions table not found · run scripts/apply-wave-181-sa-v2.ts to apply migration 0061",
      };
    }

    // Pull the snapshot in ONE round-trip · per-arm count + avg confidence +
    // most-recent created_at (== last cron tick) + impression/action totals.
    const stats = await d.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM service_affinity_predictions) AS predTotal,
        (SELECT COUNT(*) FROM service_affinity_predictions WHERE ab_arm = 'treatment') AS predTreatment,
        (SELECT COUNT(*) FROM service_affinity_predictions WHERE ab_arm = 'control') AS predControl,
        (SELECT ROUND(AVG(confidence) * 100, 1) FROM service_affinity_predictions WHERE ab_arm = 'treatment') AS avgConfTreatment,
        (SELECT ROUND(AVG(confidence) * 100, 1) FROM service_affinity_predictions WHERE ab_arm = 'control') AS avgConfControl,
        (SELECT MAX(created_at) FROM service_affinity_predictions) AS lastCronTick,
        (SELECT COUNT(DISTINCT model_version) FROM service_affinity_predictions) AS distinctModels,
        (SELECT COUNT(*) FROM prediction_impressions) AS impressionTotal,
        (SELECT COUNT(*) FROM prediction_actions WHERE action = 'sms_sent') AS smsSentTotal,
        (SELECT COUNT(*) FROM prediction_outcomes WHERE matched = 1) AS outcomesMatched
    `);

    type Row = {
      predTotal: number;
      predTreatment: number;
      predControl: number;
      avgConfTreatment: number | null;
      avgConfControl: number | null;
      lastCronTick: Date | null;
      distinctModels: number;
      impressionTotal: number;
      smsSentTotal: number;
      outcomesMatched: number;
    };
    const rows = (Array.isArray(stats) && Array.isArray(stats[0])
      ? stats[0]
      : stats) as Row[];
    const r = rows[0];
    if (!r) return { ok: true, migrated: true, predictions: 0 };

    const lastTickIso = r.lastCronTick ? new Date(r.lastCronTick).toISOString() : null;
    const ageMinutes = lastTickIso
      ? Math.round((Date.now() - new Date(lastTickIso).getTime()) / 60_000)
      : null;
    const armRatio = r.predTotal > 0
      ? Math.round((Number(r.predTreatment) / Number(r.predTotal)) * 100)
      : null;
    // Healthy split is roughly 50/50 (±10 percentage points · stable hash variance)
    const armSplitHealthy = armRatio == null ? null : armRatio >= 40 && armRatio <= 60;

    return {
      ok: true,
      migrated: true,
      predictions: {
        total: Number(r.predTotal),
        treatment: Number(r.predTreatment),
        control: Number(r.predControl),
        armRatioTreatmentPct: armRatio,
        armSplitHealthy,
        avgConfidenceTreatment: r.avgConfTreatment != null ? Number(r.avgConfTreatment) : null,
        avgConfidenceControl: r.avgConfControl != null ? Number(r.avgConfControl) : null,
        distinctModelVersions: Number(r.distinctModels),
      },
      cron: {
        lastTick: lastTickIso,
        ageMinutes,
        running: ageMinutes != null && ageMinutes < 180,
      },
      closedLoop: {
        impressions: Number(r.impressionTotal),
        smsSent: Number(r.smsSentTotal),
        outcomesMatched: Number(r.outcomesMatched),
      },
    };
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

  // ─── Intelligence Dispersal Wave 1.5 (2026-05-24) ─────────
  // `master_report` · synthesized health score + top alert/opp/risk +
  // 13-component score breakdown + sub-reports. Statenour consumes
  // this on /scoreboard (per dispersal plan §4.3 · Bucket C migrate
  // to statenour). The umbrella view dies on nickstire (Intelligence
  // page being deleted) · the engine and sub-reports stay alive
  // because operator wants the underlying data for future improve-
  // ments (decision §4.4 #1).
  //
  // Shape returned to statenour:
  //   {
  //     timestamp,
  //     summary: { score, topAlert, topOpportunity, topRisk, scoreBreakdown[] },
  //     revenue: { pacing, anomalies, cashFlow, margins, ticketTrend },
  //     customers: { churnRisk, riskScores, valueTrend, repeatPrediction, velocity, concentration },
  //     operations: { techEfficiency, turnaround, bayUtilization, capacity, partsCost },
  //     marketing: { channelROI, reviewVelocity, smsEngagement, leadResponse, contentPerformance },
  //     growth: { newCustomerVelocity, referralNetwork, portfolioLTV, marketShare, seasonalDemand },
  //     competitive: { competitorGap, chatFunnel, reviewSentiment }
  //   }
  //
  // No filters · always returns the current state. Cache TTL is
  // 60s server-side via memoize() inside generateMasterIntelligence-
  // Report so back-to-back calls don't pile DB load.
  "master_report": async () => {
    const { generateMasterIntelligenceReport } = await import("../services/masterIntelligence");
    try {
      const report = await generateMasterIntelligenceReport();
      return {
        ok: true as const,
        timestamp: report.timestamp,
        summary: report.summary,
        revenue: report.revenue,
        customers: report.customers,
        operations: report.operations,
        marketing: report.marketing,
        growth: report.growth,
        competitive: report.competitive,
      };
    } catch (err) {
      log.warn("[master_report] generation failed:", err instanceof Error ? err.message : err);
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },

  // ─── Intelligence Dispersal Wave 3 first ship (2026-05-24) ───
  // `funnel_overview` · 6-stage conversion · derived from
  // master_report. Statenour /funnel page consumes this.
  //
  // Pulls the same data the deleted nickstire OverviewTab Customer
  // Journey Funnel computed. master_report.operations.pipeline +
  // customers.velocity + revenue.pacing + marketing.reviewVelocity +
  // customers.retention are the underlying sources.
  //
  // Shape returned:
  //   {
  //     ok: true,
  //     stages: [
  //       { label, value, conversionFromPrev (pct), pctOfTopOfFunnel },
  //       ... 6 stages: Leads → Estimates → Drop-Offs → Jobs → Reviews → Retained
  //     ],
  //     leadToJobRate, leadToRetainedRate
  //   }
  "funnel_overview": async () => {
    const { generateMasterIntelligenceReport } = await import("../services/masterIntelligence");
    try {
      const report = await generateMasterIntelligenceReport();
      // Same derivation pattern as the deleted OverviewTab.CustomerJourneyFunnel
      const ops = report.operations as { pipeline?: { total?: number; estimated?: number; booked?: number } } | undefined;
      const cust = report.customers as { velocity?: { totalLeads?: number; thisMonth?: number }; retention?: { returning?: number } } | undefined;
      const rev = report.revenue as { pacing?: { month?: { jobCount?: number } } } | undefined;
      const mkt = report.marketing as { reviewVelocity?: { thisMonth?: number } } | undefined;

      // v-truth · track whether each stage's value came from a REAL source
      // or a ratio-derived ESTIMATE (the `?? Math.round(...)` fallback). The
      // statenour /funnel page marks synthetic stages so the operator can tell
      // real data from a guess — previously these fabricated values rendered
      // identically to real ones with plausible-looking conversion %.
      const leads = ops?.pipeline?.total ?? cust?.velocity?.totalLeads ?? 0;
      const estimatesReal = ops?.pipeline?.estimated;
      const estimates = estimatesReal ?? Math.round(leads * 0.6);
      const dropoffsReal = ops?.pipeline?.booked ?? cust?.velocity?.thisMonth;
      const dropoffs = dropoffsReal ?? Math.round(estimates * 0.4);
      const jobsReal = rev?.pacing?.month?.jobCount;
      const jobs = jobsReal ?? Math.round(dropoffs * 0.8);
      const reviewsReal = mkt?.reviewVelocity?.thisMonth;
      const reviews = reviewsReal ?? Math.round(jobs * 0.15);
      const retainedReal = cust?.retention?.returning;
      const retained = retainedReal ?? Math.round(jobs * 0.3);

      const stagesRaw = [
        { label: "Leads", value: leads, synthetic: false },
        { label: "Estimates", value: estimates, synthetic: estimatesReal == null },
        { label: "Drop-Offs", value: dropoffs, synthetic: dropoffsReal == null },
        { label: "Jobs Done", value: jobs, synthetic: jobsReal == null },
        { label: "Reviews", value: reviews, synthetic: reviewsReal == null },
        { label: "Retained", value: retained, synthetic: retainedReal == null },
      ];
      const top = stagesRaw[0]?.value ?? 0;
      const stages = stagesRaw.map((s, i) => {
        const prev = i > 0 ? stagesRaw[i - 1].value : s.value;
        const conv = prev > 0 ? Math.round((s.value / prev) * 100) : 0;
        const pctTop = top > 0 ? Math.round((s.value / top) * 100) : 0;
        return { ...s, conversionFromPrev: conv, pctOfTopOfFunnel: pctTop };
      });

      return {
        ok: true as const,
        stages,
        leadToJobRate: leads > 0 ? Math.round((jobs / leads) * 100) : 0,
        leadToRetainedRate: leads > 0 ? Math.round((retained / leads) * 100) : 0,
        timestamp: report.timestamp,
      };
    } catch (err) {
      log.warn("[funnel_overview] failed:", err instanceof Error ? err.message : err);
      return { ok: false as const, error: err instanceof Error ? err.message : "Unknown error" };
    }
  },

  // `funnel_first_visit` · per-source conversion of first-visit
  // customers · the "where do best customers come from" view.
  // Wraps trpc.intelligence.firstVisitConversion data shape.
  "funnel_first_visit": async () => {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return { ok: false as const, error: "No DB" };
    try {
      const { analyzeFirstVisitConversion } = await import("../services/engines/customer");
      const data = await analyzeFirstVisitConversion();
      return {
        ok: true as const,
        overallRate: data.overallRate,
        avgDaysToRepeat: data.avgDaysToRepeat,
        bySource: data.bySource ?? [],
      };
    } catch (err) {
      log.warn("[funnel_first_visit] failed:", err instanceof Error ? err.message : err);
      return { ok: false as const, error: err instanceof Error ? err.message : "Unknown error" };
    }
  },

  // ─── Recent invoices (added 2026-06-11) ──────────
  "recent_invoices": async (filters) => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const days = Math.max(1, Math.min(1000, Number(filters.days ?? 30)));
    const [rows] = await d.execute(sql`
      SELECT id, totalAmount, invoiceDate
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      ORDER BY invoiceDate DESC
      LIMIT 1000
    `);
    return { invoices: rows, count: (rows as unknown[]).length, days };
  },

  // ─── Recent leads (added 2026-06-11) ─────────────
  "recent_leads": async (filters) => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };
    const days = Math.max(1, Math.min(1000, Number(filters.days ?? 30)));
    const [rows] = await d.execute(sql`
      SELECT id, name AS fullName, createdAt, status, urgencyScore, source
      FROM leads
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      ORDER BY createdAt DESC
      LIMIT 1000
    `);
    return { leads: rows, count: (rows as unknown[]).length, days };
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
