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
      } catch (err) {
        console.error("[Bridge] Shop pulse fetch failed:", err instanceof Error ? err.message : err);
      }
      try {
        const { getDashboardStats } = await import("../admin-stats");
        const stats = await getDashboardStats();
        bookings = { total: stats.bookings.total, thisWeek: stats.bookings.thisWeek, new: stats.bookings.new };
        leads = { total: stats.leads.total, thisWeek: stats.leads.thisWeek, new: stats.leads.new, urgent: stats.leads.urgent };
        callbacks = { total: stats.callbacks.total, new: stats.callbacks.new };
      } catch (err) {
        console.error("[Bridge] Dashboard stats fetch failed:", err instanceof Error ? err.message : err);
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

  // Ingest parsed report data (invoices + analytics) from local machine
  app.post("/api/bridge/ingest-reports", bridgeAuth, async (req, res) => {
    try {
      const { invoices, analytics } = req.body;
      if (!invoices || !Array.isArray(invoices)) {
        res.status(400).json({ error: "invoices array required" });
        return;
      }

      // Store analytics as a memory for the brain
      if (analytics) {
        try {
          const { remember } = await import("../services/nickMemory");
          await remember({
            type: "insight",
            content: JSON.stringify({
              source: "shopdriver_reports",
              totalRevenue: analytics.totalRevenue,
              invoiceCount: analytics.invoiceCount,
              operatingDays: analytics.operatingDays,
              avgTicketSize: analytics.avgTicketSize,
              repeatRate: analytics.repeatRate,
              growthRate: analytics.growthRate,
              topCategories: analytics.serviceCategories?.slice(0, 5),
              projectedAnnual: analytics.projectedAnnualRevenue,
            }).slice(0, 2000),
            source: "report_ingestion",
            confidence: 0.95,
          });
        } catch {}
      }

      // Ingest invoices
      const { ingestInvoices } = await import("../services/reportIngestion");
      const result = await ingestInvoices(invoices);

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
      } catch (enrichErr: any) {
        res.json({
          ingestion: result,
          enrichment: `failed: ${enrichErr.message}`,
          analyticsStored: !!analytics,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      console.error("[Bridge] Ingest error:", err);
      res.status(500).json({ error: err.message || "Ingestion failed" });
    }
  });

  // Get stored analytics
  app.get("/api/bridge/analytics", bridgeAuth, async (_req, res) => {
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }

      // Get invoice stats directly
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
        GROUP BY DATE_FORMAT(invoiceDate, '%Y-%m')
        ORDER BY month
      `);

      // Payment method breakdown
      const [payments] = await db.execute(sql`
        SELECT paymentMethod, COUNT(*) as cnt, SUM(totalAmount) as revenue
        FROM invoices GROUP BY paymentMethod ORDER BY revenue DESC
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
        invoiceStats: (stats as any[])?.[0],
        monthlyTrend: monthly,
        paymentBreakdown: payments,
        customerStats: (custStats as any[])?.[0],
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SMS Thank You + Referral + Review campaign — targets recent customers
  app.post("/api/bridge/sms-campaign", bridgeAuth, async (req, res) => {
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }

      const { dryRun = true, limit = 50, daysSince = 30 } = req.body;

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

      const customers = targets as any[];
      const messages: { phone: string; name: string; message: string }[] = [];

      for (const c of customers) {
        const firstName = c.firstName || "there";
        const vehicle = [c.vehicleYear, c.vehicleMake, c.vehicleModel].filter(Boolean).join(" ");
        const vehicleLine = vehicle ? ` on your ${vehicle}` : "";

        // Personalized message: thank you + referral + review
        const msg = `Hi ${firstName}! Thank you for choosing Nick's Tire & Auto for your recent service${vehicleLine}. ` +
          `We appreciate your business! If you were happy with our work, we'd love a quick Google review: https://g.page/r/nickstire/review ` +
          `Know someone who needs tires or auto service? Refer a friend and both of you get 10% off your next visit! ` +
          `— Nick's Tire & Auto (216) 862-0005`;

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
          await sendSms(m.phone, m.message);
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
      } catch {}

      res.json({ sent, failed, total: messages.length, timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error("[Bridge] SMS campaign error:", err);
      res.status(500).json({ error: err.message || "Campaign failed" });
    }
  });

  // Historical backfill — fetch ALL invoice history from ShopDriver (not just recent)
  app.post("/api/bridge/backfill-history", bridgeAuth, async (_req, res) => {
    try {
      const { runHistoricalBackfill } = await import("../services/shopDriverMirror");
      const result = await runHistoricalBackfill();
      res.json({ ...result, timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error("[Bridge] Backfill error:", err);
      res.status(500).json({ error: err.message || "Backfill failed" });
    }
  });

  // Force ShopDriver/ALG mirror sync (instead of waiting for 15-min pulse)
  app.post("/api/bridge/trigger-mirror", bridgeAuth, async (_req, res) => {
    try {
      const { runFullMirror, debugLastFetch } = await import("../services/shopDriverMirror");
      const result = await runFullMirror();
      res.json({ success: true, ...result, debug: debugLastFetch(), timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error("[Bridge] Mirror trigger error:", err);
      res.status(500).json({ error: err.message || "Mirror sync failed" });
    }
  });

  // Probe ALG API endpoints to discover what data is available
  app.get("/api/bridge/probe-alg", bridgeAuth, async (_req, res) => {
    try {
      const { probeAlgEndpoints } = await import("../services/shopDriverMirror");
      const results = await probeAlgEndpoints();
      res.json({ results, timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error("[Bridge] ALG probe error:", err);
      res.status(500).json({ error: err.message || "Probe failed" });
    }
  });

  // Full data cascade: mirror → sheets → statenour → brain (run all syncs)
  app.post("/api/bridge/full-sync", bridgeAuth, async (_req, res) => {
    const results: Record<string, any> = { timestamp: new Date().toISOString() };
    const start = Date.now();

    // 1. Mirror sync (ALG → DB)
    try {
      const { runFullMirror } = await import("../services/shopDriverMirror");
      results.mirror = await runFullMirror();
    } catch (e: any) {
      results.mirror = { error: e.message };
    }

    // 2. Dashboard Sheets sync (DB → Google Sheets)
    try {
      const { processDashboardSync } = await import("../cron/jobs/dashboardSync");
      results.sheets = await processDashboardSync();
    } catch (e: any) {
      results.sheets = { error: e.message };
    }

    // 3. Statenour sync (DB → NOUR OS brain)
    try {
      const { syncToStatenour } = await import("../cron/jobs/statenourSync");
      results.statenour = await syncToStatenour();
    } catch (e: any) {
      results.statenour = { error: e.message };
    }

    // 4. Nick AI memory — learn from backlog
    try {
      const { remember } = await import("../services/nickMemory");
      const mirrorDetails = results.mirror?.details || "";
      if (mirrorDetails.includes("updated") || mirrorDetails.includes("new")) {
        await remember({
          type: "pattern",
          content: `ALG MIRROR RECOVERY: Data backlog resolved. ${mirrorDetails}. All invoice data refreshed across DB, Sheets, and NOUR OS.`,
          source: "mirror_recovery",
          confidence: 0.9,
        });
      }
      results.brain = { learned: true };
    } catch (e: any) {
      results.brain = { error: e.message };
    }

    results.totalDuration = `${Date.now() - start}ms`;
    res.json(results);
  });

  // Run a specific cron job by name (e.g. enrich-customer-data)
  app.post("/api/bridge/run-job", bridgeAuth, async (req, res) => {
    try {
      const { jobName } = req.body;
      if (!jobName) { res.status(400).json({ error: "jobName required" }); return; }
      // Try legacy registry first, then tiered scheduler
      const { runJobByName } = await import("../cron/index");
      let result = await runJobByName(jobName);
      if (result.status === "not_found") {
        const { runTierJobByName } = await import("../cron/scheduler");
        result = await runTierJobByName(jobName);
      }
      res.json({ ...result, timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error("[Bridge] Run job error:", err);
      res.status(500).json({ error: err.message || "Job failed" });
    }
  });

  // Ad-hoc diagnostic query (read-only)
  app.post("/api/bridge/diag", bridgeAuth, async (req, res) => {
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }
      const query = req.body.query;
      if (!query || typeof query !== "string") { res.status(400).json({ error: "query required" }); return; }
      // Only allow SELECT for safety
      if (!query.trim().toUpperCase().startsWith("SELECT")) { res.status(400).json({ error: "SELECT only" }); return; }
      const [rows] = await db.execute(sql.raw(query));
      res.json({ rows, timestamp: new Date().toISOString() });
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
      console.error("[Bridge] Cron status error:", err);
      res.json({ jobs: [], error: "Internal error" });
    }
  });

  // ─── BUSINESS INTELLIGENCE — Full analytics + forecasting ────
  app.get("/api/bridge/intelligence", bridgeAuth, async (_req, res) => {
    try {
      const results: Record<string, any> = { timestamp: new Date().toISOString() };

      // 1. Conversion pipeline (estimate→job, lead→booking rates)
      try {
        const { analyzeConversionPipeline } = await import("../services/nickIntelligence");
        results.pipeline = await analyzeConversionPipeline();
      } catch (e: any) {
        results.pipeline = { error: e.message };
      }

      // 2. Revenue projections (weekly, monthly, trends)
      try {
        const { projectRevenue } = await import("../services/nickIntelligence");
        results.revenue = await projectRevenue();
      } catch (e: any) {
        results.revenue = { error: e.message };
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
      } catch (e: any) {
        results.customers = { error: e.message };
      }

      // 4. Proactive alerts (what needs attention right now)
      try {
        const { generateProactiveAlerts } = await import("../services/nickIntelligence");
        results.alerts = await generateProactiveAlerts();
      } catch (e: any) {
        results.alerts = { error: e.message };
      }

      // 5. AI weekly insight
      try {
        const { generateWeeklyInsight } = await import("../services/nickIntelligence");
        results.aiInsight = await generateWeeklyInsight();
      } catch (e: any) {
        results.aiInsight = e.message;
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
          results.dailyRevenue = (dailyRevenue as any[]).map((r: any) => ({
            date: r.day,
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
          results.monthlyRevenue = (monthlyRevenue as any[]).map((r: any) => ({
            month: r.month,
            jobs: Number(r.jobs),
            revenue: Math.round(Number(r.revenue) / 100),
            avgTicket: Math.round(Number(r.avgTicket) / 100),
          }));

          // Total historical stats
          const [allTimeStats] = await d.execute(sql`
            SELECT COUNT(*) as totalInvoices,
                   COALESCE(SUM(totalAmount), 0) as totalRevenue,
                   ROUND(AVG(totalAmount)) as avgTicket,
                   MIN(invoiceDate) as firstInvoice,
                   MAX(invoiceDate) as lastInvoice
            FROM invoices WHERE paymentStatus = 'paid'
          `) as any[];
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
          results.topServices = (serviceBreakdown as any[]).map((r: any) => ({
            service: r.serviceDescription,
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
          results.paymentMethods = (paymentBreakdown as any[]).map((r: any) => ({
            method: r.paymentMethod,
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
          results.dayOfWeekPerformance = (dayOfWeekPerf as any[]).map((r: any) => ({
            day: dayNames[Number(r.dow) - 1] || "?",
            jobs: Number(r.jobs),
            revenue: Math.round(Number(r.revenue) / 100),
          }));
        }
      } catch (e: any) {
        results.historicalError = e.message;
      }

      // 7. Revenue anomaly detection
      try {
        const { detectRevenueAnomalies } = await import("../services/revenuePrediction");
        if (results.dailyRevenue?.length >= 14) {
          results.anomalies = detectRevenueAnomalies(
            results.dailyRevenue.map((d: any) => ({ date: d.date, amount: d.revenue, orderCount: d.jobs }))
          );
        }
      } catch {}

      // 8. Shop pulse (current state)
      try {
        const { getShopPulse } = await import("../services/nickIntelligence");
        results.shopPulse = await getShopPulse();
      } catch (e: any) {
        results.shopPulse = { error: e.message };
      }

      res.json(results);
    } catch (err: any) {
      console.error("[Bridge] Intelligence error:", err);
      res.status(500).json({ error: "Internal error", timestamp: new Date().toISOString() });
    }
  });
}
