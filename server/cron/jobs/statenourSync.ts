/**
 * Cron: Statenour Business Sync — Push metrics to NOUR OS brain
 * Runs daily. Sends bookings, leads, revenue, and health data
 * to statenour-os /api/sync/business so the AI has business context.
 */
import { createLogger } from "../../lib/logger";
import { BUSINESS } from "@shared/business";

const log = createLogger("cron:statenour-sync");
const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;

export async function syncToStatenour(): Promise<{ recordsProcessed: number; details: string }> {
  const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-os.vercel.app";
  const syncKey = process.env.STATENOUR_SYNC_KEY || "";

  try {
    const { getDashboardStats, getSiteHealth } = await import("../../admin-stats");
    const stats = await getDashboardStats();
    const health = await getSiteHealth();

    // Gather intelligence data
    let intelligence: any = {};
    try {
      const { analyzeConversionPipeline, projectRevenue, getShopPulse } = await import("../../services/nickIntelligence");
      const [pipeline, revenue, pulse] = await Promise.all([
        analyzeConversionPipeline(),
        projectRevenue(),
        getShopPulse(),
      ]);
      intelligence = { pipeline, revenue, pulse };
    } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); }

    // Gather Nick AI memories
    let memories: any[] = [];
    try {
      const { recall } = await import("../../services/nickMemory");
      memories = await recall({ limit: 20 });
    } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); }

    // Gather bridge analytics
    let bridgeAnalytics: any = {};
    try {
      const { getEventAnalytics } = await import("../../nour-os-bridge");
      bridgeAnalytics = getEventAnalytics();
    } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); }

    const payload = {
      source: "nickstire",
      timestamp: new Date().toISOString(),
      version: "v2", // upgraded sync format
      bookings: {
        total: stats.bookings.total,
        thisWeek: stats.bookings.thisWeek,
        new: stats.bookings.new,
        confirmed: stats.bookings.confirmed,
        completed: stats.bookings.completed,
        cancelled: stats.bookings.cancelled,
        topServices: stats.bookings.byService.slice(0, 5),
      },
      leads: {
        total: stats.leads.total,
        thisWeek: stats.leads.thisWeek,
        new: stats.leads.new,
        contacted: stats.leads.contacted,
        booked: stats.leads.booked,
        lost: stats.leads.lost,
        urgent: stats.leads.urgent,
        avgUrgency: stats.leads.avgUrgency,
        topSources: stats.leads.bySource.slice(0, 5),
      },
      chat: {
        totalSessions: stats.chat.totalSessions,
        converted: stats.chat.converted,
        thisWeek: stats.chat.thisWeek,
        conversionRate: stats.chat.totalSessions > 0
          ? Math.round((stats.chat.converted / stats.chat.totalSessions) * 100)
          : 0,
      },
      calls: {
        total: stats.callTracking.totalCalls,
        thisWeek: stats.callTracking.thisWeek,
        topPages: stats.callTracking.byPage.slice(0, 3),
      },
      callbacks: {
        total: stats.callbacks.total,
        new: stats.callbacks.new,
        completed: stats.callbacks.completed,
        thisWeek: stats.callbacks.thisWeek,
      },
      content: {
        totalArticles: stats.content.totalArticles,
        published: stats.content.published,
      },
      siteHealth: {
        indexedPages: health.indexedPages,
        notIndexed: health.notIndexedPages,
        sheetsConfigured: health.sheetsConfigured,
      },
      attribution: {
        bookingsBySource: stats.sourceAttribution.bookingsBySource.slice(0, 5),
        leadsBySource: stats.sourceAttribution.leadsBySource.slice(0, 5),
      },
      // ═══ Revenue (what command deck reads) ═══
      revenue: await (async () => {
        // Direct DB query as primary source — never returns 0 if invoices exist
        try {
          const { getDb } = await import("../../db");
          const { sql } = await import("drizzle-orm");
          const db = await getDb();
          if (!db) throw new Error("no db");

          const [todayRow] = await db.execute(sql`
            SELECT COALESCE(SUM(totalAmount), 0) as rev, COUNT(*) as cnt,
                   CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(totalAmount) / COUNT(*)) ELSE 0 END as avgTkt
            FROM invoices WHERE DATE(invoiceDate) = CURDATE() AND paymentStatus = 'paid'
          `);
          const [weekRow] = await db.execute(sql`
            SELECT COALESCE(SUM(totalAmount), 0) as rev FROM invoices
            WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND paymentStatus = 'paid'
          `);
          const [monthRow] = await db.execute(sql`
            SELECT COALESCE(SUM(totalAmount), 0) as rev FROM invoices
            WHERE invoiceDate >= DATE_FORMAT(CURDATE(), '%Y-%m-01') AND paymentStatus = 'paid'
          `);
          const today = (todayRow as any[])?.[0] || {};
          const week = (weekRow as any[])?.[0] || {};
          const month = (monthRow as any[])?.[0] || {};

          // Yesterday's revenue for morning brief comparison
          const [yesterdayRow] = await db.execute(sql`
            SELECT COALESCE(SUM(totalAmount), 0) as rev, COUNT(*) as cnt
            FROM invoices WHERE DATE(invoiceDate) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND paymentStatus = 'paid'
          `);
          const yesterday = (yesterdayRow as any[])?.[0] || {};

          return {
            todayEstimate: Math.round(Number(today.rev || 0) / 100),
            yesterdayRevenue: Math.round(Number(yesterday.rev || 0) / 100),
            yesterdayJobs: Number(yesterday.cnt || 0),
            weekRevenue: Math.round(Number(week.rev || 0) / 100),
            monthRevenue: Math.round(Number(month.rev || 0) / 100),
            avgTicket: Math.round(Number(today.avgTkt || 0) / 100),
            jobsToday: Number(today.cnt || 0),
            monthlyTarget: MONTHLY_TARGET,
            dailyTarget: Math.round(MONTHLY_TARGET / 26), // target / 26 working days
            pacing: Math.round(Number(month.rev || 0) / 100) >= MONTHLY_TARGET ? "on_track" : "behind",
            walkRate: intelligence.pulse?.thisWeek?.walkRate ?? 0,
          };
        } catch (e) {
          console.warn("[jobs/statenourSync] operation failed:", e);
          // Fallback to intelligence if DB query fails
          return {
            todayEstimate: intelligence.pulse?.today?.revenue ?? 0,
            weekRevenue: intelligence.pulse?.thisWeek?.revenue ?? 0,
            monthRevenue: intelligence.revenue?.thisMonthProjection ?? 0,
            avgTicket: intelligence.pulse?.today?.avgTicket ?? 0,
            jobsToday: intelligence.pulse?.today?.jobsClosed ?? 0,
            monthlyTarget: MONTHLY_TARGET,
            walkRate: intelligence.pulse?.thisWeek?.walkRate ?? 0,
          };
        }
      })(),
      // ═══ Intelligence layer data ═══
      intelligence: {
        conversionPipeline: intelligence.pipeline || null,
        revenueProjection: intelligence.revenue || null,
        shopPulse: intelligence.pulse || null,
      },
      nickAI: {
        memories: memories.slice(0, 10),
        memoryCount: memories.length,
      },
      bridge: bridgeAnalytics,
      // ═══ Customer Intelligence ═══
      // ═══ Full Customer Intelligence ═══
      customerIntelligence: await (async () => {
        try {
          const { analyzeCustomers, getCustomerActionPlan } = await import("../../services/customerIntelligence");
          const ci = await analyzeCustomers();
          const plan = await getCustomerActionPlan();
          return {
            totalCustomers: ci.totalCustomers,
            activeCustomers: ci.activeCustomers,
            lapsedCustomers: ci.lapsedCustomers,
            lostCustomers: ci.lostCustomers,
            newThisMonth: ci.newThisMonth,
            retentionRate: ci.retentionRate,
            avgLifetimeValue: ci.avgLifetimeValue,
            avgTicket: ci.avgTicket,
            topSpenders: ci.topSpenders.slice(0, 5),
            atRiskCustomers: ci.atRiskCustomers.slice(0, 5),
            servicePatterns: ci.servicePatterns.slice(0, 5),
            dayOfWeekPattern: ci.dayOfWeekPattern,
            peakHours: ci.peakHours,
            actionPlan: plan,
          };
        } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); return null; }
      })(),
      // ═══ Feedback Loop Data ═══
      feedbackLoop: await (async () => {
        try {
          const { detectAnomalies, getBriefEngagement } = await import("../../services/feedbackLoop");
          const anomalies = detectAnomalies();
          const engagement = getBriefEngagement();
          return {
            anomalies: anomalies.map(a => ({ type: a.type, current: a.current, average: a.average, deviation: a.deviation })),
            briefEngagement: engagement,
          };
        } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); return null; }
      })(),
      // ═══ Event Lifecycle Journeys ═══
      customerJourneys: (() => {
        try {
          const { getActiveJourneys } = require("../../services/eventBus");
          return getActiveJourneys();
        } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); return []; }
      })(),
      // ═══ Declined Work (revenue on the table) ═══
      declinedWork: await (async () => {
        try {
          const { getDeclinedWorkLedger } = await import("../../services/declinedWorkRecovery");
          const ledger = await getDeclinedWorkLedger(10);
          const unrecovered = ledger.filter(e => e.declinedItems.some(i => !i.recovered));
          return {
            totalRecoverable: unrecovered.reduce((s, e) => s + e.totalDeclinedValue, 0),
            customerCount: unrecovered.length,
            safetyItemCount: unrecovered.filter(e => e.hasSafetyItems).length,
            topItems: unrecovered.slice(0, 3).map(e => ({
              customer: e.customerName,
              phone: e.phone,
              value: e.totalDeclinedValue,
              hasSafety: e.hasSafetyItems,
            })),
          };
        } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); return null; }
      })(),
      // ═══ Work Order Status ═══
      workOrders: await (async () => {
        try {
          const { getDb } = await import("../../db");
          const { workOrders: woTable } = await import("../../../drizzle/schema");
          const { sql } = await import("drizzle-orm");
          const d = await getDb();
          if (!d) return null;
          const [open, blocked] = await Promise.all([
            d.select({ count: sql<number>`count(*)` }).from(woTable).where(sql`${woTable.status} NOT IN ('closed','invoiced','picked_up','cancelled')`),
            d.select({ count: sql<number>`count(*)` }).from(woTable).where(sql`${woTable.status} = 'blocked'`),
          ]);
          return { open: open[0]?.count ?? 0, blocked: blocked[0]?.count ?? 0 };
        } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); return null; }
      })(),
      // ═══ Question Patterns (what Nour asks about) ═══
      operatorPatterns: (() => {
        try {
          const { getTopQuestions } = require("../../services/nickMemory");
          return getTopQuestions(5);
        } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); return []; }
      })(),
      // ═══ ALG Source-of-Truth Health ═══
      algHealth: await (async () => {
        try {
          const { checkMirrorHealth } = await import("../../services/shopDriverMirror");
          const health = await checkMirrorHealth();
          return {
            status: health.recordsProcessed > 0 ? "ok" : "degraded",
            details: health.details,
          };
        } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); return { status: "unknown", details: "health check failed" }; }
      })(),
      // ═══ Shop Floor (ALG-sourced) ═══
      shopFloor: stats.shopFloor || null,
    };

    const res = await fetch(`${statenourUrl}/api/sync/business`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(syncKey ? { "Authorization": `Bearer ${syncKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(`Statenour sync failed: ${res.status} ${errText}`);
    }

    const result = await res.json();
    log.info("Statenour sync completed", {
      bookings: payload.bookings.total,
      leads: payload.leads.total,
    });

    // Process response from statenour — it may contain insights or directives
    if (result?.insights || result?.directives || result?.driftAlerts) {
      try {
        const { remember } = await import("../../services/nickMemory");
        for (const insight of (result.insights || []).slice(0, 3)) {
          await remember({
            type: "insight",
            content: `[statenour-response] ${typeof insight === "string" ? insight : insight.title || JSON.stringify(insight)}`.slice(0, 500),
            source: "statenour_response",
            confidence: 0.8,
          });
        }
        // Urgent drift alerts → immediate Telegram notification
        const urgentAlerts = (result.driftAlerts || []).filter((a: any) => a.severity === "critical" || a.urgent);
        if (urgentAlerts.length > 0) {
          const { sendUrgentBrief } = await import("./morningBrief");
          await sendUrgentBrief(
            "Statenour Drift Alert",
            urgentAlerts.map((a: any) => a.message || a.title || String(a)).join("\n")
          );
        }
      } catch (e) { console.warn("[jobs/statenourSync] operation failed:", e); }
    }

    return {
      recordsProcessed: 1,
      details: `Synced: ${payload.bookings.total} bookings, ${payload.leads.total} leads, ${payload.chat.totalSessions} chats`,
    };
  } catch (err) {
    const msg = err instanceof Error ? (err as Error).message : String(err);
    log.error("Statenour sync failed", { error: msg });
    return { recordsProcessed: 0, details: `Error: ${msg}` };
  }
}
