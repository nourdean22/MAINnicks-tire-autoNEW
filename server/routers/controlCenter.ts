/**
 * Control Center router — unified admin overview with urgent items,
 * today's stats, AI gateway health, and system status.
 */
import { adminProcedure, router } from "../_core/trpc";
import { sql, eq, gte, and } from "drizzle-orm";
import { bookings, leads, callbackRequests, smsMessages } from "../../drizzle/schema";
import { getGatewayHealth, getAvailableModels } from "../lib/ai-gateway";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const controlCenterRouter = router({
  getOverview: adminProcedure.query(async () => {
    const d = await db();

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // ─── Today's Stats ───────────────────────────────
    let todayStats = { leadsToday: 0, quotesToday: 0, bookingsToday: 0, callbacksPending: 0 };

    if (d) {
      const [leadsToday] = await d
        .select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(gte(leads.createdAt, todayStart));

      const [bookingsToday] = await d
        .select({ count: sql<number>`count(*)` })
        .from(bookings)
        .where(gte(bookings.createdAt, todayStart));

      const [callbacksPending] = await d
        .select({ count: sql<number>`count(*)` })
        .from(callbackRequests)
        .where(eq(callbackRequests.status, "new"));

      // "Quotes" = leads with status contacted or booked (in pipeline)
      const [quotesToday] = await d
        .select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(and(
          gte(leads.createdAt, todayStart),
          sql`${leads.status} IN ('contacted', 'booked')`
        ));

      todayStats = {
        leadsToday: leadsToday?.count ?? 0,
        quotesToday: quotesToday?.count ?? 0,
        bookingsToday: bookingsToday?.count ?? 0,
        callbacksPending: callbacksPending?.count ?? 0,
      };
    }

    // ─── AI Gateway ──────────────────────────────────
    let aiGateway = {
      ollamaHealthy: false,
      recentRequests: 0,
      fallbackRate: 0,
      topModels: [] as string[],
    };

    try {
      const health = getGatewayHealth();
      const models = await getAvailableModels();
      const ollamaModels = models.find(m => m.provider === "ollama")?.models ?? [];

      aiGateway = {
        ollamaHealthy: health.ollamaHealthy,
        recentRequests: health.stats.last5min.total,
        fallbackRate: health.stats.last5min.total > 0
          ? Math.round((health.stats.last5min.fallbacks / health.stats.last5min.total) * 100)
          : 0,
        topModels: ollamaModels.slice(0, 5),
      };
    } catch {
      // AI gateway unavailable — defaults are fine
    }

    // ─── System Health ───────────────────────────────
    let dbStatus: "connected" | "degraded" | "disconnected" = "disconnected";
    if (d) {
      try {
        await d.execute(sql`SELECT 1`);
        dbStatus = "connected";
      } catch {
        dbStatus = "degraded";
      }
    }

    // Tunnel status — no tunnel module exists, return inactive
    let tunnelUrl: string | null = null;
    let tunnelMode = "none";
    try {
      const tunnel = await import("../lib/tunnel-status").catch(() => null);
      if (tunnel && typeof tunnel.getTunnelStatus === "function") {
        const status = await tunnel.getTunnelStatus();
        tunnelUrl = status?.url ?? null;
        tunnelMode = status?.mode ?? "none";
      }
    } catch {
      // No tunnel module
    }

    const systemHealth = {
      dbStatus,
      tunnelUrl,
      tunnelMode,
      uptime: Math.round(process.uptime()),
      lastDeployTime: null as string | null,
    };

    // ─── Urgent Items ────────────────────────────────
    const urgentItems: Array<{
      type: string;
      message: string;
      action: string;
      priority: "high" | "medium" | "low";
    }> = [];

    if (d) {
      // Leads with no response in 24h
      const [staleLeads] = await d
        .select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(and(
          eq(leads.status, "new"),
          sql`${leads.createdAt} < ${yesterday}`
        ));
      if ((staleLeads?.count ?? 0) > 0) {
        urgentItems.push({
          type: "lead",
          message: `${staleLeads!.count} lead${staleLeads!.count > 1 ? "s" : ""} with no response in 24h`,
          action: "/admin#leads",
          priority: "high",
        });
      }

      // Pending callbacks
      if (todayStats.callbacksPending > 0) {
        urgentItems.push({
          type: "callback",
          message: `${todayStats.callbacksPending} callback${todayStats.callbacksPending > 1 ? "s" : ""} pending`,
          action: "/admin#bookings",
          priority: "high",
        });
      }

      // Stale quotes — contacted leads older than 48h not yet booked
      const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      const [staleQuotes] = await d
        .select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(and(
          eq(leads.status, "contacted"),
          sql`${leads.createdAt} < ${twoDaysAgo}`
        ));
      if ((staleQuotes?.count ?? 0) > 0) {
        urgentItems.push({
          type: "quote",
          message: `${staleQuotes!.count} quote${staleQuotes!.count > 1 ? "s" : ""} not followed up (48h+)`,
          action: "/admin#leads",
          priority: "medium",
        });
      }

      // Failed SMS in last 24h
      try {
        const [failedSms] = await d
          .select({ count: sql<number>`count(*)` })
          .from(smsMessages)
          .where(and(
            eq(smsMessages.status, "failed"),
            gte(smsMessages.createdAt, yesterday)
          ));
        if ((failedSms?.count ?? 0) > 0) {
          urgentItems.push({
            type: "sms",
            message: `${failedSms!.count} failed SMS in last 24h`,
            action: "/admin#sms",
            priority: "medium",
          });
        }
      } catch {
        // SMS table might not exist yet
      }

      // Unread leads from today
      const [newLeadsToday] = await d
        .select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(and(
          eq(leads.status, "new"),
          gte(leads.createdAt, todayStart)
        ));
      if ((newLeadsToday?.count ?? 0) > 0) {
        urgentItems.push({
          type: "lead",
          message: `${newLeadsToday!.count} new lead${newLeadsToday!.count > 1 ? "s" : ""} today — not contacted yet`,
          action: "/admin#leads",
          priority: "medium",
        });
      }
    }

    // Ollama down is always urgent
    if (!aiGateway.ollamaHealthy) {
      urgentItems.push({
        type: "system",
        message: "Ollama is offline — AI running on cloud fallback",
        action: "/admin#health",
        priority: "low",
      });
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    urgentItems.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return { todayStats, aiGateway, systemHealth, urgentItems };
  }),
});
