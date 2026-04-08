/**
 * Control Center router — unified admin overview with urgent items,
 * today's stats, AI gateway health, system status, daily brief, and execution tracking.
 */
import { adminProcedure, router } from "../_core/trpc";
import { sql, eq, gte, and } from "drizzle-orm";
import { execSync } from "child_process";
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

// ─── Domain Constants (single source of truth for thresholds) ───
const NON_NEGOTIABLES = [
  { key: "wake", label: "Wake by 6:30 AM" },
  { key: "workout", label: "Workout / Movement" },
  { key: "business_action", label: "One Business Action" },
  { key: "clean_space", label: "Clean Space" },
  { key: "no_social_am", label: "No Social Before Noon" },
] as const;

const THRESHOLDS = {
  // Execution status
  ON_TRACK_MIN: 80,       // ≥80% = on_track
  DRIFTING_MIN: 40,       // ≥40% = drifting, <40% = off_track
  // Drift signals
  STALE_LEADS_WARN: 3,    // >3 stale leads triggers drift signal
  STALE_QUOTES_WARN: 5,   // >5 stale quotes triggers drift signal
  CALLBACKS_WARN: 3,      // >3 pending callbacks triggers drift signal
  COMPLETION_WARN: 60,    // <60% completion triggers drift signal
  // Operating mode
  RECOVERY_REVENUE_MIN: 5, // ≥5 overdue revenue items + off_track = recovery
  MVD_SCORE_MAX: 40,      // <40% mid-day = minimum viable day
  CLEAR_SCORE_MIN: 80,    // ≥80% + no revenue = clear
  // Time
  BUSINESS_DAY_END: 21,   // 9pm ET = end of business day
  STREAK_LOOKBACK_DAYS: 30,
} as const;

