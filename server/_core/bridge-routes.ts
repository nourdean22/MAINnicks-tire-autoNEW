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

  const provided = req.headers["x-bridge-key"];
  if (typeof provided !== "string" || !safeCompare(provided, key)) {
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
      } catch (err) {
        console.error("[Bridge] DB health check failed:", err instanceof Error ? err.message : err);
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
    } catch (err: any) {
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
        console.error("[Bridge] Work order stats failed:", err instanceof Error ? err.message : err);
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
        console.error("[Bridge] Vendor health failed:", err instanceof Error ? err.message : err);
      }

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
      } catch (err) {
        console.error("[Bridge] Dispatch load failed:", err instanceof Error ? err.message : err);
      }

      // QC stats
      let qc: Record<string, unknown> = {};
      try {
        const { getQcStats } = await import("../services/qcService");
        qc = await getQcStats();
      } catch (err) {
        console.error("[Bridge] QC stats failed:", err instanceof Error ? err.message : err);
      }

      // Promise risk
      let risk: Record<string, unknown> = {};
      try {
        const { getPromiseRiskSummary } = await import("../services/promiseRisk");
        risk = await getPromiseRiskSummary();
      } catch (err) {
        console.error("[Bridge] Promise risk failed:", err instanceof Error ? err.message : err);
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
      } catch {}
      try {
        const { getDashboardStats } = await import("../admin-stats");
        const stats = await getDashboardStats();
        bookings = { total: stats.bookings.total, thisWeek: stats.bookings.thisWeek, new: stats.bookings.new };
        leads = { total: stats.leads.total, thisWeek: stats.leads.thisWeek, new: stats.leads.new, urgent: stats.leads.urgent };
        callbacks = { total: stats.callbacks.total, new: stats.callbacks.new };
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
        revenue,
        bookings,
        leads,
        callbacks,
      });
    } catch (err: any) {
      res.status(500).json({
        shop: "nickstire",
        error: "Internal error",
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
      console.error("[Bridge] Action error:", err);
      res.status(500).json({ error: "Internal error" });
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
      console.error("[Bridge] Action error:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Force ShopDriver/ALG mirror sync (instead of waiting for 15-min pulse)
  app.post("/api/bridge/trigger-mirror", bridgeAuth, async (_req, res) => {
    try {
      const { runFullMirror } = await import("../services/shopDriverMirror");
      const result = await runFullMirror();
      res.json({ success: true, ...result, timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error("[Bridge] Mirror trigger error:", err);
      res.status(500).json({ error: err.message || "Mirror sync failed" });
    }
  });

  // Diagnostic: test ShopDriver auth step-by-step (returns results inline)
  app.post("/api/bridge/diag-alg-auth", bridgeAuth, async (_req, res) => {
    const diag: Record<string, unknown> = { timestamp: new Date().toISOString() };
    const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";
    const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";
    const username = process.env.AUTO_LABOR_USERNAME;
    const password = process.env.AUTO_LABOR_PASSWORD;
    diag.hasUsername = !!username;
    diag.hasPassword = !!password;
    diag.username = username;

    // Step 1: Test login
    try {
      const loginRes = await fetch(`${SHOPDRIVER_API}/api/account/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Origin": SHOPDRIVER_BASE,
          "Referer": `${SHOPDRIVER_BASE}/`,
        },
        body: JSON.stringify({ login: username, password, ipAddress: "", location: "" }),
        signal: AbortSignal.timeout(15000),
      });

      diag.loginStatus = loginRes.status;
      diag.loginContentType = loginRes.headers.get("content-type");
      const cookies = loginRes.headers.getSetCookie?.() || [];
      diag.loginCookies = cookies.length;

      const rawBody = await loginRes.text();
      diag.loginBodyLength = rawBody.length;
      diag.loginBodyPreview = rawBody.substring(0, 1000);

      // Try to parse as JSON
      try {
        const data = JSON.parse(rawBody);
        diag.loginKeys = Object.keys(data);
        diag.hasToken = !!data.token;
        diag.hasJwt = !!data.jwt;
        diag.hasAccessToken = !!data.accessToken;
        diag.hasData = !!data.data;
        diag.hasResult = !!data.result;

        const token = data.token || data.jwt || data.accessToken || data.access_token ||
          data.data?.token || data.data?.jwt || data.data?.accessToken ||
          data.result?.token || data.result?.jwt;
        diag.extractedToken = token ? `${String(token).substring(0, 30)}...` : null;

        // Step 2: If we got a token, try a few endpoints
        if (token) {
          const testEndpoints = [
            "/api/ticket/getRecent",
            "/api/customer/getAll",
            "/api/ticket/getAll",
            "/api/invoice/getAll",
          ];
          const probes: Record<string, unknown>[] = [];
          for (const ep of testEndpoints) {
            try {
              const r = await fetch(`${SHOPDRIVER_API}${ep}`, {
                headers: {
                  "Authorization": `Bearer ${token}`,
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  "Accept": "application/json",
                  "Referer": `${SHOPDRIVER_BASE}/`,
                },
                signal: AbortSignal.timeout(10000),
              });
              const body = await r.text();
              probes.push({
                endpoint: ep,
                status: r.status,
                contentType: r.headers.get("content-type"),
                bodyLength: body.length,
                bodyPreview: body.substring(0, 300),
              });
            } catch (e: any) {
              probes.push({ endpoint: ep, error: e.message });
            }
          }
          diag.endpointProbes = probes;
        }
      } catch {
        diag.loginParseError = "Not JSON";
      }
    } catch (err: any) {
      diag.loginError = err.message;
    }

    res.json(diag);
  });

  // Get cron status (read-only action)
  app.get("/api/bridge/cron-status", bridgeAuth, async (_req, res) => {
    try {
      const { getJobStatuses } = await import("../cron/index");
      res.json({ jobs: getJobStatuses(), timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error("[Bridge] Cron status error:", err);
      res.json({ jobs: [], error: "Internal error" });
    }
  });
}
