/**
 * Bridge REST Routes — Plain Express endpoints for NOUR OS to pull shop data.
 *
 * NOUR OS (statenour-os.vercel.app) calls these to get:
 *   GET /api/bridge/health     — Bridge + vendor health status
 *   GET /api/bridge/shop-snapshot — Full shop floor snapshot
 *
 * Auth: X-Bridge-Key header must match BRIDGE_API_KEY env var.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { z } from "zod";

import { createLogger } from "../lib/logger";

// wave-181.59 MEDIUM (DoS): unbounded daysSince walked the whole customers
// table via INTERVAL arithmetic; unbounded limit returned megabytes of JSON.
// 365 / 500 are the operator-realistic ceilings — NOUR OS callers send the
// defaults; no admin view passes larger values.
const SmsCampaignInput = z.object({
  dryRun: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(50),
  daysSince: z.number().int().min(0).max(365).default(30),
});

// wave-181.61 MEDIUM (DoS): deferred from 181.59 spawn cluster. quick-note
// accepted arbitrary-length strings; a 100MB note would eat memory + flood
// stdout. 2000 chars is operator-realistic (the longest legit notes from
// NOUR OS are short sentences).
const QuickNoteInput = z.object({
  note: z.string().min(1).max(2000),
  context: z.string().max(200).optional(),
});

// wave-181.61 MEDIUM (DoS): ingest-reports accepted an unbounded invoices
// array. ShopDriver exports rarely exceed a few thousand rows per call;
// 10000 is a comfortable ceiling above any real-world batch. Analytics is
// already truncated at 2000 chars by the memory store; loose object here.
const IngestReportsInput = z.object({
  invoices: z.array(z.unknown()).min(1).max(10000),
  analytics: z.record(z.string(), z.unknown()).optional(),
});

// ─── Heavy-sync safety gate (2026-07-05 adversarial audit) ──────────
// backfill-history, trigger-mirror, and full-sync each took NO request
// body and fired a minutes-long, DB-writing sync the instant a call
// cleared bridgeAuth. An LLM driving the "Nour Command" Custom GPT — or a
// leaked X-Bridge-Key — could therefore loop heavy writes at will (the one
// confirmed cross-bridge finding on 2026-07-05). Two layered guards bring
// them to the same bar as the sibling ops (sms-campaign's dryRun-default,
// run-job's allowlist):
//   1. confirm-gate — require an explicit {confirm:true}; a missing/false
//      flag returns a no-op preview (defaults to the SAFE path), so an
//      accidental single call can't trigger a write.
//   2. per-op cooldown — a second real run within HEAVY_SYNC_COOLDOWN_MS
//      is rejected 429, so a tight loop can't repeatedly hammer the sync.
export const HEAVY_SYNC_COOLDOWN_MS = 60_000;

const HeavySyncInput = z.object({
  confirm: z.boolean().default(false),
});

type HeavySyncDecision =
  | { action: "run" }
  | { action: "reject"; status: number; body: Record<string, unknown> };

// Pure decision function (exported for unit tests). Time is injected via
// `now` and prior-run state via `lastRunAt` so it has no hidden clock or
// mutable state — the caller owns the per-op timestamp map and records a
// run only when this returns { action: "run" }.
export function evaluateHeavySync(
  op: string,
  body: unknown,
  lastRunAt: number | undefined,
  now: number,
): HeavySyncDecision {
  const parsed = HeavySyncInput.safeParse(body ?? {});
  if (!parsed.success) {
    return { action: "reject", status: 400, body: { error: "invalid input", issues: parsed.error.issues } };
  }
  // Guard 1: confirm-gate — default (missing/false) is the safe no-op path.
  if (!parsed.data.confirm) {
    return {
      action: "reject",
      status: 200,
      body: {
        skipped: true,
        confirmRequired: true,
        op,
        message: `DESTRUCTIVE op '${op}' not run — this was a safe no-op. Re-call with {"confirm": true} to execute.`,
      },
    };
  }
  // Guard 2: per-op cooldown — brake a looped confirmed caller.
  if (lastRunAt !== undefined && now - lastRunAt < HEAVY_SYNC_COOLDOWN_MS) {
    const retryAfterMs = HEAVY_SYNC_COOLDOWN_MS - (now - lastRunAt);
    return {
      action: "reject",
      status: 429,
      body: {
        error: "rate_limited",
        op,
        retryAfterMs,
        message: `'${op}' ran within the last ${HEAVY_SYNC_COOLDOWN_MS / 1000}s. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
      },
    };
  }
  return { action: "run" };
}

const log = createLogger("_core:bridge-routes");
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Auth middleware ────────────────────────────────────
function bridgeAuth(req: Request, res: Response, next: NextFunction): void {
  const key = process.env.BRIDGE_API_KEY;
  if (!key) {
    res.status(503).json({ error: "Bridge not configured" });
    return;
  }

  if (key.length < 32) {
    log.warn("[Bridge] WARNING: BRIDGE_API_KEY is short (" + key.length + " chars). Recommend 64+ chars for security.");
  }

  const provided = req.headers["x-bridge-key"];
  if (typeof provided !== "string" || !safeCompare(provided, key)) {
    res.status(401).json({ error: "Invalid bridge key" });
    return;
  }

  next();
}

// ─── Custom GPT Actions OpenAPI schema ──────────────────────────────
// 2026-07-05 · public OpenAPI 3.1 schema so a ChatGPT Custom GPT can
// "Import from URL" (https://nickstire.org/api/actions/openapi) and call
// the /api/bridge/* endpoints — the mirror of statenour's
// /api/actions/openapi. The schema itself is NOT a secret and is served
// unauthenticated (ChatGPT fetches it during import without a key); every
// OPERATION it describes still requires the X-Bridge-Key header at call
// time (bridgeAuth). Set BRIDGE_API_KEY as the action's API key in the GPT
// builder, auth type "API Key", custom header name "X-Bridge-Key".
type BridgeOp = {
  method: "get" | "post";
  path: string;
  id: string;
  summary: string;
  properties?: Record<string, { type: string; description: string; items?: { type: string }; default?: unknown }>;
  required?: string[];
};

const BRIDGE_OPS: BridgeOp[] = [
  { method: "get", path: "/api/bridge/health", id: "bridge_health", summary: "Bridge + DB health and sync counters." },
  { method: "get", path: "/api/bridge/shop-snapshot", id: "bridge_shop_snapshot", summary: "Live shop snapshot: work orders, bookings, leads, revenue signals." },
  { method: "get", path: "/api/bridge/analytics", id: "bridge_analytics", summary: "Traffic + funnel analytics rollup." },
  { method: "get", path: "/api/bridge/intelligence", id: "bridge_intelligence", summary: "Aggregated business intelligence brief." },
  { method: "get", path: "/api/bridge/cron-status", id: "bridge_cron_status", summary: "Status of scheduled cron jobs." },
  { method: "get", path: "/api/bridge/probe-alg", id: "bridge_probe_alg", summary: "Probe the ALG invoice integration." },
  {
    method: "post", path: "/api/bridge/actions/mark-contacted", id: "bridge_mark_contacted",
    summary: "Mark a lead as contacted.",
    properties: { leadId: { type: "integer", description: "The lead id to mark contacted (positive integer)." } },
    required: ["leadId"],
  },
  {
    method: "post", path: "/api/bridge/actions/quick-note", id: "bridge_quick_note",
    summary: "Log a quick operator note.",
    properties: {
      note: { type: "string", description: "Note body (1–2000 chars)." },
      context: { type: "string", description: "Optional short context tag (≤200 chars)." },
    },
    required: ["note"],
  },
  {
    method: "post", path: "/api/bridge/ingest-reports", id: "bridge_ingest_reports",
    summary: "Ingest a batch of invoice/analytics report rows.",
    properties: {
      invoices: { type: "array", description: "1–10000 invoice records.", items: { type: "object" } },
      analytics: { type: "object", description: "Optional analytics key/value map." },
    },
    required: ["invoices"],
  },
  {
    method: "post", path: "/api/bridge/sms-campaign", id: "bridge_sms_campaign",
    summary: "DESTRUCTIVE: run a win-back SMS campaign to real customers. dryRun defaults to true — set dryRun:false to actually send.",
    properties: {
      dryRun: { type: "boolean", description: "If true (default), simulate without sending. Set false to send real texts.", default: true },
      limit: { type: "integer", description: "Max recipients (1–500, default 50)." },
      daysSince: { type: "integer", description: "Target customers inactive at least this many days (0–365, default 30)." },
    },
  },
  {
    method: "post", path: "/api/bridge/backfill-history", id: "bridge_backfill_history",
    summary: "DESTRUCTIVE: backfill all historical invoice data (writes to the DB). Safe by default — omit/false confirm returns a no-op preview; set confirm:true to run. Rate-limited to one run per 60s.",
    properties: { confirm: { type: "boolean", description: "Must be true to actually run. Omitted/false (default) returns a no-op preview without writing.", default: false } },
  },
  {
    method: "post", path: "/api/bridge/trigger-mirror", id: "bridge_trigger_mirror",
    summary: "DESTRUCTIVE: trigger a ShopDriver/ALG data mirror sync run. Safe by default — omit/false confirm returns a no-op preview; set confirm:true to run. Rate-limited to one run per 60s.",
    properties: { confirm: { type: "boolean", description: "Must be true to actually run. Omitted/false (default) returns a no-op preview without syncing.", default: false } },
  },
  {
    method: "post", path: "/api/bridge/full-sync", id: "bridge_full_sync",
    summary: "DESTRUCTIVE: force a full data sync cascade (mirror → sheets → statenour → brain; heavy, writes). Safe by default — omit/false confirm returns a no-op preview; set confirm:true to run. Rate-limited to one run per 60s.",
    properties: { confirm: { type: "boolean", description: "Must be true to actually run. Omitted/false (default) returns a no-op preview without syncing.", default: false } },
  },
  {
    method: "post", path: "/api/bridge/run-job", id: "bridge_run_job",
    summary: "DESTRUCTIVE: run an allowlisted background job by name (e.g. dashboard-sync, vendor-health, self-healing, customer-segmentation, enrich-customer-data, weather-intel).",
    properties: { jobName: { type: "string", description: "Allowlisted job name; a non-allowlisted name returns 403 with the allowed list." } },
    required: ["jobName"],
  },
  {
    method: "post", path: "/api/bridge/diag", id: "bridge_diag",
    summary: "Run a read-only SELECT diagnostic query (SELECT-only, single statement, ≤2000 chars; writes are rejected).",
    properties: { query: { type: "string", description: "A single read-only SELECT statement." } },
    required: ["query"],
  },
];

function buildBridgeOpenApi(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const op of BRIDGE_OPS) {
    const operation: Record<string, unknown> = {
      operationId: op.id,
      summary: op.summary,
      description: op.summary,
      responses: {
        "200": { description: "Success", content: { "application/json": { schema: { type: "object" } } } },
      },
    };
    if (op.method === "post") {
      operation.requestBody = {
        required: !!(op.required && op.required.length),
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: op.properties ?? {},
              ...(op.required && op.required.length ? { required: op.required } : {}),
            },
          },
        },
      };
    }
    paths[op.path] = { [op.method]: operation };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Nick's Tire & Auto Bridge",
      description: "Remote command interface (nickstire.org) for a Custom GPT. All operations require the X-Bridge-Key header.",
      version: "1.0.0",
    },
    servers: [{ url: "https://nickstire.org" }],
    paths,
    components: {
      securitySchemes: {
        BridgeKey: { type: "apiKey", in: "header", name: "X-Bridge-Key" },
      },
    },
    security: [{ BridgeKey: [] }],
  };
}

const BRIDGE_OPENAPI_SCHEMA = buildBridgeOpenApi();

export function registerBridgeRoutes(app: Express): void {
  // Per-op last-run timestamps for the heavy-sync cooldown (see
  // evaluateHeavySync). In-memory is sufficient: a single Railway instance
  // serves the bridge, and the cooldown only needs to brake a tight loop
  // from one caller — not coordinate a cluster. A restart resets it, which
  // is harmless (a fresh process legitimately allows the next run).
  const heavySyncLastRun = new Map<string, number>();
  function passesHeavySyncGate(op: string, req: Request, res: Response): boolean {
    const decision = evaluateHeavySync(op, req.body, heavySyncLastRun.get(op), Date.now());
    if (decision.action === "reject") {
      res.status(decision.status).json({ ...decision.body, timestamp: new Date().toISOString() });
      return false;
    }
    heavySyncLastRun.set(op, Date.now());
    return true;
  }

  // ─── Custom GPT Actions schema (public; per-op auth still enforced) ──
  app.get("/api/actions/openapi", (_req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(BRIDGE_OPENAPI_SCHEMA);
  });

  // ─── Health Check ──────────────────────────────────────
  app.get("/api/bridge/health", bridgeAuth, async (_req, res) => {
    try {
      const { getSyncStatus } = await import("../nour-os-bridge");
      const sync = getSyncStatus();

      // Check DB connectivity
      let dbHealthy = false;
      try {
        const { getDb } = await import("../db");
        const d = await getDb();
        dbHealthy = !!d;
      } catch (err) {
        log.error("[Bridge] DB health check failed:", err instanceof Error ? err.message : err);
      }

      res.json({
        status: dbHealthy ? "healthy" : "degraded",
        bridge: {
          eventsLocal: sync.totalEventsLocal,
          eventsSent: sync.totalEventsSent,
          lastSync: sync.lastSyncTime,
          lastError: sync.lastError,
        },
        database: dbHealthy,
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(500).json({
        status: "error",
        error: "Internal error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ─── Shop Snapshot ─────────────────────────────────────
  app.get("/api/bridge/shop-snapshot", bridgeAuth, async (_req, res) => {
    try {
      const { getSyncStatus } = await import("../nour-os-bridge");
      const sync = getSyncStatus();

      // Work order stats
      let workOrders: Record<string, unknown> = {};
      try {
        const { getWorkOrderStats } = await import("../services/workOrderService");
        workOrders = await getWorkOrderStats();
      } catch (err) {
        log.error("[Bridge] Work order stats failed:", err instanceof Error ? err.message : err);
      }

      // Vendor health
      let vendors: unknown[] = [];
      let vendorOverall = "unknown";
      try {
        const { getVendorHealthReport } = await import("../services/vendorHealth");
        const report = await getVendorHealthReport();
        vendors = report.results;
        vendorOverall = report.overallStatus;
      } catch (err) {
        log.error("[Bridge] Vendor health failed:", err instanceof Error ? err.message : err);
      }

      // Dispatch load
      let dispatch: Record<string, unknown> = {};
      try {
        const { getDispatchLoad } = await import("../services/dispatch");
        const load: { techs: Array<{ clockedIn: boolean }>; bays: Array<{ occupied: boolean }> } = await getDispatchLoad();
        const clockedIn = load.techs.filter((t) => t.clockedIn).length;
        const freeBays = load.bays.filter((b) => !b.occupied).length;
        dispatch = {
          techsClockedIn: clockedIn,
          freeBays,
          totalBays: load.bays.length,
        };
      } catch (err) {
        log.error("[Bridge] Dispatch load failed:", err instanceof Error ? err.message : err);
      }

      // QC stats
      let qc: Record<string, unknown> = {};
      try {
        const { getQcStats } = await import("../services/qcService");
        qc = await getQcStats();
      } catch (err) {
        log.error("[Bridge] QC stats failed:", err instanceof Error ? err.message : err);
      }

      // Promise risk
      let risk: Record<string, unknown> = {};
      try {
        const { getPromiseRiskSummary } = await import("../services/promiseRisk");
        risk = await getPromiseRiskSummary();
      } catch (err) {
        log.error("[Bridge] Promise risk failed:", err instanceof Error ? err.message : err);
      }

      // Live revenue + bookings + leads + callbacks
      let revenue: Record<string, unknown> = {};
      let bookings: Record<string, unknown> = {};
      let leads: Record<string, unknown> = {};
      let callbacks: Record<string, unknown> = {};
      try {
        const { getShopPulse } = await import("../services/nickIntelligence");
        const pulse = await getShopPulse();
        revenue = {
          todayRevenue: pulse.today.revenue,
          weekRevenue: pulse.thisWeek.revenue,
          avgTicket: pulse.today.avgTicket,
          jobsToday: pulse.today.jobsClosed,
          walkRate: pulse.thisWeek.walkRate,
          shopStatus: pulse.shopStatus,
          shopInsight: pulse.shopInsight,
        };
      } catch (err) {
        log.error("[Bridge] Shop pulse fetch failed:", err instanceof Error ? err.message : err);
      }
      try {
        const { getDashboardStats } = await import("../admin-stats");
        const stats = await getDashboardStats();
        bookings = { total: stats.bookings.total, thisWeek: stats.bookings.thisWeek, new: stats.bookings.new };
        leads = { total: stats.leads.total, thisWeek: stats.leads.thisWeek, new: stats.leads.new, urgent: stats.leads.urgent };
        callbacks = { total: stats.callbacks.total, new: stats.callbacks.new };
      } catch (err) {
        log.error("[Bridge] Dashboard stats fetch failed:", err instanceof Error ? err.message : err);
      }

      res.json({
        shop: "nickstire",
        timestamp: new Date().toISOString(),
        sync: {
          eventsLocal: sync.totalEventsLocal,
          eventsSent: sync.totalEventsSent,
          lastSync: sync.lastSyncTime,
          lastError: sync.lastError,
        },
        workOrders,
        vendorHealth: { overall: vendorOverall, vendors },
        dispatch,
        qc,
        promiseRisk: risk,
        revenue,
        bookings,
        leads,
        callbacks,
      });
    } catch {
      res.status(500).json({
        shop: "nickstire",
        error: "Internal error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ─── BRIDGE ACTIONS (bidirectional — NOUR OS triggers actions) ────

  // Mark a lead as contacted — wave-178 STRIDE T (Tampering) fix:
  // leadId went straight into eq() with no integer validation. A non-
  // integer or coerced-falsy value could produce a malformed WHERE
  // matching unintended rows. Same Number.isInteger guard the rest
  // of the codebase already uses for sql.raw interpolation sites.
  app.post("/api/bridge/actions/mark-contacted", bridgeAuth, async (req, res) => {
    try {
      const leadIdParsed = parseInt(String(req.body.leadId), 10);
      if (!Number.isInteger(leadIdParsed) || leadIdParsed <= 0) {
        res.status(400).json({ error: "leadId must be a positive integer" });
        return;
      }
      const { getDb } = await import("../db");
      const { leads } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }
      await db.update(leads).set({ status: "contacted" }).where(eq(leads.id, leadIdParsed));
      res.json({ success: true, leadId: leadIdParsed });
    } catch (err: unknown) {
      log.error("[Bridge] Action error:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Add a quick note to a customer or work order
  app.post("/api/bridge/actions/quick-note", bridgeAuth, async (req, res) => {
    try {
      const parsed = QuickNoteInput.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
        return;
      }
      const { note, context } = parsed.data;
      // Privacy: log metadata only — never the note body to the stdout/Railway stream.
      // NOTE: quick-note currently has NO persistence sink (the note is not written to
      // any table). If retained notes are needed, wire a real store here; until then
      // this endpoint only acknowledges receipt.
      log.info("[bridge:note] received", {
        context: context || "general",
        note_len: note.length,
      });
      res.json({ success: true, logged: true });
    } catch (err: unknown) {
      log.error("[Bridge] Action error:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Ingest parsed report data (invoices + analytics) from local machine
  app.post("/api/bridge/ingest-reports", bridgeAuth, async (req, res) => {
    try {
      const parsed = IngestReportsInput.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
        return;
      }
      const { invoices, analytics } = parsed.data;

      // Store analytics as a memory for the brain. Zod gives us a bounded
      // shape; downstream code expects ShopDriver's analytics fields, which
      // we read through a structural alias rather than re-validating.
      if (analytics) {
        const a = analytics as {
          totalRevenue?: number;
          invoiceCount?: number;
          operatingDays?: number;
          avgTicketSize?: number;
          repeatRate?: number;
          growthRate?: number;
          serviceCategories?: unknown[];
          projectedAnnualRevenue?: number;
        };
        try {
          const { remember } = await import("../services/nickMemory");
          await remember({
            type: "insight",
            content: JSON.stringify({
              source: "shopdriver_reports",
              totalRevenue: a.totalRevenue,
              invoiceCount: a.invoiceCount,
              operatingDays: a.operatingDays,
              avgTicketSize: a.avgTicketSize,
              repeatRate: a.repeatRate,
              growthRate: a.growthRate,
              topCategories: a.serviceCategories?.slice(0, 5),
              projectedAnnual: a.projectedAnnualRevenue,
            }).slice(0, 2000),
            source: "report_ingestion",
            confidence: 0.95,
          });
        } catch (e) { log.warn("[bridge] operation failed:", e); }
      }

      // Ingest invoices — Zod enforces array + bounds; field shape is
      // validated downstream by ingestInvoices itself.
      // wave-181.61 · destructured import so the typeof cast is on a
      // bare identifier (TS rejects `typeof ns.member` inside generic
      // type arguments — TS1005 parser error).
      const { ingestInvoices } = await import("../services/reportIngestion");
      const result = await ingestInvoices(
        invoices as Parameters<typeof ingestInvoices>[0],
      );

      // Run enrichment after ingestion
      try {
        const { enrichCustomerData } = await import("../services/dataPipelines");
        const enrichResult = await enrichCustomerData();
        res.json({
          ingestion: result,
          enrichment: enrichResult.details,
          analyticsStored: !!analytics,
          timestamp: new Date().toISOString(),
        });
      } catch (enrichErr: unknown) {
        res.json({
          ingestion: result,
          enrichment: `failed: ${(enrichErr as Error).message}`,
          analyticsStored: !!analytics,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err: unknown) {
      log.error("[Bridge] Ingest error:", err);
      res.status(500).json({ error: (err as Error).message || "Ingestion failed" });
    }
  });

  // Get stored analytics
  app.get("/api/bridge/analytics", bridgeAuth, async (_req, res) => {
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }

      // Get invoice stats directly.
      // wave-182 (architecture decision #3): canonical revenue = PAID-only.
      // This endpoint feeds statenour's Nick intelligence; without the filter
      // Nick read an all-invoice total inflated by pending / partial / refunded
      // rows. Filter to collected revenue (consistent with the admin surfaces).
      const [stats] = await db.execute(sql`
        SELECT
          COUNT(*) as totalInvoices,
          SUM(totalAmount) as totalRevenue,
          SUM(laborCost) as totalLabor,
          SUM(partsCost) as totalParts,
          SUM(taxAmount) as totalTax,
          AVG(totalAmount) as avgTicket,
          MIN(invoiceDate) as firstInvoice,
          MAX(invoiceDate) as lastInvoice,
          COUNT(DISTINCT customerName) as uniqueCustomers,
          COUNT(DISTINCT DATE(invoiceDate)) as operatingDays
        FROM invoices
        WHERE paymentStatus = 'paid'
      `);

      // Monthly trend
      const [monthly] = await db.execute(sql`
        SELECT
          DATE_FORMAT(invoiceDate, '%Y-%m') as month,
          COUNT(*) as invoices,
          SUM(totalAmount) as revenue,
          SUM(laborCost) as labor,
          SUM(partsCost) as parts
        FROM invoices
        WHERE paymentStatus = 'paid'
        GROUP BY DATE_FORMAT(invoiceDate, '%Y-%m')
        ORDER BY month
      `);

      // Payment method breakdown
      const [payments] = await db.execute(sql`
        SELECT paymentMethod, COUNT(*) as cnt, SUM(totalAmount) as revenue
        FROM invoices WHERE paymentStatus = 'paid' GROUP BY paymentMethod ORDER BY revenue DESC
      `);

      // Customer stats
      const [custStats] = await db.execute(sql`
        SELECT
          SUM(CASE WHEN totalSpent > 0 THEN 1 ELSE 0 END) as withSpend,
          SUM(CASE WHEN totalVisits >= 2 THEN 1 ELSE 0 END) as repeatCustomers,
          SUM(CASE WHEN totalVisits >= 3 THEN 1 ELSE 0 END) as vip,
          SUM(CASE WHEN vehicleMake IS NOT NULL THEN 1 ELSE 0 END) as withVehicle,
          COUNT(*) as total
        FROM customers
      `);

      res.json({
        invoiceStats: (stats as Record<string, unknown>[])?.[0],
        monthlyTrend: monthly,
        paymentBreakdown: payments,
        customerStats: (custStats as Record<string, unknown>[])?.[0],
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // SMS Thank You + Referral + Review campaign — targets recent customers
  app.post("/api/bridge/sms-campaign", bridgeAuth, async (req, res) => {
    try {
      const { isEnabled } = await import("../services/featureFlags");
      if (!(await isEnabled("sms_blast_enabled"))) {
        res.json({ error: "SMS blast feature is disabled", sent: 0 });
        return;
      }
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }

      const parsed = SmsCampaignInput.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
        return;
      }
      const { dryRun, limit, daysSince } = parsed.data;

      // Find recent customers with phone numbers who visited in the last N days
      const [targets] = await db.execute(sql`
        SELECT c.id, c.firstName, c.lastName, c.phone, c.totalSpent, c.totalVisits, c.lastVisitDate,
               c.vehicleMake, c.vehicleModel, c.vehicleYear
        FROM customers c
        WHERE c.lastVisitDate >= DATE_SUB(NOW(), INTERVAL ${daysSince} DAY)
          AND c.phone IS NOT NULL AND LENGTH(c.phone) >= 10
          AND c.smsOptOut = 0 AND c.smsCampaignSent = 0
        ORDER BY c.lastVisitDate DESC
        LIMIT ${limit}
      `);

      interface SmsCampaignCustomer {
        id: number;
        firstName: string | null;
        lastName: string | null;
        phone: string;
        totalSpent: number | null;
        totalVisits: number | null;
        lastVisitDate: string | null;
        vehicleMake: string | null;
        vehicleModel: string | null;
        vehicleYear: string | null;
      }
      const customers = targets as SmsCampaignCustomer[];
      const messages: { phone: string; name: string; message: string }[] = [];

      for (const c of customers) {
        const firstName = c.firstName || "there";
        const vehicle = [c.vehicleYear, c.vehicleMake, c.vehicleModel].filter(Boolean).join(" ");
        const vehicleLine = vehicle ? ` on your ${vehicle}` : "";

        const msg = `Hey ${firstName}, Nick's Tire & Auto here. Thanks again for trusting us with the work${vehicleLine}. ` +
          `If we earned it, a quick Google review helps other Cleveland drivers find us: https://g.page/r/nickstire/review. ` +
          `If you send a friend our way, we'll take care of you both on your next visits. Call or text us anytime at (216) 862-0005.`;

        messages.push({ phone: c.phone, name: `${c.firstName} ${c.lastName}`, message: msg });
      }

      if (dryRun) {
        res.json({
          dryRun: true,
          targetCount: messages.length,
          sampleMessages: messages.slice(0, 3),
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Actually send via Twilio
      let sent = 0, failed = 0;
      const { sendSms } = await import("../sms");
      for (const m of messages) {
        try {
          await sendSms(m.phone, m.message, { via: "shop" });
          // Mark customer as campaign-sent
          await db.execute(sql`UPDATE customers SET smsCampaignSent = 1, smsCampaignDate = NOW() WHERE phone = ${m.phone}`);
          sent++;
        } catch {
          failed++;
        }
      }

      // Log to Telegram
      try {
        const { sendTelegram } = await import("../services/telegram");
        await sendTelegram(`📱 SMS Campaign Sent\n\n${sent} messages sent, ${failed} failed\nCampaign: Thank You + Referral + Review`);
      } catch (e) { log.warn("[bridge] operation failed:", e); }

      res.json({ sent, failed, total: messages.length, timestamp: new Date().toISOString() });
    } catch (err: unknown) {
      log.error("[Bridge] SMS campaign error:", err);
      res.status(500).json({ error: (err as Error).message || "Campaign failed" });
    }
  });

  // Historical backfill — fetch ALL invoice history from ShopDriver (not just recent)
  app.post("/api/bridge/backfill-history", bridgeAuth, async (req, res) => {
    if (!passesHeavySyncGate("backfill-history", req, res)) return;
    try {
      const { runHistoricalBackfill } = await import("../services/shopDriverMirror");
      const result = await runHistoricalBackfill();
      res.json({ ...result, timestamp: new Date().toISOString() });
    } catch (err: unknown) {
      log.error("[Bridge] Backfill error:", err);
      res.status(500).json({ error: (err as Error).message || "Backfill failed" });
    }
  });

  // Force ShopDriver/ALG mirror sync (instead of waiting for 15-min pulse)
  app.post("/api/bridge/trigger-mirror", bridgeAuth, async (req, res) => {
    if (!passesHeavySyncGate("trigger-mirror", req, res)) return;
    try {
      const { runFullMirror, debugLastFetch } = await import("../services/shopDriverMirror");
      const result = await runFullMirror();
      res.json({ success: true, ...result, debug: debugLastFetch(), timestamp: new Date().toISOString() });
    } catch (err: unknown) {
      log.error("[Bridge] Mirror trigger error:", err);
      res.status(500).json({ error: (err as Error).message || "Mirror sync failed" });
    }
  });

  // Probe ALG API endpoints to discover what data is available
  app.get("/api/bridge/probe-alg", bridgeAuth, async (_req, res) => {
    try {
      const { probeAlgEndpoints } = await import("../services/shopDriverMirror");
      const results = await probeAlgEndpoints();
      res.json({ results, timestamp: new Date().toISOString() });
    } catch (err: unknown) {
      log.error("[Bridge] ALG probe error:", err);
      res.status(500).json({ error: (err as Error).message || "Probe failed" });
    }
  });

  // Full data cascade: mirror → sheets → statenour → brain (run all syncs)
  app.post("/api/bridge/full-sync", bridgeAuth, async (req, res) => {
    if (!passesHeavySyncGate("full-sync", req, res)) return;
    const results: Record<string, unknown> = { timestamp: new Date().toISOString() };
    const start = Date.now();

    // 1. Mirror sync (ALG → DB)
    try {
      const { runFullMirror } = await import("../services/shopDriverMirror");
      results.mirror = await runFullMirror();
    } catch (e: unknown) {
      results.mirror = { error: (e as Error).message };
    }

    // 2. Dashboard Sheets sync (DB → Google Sheets)
    try {
      const { processDashboardSync } = await import("../cron/jobs/dashboardSync");
      results.sheets = await processDashboardSync();
    } catch (e: unknown) {
      results.sheets = { error: (e as Error).message };
    }

    // 3. Statenour sync (DB → NOUR OS brain)
    try {
      const { syncToStatenour } = await import("../cron/jobs/statenourSync");
      results.statenour = await syncToStatenour();
    } catch (e: unknown) {
      results.statenour = { error: (e as Error).message };
    }

    // 4. Nick AI memory — learn from backlog
    try {
      const { remember } = await import("../services/nickMemory");
      const mirrorResult = results.mirror as Record<string, unknown> | undefined;
      const mirrorDetails = (mirrorResult?.details as string) || "";
      if (mirrorDetails.includes("updated") || mirrorDetails.includes("new")) {
        await remember({
          type: "pattern",
          content: `ALG MIRROR RECOVERY: Data backlog resolved. ${mirrorDetails}. All invoice data refreshed across DB, Sheets, and NOUR OS.`,
          source: "mirror_recovery",
          confidence: 0.9,
        });
      }
      results.brain = { learned: true };
    } catch (e: unknown) {
      results.brain = { error: (e as Error).message };
    }

    results.totalDuration = `${Date.now() - start}ms`;
    res.json(results);
  });

  // wave-178 STRIDE D (Denial of Service): allowlist of cron jobs the
  // bridge endpoint is allowed to fire on demand. Previously accepted
  // ANY job name from the request body — a compromised BRIDGE_API_KEY
  // (or a tight polling loop) could fire expensive long-running jobs
  // (full ALG mirror sync, historical backfill) in rapid succession,
  // exhausting the DB connection pool or ALG session limits.
  //
  // This list intentionally excludes destructive ops (anything that
  // writes outbound SMS, ALG sync, or financial mutations). Add to it
  // explicitly when you genuinely need to run a job over the bridge.
  const BRIDGE_RUN_JOB_ALLOWLIST = new Set([
    "enrich-customer-data",
    "customer-segmentation",
    "vendor-health",
    "dashboard-sync",
    "self-healing",
    "weather-intel",
    "review-monitor",
    "staff-performance",
    "fleet-scoring",
  ]);

  // Run a specific cron job by name (e.g. enrich-customer-data)
  app.post("/api/bridge/run-job", bridgeAuth, async (req, res) => {
    try {
      const { jobName } = req.body;
      if (!jobName || typeof jobName !== "string") {
        res.status(400).json({ error: "jobName required (string)" });
        return;
      }
      if (!BRIDGE_RUN_JOB_ALLOWLIST.has(jobName)) {
        res.status(403).json({
          error: "jobName not allowed via bridge",
          allowed: Array.from(BRIDGE_RUN_JOB_ALLOWLIST),
        });
        return;
      }
      // Try legacy registry first, then tiered scheduler
      const { runJobByName } = await import("../cron/index");
      let result = await runJobByName(jobName);
      if (result.status === "not_found") {
        const { runTierJobByName } = await import("../cron/scheduler");
        result = await runTierJobByName(jobName);
      }
      res.json({ ...result, timestamp: new Date().toISOString() });
    } catch (err: unknown) {
      log.error("[Bridge] Run job error:", err);
      res.status(500).json({ error: (err as Error).message || "Job failed" });
    }
  });

  // Ad-hoc diagnostic query (read-only) — hardened wave-165
  // Even behind bridgeAuth this surface was dangerous: trim+startsWith("SELECT")
  // is bypassed by multi-statement attacks ("SELECT 1; DROP TABLE..."),
  // SELECT INTO OUTFILE exfil, and UNION-based blind injection. We now apply
  // five layered guards before passing anything to sql.raw. A compromised
  // bridge key must no longer translate to arbitrary DB access.
  app.post("/api/bridge/diag", bridgeAuth, async (req, res) => {
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }
      const query = req.body.query;
      if (!query || typeof query !== "string") { res.status(400).json({ error: "query required" }); return; }
      const q = query.trim();

      // Guard 1: length cap — diagnostic queries are short
      if (q.length > 2000) { res.status(400).json({ error: "query too long (max 2000 chars)" }); return; }

      // Guard 2: must start with SELECT (case-insensitive)
      if (!/^select\s/i.test(q)) { res.status(400).json({ error: "SELECT only" }); return; }

      // Guard 3: no statement separators (kills multi-statement injection)
      // Strip the optional trailing semicolon first so legitimate "SELECT ...;" still passes.
      const qNoTrailing = q.replace(/;\s*$/, "");
      if (qNoTrailing.includes(";")) { res.status(400).json({ error: "multi-statement queries forbidden" }); return; }

      // Guard 4: dangerous patterns — exfiltration + privilege probes
      const FORBIDDEN = /\b(into\s+outfile|into\s+dumpfile|load_file|load\s+data|sys_exec|benchmark|sleep|information_schema\.user_privileges|mysql\.user)\b/i;
      if (FORBIDDEN.test(qNoTrailing)) { res.status(400).json({ error: "forbidden pattern" }); return; }

      // Guard 5: no write keywords (defence-in-depth even though we required SELECT prefix)
      const WRITE = /\b(insert|update|delete|drop|truncate|alter|create|rename|grant|revoke|replace)\b/i;
      if (WRITE.test(qNoTrailing)) { res.status(400).json({ error: "write keyword detected" }); return; }

      const [rows] = await db.execute(sql.raw(qNoTrailing));
      // Cap response to first 500 rows so an unbounded SELECT can't dump the whole table.
      const limited = Array.isArray(rows) ? rows.slice(0, 500) : rows;
      res.json({ rows: limited, truncated: Array.isArray(rows) && rows.length > 500, timestamp: new Date().toISOString() });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get cron status (read-only action)
  app.get("/api/bridge/cron-status", bridgeAuth, async (_req, res) => {
    try {
      const { getJobStatuses } = await import("../cron/index");
      res.json({ jobs: getJobStatuses(), timestamp: new Date().toISOString() });
    } catch (err: unknown) {
      log.error("[Bridge] Cron status error:", err);
      res.json({ jobs: [], error: "Internal error" });
    }
  });

  // ─── BUSINESS INTELLIGENCE — Full analytics + forecasting ────
  app.get("/api/bridge/intelligence", bridgeAuth, async (_req, res) => {
    try {
      const results: Record<string, unknown> = { timestamp: new Date().toISOString() };

      // 1. Conversion pipeline (estimate→job, lead→booking rates)
      try {
        const { analyzeConversionPipeline } = await import("../services/nickIntelligence");
        results.pipeline = await analyzeConversionPipeline();
      } catch (e: unknown) {
        results.pipeline = { error: (e as Error).message };
      }

      // 2. Revenue projections (weekly, monthly, trends)
      try {
        const { projectRevenue } = await import("../services/nickIntelligence");
        results.revenue = await projectRevenue();
      } catch (e: unknown) {
        results.revenue = { error: (e as Error).message };
      }

      // 3. Customer intelligence (CLV, retention, at-risk, top spenders)
      try {
        const { analyzeCustomers } = await import("../services/customerIntelligence");
        const ci = await analyzeCustomers();
        results.customers = {
          total: ci.totalCustomers,
          active: ci.activeCustomers,
          lapsed: ci.lapsedCustomers,
          lost: ci.lostCustomers,
          newThisMonth: ci.newThisMonth,
          retentionRate: ci.retentionRate,
          avgTicket: ci.avgTicket,
          avgVisitsPerCustomer: ci.avgVisitsPerCustomer,
          avgLifetimeValue: ci.avgLifetimeValue,
          topSpenders: ci.topSpenders.slice(0, 5),
          atRiskCustomers: ci.atRiskCustomers.slice(0, 5),
          servicePatterns: ci.servicePatterns.slice(0, 10),
          dayOfWeekPattern: ci.dayOfWeekPattern,
          peakHours: ci.peakHours,
        };
      } catch (e: unknown) {
        results.customers = { error: (e as Error).message };
      }

      // 4. Proactive alerts (what needs attention right now)
      try {
        const { generateProactiveAlerts } = await import("../services/nickIntelligence");
        results.alerts = await generateProactiveAlerts();
      } catch (e: unknown) {
        results.alerts = { error: (e as Error).message };
      }

      // 5. AI weekly insight
      try {
        const { generateWeeklyInsight } = await import("../services/nickIntelligence");
        results.aiInsight = await generateWeeklyInsight();
      } catch (e: unknown) {
        results.aiInsight = (e as Error).message;
      }

      // 6. Historical revenue snapshots (last 30 days)
      try {
        const { getDb } = await import("../db");
        const { invoices } = await import("../../drizzle/schema");
        const { sql, gte, eq } = await import("drizzle-orm");
        const d = await getDb();
        if (d) {
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const dailyRevenue = await d.execute(sql`
            SELECT DATE(invoiceDate) as day,
                   COUNT(*) as jobs,
                   COALESCE(SUM(totalAmount), 0) as revenue
            FROM invoices
            WHERE invoiceDate >= ${thirtyDaysAgo}
              AND paymentStatus = 'paid'
            GROUP BY DATE(invoiceDate)
            ORDER BY day DESC
          `);
          type DbRow = Record<string, unknown>;
          results.dailyRevenue = (dailyRevenue as DbRow[]).map((r) => ({
            date: r.day as string,
            jobs: Number(r.jobs),
            revenue: Math.round(Number(r.revenue) / 100),
          }));

          // Monthly totals (last 6 months)
          const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
          const monthlyRevenue = await d.execute(sql`
            SELECT DATE_FORMAT(invoiceDate, '%Y-%m') as month,
                   COUNT(*) as jobs,
                   COALESCE(SUM(totalAmount), 0) as revenue,
                   ROUND(AVG(totalAmount)) as avgTicket
            FROM invoices
            WHERE invoiceDate >= ${sixMonthsAgo}
              AND paymentStatus = 'paid'
            GROUP BY DATE_FORMAT(invoiceDate, '%Y-%m')
            ORDER BY month DESC
          `);
          results.monthlyRevenue = (monthlyRevenue as DbRow[]).map((r) => ({
            month: r.month as string,
            jobs: Number(r.jobs),
            revenue: Math.round(Number(r.revenue) / 100),
            avgTicket: Math.round(Number(r.avgTicket) / 100),
          }));

          // Total historical stats
          const [allTimeRows] = await d.execute(sql`
            SELECT COUNT(*) as totalInvoices,
                   COALESCE(SUM(totalAmount), 0) as totalRevenue,
                   ROUND(AVG(totalAmount)) as avgTicket,
                   MIN(invoiceDate) as firstInvoice,
                   MAX(invoiceDate) as lastInvoice
            FROM invoices WHERE paymentStatus = 'paid'
          `);
          const allTimeStats = (allTimeRows as DbRow[])?.[0] as DbRow | undefined;
          results.allTime = {
            totalInvoices: Number(allTimeStats?.totalInvoices || 0),
            totalRevenue: Math.round(Number(allTimeStats?.totalRevenue || 0) / 100),
            avgTicket: Math.round(Number(allTimeStats?.avgTicket || 0) / 100),
            firstInvoice: allTimeStats?.firstInvoice,
            lastInvoice: allTimeStats?.lastInvoice,
          };

          // Service breakdown (top services by revenue)
          const serviceBreakdown = await d.execute(sql`
            SELECT serviceDescription,
                   COUNT(*) as count,
                   COALESCE(SUM(totalAmount), 0) as revenue
            FROM invoices
            WHERE paymentStatus = 'paid'
              AND serviceDescription IS NOT NULL
              AND serviceDescription != ''
            GROUP BY serviceDescription
            ORDER BY revenue DESC
            LIMIT 15
          `);
          results.topServices = (serviceBreakdown as DbRow[]).map((r) => ({
            service: r.serviceDescription as string,
            count: Number(r.count),
            revenue: Math.round(Number(r.revenue) / 100),
          }));

          // Payment method breakdown
          const paymentBreakdown = await d.execute(sql`
            SELECT paymentMethod,
                   COUNT(*) as count,
                   COALESCE(SUM(totalAmount), 0) as revenue
            FROM invoices WHERE paymentStatus = 'paid'
            GROUP BY paymentMethod
            ORDER BY revenue DESC
          `);
          results.paymentMethods = (paymentBreakdown as DbRow[]).map((r) => ({
            method: r.paymentMethod as string,
            count: Number(r.count),
            revenue: Math.round(Number(r.revenue) / 100),
          }));

          // Day of week performance
          const dayOfWeekPerf = await d.execute(sql`
            SELECT DAYOFWEEK(invoiceDate) as dow,
                   COUNT(*) as jobs,
                   COALESCE(SUM(totalAmount), 0) as revenue
            FROM invoices
            WHERE paymentStatus = 'paid'
              AND invoiceDate >= ${thirtyDaysAgo}
            GROUP BY DAYOFWEEK(invoiceDate)
            ORDER BY dow
          `);
          const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          results.dayOfWeekPerformance = (dayOfWeekPerf as DbRow[]).map((r) => ({
            day: dayNames[Number(r.dow) - 1] || "?",
            jobs: Number(r.jobs),
            revenue: Math.round(Number(r.revenue) / 100),
          }));
        }
      } catch (e: unknown) {
        results.historicalError = (e as Error).message;
      }

      // 7. Revenue anomaly detection
      try {
        const { detectRevenueAnomalies } = await import("../services/revenuePrediction");
        const dailyRev = results.dailyRevenue as Array<{ date: string; jobs: number; revenue: number }> | undefined;
        if (dailyRev && dailyRev.length >= 14) {
          results.anomalies = detectRevenueAnomalies(
            dailyRev.map((d) => ({ date: d.date, amount: d.revenue, orderCount: d.jobs }))
          );
        }
      } catch (e) { log.warn("[bridge] operation failed:", e); }

      // 8. Shop pulse (current state)
      try {
        const { getShopPulse } = await import("../services/nickIntelligence");
        results.shopPulse = await getShopPulse();
      } catch (e: unknown) {
        results.shopPulse = { error: (e as Error).message };
      }

      res.json(results);
    } catch (err: unknown) {
      log.error("[Bridge] Intelligence error:", err);
      res.status(500).json({ error: "Internal error", timestamp: new Date().toISOString() });
    }
  });
}