/** Derive the single biggest bottleneck across all dimensions */
function deriveBottleneck(
  execution: { completionScore: number; mission: string | null; streak: number },
  revenue: { staleLeadsCount: number; staleQuotesCount: number; pendingCallbacks: number },
  driftStatus: string,
  totalRevenue: number,
  mode: string,
): { area: string; message: string; severity: "critical" | "high" | "medium" | "low" } {
  // Priority order: fire > revenue decay > execution collapse > drift > clear
  if (mode === "recovery") {
    return { area: "operations", message: "Too many things overdue. Triage first.", severity: "critical" };
  }
  if (revenue.pendingCallbacks > THRESHOLDS.CALLBACKS_WARN) {
    return { area: "revenue", message: `${revenue.pendingCallbacks} callbacks waiting — money on the table`, severity: "high" };
  }
  if (revenue.staleLeadsCount > THRESHOLDS.STALE_LEADS_WARN) {
    return { area: "revenue", message: `${revenue.staleLeadsCount} leads going cold — contact them`, severity: "high" };
  }
  if (execution.completionScore < THRESHOLDS.DRIFTING_MIN && !execution.mission) {
    return { area: "execution", message: "No mission set and habits slipping", severity: "high" };
  }
  if (driftStatus === "off_track") {
    return { area: "discipline", message: "Multiple drift signals — return to fundamentals", severity: "medium" };
  }
  if (totalRevenue > 0) {
    return { area: "revenue", message: `${totalRevenue} items waiting on follow-up`, severity: "medium" };
  }
  if (execution.completionScore < THRESHOLDS.ON_TRACK_MIN) {
    return { area: "execution", message: "Finish non-negotiables to stay on track", severity: "low" };
  }
  return { area: "none", message: "Clear. Execute your mission.", severity: "low" };
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
      veniceHealthy: false,
      recentRequests: 0,
      fallbackRate: 0,
      topModels: [] as string[],
    };

    try {
      const health = getGatewayHealth();
      const models = await getAvailableModels();
      const veniceModels = models.find(m => m.provider === "venice")?.models ?? [];

      aiGateway = {
        veniceHealthy: health.veniceHealthy,
        recentRequests: health.stats.last5min.total,
        fallbackRate: health.stats.last5min.total > 0
          ? Math.round((health.stats.last5min.fallbacks / health.stats.last5min.total) * 100)
          : 0,
        topModels: veniceModels.slice(0, 5),
      };
    } catch (err) {
      // AI gateway unavailable — defaults are fine
      console.warn("[ControlCenter] AI gateway stats unavailable:", err instanceof Error ? err.message : err);
    }

    // ─── System Health ───────────────────────────────
    let dbStatus: "connected" | "degraded" | "disconnected" = "disconnected";
    if (d) {
      try {
        await d.execute(sql`SELECT 1`);
        dbStatus = "connected";
      } catch (err) {
        dbStatus = "degraded";
        console.error("[ControlCenter] DB ping failed:", err instanceof Error ? err.message : err);
      }
    }

    // Tunnel status — no tunnel module exists, return inactive
    let tunnelUrl: string | null = null;
    let tunnelMode = "none";
    try {
      const tunnel = await import("../lib/tunnel-status").catch((e) => { console.warn("[routers/controlCenter] optional operation failed:", e); return null; });
      if (tunnel && typeof tunnel.getTunnelStatus === "function") {
        const status = await tunnel.getTunnelStatus();
        tunnelUrl = status?.url ?? null;
        tunnelMode = status?.mode ?? "none";
      }
    } catch (err) {
      // No tunnel module — expected in some environments
      console.debug("[ControlCenter] Tunnel status unavailable:", err instanceof Error ? err.message : err);
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

    // Venice down is urgent — means all AI is on OpenAI fallback
    if (!aiGateway.veniceHealthy) {
      urgentItems.push({
        type: "system",
        message: "Venice AI is offline — running on OpenAI fallback",
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
          .orderBy(sql`CASE ${leads.status} WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END`, leads.createdAt)
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
        } catch (err) {
          // SMS table might not exist yet
          console.warn("[ControlCenter] SMS stats query failed:", err instanceof Error ? err.message : err);
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
        const thirtyDaysAgo = new Date(now.getTime() - THRESHOLDS.STREAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
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

        const habitMap = new Map(todayHabits.map((h: typeof todayHabits[number]) => [h.habitKey, h.completed]));

        execution.nonNegotiables = NON_NEGOTIABLES.map((h) => ({
          key: h.key,
          label: h.label,
          completed: !!habitMap.get(h.key),
        }));

        const completedCount = execution.nonNegotiables.filter((h) => h.completed).length;
        execution.completionScore = Math.round((completedCount / NON_NEGOTIABLES.length) * 100);

        if (execution.completionScore >= THRESHOLDS.ON_TRACK_MIN) {
          execution.status = "on_track";
        } else if (execution.completionScore >= THRESHOLDS.DRIFTING_MIN) {
          execution.status = "drifting";
        } else {
          execution.status = "off_track";
        }

        // Streak from parallel query above
        let streak = 0;
        type RawRow = Record<string, unknown>;
        for (const row of ((streakRows as [RawRow[], unknown])[0] ?? [])) {
          const pct = (Number(row.done) / Number(row.total)) * 100;
          if (pct >= 80) streak++;
          else break;
        }
        execution.streak = streak;
      } catch (err) {
        // Tables might not exist yet — return defaults
        console.warn("[ControlCenter] Execution tracking query failed:", err instanceof Error ? err.message : err);
      }
    }

    // ─── Drift Indicator ─────────────────────────────────
    const signals: string[] = [];

    if (revenueWaiting.staleLeadsCount > THRESHOLDS.STALE_LEADS_WARN) {
      signals.push("Leads going cold");
    }
    if (execution.completionScore < THRESHOLDS.COMPLETION_WARN) {
      signals.push("Non-negotiables slipping");
    }
    if (revenueWaiting.staleQuotesCount > THRESHOLDS.STALE_QUOTES_WARN) {
      signals.push("Quotes dying on the vine");
    }
    if (revenueWaiting.pendingCallbacks > THRESHOLDS.CALLBACKS_WARN) {
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

    const hoursLeft = Math.max(0, THRESHOLDS.BUSINESS_DAY_END - etHour);

    // ─── Operating Mode (derived from thresholds) ─────────
    const totalRevenue = revenueWaiting.staleLeadsCount + revenueWaiting.staleQuotesCount + revenueWaiting.pendingCallbacks;
    let mode: "fire" | "recovery" | "mvd" | "normal" | "clear" = "normal";

    if (driftStatus === "off_track" && totalRevenue >= THRESHOLDS.RECOVERY_REVENUE_MIN) {
      mode = "recovery";
    } else if (score < THRESHOLDS.MVD_SCORE_MAX && period !== "morning" && period !== "night") {
      mode = "mvd";
    } else if (totalRevenue === 0 && score >= THRESHOLDS.CLEAR_SCORE_MIN) {
      mode = "clear";
    }
    // "fire" is determined client-side from urgentItems priority

    // ─── Execution Debt ─────
    // Simple: streak=0 means yesterday was bad. No streak = no momentum.
    // We report streak directly — client decides how to display.
    // executionDebt = 0 means streak is healthy, >0 means days since last good streak.
    const executionDebt = execution.streak === 0 && execution.completionScore < THRESHOLDS.DRIFTING_MIN ? 1 : 0;

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
      executionDebt,
      bottleneck: deriveBottleneck(execution, revenueWaiting, driftStatus, totalRevenue, mode),
    };
  }),

  // ─── TOGGLE HABIT ────────────────────────────────────
  toggleHabit: adminProcedure
    .input(z.object({ habitKey: z.string().max(100), completed: z.boolean() }))
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
    .input(z.object({ mission: z.string().max(500) }))
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

  // ─── LOG ACTION (telemetry + action completion tracking) ───
  logAction: adminProcedure
    .input(z.object({
      action: z.enum(["done", "skip", "defer", "open", "habit_toggle", "mission_set", "command"]),
      target: z.string().max(500).optional(),
      meta: z.record(z.string().max(100), z.string().max(500)).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { logged: false };

      const today = getTodayET();
      await d.execute(
        sql`INSERT INTO daily_execution (date, status) VALUES (${today}, 'on_track')
            ON DUPLICATE KEY UPDATE status = status`
      );

      // Atomic increment — avoids race condition on concurrent logAction calls
      // Uses COALESCE + JSON to safely increment without read-modify-write
      const actionKey = input.action.replace(/[^a-z_]/g, ""); // sanitize key
      await d.execute(
        sql`UPDATE daily_execution
            SET notes = JSON_SET(
              COALESCE(notes, '{}'),
              ${`$.${actionKey}`},
              COALESCE(JSON_EXTRACT(notes, ${`$.${actionKey}`}), 0) + 1
            )
            WHERE date = ${today}`
      );

      return { logged: true, action: input.action, date: today };
    }),

  // ─── CLOSE DAY (end-of-day summary + rollover) ────────────
  closeDay: adminProcedure
    .mutation(async () => {
      const d = await db();
      if (!d) throw new Error("Database unavailable");

      const today = getTodayET();

      // Calculate final score for today
      const habits = await d.select().from(dailyHabits).where(sql`${dailyHabits.date} = ${today}`);
      const completed = habits.filter((h: typeof habits[number]) => h.completed).length;
      const total = habits.length || 1;
      const score = Math.round((completed / total) * 100);

      const status = score >= THRESHOLDS.ON_TRACK_MIN ? "on_track" : score >= THRESHOLDS.DRIFTING_MIN ? "drifting" : "off_track";

      await d.execute(
        sql`UPDATE daily_execution SET status = ${status} WHERE date = ${today}`
      );

      return { date: today, score, status, habitsCompleted: completed, habitsTotal: total };
    }),

  // ─── GET YESTERDAY (carry-forward data) ────────────────────
  getYesterday: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return null;

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      .toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    const [row] = await d.select().from(dailyExecution).where(sql`${dailyExecution.date} = ${yesterday}`).limit(1);
    if (!row) return null;

    const habits = await d.select().from(dailyHabits).where(sql`${dailyHabits.date} = ${yesterday}`);
    const completed = habits.filter((h: typeof habits[number]) => h.completed || h.completedAt).length;

    return {
      date: yesterday,
      mission: row.mission,
      status: row.status,
      score: Math.round((completed / (habits.length || 1)) * 100),
      habitsCompleted: completed,
      habitsTotal: habits.length,
    };
  }),

  // ─── REPO ACTIVITY (git-based source awareness) ────────
  getRepoActivity: adminProcedure.query(async () => {
    try {
      const cwd = process.cwd();

      // Recent commits (last 7 days)
      const logRaw = execSync(
        'git log --oneline --since="7 days ago" --no-decorate 2>/dev/null',
        { cwd, encoding: "utf-8", timeout: 5000 }
      ).trim();
      const commits = logRaw ? logRaw.split("\n").map(line => {
        const [hash, ...rest] = line.split(" ");
        return { hash, message: rest.join(" ") };
      }) : [];

      // Files changed today
      const diffRaw = execSync(
        'git diff --name-only HEAD~1 2>/dev/null || echo ""',
        { cwd, encoding: "utf-8", timeout: 5000 }
      ).trim();
      const recentFiles = diffRaw ? diffRaw.split("\n").filter(Boolean).slice(0, 10) : [];

      // Current branch
      const branch = execSync(
        'git branch --show-current 2>/dev/null',
        { cwd, encoding: "utf-8", timeout: 3000 }
      ).trim();

      // Uncommitted changes
      const statusRaw = execSync(
        'git status --porcelain 2>/dev/null',
        { cwd, encoding: "utf-8", timeout: 3000 }
      ).trim();
      const uncommittedCount = statusRaw ? statusRaw.split("\n").filter(Boolean).length : 0;

      return {
        branch,
        commitsThisWeek: commits.length,
        recentCommits: commits.slice(0, 5),
        recentFiles,
        uncommittedCount,
      };
    } catch (err) {
      console.warn("[ControlCenter] Git pulse query failed:", err instanceof Error ? err.message : err);
      return {
        branch: "unknown",
        commitsThisWeek: 0,
        recentCommits: [],
        recentFiles: [],
        uncommittedCount: 0,
      };
    }
  }),

  // ─── OPERATIONAL TWIN (machine-readable system model) ────
  getOperationalTwin: adminProcedure.query(async () => {
    const d = await db();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- gateway health shape varies between providers
    let health: Record<string, any> = { ollamaHealthy: false, circuitBreaker: { open: false } };
    try { health = getGatewayHealth(); } catch (err) {
      console.warn("[ControlCenter] Gateway health unavailable for twin:", err instanceof Error ? err.message : err);
    }

    return {
      version: "1.0",
      timestamp: new Date().toISOString(),
      subsystems: {
        server: { status: "live", risk: "low" },
        database: { status: d ? "connected" : "disconnected", risk: d ? "low" : "critical" },
        aiGateway: {
          status: health.ollamaHealthy ? "local" : "cloud-fallback",
          circuitBreaker: health.circuitBreaker?.open ? "open" : "closed",
          risk: health.ollamaHealthy ? "low" : "medium",
        },
        cron: { status: "running", jobCount: 11, risk: "low" },
        auth: { status: "active", method: "google-oauth", risk: "low" },
        controlCenter: { status: "active", endpoints: 10, risk: "low" },
        tunnel: { status: process.env.TUNNEL_URL ? "configured" : "local-only", risk: "low" },
      },
      protectedCore: [
        "server/_core/index.ts", "server/_core/trpc.ts", "server/routers.ts",
        "drizzle/schema.ts", "server/db.ts", "client/src/App.tsx",
      ],
      truthSources: {
        database: "TiDB Cloud via Drizzle ORM",
        ai: "Ollama local-first, OpenAI fallback via ai-gateway.ts",
        auth: "Google OAuth via GOOGLE_OAUTH_CLIENT_ID",
        config: ".env + Railway env vars",
        schema: "drizzle/schema.ts (68 tables, 22 migrations)",
      },
      knownDebt: {
        schemaNaming: "mixed camelCase/snake_case across eras",
        missingTimestamps: 8,
        missingIndexes: 22,
        stubCronJobs: 2,
        contentCronMissing: true,
        staleKBDoc: true,
      },
    };
  }),

  // ─── SOURCE STATUS (truth layer summary) ────────────────
  getSourceStatus: adminProcedure.query(async () => {
    const d = await db();

    // Runtime truth
    const runtime = {
      env: process.env.NODE_ENV ?? "unknown",
      isProduction: process.env.NODE_ENV === "production",
      hasOllamaLocal: true, // Ollama defaults to localhost:11434 when not configured
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasGoogleOAuth: !!process.env.GOOGLE_OAUTH_CLIENT_ID,
      hasAdminKey: !!process.env.ADMIN_API_KEY,
      hasTwilio: !!process.env.TWILIO_ACCOUNT_SID,
      hasResend: !!process.env.RESEND_API_KEY,
      dbConnected: !!d,
    };

    // Known source docs (from Drive registry)
    const knownDocs = [
      { name: "Knowledge Base", lastUpdated: "2026-03-15", status: "stale" as const, drift: "9 contradictions found" },
      { name: "Brand Blueprint", lastUpdated: "2026-03-15", status: "current" as const, drift: null },
      { name: "Website Audit", lastUpdated: "2026-03-19", status: "current" as const, drift: null },
      { name: "Weekly Directives", lastUpdated: "2026-03-15", status: "stale" as const, drift: "Covers Mar 16-22 only" },
    ];

    return { runtime, knownDocs };
  }),
});
