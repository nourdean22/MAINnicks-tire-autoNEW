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

// ─── Auth middleware ────────────────────────────────────
function bridgeAuth(req: Request, res: Response, next: NextFunction): void {
  const key = process.env.BRIDGE_API_KEY;
  if (!key) {
    res.status(503).json({ error: "Bridge not configured" });
    return;
  }

  const provided = req.headers["x-bridge-key"];
  if (provided !== key) {
    res.status(401).json({ error: "Invalid bridge key" });
    return;
  }

  next();
}

export function registerBridgeRoutes(app: Express): void {
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
      } catch {}

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
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err.message,
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
      } catch {}

      // Vendor health
      let vendors: unknown[] = [];
      let vendorOverall = "unknown";
      try {
        const { getVendorHealthReport } = await import("../services/vendorHealth");
        const report = await getVendorHealthReport();
        vendors = report.results;
        vendorOverall = report.overallStatus;
      } catch {}

      // Dispatch load
      let dispatch: Record<string, unknown> = {};
      try {
        const { getDispatchLoad } = await import("../services/dispatch");
        const load = await getDispatchLoad();
        const clockedIn = (load.techs as any[]).filter((t: any) => t.clockedIn).length;
        const freeBays = (load.bays as any[]).filter((b: any) => !b.occupied).length;
        dispatch = {
          techsClockedIn: clockedIn,
          freeBays,
          totalBays: (load.bays as any[]).length,
        };
      } catch {}

      // QC stats
      let qc: Record<string, unknown> = {};
      try {
        const { getQcStats } = await import("../services/qcService");
        qc = await getQcStats();
      } catch {}

      // Promise risk
      let risk: Record<string, unknown> = {};
      try {
        const { getPromiseRiskSummary } = await import("../services/promiseRisk");
        risk = await getPromiseRiskSummary();
      } catch {}

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
      });
    } catch (err: any) {
      res.status(500).json({
        shop: "nickstire",
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ─── BRIDGE ACTIONS (bidirectional — NOUR OS triggers actions) ────

  // Mark a lead as contacted
  app.post("/api/bridge/actions/mark-contacted", bridgeAuth, async (req, res) => {
    try {
      const { leadId } = req.body;
      if (!leadId) { res.status(400).json({ error: "leadId required" }); return; }
      const { getDb } = await import("../db");
      const { leads } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }
      await db.update(leads).set({ status: "contacted" }).where(eq(leads.id, leadId));
      res.json({ success: true, leadId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add a quick note to a customer or work order
  app.post("/api/bridge/actions/quick-note", bridgeAuth, async (req, res) => {
    try {
      const { note, context } = req.body;
      if (!note) { res.status(400).json({ error: "note required" }); return; }
      console.log(`[Bridge Note] ${context || "general"}: ${note}`);
      res.json({ success: true, logged: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get cron status (read-only action)
  app.get("/api/bridge/cron-status", bridgeAuth, async (_req, res) => {
    try {
      const { getJobStatuses } = await import("../cron/index");
      res.json({ jobs: getJobStatuses(), timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.json({ jobs: [], error: err.message });
    }
  });
}
