/**
 * Control Center router — unified admin overview with urgent items,
 * today's stats, AI gateway health, system status, daily brief, and execution tracking.
 */
import { adminProcedure, router } from "../_core/trpc";
import { sql, eq, gte, and } from "drizzle-orm";
import { bookings, leads, callbackRequests, smsMessages, dailyExecution, dailyHabits } from "../../drizzle/schema";
import { getGatewayHealth, getAvailableModels } from "../lib/ai-gateway";
import { z } from "zod";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

/** Get today's date string (YYYY-MM-DD) in America/New_York timezone */
function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// Fixed non-negotiable habits (defined in code, not DB)
const NON_NEGOTIABLES = [
  { key: "wake", label: "Wake by 6:30 AM" },
  { key: "workout", label: "Workout / Movement" },
  { key: "business_action", label: "One Business Action" },
  { key: "clean_space", label: "Clean Space" },
  { key: "no_social_am", label: "No Social Before Noon" },
];

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
      env: process.env.NODE_ENV ?? "unknown",
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
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

  // ─── DAILY BRIEF ─────────────────────────────────────
  getDailyBrief: adminProcedure.query(async () => {
    const d = await db();
    const today = getTodayET();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // ─── Top Action (single highest-priority urgent item) ───
    let topAction: { type: string; message: string; action: string } | null = null;

    // ─── Revenue Waiting ────────────────────────────────
    let revenueWaiting = {
      staleLeadsCount: 0,
      staleQuotesCount: 0,
      pendingCallbacks: 0,
      topOpportunities: [] as Array<{
        id: number;
        name: string;
        phone: string;
        service: string;
        createdAt: Date;
        status: string;
      }>,
    };

    if (d) {
      // Stale leads: new, >24h
      const [staleLeadsResult] = await d
        .select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(and(
          eq(leads.status, "new"),
          sql`${leads.createdAt} < ${yesterday}`
        ));
      revenueWaiting.staleLeadsCount = staleLeadsResult?.count ?? 0;

      // Stale quotes: contacted, >48h
      const [staleQuotesResult] = await d
        .select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(and(
          eq(leads.status, "contacted"),
          sql`${leads.createdAt} < ${twoDaysAgo}`
        ));
      revenueWaiting.staleQuotesCount = staleQuotesResult?.count ?? 0;

      // Pending callbacks
      const [callbacksResult] = await d
        .select({ count: sql<number>`count(*)` })
        .from(callbackRequests)
        .where(eq(callbackRequests.status, "new"));
      revenueWaiting.pendingCallbacks = callbacksResult?.count ?? 0;

      // Top 5 opportunities sorted by urgency (new leads first, then by age)
      const topOpps = await d
        .select({
          id: leads.id,
          name: leads.name,
          phone: leads.phone,
          service: leads.recommendedService,
          createdAt: leads.createdAt,
          status: leads.status,
        })
        .from(leads)
        .where(sql`${leads.status} IN ('new', 'contacted')`)
        .orderBy(sql`FIELD(${leads.status}, 'new', 'contacted')`, leads.createdAt)
        .limit(5);

      revenueWaiting.topOpportunities = topOpps.map((o: typeof topOpps[number]) => ({
        id: o.id,
        name: o.name,
        phone: o.phone,
        service: o.service ?? "General",
        createdAt: o.createdAt,
        status: o.status,
      }));

      // Build topAction from priority: stale leads > pending callbacks > stale quotes > failed SMS
      if (revenueWaiting.staleLeadsCount > 0) {
        topAction = {
          type: "lead",
          message: `${revenueWaiting.staleLeadsCount} lead${revenueWaiting.staleLeadsCount > 1 ? "s" : ""} with no response in 24h`,
          action: "/admin#leads",
        };
      } else if (revenueWaiting.pendingCallbacks > 0) {
        topAction = {
          type: "callback",
          message: `${revenueWaiting.pendingCallbacks} callback${revenueWaiting.pendingCallbacks > 1 ? "s" : ""} pending`,
          action: "/admin#bookings",
        };
      } else if (revenueWaiting.staleQuotesCount > 0) {
        topAction = {
          type: "quote",
          message: `${revenueWaiting.staleQuotesCount} quote${revenueWaiting.staleQuotesCount > 1 ? "s" : ""} not followed up (48h+)`,
          action: "/admin#leads",
        };
      } else {
        // Check failed SMS as lowest priority topAction
        try {
          const [failedSms] = await d
            .select({ count: sql<number>`count(*)` })
            .from(smsMessages)
            .where(and(
              eq(smsMessages.status, "failed"),
              gte(smsMessages.createdAt, yesterday)
            ));
          if ((failedSms?.count ?? 0) > 0) {
            topAction = {
              type: "sms",
              message: `${failedSms!.count} failed SMS in last 24h`,
              action: "/admin#sms",
            };
          }
        } catch {
          // SMS table might not exist yet
        }
      }
    }

    // ─── Execution Tracking ──────────────────────────────
    let execution = {
      date: today,
      mission: null as string | null,
      nonNegotiables: NON_NEGOTIABLES.map((h) => ({ key: h.key, label: h.label, completed: false })),
      completionScore: 0,
      status: "off_track" as "on_track" | "drifting" | "off_track",
      streak: 0,
    };

    if (d) {
      try {
        // Ensure today's daily_execution row exists
        await d.execute(
          sql`INSERT IGNORE INTO daily_execution (date, status) VALUES (${today}, 'on_track')`
        );

        // Get today's execution
        const [todayExec] = await d
          .select()
          .from(dailyExecution)
          .where(sql`${dailyExecution.date} = ${today}`)
          .limit(1);

        if (todayExec) {
          execution.mission = todayExec.mission;
        }

        // Ensure all habit rows exist for today
        for (const habit of NON_NEGOTIABLES) {
          await d.execute(
            sql`INSERT IGNORE INTO daily_habits (date, habit_key, completed) VALUES (${today}, ${habit.key}, 0)`
          );
        }

        // Get today's habits
        const todayHabits = await d
          .select()
          .from(dailyHabits)
          .where(sql`${dailyHabits.date} = ${today}`);

        const habitMap = new Map(todayHabits.map((h: any) => [h.habit_key ?? h.habitKey, h.completed]));

        execution.nonNegotiables = NON_NEGOTIABLES.map((h) => ({
          key: h.key,
          label: h.label,
          completed: habitMap.get(h.key) === true,
        }));

        const completedCount = execution.nonNegotiables.filter((h) => h.completed).length;
        execution.completionScore = Math.round((completedCount / NON_NEGOTIABLES.length) * 100);

        if (execution.completionScore >= 80) {
          execution.status = "on_track";
        } else if (execution.completionScore >= 40) {
          execution.status = "drifting";
        } else {
          execution.status = "off_track";
        }

        // Calculate streak: consecutive past days with >=80% completion (single query)
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          .toLocaleDateString("en-CA", { timeZone: "America/New_York" });

        const streakRows = await d.execute(
          sql`SELECT date, SUM(completed) as done, COUNT(*) as total
              FROM daily_habits
              WHERE date >= ${thirtyDaysAgo} AND date < ${today}
              GROUP BY date
              ORDER BY date DESC`
        ) as any[];

        let streak = 0;
        for (const row of (streakRows as any[] ?? [])) {
          const pct = (Number(row.done) / Number(row.total)) * 100;
          if (pct >= 80) streak++;
          else break;
        }
        execution.streak = streak;
      } catch {
        // Tables might not exist yet — return defaults
      }
    }

    // ─── Drift Indicator ─────────────────────────────────
    const signals: string[] = [];

    if (revenueWaiting.staleLeadsCount > 3) {
      signals.push("Leads going cold");
    }
    if (execution.completionScore < 60) {
      signals.push("Non-negotiables slipping");
    }
    if (revenueWaiting.staleQuotesCount > 5) {
      signals.push("Quotes dying on the vine");
    }
    if (revenueWaiting.pendingCallbacks > 3) {
      signals.push("Callbacks piling up");
    }

    let driftStatus: "focused" | "drifting" | "off_track" = "focused";
    if (signals.length >= 3) {
      driftStatus = "off_track";
    } else if (signals.length >= 1) {
      driftStatus = "drifting";
    }

    // ─── Time Context ───────────────────────────────────
    const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const etHour = etNow.getHours();

    let period: "morning" | "afternoon" | "evening" | "night";
    if (etHour < 12) period = "morning";
    else if (etHour < 17) period = "afternoon";
    else if (etHour < 21) period = "evening";
    else period = "night";

    const score = execution.completionScore;
    const missionSet = !!execution.mission;
    let greeting: string;

    if (period === "morning") {
      if (!missionSet) greeting = "Set your mission. Start with the hardest thing.";
      else if (score < 40) greeting = "Morning. Time to move.";
      else greeting = "Good start. Keep going.";
    } else if (period === "afternoon") {
      if (score < 60) greeting = "Afternoon check. You're behind.";
      else greeting = "Solid afternoon. Close it out.";
    } else if (period === "evening") {
      if (score < 80) greeting = "Day's ending. What's left?";
      else greeting = "Strong day. Finish clean.";
    } else {
      greeting = "Day's over. Rest. Reset.";
    }

    const hoursLeft = Math.max(0, 21 - etHour);

    return {
      topAction,
      revenueWaiting,
      execution,
      driftIndicator: {
        status: driftStatus,
        signals,
      },
      timeContext: {
        period,
        greeting,
        hoursLeft,
      },
    };
  }),

  // ─── TOGGLE HABIT ────────────────────────────────────
  toggleHabit: adminProcedure
    .input(z.object({ habitKey: z.string(), completed: z.boolean() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database unavailable");

      const today = getTodayET();
      const completedAt = input.completed ? new Date() : null;

      await d.execute(
        sql`INSERT INTO daily_habits (date, habit_key, completed, completed_at)
            VALUES (${today}, ${input.habitKey}, ${input.completed ? 1 : 0}, ${completedAt})
            ON DUPLICATE KEY UPDATE
              completed = ${input.completed ? 1 : 0},
              completed_at = ${completedAt}`
      );

      return { habitKey: input.habitKey, completed: input.completed, date: today };
    }),

  // ─── SET MISSION ─────────────────────────────────────
  setMission: adminProcedure
    .input(z.object({ mission: z.string() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database unavailable");

      const today = getTodayET();

      await d.execute(
        sql`INSERT INTO daily_execution (date, mission, status)
            VALUES (${today}, ${input.mission}, 'on_track')
            ON DUPLICATE KEY UPDATE
              mission = ${input.mission}`
      );

      return { success: true, date: today, mission: input.mission };
    }),
});
