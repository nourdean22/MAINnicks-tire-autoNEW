/**
 * Cron: Statenour Business Sync — Push metrics to NOUR OS brain
 * Runs daily. Sends bookings, leads, revenue, and health data
 * to statenour-os /api/sync/business so the AI has business context.
 */
import { createLogger } from "../../lib/logger";

const log = createLogger("cron:statenour-sync");

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
    } catch {}

    // Gather Nick AI memories
    let memories: any[] = [];
    try {
      const { recall } = await import("../../services/nickMemory");
      memories = await recall({ limit: 20 });
    } catch {}

    // Gather bridge analytics
    let bridgeAnalytics: any = {};
    try {
      const { getEventAnalytics } = await import("../../nour-os-bridge");
      bridgeAnalytics = getEventAnalytics();
    } catch {}

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
      revenue: {
        todayEstimate: intelligence.pulse?.today?.revenue ?? 0,
        weekRevenue: intelligence.pulse?.thisWeek?.revenue ?? 0,
        monthRevenue: intelligence.revenue?.thisMonthProjection ?? 0,
        avgTicket: intelligence.pulse?.today?.avgTicket ?? 0,
        jobsToday: intelligence.pulse?.today?.jobsClosed ?? 0,
        walkRate: intelligence.pulse?.thisWeek?.walkRate ?? 0,
      },
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
      customerIntelligence: (() => {
        try {
          const ci = intelligence.pulse ? {
            totalCustomers: stats.bookings?.total || 0,
            walkRate: intelligence.pulse?.thisWeek?.walkRate || 0,
            avgTicket: intelligence.pulse?.thisWeek?.avgTicket || 0,
          } : null;
          return ci;
        } catch { return null; }
      })(),
    };

    const res = await fetch(`${statenourUrl}/api/sync/business`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(syncKey ? { "Authorization": `Bearer ${syncKey}` } : {}),
      },
      body: JSON.stringify(payload),
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

    return {
      recordsProcessed: 1,
      details: `Synced: ${payload.bookings.total} bookings, ${payload.leads.total} leads, ${payload.chat.totalSessions} chats`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Statenour sync failed", { error: msg });
    return { recordsProcessed: 0, details: `Error: ${msg}` };
  }
}
