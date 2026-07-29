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

async function exec(d: unknown, q: unknown): Promise<Record<string, unknown>[]> {
  const result = (await (d as { execute: (q: unknown) => Promise<unknown> }).execute(q)) as unknown;
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as Record<string, unknown>[];
  }
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return [];
}

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

function safeDays(d: number): number {
  if (!Number.isInteger(d) || d < 1 || d > 730) {
    throw new Error(`statenour-bridge: invalid days=${d}`);
  }
  return d;
}

interface QueryRequest {
  query: string;
  filters?: Record<string, unknown>;
}

type QueryHandler = (filters: Record<string, unknown>) => Promise<unknown>;

const QUERY_HANDLERS: Record<string, QueryHandler> = {
  // ─── Decision inbox (S2, 2026-07-28) ─────────────────────────────
  // Card-friendly top-N from the opportunity queue — the same
  // due-aware/consented/SQL-ranked read the admin panel uses, so the
  // statenour chat card and the Decision Inbox can never disagree.
  "top_decisions": async () => {
    const { topDecisions } = await import("../services/opportunityQueue");
    const top = await topDecisions(5);
    return {
      decisions: top.decisions.map((d) => ({
        id: d.id,
        urgency: d.urgency,
        state: d.state,
        recommendedAction: d.recommendedAction,
        valueDollars: d.factors.valueDollars,
        dataQuality: d.dataQuality,
        attempts: d.attempts,
      })),
      totalLive: top.totalLive,
      excludedNoConsent: top.excludedNoConsent,
      excludedSnoozed: top.excludedSnoozed,
    };
  },

  /**
   * Autopilot Wave 2 (2026-07-29) · the ONE bounded customer-texting action,
   * exposed to statenour as a draft/send pair over the existing sync-key
   * bridge. CONTRACT (NICKSTIRE-QUERY-CONTRACT §8):
   *
   *   draft_opportunity_sms {opportunityId} — READ. Returns the
   *     deterministic evidence-only draft + best channel + risk label +
   *     masked identity. Call-first types return no draft with the reason.
   *
   *   send_opportunity_sms {opportunityId, body, idempotencyKey, approvedBy}
   *     — ACTION. statenour MUST show Nour the exact body and collect an
   *     explicit approval BEFORE calling; approvedBy records who. Guards
   *     (all server-side here, none trusted to the caller): opportunity must
   *     be live + consented + non-call-only; preflight guard blocks critical
   *     findings; the send rides sendSms's FULL gate stack (opt-out
   *     fail-closed, caps, pause, quiet-hour queue) as humanInitiated;
   *     success receipts the opportunity as `attempted`. Idempotency: the
   *     key is checked+recorded in audit_log — a replayed call returns
   *     duplicate:true and sends NOTHING. Free-form texting to arbitrary
   *     numbers is deliberately NOT exposed — the opportunity row IS the
   *     identity resolution.
   */
  "draft_opportunity_sms": async (filters) => {
    const opportunityId = String(filters.opportunityId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(opportunityId)) return { error: "opportunityId (uuid) required" };
    const { listOpportunities } = await import("../services/opportunityQueue");
    const rows = await listOpportunities({ limit: 500 });
    const opp = rows.find((r) => r.id === opportunityId);
    if (!opp) return { error: "opportunity not found" };
    const { draftOpportunityOutreach } = await import("../services/opportunityDraft");
    const draft = await draftOpportunityOutreach(opp);
    return {
      opportunityId,
      customerName: opp.customerName,
      customerPhoneMasked: opp.customerPhone ? `***-${opp.customerPhone.slice(-4)}` : null,
      sourceType: opp.sourceType,
      state: opp.state,
      consentOk: opp.consentOk,
      recommendedAction: opp.recommendedAction,
      ...draft,
    };
  },

  "send_opportunity_sms": async (filters) => {
    const opportunityId = String(filters.opportunityId ?? "");
    const body = String(filters.body ?? "").trim();
    const idempotencyKey = String(filters.idempotencyKey ?? "").trim();
    const approvedBy = String(filters.approvedBy ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(opportunityId)) return { error: "opportunityId (uuid) required" };
    if (!body) return { error: "body required — statenour must show Nour the exact text and pass it back" };
    if (!/^[A-Za-z0-9._-]{8,64}$/.test(idempotencyKey)) return { error: "idempotencyKey (8-64 chars, [A-Za-z0-9._-]) required" };
    if (!approvedBy) return { error: "approvedBy required — records WHO approved the exact text" };

    // Durable idempotency via the audit trail: one row per key, checked
    // before any send. A replayed call (retry, double-tap, crashed client)
    // returns duplicate:true and never reaches sendSms.
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "DB unavailable — refusing to send without idempotency" };
    const marker = `bridge_send:${idempotencyKey}`;
    const dupRows = await exec(d, sql`
      SELECT 1 FROM audit_log
      WHERE action = 'sms.bridge_send' AND details LIKE ${`%${marker}%`}
      LIMIT 1
    `);
    if (dupRows.length > 0) return { ok: true, duplicate: true, sent: false };

    const { sendOpportunityDraft } = await import("../services/opportunityDraft");
    const result = await sendOpportunityDraft({
      id: opportunityId,
      body,
      by: `statenour:${approvedBy}`,
    });
    if (result.ok) {
      try {
        const { logAdminAction } = await import("../services/auditTrail");
        await logAdminAction({
          action: "sms.bridge_send",
          entityType: "revenue_opportunity",
          entityId: opportunityId,
          details: `${marker} · approved by ${approvedBy} · ${result.queued ? "queued for window" : "dispatched"} · "${body.slice(0, 100)}"`,
          actor: `statenour:${approvedBy}`,
        });
      } catch {
        // the send happened; a failed audit write must be loud in logs only
        log.error("bridge send succeeded but idempotency record failed — replays will NOT dedupe", { opportunityId });
      }
    }
    return { ...result, sent: result.ok, duplicate: false };
  },

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

    // 2026-07-10 · rewritten against the REAL prod schema. The prior
    // version queried an `estimates` table that does not exist, selected
    // `notes` from invoices (real col: serviceDescription), used
    // camelCase columns on the snake_case alg_estimates table, and
    // filtered alg_estimates/callback_requests by a customerId column
    // neither table has — so EVERY customer-detail load threw four
    // "Failed query" errors in prod (the statenour Customer-360 view was
    // dead + log-spamming). alg_estimates.customer_id is NULL for all
    // rows (ShopDriver sync keys by phone), so alg_estimates,
    // callback_requests, and estimates_log are all matched by PHONE —
    // which means we must resolve the customer (and its phone) first,
    // then fan out the phone-keyed reads.
    const customerRows = await d.execute(sql`
      SELECT id, firstName, lastName, phone, email,
             vehicleYear, vehicleMake, vehicleModel,
             segment, totalVisits, totalSpent, lastVisitDate, createdAt
      FROM customers WHERE id = ${customerId} LIMIT 1
    `);
    const customer = (customerRows[0] as Array<Record<string, unknown>>)?.[0] ?? null;
    if (!customer) return { error: "Customer not found", customerId };
    const phone = String(customer.phone ?? "");

    const [invoiceRows, estimateRows, algRows, callbackRows] = await Promise.all([
      d.execute(sql`
        SELECT id, invoiceNumber, totalAmount, paymentStatus, invoiceDate, serviceDescription
        FROM invoices
        WHERE customerId = ${customerId}
        ORDER BY invoiceDate DESC LIMIT 10
      `),
      // Formal estimates live in estimates_log (phone-keyed).
      d.execute(sql`
        SELECT id, service, estimatedAmountCents, converted, invoiceId, createdAt
        FROM estimates_log
        WHERE phone = ${phone}
        ORDER BY createdAt DESC LIMIT 5
      `),
      // Walk-in quotes synced from ShopDriver (snake_case, phone-keyed).
      // Aliased to the camelCase timeline contract the statenour
      // consumer (lib/brain/customer-preferences.ts) reads. `status` is
      // derived from the documented match heuristic — an unmatched quote
      // is a walked/declined-work recovery target (NICKSTIRE-QUERY-
      // CONTRACT.md §2) — so declinedValueCents/openRecoveryCount, which
      // were silently 0 while this query errored, now populate.
      d.execute(sql`
        SELECT id,
               estimated_amount AS totalAmount,
               service_description AS services,
               CASE WHEN matched_invoice_id IS NULL THEN 'walked' ELSE 'converted' END AS status,
               source,
               matched_invoice_id,
               created_at AS createdAt
        FROM alg_estimates
        WHERE customer_phone = ${phone}
        ORDER BY created_at DESC LIMIT 5
      `),
      d.execute(sql`
        SELECT id, name, context, status, createdAt, calledAt
        FROM callback_requests
        WHERE phone = ${phone}
        ORDER BY createdAt DESC LIMIT 5
      `),
    ]);

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

  // ─── Team performance (AG-20 · 2026-07-09) ────
  // First staff-visible bridge handler: none of the other 33 exposed
  // team data, so the statenour command center (chat, Telegram,
  // warroom) was completely blind to shop staff — "who's clocked in"
  // was unanswerable. Returns per-tech 30d metrics + clock state.
  "team_performance": async () => {
    try {
      const { getTeamPerformance } = await import("../services/staffPerformance");
      const perf = await getTeamPerformance();
      return {
        techs: perf.techs.map((t) => ({
          techId: t.techId,
          name: t.name,
          role: t.role,
          clockedIn: t.clockedIn,
          currentLoad: t.currentLoad,
          jobsCompleted30d: t.metrics.jobsCompleted30d,
          totalRevenue30d: t.metrics.totalRevenue30d,
          qcPassRate: t.metrics.qcPassRate,
          comebackRate: t.metrics.comebackRate,
        })),
        teamTotals: perf.teamTotals,
      };
    } catch { return { error: "Staff data unavailable" }; }
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

  // ─── Cars Today (added 2026-06-12) ──────────────────
  "cars_today": async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };

    const [bookingRows, invoiceRows] = await Promise.all([
      exec(d, sql`
        SELECT
          SUM(CASE WHEN stage = 'received' AND status != 'cancelled' THEN 1 ELSE 0 END) AS drop_off,
          SUM(CASE WHEN stage IN ('inspecting','waiting-parts','in-progress','quality-check') THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN stage = 'ready' THEN 1 ELSE 0 END) AS ready,
          COUNT(*) AS total_bookings
        FROM bookings
        WHERE (DATE(CONVERT_TZ(createdAt, '+00:00', 'America/New_York')) = DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))
            OR preferredDate = DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')))
          AND status != 'cancelled'
      `),
      exec(d, sql`
        SELECT COUNT(*) AS paid, COALESCE(SUM(totalAmount), 0) AS totalCents, COALESCE(AVG(totalAmount), 0) AS avgCents
        FROM invoices
        WHERE DATE(CONVERT_TZ(invoiceDate, '+00:00', 'America/New_York')) = DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))
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
    const count = totalBookings + paid;
    const openTickets = drop_off + in_progress + ready;
    const avgTicket = Math.round(Number(inv.avgCents ?? 0)) / 100;

    const paymentBreakdown = await exec(d, sql`
      SELECT paymentMethod, COUNT(*) AS cnt, COALESCE(SUM(totalAmount), 0) AS totalCents
      FROM invoices
      WHERE DATE(CONVERT_TZ(invoiceDate, '+00:00', 'America/New_York')) = DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))
        AND paymentStatus = 'paid'
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
    return {
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
    };
  },

  // ─── Estimates Conversion (added 2026-06-12) ────────
  "estimates_conversion": async (filters) => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };

    const days = rangeToDays(typeof filters.range === "string" ? filters.range : undefined);
    const scope = (typeof filters.scope === "string" ? filters.scope : "online").toLowerCase();

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
      return {
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
      };
    }

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
    return {
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
    };
  },

  // ─── Estimates Aging (added 2026-06-12) ─────────────
  "estimates_aging": async (filters) => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };

    const scope = (typeof filters.scope === "string" ? filters.scope : "online").toLowerCase();

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
      return {
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
      };
    }

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
    return {
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
    };
  },

  // ─── Drop Off Ratio (added 2026-06-12) ──────────────
  "drop_off_ratio": async (filters) => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { error: "No DB" };

    const days = rangeToDays(typeof filters.range === "string" ? filters.range : undefined);

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
    return {
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
    };
  },

  // ─── Instagram Autopost ──────────────────────────────────────────
  "instagram_autopost_status": async () => {
    const { isEnabled } = await import("../services/featureFlags");
    const { getDb } = await import("../db");
    const { igAutopostLog } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    
    const db = await getDb();
    const livePostingEnabled = await isEnabled("legacy_autopost_live");
    
    let latestLogs: any[] = [];
    if (db) {
      latestLogs = await db
        .select({
          id: igAutopostLog.id,
          archetype: igAutopostLog.archetype,
          conceptKey: igAutopostLog.conceptKey,
          status: igAutopostLog.status,
          caption: igAutopostLog.caption,
          imageUrl: igAutopostLog.imageUrl,
          overallScore: igAutopostLog.overallScore,
          source: igAutopostLog.source,
          createdAt: igAutopostLog.createdAt,
          error: igAutopostLog.error,
        })
        .from(igAutopostLog)
        .orderBy(desc(igAutopostLog.createdAt))
        .limit(5);
    }
    
    return {
      livePostingEnabled,
      latestLogs,
    };
  },

  "instagram_autopost_run": async (filters) => {
    const { runIgAutopost } = await import("../services/igAutopost");
    const { isEnabled, setFlag } = await import("../services/featureFlags");
    
    const dryRun = filters.dryRun !== false;
    const forceArchetype = filters.forceArchetype as any;
    
    const initialFlag = await isEnabled("legacy_autopost_live");
    
    if (!initialFlag && !dryRun) {
      await setFlag("legacy_autopost_live", true);
    }
    
    try {
      const result = await runIgAutopost({
        dryRun,
        forceArchetype,
        source: "admin",
      });
      return result;
    } finally {
      if (!initialFlag && !dryRun) {
        await setFlag("legacy_autopost_live", false);
      }
    }
  },

  "instagram_autopost_set_config": async (filters) => {
    const { setFlag } = await import("../services/featureFlags");
    const enabled = filters.enabled === true;
    await setFlag("legacy_autopost_live", enabled);
    return { success: true, livePostingEnabled: enabled };
  },

  "instagram_autopost_test_hf": async () => {
    const dns = await import("dns");
    const util = await import("util");
    const lookup = util.promisify(dns.lookup);
    
    const hosts = ["google.com", "graph.facebook.com", "router.huggingface.co", "huggingface.co"];
    const dnsResults: Record<string, any> = {};
    for (const host of hosts) {
      try {
        const res = await lookup(host);
        dnsResults[host] = { address: res.address, family: res.family };
      } catch (err) {
        dnsResults[host] = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    const urls = ["https://google.com", "https://huggingface.co", "https://router.huggingface.co"];
    const fetchResults: Record<string, any> = {};
    for (const url of urls) {
      try {
        const start = Date.now();
        const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
        fetchResults[url] = { status: res.status, statusText: res.statusText, durationMs: Date.now() - start };
      } catch (err) {
        fetchResults[url] = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    return {
      dnsResults,
      fetchResults,
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
