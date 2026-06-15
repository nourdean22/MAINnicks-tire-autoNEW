/**
 * Control Center router — unified admin overview with urgent items,
 * today's stats, AI gateway health, system status, daily brief, and execution tracking.
 */
import { adminProcedure, router } from "../_core/trpc";
import { sql, eq, gte, and, desc } from "drizzle-orm";
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
import { bookings, leads, callbackRequests, smsMessages, dailyExecution, dailyHabits, invoices, estimatesLog, callEvents, tireOrders, winbackSends, winbackCampaigns, memberships } from "../../drizzle/schema";
import { countActionableLeads } from "@shared/leadSource";
import { getGatewayHealth, getAvailableModels } from "../lib/ai-gateway";
import { z } from "zod";

import { db } from "../lib/db-helper";

import { BUSINESS } from "@shared/business";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:controlCenter");
/** Get today's date string (YYYY-MM-DD) in America/New_York timezone */
function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
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
  moneySummary: adminProcedure.query(async () => {
    const d = await db();
    if (!d) {
      return {
        unpaidInvoicesSum: 0,
        openEstimatesSum: 0,
        totalOutstanding: 0,
        todayMetrics: { calls: 0, leads: 0, bookings: 0, tireOrders: 0, winbacks: 0 },
        pendingItems: [],
      };
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      openEstimates,
      callsToday,
      leadsToday,
      bookingsToday,
      tireOrdersToday,
      winbacksToday,
      pendingEstimatesList,
    ] = await Promise.all([
      d.select({ sum: sql<number>`COALESCE(SUM(${estimatesLog.estimatedAmountCents}), 0)` })
        .from(estimatesLog)
        .where(eq(estimatesLog.converted, 0)),
      d.select({ count: sql<number>`count(*)` })
        .from(callEvents)
        .where(gte(callEvents.createdAt, todayStart)),
      d.select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(gte(leads.createdAt, todayStart)),
      d.select({ count: sql<number>`count(*)` })
        .from(bookings)
        .where(gte(bookings.createdAt, todayStart)),
      d.select({ count: sql<number>`count(*)` })
        .from(tireOrders)
        .where(gte(tireOrders.createdAt, todayStart)),
      d.select({ count: sql<number>`count(*)` })
        .from(winbackSends)
        .where(gte(winbackSends.createdAt, todayStart)),
      d.select({
        id: estimatesLog.id,
        name: estimatesLog.name,
        value: estimatesLog.estimatedAmountCents,
        createdAt: estimatesLog.createdAt,
        service: estimatesLog.service,
      })
        .from(estimatesLog)
        .where(eq(estimatesLog.converted, 0))
        .orderBy(desc(estimatesLog.estimatedAmountCents))
        .limit(5),
    ]);

    const openEstimatesSum = openEstimates[0]?.sum ?? 0;

    const combinedPending = [
      ...pendingEstimatesList.map((est: { id: number; name: string | null; value: number | null; createdAt: Date; service: string | null }) => ({
        id: est.id,
        name: est.name || "Unknown",
        value: est.value ?? 0,
        type: "estimate" as const,
        date: est.createdAt,
        reference: est.service || `EST-${est.id}`,
      })),
    ]
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    return {
      unpaidInvoicesSum: 0,
      openEstimatesSum,
      totalOutstanding: openEstimatesSum,
      todayMetrics: {
        calls: callsToday[0]?.count ?? 0,
        leads: leadsToday[0]?.count ?? 0,
        bookings: bookingsToday[0]?.count ?? 0,
        tireOrders: tireOrdersToday[0]?.count ?? 0,
        winbacks: winbacksToday[0]?.count ?? 0,
      },
      pendingItems: combinedPending,
    };
  }),

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
      log.warn("[ControlCenter] AI gateway stats unavailable:", err instanceof Error ? err.message : err);
    }

    // ─── System Health ───────────────────────────────
    let dbStatus: "connected" | "degraded" | "disconnected" = "disconnected";
    if (d) {
      try {
        await d.execute(sql`SELECT 1`);
        dbStatus = "connected";
      } catch (err) {
        dbStatus = "degraded";
        log.error("[ControlCenter] DB ping failed:", err instanceof Error ? err.message : err);
      }
    }

    // Tunnel status — no tunnel module exists, return inactive
    let tunnelUrl: string | null = null;
    let tunnelMode = "none";
    try {
      const tunnel = await import("../lib/tunnel-status").catch((e) => { log.warn("[routers/controlCenter] optional operation failed:", e); return null; });
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
        d.select({ source: leads.source, callbackId: leads.callbackId }).from(leads)
          .where(and(eq(leads.status, "new"), sql`${leads.createdAt} < ${yesterday}`)),
        d.select({ count: sql<number>`count(*)` }).from(leads)
          .where(and(eq(leads.status, "contacted"), sql`${leads.createdAt} < ${twoDaysAgo}`)),
        d.select({ count: sql<number>`count(*)` }).from(smsMessages)
          .where(and(eq(smsMessages.status, "failed"), gte(smsMessages.createdAt, yesterday)))
          // wave-116d — was silent fallback to 0; now logs at warn so a
          // failing query doesn't look identical to "no failed SMS today"
          // on the operator's command surface. Still returns 0 so the UI
          // never crashes — just leaves a trail.
          .catch((err: unknown) => {
            log.warn("[controlCenter] failedSms count query failed", { error: err instanceof Error ? err.message : String(err) });
            return [{ count: 0 }];
          }),
        d.select({ source: leads.source, callbackId: leads.callbackId }).from(leads)
          .where(and(eq(leads.status, "new"), gte(leads.createdAt, todayStart))),
      ]);

      // Linked callback-form leads (callbackId set) are the same person as a
      // callback_requests row counted separately below — exclude them so one
      // caller isn't both a "stale lead" and a "pending callback". Voice
      // rack-check leads (callbackId null) still count. See shared/leadSource.ts.
      const staleLeadsCount = countActionableLeads(staleLeadsArr);
      const staleQuotesCount = staleQuotesArr[0]?.count ?? 0;
      const failedSmsCount = failedSmsArr[0]?.count ?? 0;
      const newLeadsTodayCount = countActionableLeads(newLeadsTodayArr);

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

    // ─── Revenue Pipeline ($) ────────────────────────
    let revenueWaiting = {
      pipelineValueCents: 0,
      stalePipelineValueCents: 0,
      staleLeadsCount: 0,
      staleQuotesCount: 0,
      pendingCallbacks: todayStats.callbacksPending,
      avgLeadAgeDays: 0,
      oldestUntouchedHours: 0,
      topOpportunities: [] as Array<{
        id: number; name: string; phone: string; service: string;
        createdAt: Date; status: string; estimatedValueCents: number | null;
        lastFollowUpAt: Date | null; ageHours: number;
      }>,
    };

    if (d) {
      try {
        const [pipelineVal, staleVal, topLeads] = await Promise.all([
          d.select({ total: sql<number>`COALESCE(SUM(${leads.estimatedValueCents}), 0)` })
            .from(leads).where(sql`${leads.status} IN ('new', 'contacted')`),
          d.select({ total: sql<number>`COALESCE(SUM(${leads.estimatedValueCents}), 0)` })
            .from(leads).where(and(
              sql`${leads.status} IN ('new', 'contacted')`,
              sql`${leads.createdAt} < ${yesterday}`,
              sql`(${leads.lastFollowUpAt} IS NULL OR ${leads.lastFollowUpAt} < ${yesterday})`
            )),
          d.select({
            id: leads.id, name: leads.name, phone: leads.phone,
            service: leads.recommendedService, createdAt: leads.createdAt, status: leads.status,
            estimatedValueCents: leads.estimatedValueCents, lastFollowUpAt: leads.lastFollowUpAt,
          }).from(leads).where(sql`${leads.status} IN ('new', 'contacted')`)
            .orderBy(sql`CASE ${leads.status} WHEN 'new' THEN 0 ELSE 1 END`, leads.createdAt)
            .limit(5),
        ]);

        revenueWaiting.pipelineValueCents = pipelineVal[0]?.total ?? 0;
        revenueWaiting.stalePipelineValueCents = staleVal[0]?.total ?? 0;

        const nowMs = Date.now();
        let totalAge = 0, oldest = 0;
        for (const o of topLeads) {
          const age = nowMs - new Date(o.createdAt).getTime();
          totalAge += age;
          const touch = o.lastFollowUpAt ? new Date(o.lastFollowUpAt).getTime() : new Date(o.createdAt).getTime();
          const untouched = nowMs - touch;
          if (untouched > oldest) oldest = untouched;
        }
        revenueWaiting.avgLeadAgeDays = topLeads.length > 0 ? Math.round(totalAge / topLeads.length / 86400000 * 10) / 10 : 0;
        revenueWaiting.oldestUntouchedHours = Math.round(oldest / 3600000);
        revenueWaiting.topOpportunities = topLeads.map((o: typeof topLeads[number]) => ({
          id: o.id, name: o.name, phone: o.phone,
          service: o.service ?? "General", createdAt: o.createdAt, status: o.status,
          estimatedValueCents: o.estimatedValueCents ?? null,
          lastFollowUpAt: o.lastFollowUpAt ?? null,
          ageHours: Math.round((nowMs - new Date(o.createdAt).getTime()) / 3600000),
        }));
      } catch (e) {
        log.error("[ControlCenter] Pipeline query failed:", e instanceof Error ? e.message : e);
      }
    }

    return { todayStats, aiGateway, systemHealth, urgentItems, revenueWaiting };
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

    // ─── Revenue Waiting (counts + $ amounts + aging) ────────────────────────────────
    let revenueWaiting = {
      staleLeadsCount: 0,
      staleQuotesCount: 0,
      pendingCallbacks: 0,
      // NEW: Dollar amounts in the pipeline
      pipelineValueCents: 0, // total estimated $ of open leads
      stalePipelineValueCents: 0, // $ value of stale leads (24h+ no contact)
      avgLeadAgeDays: 0, // average days since lead was created
      oldestUntouchedHours: 0, // hours since oldest lead without follow-up
      topOpportunities: [] as Array<{
        id: number;
        name: string;
        phone: string;
        service: string;
        createdAt: Date;
        status: string;
        estimatedValueCents: number | null;
        lastFollowUpAt: Date | null;
        ageHours: number;
      }>,
    };

    if (d) {
      // Parallel revenue queries (was 4 serial)
      const [staleLeadsArr, staleQuotesArr, callbacksArr, topOpps, pipelineValue, stalePipelineValue] = await Promise.all([
        d.select({ source: leads.source, callbackId: leads.callbackId })
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
            estimatedValueCents: leads.estimatedValueCents,
            lastFollowUpAt: leads.lastFollowUpAt,
          })
          .from(leads)
          .where(sql`${leads.status} IN ('new', 'contacted')`)
          .orderBy(sql`CASE ${leads.status} WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END`, leads.createdAt)
          .limit(10),
        // Total pipeline $ value (all open leads with estimated value)
        d.select({ total: sql<number>`COALESCE(SUM(${leads.estimatedValueCents}), 0)` })
          .from(leads)
          .where(sql`${leads.status} IN ('new', 'contacted')`),
        // Stale pipeline $ value (leads 24h+ with no follow-up)
        d.select({ total: sql<number>`COALESCE(SUM(${leads.estimatedValueCents}), 0)` })
          .from(leads)
          .where(and(
            sql`${leads.status} IN ('new', 'contacted')`,
            sql`${leads.createdAt} < ${yesterday}`,
            sql`(${leads.lastFollowUpAt} IS NULL OR ${leads.lastFollowUpAt} < ${yesterday})`
          )),
      ]);

      // Exclude linked callback-form leads (counted as callbacks below). See shared/leadSource.ts.
      revenueWaiting.staleLeadsCount = countActionableLeads(staleLeadsArr);
      revenueWaiting.staleQuotesCount = staleQuotesArr[0]?.count ?? 0;
      revenueWaiting.pendingCallbacks = callbacksArr[0]?.count ?? 0;
      revenueWaiting.pipelineValueCents = pipelineValue[0]?.total ?? 0;
      revenueWaiting.stalePipelineValueCents = stalePipelineValue[0]?.total ?? 0;

      // Compute aging metrics from topOpps
      const nowMs = Date.now();
      let totalAgeMs = 0;
      let oldestUntouched = 0;
      for (const o of topOpps) {
        const ageMs = nowMs - new Date(o.createdAt).getTime();
        totalAgeMs += ageMs;
        const lastTouch = o.lastFollowUpAt ? new Date(o.lastFollowUpAt).getTime() : new Date(o.createdAt).getTime();
        const untouchedMs = nowMs - lastTouch;
        if (untouchedMs > oldestUntouched) oldestUntouched = untouchedMs;
      }
      revenueWaiting.avgLeadAgeDays = topOpps.length > 0 ? Math.round(totalAgeMs / topOpps.length / 86400000 * 10) / 10 : 0;
      revenueWaiting.oldestUntouchedHours = Math.round(oldestUntouched / 3600000);

      revenueWaiting.topOpportunities = topOpps.map((o: typeof topOpps[number]) => {
        const ageHours = Math.round((nowMs - new Date(o.createdAt).getTime()) / 3600000);
        return {
          id: o.id, name: o.name, phone: o.phone,
          service: o.service ?? "General", createdAt: o.createdAt, status: o.status,
          estimatedValueCents: o.estimatedValueCents ?? null,
          lastFollowUpAt: o.lastFollowUpAt ?? null,
          ageHours,
        };
      });

      // Build topAction from priority: stale leads > pending callbacks > stale quotes > failed SMS
      // NOW WITH $ AMOUNTS — money aging is visible in every alert
      const staleDollars = revenueWaiting.stalePipelineValueCents > 0
        ? ` (~$${Math.round(revenueWaiting.stalePipelineValueCents / 100).toLocaleString()} at risk)`
        : "";
      if (revenueWaiting.staleLeadsCount > 0) {
        topAction = {
          type: "lead",
          message: `${revenueWaiting.staleLeadsCount} lead${revenueWaiting.staleLeadsCount > 1 ? "s" : ""} with no response in 24h${staleDollars}`,
          action: "/admin#leads",
        };
      } else if (revenueWaiting.pendingCallbacks > 0) {
        topAction = {
          type: "callback",
          message: `${revenueWaiting.pendingCallbacks} callback${revenueWaiting.pendingCallbacks > 1 ? "s" : ""} pending — money waiting`,
          action: "/admin#bookings",
        };
      } else if (revenueWaiting.staleQuotesCount > 0) {
        topAction = {
          type: "quote",
          message: `${revenueWaiting.staleQuotesCount} quote${revenueWaiting.staleQuotesCount > 1 ? "s" : ""} not followed up (48h+)${staleDollars}`,
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
          log.warn("[ControlCenter] SMS stats query failed:", err instanceof Error ? err.message : err);
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
        // wave-181.58 · was sql.raw() with string interpolation. Currently safe
        // because NON_NEGOTIABLES is a hard-coded const (line 26), not user
        // input — so no live CVE. But the pattern is a footgun: if anyone
        // ever sources NON_NEGOTIABLES from DB or operator config, the
        // interpolation becomes an injection vector. Replacing with the
        // parameterized Drizzle insert that the rest of the codebase uses.
        await Promise.all([
          d.execute(sql`INSERT IGNORE INTO daily_execution (date, status) VALUES (${today}, 'on_track')`),
          d.insert(dailyHabits)
            .ignore()
            .values(NON_NEGOTIABLES.map((h) => ({ date: today, habitKey: h.key, completed: 0 }))),
        ]);

        // Parallel reads: execution + habits + streak (was 3 sequential)
        const thirtyDaysAgo = new Date(now.getTime() - THRESHOLDS.STREAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
          .toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });

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
        log.warn("[ControlCenter] Execution tracking query failed:", err instanceof Error ? err.message : err);
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
    const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone }));
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
      .toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });

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

      // Run all git commands concurrently (non-blocking, was execSync)
      const gitCmd = (cmd: string, timeout = 5000) =>
        execAsync(cmd, { cwd, encoding: "utf-8", timeout }).then(r => r.stdout.trim()).catch(() => "");

      const [logRaw, diffRaw, branch, statusRaw] = await Promise.all([
        gitCmd('git log --oneline --since="7 days ago" --no-decorate 2>/dev/null'),
        gitCmd('git diff --name-only HEAD~1 2>/dev/null'),
        gitCmd('git branch --show-current 2>/dev/null', 3000),
        gitCmd('git status --porcelain 2>/dev/null', 3000),
      ]);

      const commits = logRaw ? logRaw.split("\n").map(line => {
        const [hash, ...rest] = line.split(" ");
        return { hash, message: rest.join(" ") };
      }) : [];
      const recentFiles = diffRaw ? diffRaw.split("\n").filter(Boolean).slice(0, 10) : [];
      const uncommittedCount = statusRaw ? statusRaw.split("\n").filter(Boolean).length : 0;

      return {
        branch,
        commitsThisWeek: commits.length,
        recentCommits: commits.slice(0, 5),
        recentFiles,
        uncommittedCount,
      };
    } catch (err) {
      log.warn("[ControlCenter] Git pulse query failed:", err instanceof Error ? err.message : err);
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
    let health: Record<string, unknown> = { veniceHealthy: false, circuitBreaker: { open: false } };
    try { health = getGatewayHealth() as Record<string, unknown>; } catch (err) {
      log.warn("[ControlCenter] Gateway health unavailable for twin:", err instanceof Error ? err.message : err);
    }

    return {
      version: "1.0",
      timestamp: new Date().toISOString(),
      subsystems: {
        server: { status: "live", risk: "low" },
        database: { status: d ? "connected" : "disconnected", risk: d ? "low" : "critical" },
        aiGateway: {
          status: health.veniceHealthy ? "venice-primary" : "openai-fallback",
          circuitBreaker: (health.circuitBreaker as Record<string, unknown>)?.open ? "open" : "closed",
          risk: health.veniceHealthy ? "low" : "medium",
        },
        cron: { status: "running", jobCount: 55, risk: "low" },
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
        ai: "Venice primary, OpenAI fallback via ai-gateway.ts",
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

  // ─── SECURITY / COMPLIANCE ──────────────────────────
  /**
   * Last-N admin logins — for "is anyone else signing into my shop?" peace of mind.
   * Shows email, IP, UA, timestamp. Powered by compliance_log (audit_log table).
   */
  recentAdminLogins: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const { getRecentAdminLogins, getRecentAdminLoginFailures } = await import(
        "../services/complianceLog"
      );
      const [successes, failures] = await Promise.all([
        getRecentAdminLogins(input?.limit ?? 20),
        getRecentAdminLoginFailures(10),
      ]);
      return {
        successes,
        failures,
        uniqueIpsLast30d: Array.from(
          new Set(successes.map((s) => s.ipAddress).filter(Boolean) as string[]),
        ),
      };
    }),

  /**
   * Recent SMS opt-ins + opt-outs for TCPA audit trail.
   * If Twilio ever calls, we can show this proof.
   */
  smsConsentAudit: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const { getRecentOptIns, getRecentOptOuts } = await import("../services/complianceLog");
      const [optIns, optOuts] = await Promise.all([
        getRecentOptIns(input?.limit ?? 100),
        getRecentOptOuts(input?.limit ?? 100),
      ]);
      return { optIns, optOuts, totalOptIns: optIns.length, totalOptOuts: optOuts.length };
    }),

  /**
   * Core Web Vitals report — p50/p75/p95 by metric + top slowest routes.
   * Real-user data, not CrUX lab averages. 60-min default window.
   */
  webVitals: adminProcedure
    .input(z.object({ windowMinutes: z.number().min(5).max(24 * 60).default(60) }).optional())
    .query(async ({ input }) => {
      const { getCwvReport } = await import("../lib/cwv-telemetry");
      return getCwvReport(input?.windowMinutes ?? 60);
    }),

  topMoneyMoves: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];

    const moves: Array<{
      type: "estimate" | "callback" | "invoice" | "winback" | "membership";
      title: string;
      description: string;
      value: number;
      id: number;
      cta: string;
      targetTab: string;
      metadata: Record<string, any>;
      score: number;
    }> = [];

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    try {
      // 1. Highest open estimate outstanding for > 24 hours
      const [est] = await d.select({
        id: estimatesLog.id,
        name: estimatesLog.name,
        phone: estimatesLog.phone,
        service: estimatesLog.service,
        value: estimatesLog.estimatedAmountCents,
        createdAt: estimatesLog.createdAt,
      })
        .from(estimatesLog)
        .where(and(
          eq(estimatesLog.converted, 0),
          sql`${estimatesLog.estimatedAmountCents} IS NOT NULL`,
          sql`${estimatesLog.createdAt} < ${twentyFourHoursAgo}`
        ))
        .orderBy(desc(estimatesLog.estimatedAmountCents))
        .limit(1);

      if (est) {
        const val = (est.value ?? 0) / 100;
        const phoneTail = est.phone ? est.phone.slice(-4) : "";
        moves.push({
          type: "estimate",
          title: "Follow up on high-value estimate",
          description: `Customer ${est.name || 'Unknown'} (•••${phoneTail}) has an unconverted estimate for ${est.service || 'services'} worth $${val.toFixed(2)}.`,
          value: val,
          id: est.id,
          cta: "Send Follow-up",
          targetTab: "leads",
          metadata: {
            name: est.name || "Unknown",
            phoneRedacted: est.phone ? `•••${phoneTail}` : "",
            service: est.service,
            amount: val,
            id: est.id
          },
          score: val
        });
      }
    } catch (err) {
      log.error("[ControlCenter] topMoneyMoves estimate query failed:", err);
    }

    try {
      // 2. Missed call / Callback request pending
      const [cb] = await d.select({
        id: callbackRequests.id,
        name: callbackRequests.name,
        phone: callbackRequests.phone,
        context: callbackRequests.context,
        createdAt: callbackRequests.createdAt,
      })
        .from(callbackRequests)
        .where(sql`${callbackRequests.status} IN ('new', 'pending')`)
        .orderBy(desc(callbackRequests.createdAt))
        .limit(1);

      if (cb) {
        const phoneTail = cb.phone ? cb.phone.slice(-4) : "";
        moves.push({
          type: "callback",
          title: "Return missed callback request",
          description: `Customer ${cb.name || 'Unknown'} (•••${phoneTail}) requested a callback: "${cb.context || 'No details'}"`,
          value: 0,
          id: cb.id,
          cta: "Call Customer",
          targetTab: "callTrackingView",
          metadata: {
            name: cb.name || "Unknown",
            phoneRedacted: cb.phone ? `•••${phoneTail}` : "",
            context: cb.context,
            id: cb.id
          },
          score: 500 // missed callbacks have high urgency weight
        });
      }
    } catch (err) {
      log.error("[ControlCenter] topMoneyMoves callback query failed:", err);
    }



    try {
      // 4. Winback campaign in draft status
      const [camp] = await d.select({
        id: winbackCampaigns.id,
        name: winbackCampaigns.name,
        targetSegment: winbackCampaigns.targetSegment,
        targetCount: winbackCampaigns.targetCount,
      })
        .from(winbackCampaigns)
        .where(eq(winbackCampaigns.status, "draft"))
        .orderBy(desc(winbackCampaigns.createdAt))
        .limit(1);

      if (camp) {
        moves.push({
          type: "winback",
          title: "Approve winback campaign",
          description: `Outreach campaign "${camp.name}" for segment "${camp.targetSegment}" (${camp.targetCount} targets) is ready for activation.`,
          value: 0,
          id: camp.id,
          cta: "Approve Winback",
          targetTab: "campaigns",
          metadata: {
            name: camp.name,
            targetSegment: camp.targetSegment,
            targetCount: camp.targetCount,
            id: camp.id
          },
          score: 300
        });
      }
    } catch (err) {
      log.error("[ControlCenter] topMoneyMoves winback query failed:", err);
    }

    try {
      // 5. Nonstop Nick membership in warning state (past_due or incomplete)
      const [memb] = await d.select({
        id: memberships.id,
        name: memberships.name,
        phone: memberships.phone,
        status: memberships.status,
      })
        .from(memberships)
        .where(sql`${memberships.status} IN ('past_due', 'incomplete')`)
        .orderBy(desc(memberships.createdAt))
        .limit(1);

      if (memb) {
        const phoneTail = memb.phone ? memb.phone.slice(-4) : "";
        moves.push({
          type: "membership",
          title: "Overdue Nonstop Nick Membership",
          description: `Member ${memb.name || 'Unknown'} (•••${phoneTail}) is currently ${memb.status}.`,
          value: 0,
          id: memb.id,
          cta: "Grant Grace Period",
          targetTab: "memberships",
          metadata: {
            name: memb.name || "Unknown",
            phoneRedacted: memb.phone ? `•••${phoneTail}` : "",
            status: memb.status,
            id: memb.id
          },
          score: 200
        });
      }
    } catch (err) {
      log.error("[ControlCenter] topMoneyMoves membership query failed:", err);
    }

    // Sort by score desc, pick top 3
    return moves.sort((a, b) => b.score - a.score).slice(0, 3);
  }),
});
