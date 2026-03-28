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
      // Parallel stat queries (was 4 serial)
      const [leadsTodayArr, bookingsTodayArr, callbacksArr, quotesTodayArr] = await Promise.all([
        d.select({ count: sql<number>`count(*)` }).from(leads).where(gte(leads.createdAt, todayStart)),
        d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, todayStart)),
        d.select({ count: sql<number>`count(*)` }).from(callbackRequests).where(eq(callbackRequests.status, "new")),
        d.select({ count: sql<number>`count(*)` }).from(leads).where(and(
          gte(leads.createdAt, todayStart), sql`${leads.status} IN ('contacted', 'booked')`
        )),
      ]);

      todayStats = {
        leadsToday: leadsTodayArr[0]?.count ?? 0,
        quotesToday: quotesTodayArr[0]?.count ?? 0,
        bookingsToday: bookingsTodayArr[0]?.count ?? 0,
        callbacksPending: callbacksArr[0]?.count ?? 0,
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
      const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

      // Parallel urgent item queries (was 4 serial)
      const [staleLeadsArr, staleQuotesArr, failedSmsArr, newLeadsTodayArr] = await Promise.all([
        d.select({ count: sql<number>`count(*)` }).from(leads)
          .where(and(eq(leads.status, "new"), sql`${leads.createdAt} < ${yesterday}`)),
        d.select({ count: sql<number>`count(*)` }).from(leads)
          .where(and(eq(leads.status, "contacted"), sql`${leads.createdAt} < ${twoDaysAgo}`)),
        d.select({ count: sql<number>`count(*)` }).from(smsMessages)
          .where(and(eq(smsMessages.status, "failed"), gte(smsMessages.createdAt, yesterday)))
          .catch(() => [{ count: 0 }]),
        d.select({ count: sql<number>`count(*)` }).from(leads)
          .where(and(eq(leads.status, "new"), gte(leads.createdAt, todayStart))),
      ]);

      const staleLeadsCount = staleLeadsArr[0]?.count ?? 0;
      const staleQuotesCount = staleQuotesArr[0]?.count ?? 0;
      const failedSmsCount = failedSmsArr[0]?.count ?? 0;
      const newLeadsTodayCount = newLeadsTodayArr[0]?.count ?? 0;

      if (staleLeadsCount > 0) {
        urgentItems.push({
          type: "lead",
          message: `${staleLeadsCount} lead${staleLeadsCount > 1 ? "s" : ""} with no response in 24h`,
          action: "/admin#leads", priority: "high",
        });
      }
      if (todayStats.callbacksPending > 0) {
        urgentItems.push({
          type: "callback",
          message: `${todayStats.callbacksPending} callback${todayStats.callbacksPending > 1 ? "s" : ""} pending`,
          action: "/admin#bookings", priority: "high",
        });
      }
      if (staleQuotesCount > 0) {
        urgentItems.push({
          type: "quote",
          message: `${staleQuotesCount} quote${staleQuotesCount > 1 ? "s" : ""} not followed up (48h+)`,
          action: "/admin#leads", priority: "medium",
        });
      }
      if (failedSmsCount > 0) {
        urgentItems.push({
          type: "sms", message: `${failedSmsCount} failed SMS in last 24h`,
          action: "/admin#sms", priority: "medium",
        });
      }
      if (newLeadsTodayCount > 0) {
        urgentItems.push({
          type: "lead",
          message: `${newLeadsTodayCount} new lead${newLeadsTodayCount > 1 ? "s" : ""} today — not contacted yet`,
          action: "/admin#leads", priority: "medium",
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
      // Parallel revenue queries (was 4 serial)
      const [staleLeadsArr, staleQuotesArr, callbacksArr, topOpps] = await Promise.all([
        d.select({ count: sql<number>`count(*)` })
          .from(leads)
          .where(and(eq(leads.status, "new"), sql`${leads.createdAt} < ${yesterday}`)),
        d.select({ count: sql<number>`count(*)` })
          .from(leads)
          .where(and(eq(leads.status, "contacted"), sql`${leads.createdAt} < ${twoDaysAgo}`)),
        d.select({ count: sql<number>`count(*)` })
          .from(callbackRequests)
          .where(eq(callbackRequests.status, "new")),
        d.select({
            id: leads.id, name: leads.name, phone: leads.phone,
            service: leads.recommendedService, createdAt: leads.createdAt, status: leads.status,
          })
          .from(leads)
          .where(sql`${leads.status} IN ('new', 'contacted')`)
          .orderBy(sql`FIELD(${leads.status}, 'new', 'contacted')`, leads.createdAt)
          .limit(5),
      ]);

      revenueWaiting.staleLeadsCount = staleLeadsArr[0]?.count ?? 0;
      revenueWaiting.staleQuotesCount = staleQuotesArr[0]?.count ?? 0;
      revenueWaiting.pendingCallbacks = callbacksArr[0]?.count ?? 0;
      revenueWaiting.topOpportunities = topOpps.map((o: typeof topOpps[number]) => ({
        id: o.id, name: o.name, phone: o.phone,
        service: o.service ?? "General", createdAt: o.createdAt, status: o.status,
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
        // Batch ensure rows exist (1 write for execution + 1 for all habits instead of 6)
        const habitValues = NON_NEGOTIABLES.map(h => `('${today}', '${h.key}', 0)`).join(", ");
        await Promise.all([
          d.execute(sql`INSERT IGNORE INTO daily_execution (date, status) VALUES (${today}, 'on_track')`),
          d.execute(sql.raw(`INSERT IGNORE INTO daily_habits (date, habit_key, completed) VALUES ${habitValues}`)),
        ]);

        // Parallel reads: execution + habits + streak (was 3 sequential)
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          .toLocaleDateString("en-CA", { timeZone: "America/New_York" });

        const [execRows, todayHabits, streakRows] = await Promise.all([
          d.select().from(dailyExecution).where(sql`${dailyExecution.date} = ${today}`).limit(1),
          d.select().from(dailyHabits).where(sql`${dailyHabits.date} = ${today}`),
          d.execute(
            sql`SELECT date, SUM(completed) as done, COUNT(*) as total
                FROM daily_habits
                WHERE date >= ${thirtyDaysAgo} AND date < ${today}
                GROUP BY date
                ORDER BY date DESC`
          ),
        ]);

        const todayExec = execRows[0];
        if (todayExec) {
          execution.mission = todayExec.mission;
        }

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

        // Streak from parallel query above
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

    // ─── Operating Mode ───────────────────────────────────
    // Governs what the client shows and hides
    const totalRevenue = revenueWaiting.staleLeadsCount + revenueWaiting.staleQuotesCount + revenueWaiting.pendingCallbacks;
    let mode: "fire" | "recovery" | "mvd" | "normal" | "clear" = "normal";

    if (driftStatus === "off_track" && totalRevenue > 5) {
      mode = "recovery"; // too many things overdue — triage mode
    } else if (score < 40 && period !== "morning" && period !== "night") {
      mode = "mvd"; // falling behind mid-day — minimum viable day
    } else if (totalRevenue === 0 && score >= 80) {
      mode = "clear"; // nothing urgent, execution strong
    }
    // "fire" is determined client-side from urgentItems priority

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
      mode,
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
