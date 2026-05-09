/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { sendNotification, getDeliveryLog } from "../email-notify";
import { getAnalyticsSnapshots, getBookingServiceBreakdown } from "../db";
import { getDashboardStats, getSiteHealth } from "../admin-stats";
import { z } from "zod";
import { eq, desc, gte, sql } from "drizzle-orm";
import { bookings, leads, callbackRequests, customerNotifications, callEvents } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone, csvSafe } from "../sanitize";
import { saveReviewStatsToDb } from "../google-reviews";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:admin");
export const adminDashboardRouter = router({
  stats: adminProcedure.query(async () => {
    return getDashboardStats();
  }),
  siteHealth: adminProcedure.query(async () => {
    return getSiteHealth();
  }),

  /**
   * Medium-tier OverviewSection bundle — closes admin audit §1.
   * Combines 5 useQuery calls (stats, bookings, leads, callbacks,
   * siteHealth) into a single 30s-cadence query. Each field is
   * nullable so one slow/failing subquery does not break the
   * dashboard. See server/services/adminBundle.ts.
   */
  overviewMediumBundle: adminProcedure.query(async () => {
    const { getOverviewMediumBundle } = await import("../services/adminBundle");
    return getOverviewMediumBundle();
  }),

  /** Full system diagnostics — predictive health, trends, anomalies, recovery history */
  systemDiagnostics: adminProcedure.query(async () => {
    const { generateDiagnosticReport } = await import("../lib/self-healing");
    return generateDiagnosticReport();
  }),

  /** Get recent notification delivery log */
  notificationLog: adminProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      return getDeliveryLog(input?.limit ?? 50);
    }),

  /** Unified sync health check — real API probes for every vendor */
  syncHealth: adminProcedure.query(async () => {
    const { getVendorHealthReport } = await import("../services/vendorHealth");
    const report = await getVendorHealthReport();

    // Map to legacy shape for backward compat with existing UI
    const checks = report.results.map(r => ({
      name: r.vendor,
      status: r.status === "healthy" ? "connected" as const
        : r.status === "not_configured" ? "disconnected" as const
        : r.status === "down" ? "disconnected" as const
        : "degraded" as const,
      details: r.checks.map(c =>
        c.passed ? `${c.name}: OK${c.latencyMs ? ` (${c.latencyMs}ms)` : ""}`
        : `${c.name}: FAIL${c.error ? ` — ${c.error}` : ""}`
      ).join(" | "),
      lastActivity: r.checkedAt,
    }));

    return {
      overallStatus: report.overallStatus,
      checks,
      checkedAt: report.checkedAt,
    };
  }),

  /** Force re-check all vendor health (clears cache) */
  refreshHealth: adminProcedure.mutation(async () => {
    const { clearHealthCache, getVendorHealthReport } = await import("../services/vendorHealth");
    clearHealthCache();
    return getVendorHealthReport();
  }),

  /** Update Google review stats (count/rating) from the admin dashboard */
  updateReviewStats: adminProcedure
    .input(z.object({
      count: z.number().int().min(0).max(100000).optional(),
      rating: z.number().min(1).max(5).optional(),
    }))
    .mutation(async ({ input }) => {
      if (input.count === undefined && input.rating === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide at least count or rating" });
      }
      await saveReviewStatsToDb({ count: input.count, rating: input.rating });
      return { success: true, count: input.count, rating: input.rating };
    }),

  /** Run smoke tests on all integrations */
  smokeTest: adminProcedure.mutation(async () => {
    const { runSmokeTests } = await import("../services/integrationLogger");
    return runSmokeTests();
  }),

  /** Get integration event log */
  integrationLog: adminProcedure
    .input(z.object({
      vendor: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const { getRecentEvents, getEventSummary } = await import("../services/integrationLogger");
      return {
        events: getRecentEvents({ vendor: input?.vendor, limit: input?.limit }),
        summary: getEventSummary(),
      };
    }),

  /**
   * Drilldown — clicking any KPI on the dashboard opens this.
   * Returns the underlying rows that produced the metric so admins
   * can act on the data, not just stare at it.
   *
   * Each `kind` returns a normalized shape:
   *   { title, subtitle?, rows: Array<{ id, primary, secondary, meta?, value? }> }
   * The drawer renders these uniformly + the rows can deep-link.
   */
  drilldown: adminProcedure
    .input(z.object({
      kind: z.enum([
        "cars_in_shop",
        "revenue_today",
        "jobs_closed_today",
        "pending_callbacks",
        "walk_aways",
        "fresh_leads",
        "lapsed_vips",
        "negative_reviews",
        "today_bookings",
        // wave-124 — chat_sessions kind for the Overview "Chat Sessions"
        // card (was firing fresh_leads against wrong table)
        "chat_sessions",
      ]),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const empty = { title: "", subtitle: "", rows: [] as Array<{
        id: string | number;
        primary: string;
        secondary?: string;
        meta?: string;
        value?: string;
        href?: string;
      }> };
      try {
        const { getDb } = await import("../db");
        const d = await getDb();
        if (!d) return empty;
        const { sql, eq, and, gte, isNull, lte, desc } = await import("drizzle-orm");

        switch (input.kind) {
          case "cars_in_shop": {
            const { workOrders } = await import("../../drizzle/schema");
            const rows = await d
              .select({
                id: workOrders.id,
                orderNumber: workOrders.orderNumber,
                vehicleMake: workOrders.vehicleMake,
                vehicleModel: workOrders.vehicleModel,
                vehicleYear: workOrders.vehicleYear,
                status: workOrders.status,
                serviceDescription: workOrders.serviceDescription,
                assignedTech: workOrders.assignedTech,
                createdAt: workOrders.createdAt,
              })
              .from(workOrders)
              .where(sql`${workOrders.status} NOT IN ('invoiced', 'picked_up', 'cancelled')`)
              .orderBy(desc(workOrders.createdAt))
              .limit(input.limit);
            return {
              title: "Cars in Shop",
              subtitle: `${rows.length} active work orders`,
              rows: rows.map((r: { id: string; orderNumber: string; vehicleYear: number | null; vehicleMake: string | null; vehicleModel: string | null; status: string; serviceDescription: string | null; assignedTech: string | null }) => ({
                id: r.id,
                primary: [r.vehicleYear, r.vehicleMake, r.vehicleModel].filter(Boolean).join(" ") || `Order ${r.orderNumber}`,
                secondary: r.assignedTech ? `Tech: ${r.assignedTech}` : `Order ${r.orderNumber}`,
                meta: r.serviceDescription?.slice(0, 80) || "",
                value: r.status.replace(/_/g, " "),
              })),
            };
          }
          case "revenue_today":
          case "jobs_closed_today": {
            const { invoices } = await import("../../drizzle/schema");
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
            const rows = await d
              .select({
                id: invoices.id,
                invoiceNumber: invoices.invoiceNumber,
                customerName: invoices.customerName,
                vehicleInfo: invoices.vehicleInfo,
                totalAmount: invoices.totalAmount,
                paymentStatus: invoices.paymentStatus,
                serviceDescription: invoices.serviceDescription,
              })
              .from(invoices)
              .where(gte(invoices.invoiceDate, todayStart))
              .orderBy(desc(invoices.invoiceDate))
              .limit(input.limit);
            const isRevenue = input.kind === "revenue_today";
            return {
              title: isRevenue ? "Revenue Today" : "Jobs Closed Today",
              subtitle: `${rows.length} invoice${rows.length === 1 ? "" : "s"} since 12:00 AM`,
              rows: rows.map((r: { id: number; invoiceNumber: string | null; customerName: string | null; vehicleInfo: string | null; totalAmount: number; paymentStatus: string; serviceDescription: string | null }) => ({
                id: r.id,
                primary: r.customerName || "Unknown",
                secondary: r.vehicleInfo || "—",
                meta: r.serviceDescription?.slice(0, 80) || r.invoiceNumber || "",
                value: `$${(r.totalAmount / 100).toFixed(0)} · ${r.paymentStatus}`,
              })),
            };
          }
          case "pending_callbacks": {
            const { callbackRequests } = await import("../../drizzle/schema");
            const rows = await d
              .select({
                id: callbackRequests.id,
                name: callbackRequests.name,
                phone: callbackRequests.phone,
                context: callbackRequests.context,
                createdAt: callbackRequests.createdAt,
              })
              .from(callbackRequests)
              .where(sql`${callbackRequests.status} IN ('new', 'pending')`)
              .orderBy(desc(callbackRequests.createdAt))
              .limit(input.limit);
            return {
              title: "Pending Callbacks",
              subtitle: "Customers waiting for a return call. Every hour drops conversion ~10%.",
              rows: rows.map((r: { id: number; name: string; phone: string; context: string | null; createdAt: Date }) => {
                const ageMin = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 60_000);
                const ageLabel = ageMin < 60 ? `${ageMin}m` : ageMin < 1440 ? `${Math.floor(ageMin / 60)}h` : `${Math.floor(ageMin / 1440)}d`;
                return {
                  id: r.id,
                  primary: r.name,
                  secondary: r.phone,
                  meta: r.context?.slice(0, 80) || "",
                  value: `${ageLabel} waiting`,
                };
              }),
            };
          }
          case "walk_aways": {
            const { algEstimates } = await import("../../drizzle/schema");
            const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
            const rows = await d
              .select({
                id: algEstimates.id,
                customerName: algEstimates.customerName,
                customerPhone: algEstimates.customerPhone,
                vehicleInfo: algEstimates.vehicleInfo,
                serviceDescription: algEstimates.serviceDescription,
                estimatedAmount: algEstimates.estimatedAmount,
                estimateDate: algEstimates.estimateDate,
              })
              .from(algEstimates)
              .where(and(
                isNull(algEstimates.matchedInvoiceId),
                gte(algEstimates.estimateDate, sixtyDaysAgo),
              ))
              .orderBy(desc(algEstimates.estimatedAmount))
              .limit(input.limit);
            const total = rows.reduce((s: number, r: { estimatedAmount: number }) => s + r.estimatedAmount, 0);
            return {
              title: "Walk-Away Estimates",
              subtitle: `${rows.length} unmatched · $${Math.round(total / 100).toLocaleString()} on the table`,
              rows: rows.map((r: { id: number; customerName: string; customerPhone: string | null; vehicleInfo: string | null; serviceDescription: string | null; estimatedAmount: number; estimateDate: Date }) => {
                const days = Math.floor((Date.now() - new Date(r.estimateDate).getTime()) / 86_400_000);
                return {
                  id: r.id,
                  primary: r.customerName,
                  secondary: r.customerPhone || r.vehicleInfo || "—",
                  meta: r.serviceDescription?.slice(0, 80) || "",
                  value: `$${Math.round(r.estimatedAmount / 100).toLocaleString()} · ${days}d ago`,
                };
              }),
            };
          }
          case "fresh_leads": {
            const { leads } = await import("../../drizzle/schema");
            const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
            const rows = await d
              .select({
                id: leads.id,
                name: leads.name,
                phone: leads.phone,
                vehicle: leads.vehicle,
                problem: leads.problem,
                urgencyScore: leads.urgencyScore,
                createdAt: leads.createdAt,
              })
              .from(leads)
              .where(and(
                eq(leads.status, "new"),
                gte(leads.createdAt, fourHoursAgo),
              ))
              .orderBy(desc(leads.urgencyScore), desc(leads.createdAt))
              .limit(input.limit);
            return {
              title: "Hot Leads (<4h)",
              subtitle: "Golden response window. Conversion drops 80% after first day.",
              rows: rows.map((r: { id: number; name: string; phone: string; vehicle: string | null; problem: string | null; urgencyScore: number; createdAt: Date }) => ({
                id: r.id,
                primary: r.name,
                secondary: `${r.phone}${r.vehicle ? ` · ${r.vehicle}` : ""}`,
                meta: r.problem?.slice(0, 80) || "",
                value: `urgency ${r.urgencyScore}/5`,
              })),
            };
          }
          // wave-124 — chat_sessions: backs the "Chat Sessions" card on
          // the Overview dashboard. Was incorrectly firing fresh_leads
          // (wrong table) so the drawer always read "Nothing to show"
          // even though the card showed a real count. Now pulls actual
          // chat_sessions rows ordered by createdAt desc, surfacing
          // the AI-extracted vehicle/problem and conversion status.
          case "chat_sessions": {
            const { chatSessions, leads } = await import("../../drizzle/schema");
            // wave-124 — was filtered to last 7 days but the operator's
            // card shows TOTAL sessions all-time. If chat traffic is
            // sparse, a 7d filter renders empty drawer while card shows
            // "17". Now: latest N regardless of age — matches the
            // card's all-time semantics and beats the count-vs-list
            // mismatch the operator reported.
            // Left-join leads so converted sessions show the captured
            // customer name + phone instead of just "Anonymous".
            const rows = await d
              .select({
                id: chatSessions.id,
                createdAt: chatSessions.createdAt,
                vehicleInfo: chatSessions.vehicleInfo,
                problemSummary: chatSessions.problemSummary,
                converted: chatSessions.converted,
                leadId: chatSessions.leadId,
                leadName: leads.name,
                leadPhone: leads.phone,
              })
              .from(chatSessions)
              .leftJoin(leads, eq(chatSessions.leadId, leads.id))
              .orderBy(desc(chatSessions.createdAt))
              .limit(input.limit);
            type ChatRow = {
              id: number;
              createdAt: Date;
              vehicleInfo: string | null;
              problemSummary: string | null;
              converted: number;
              leadId: number | null;
              leadName: string | null;
              leadPhone: string | null;
            };
            return {
              title: "Chat Sessions",
              subtitle: "Latest visitors who interacted with the AI chat — converted ones link to their lead row.",
              rows: (rows as ChatRow[]).map((r) => ({
                id: r.id,
                primary: r.converted && r.leadName
                  ? r.leadName
                  : "Anonymous visitor",
                secondary: r.converted && r.leadPhone
                  ? `${r.leadPhone}${r.vehicleInfo ? ` · ${r.vehicleInfo}` : ""}`
                  : (r.vehicleInfo || "No vehicle captured"),
                meta: r.problemSummary?.slice(0, 100) || "No problem summary",
                value: r.converted ? "→ Lead" : "—",
              })),
            };
          }
          case "lapsed_vips": {
            const { customers } = await import("../../drizzle/schema");
            const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
            const rows = await d
              .select({
                id: customers.id,
                firstName: customers.firstName,
                lastName: customers.lastName,
                phone: customers.phone,
                totalSpent: customers.totalSpent,
                totalVisits: customers.totalVisits,
                lastVisitDate: customers.lastVisitDate,
              })
              .from(customers)
              .where(and(
                sql`${customers.totalSpent} >= 50000`,
                sql`${customers.lastVisitDate} < ${sixMonthsAgo}`,
              ))
              .orderBy(desc(customers.totalSpent))
              .limit(input.limit);
            return {
              title: "Lapsed VIPs",
              subtitle: ">$500 lifetime spend · 6+ months without a visit. Win-back targets.",
              rows: rows.map((r: { id: number; firstName: string | null; lastName: string | null; phone: string | null; totalSpent: number; totalVisits: number; lastVisitDate: Date | null }) => {
                const last = r.lastVisitDate ? Math.floor((Date.now() - new Date(r.lastVisitDate).getTime()) / 86_400_000) : null;
                return {
                  id: r.id,
                  primary: [r.firstName, r.lastName].filter(Boolean).join(" ") || "Customer",
                  secondary: r.phone || "—",
                  meta: `${r.totalVisits} visit${r.totalVisits === 1 ? "" : "s"} lifetime`,
                  value: `$${Math.round(r.totalSpent / 100).toLocaleString()} · ${last}d ago`,
                };
              }),
            };
          }
          case "negative_reviews": {
            const { reviewReplies } = await import("../../drizzle/schema");
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const rows = await d
              .select({
                id: reviewReplies.id,
                reviewerName: reviewReplies.reviewerName,
                reviewRating: reviewReplies.reviewRating,
                reviewText: reviewReplies.reviewText,
                reviewDate: reviewReplies.reviewDate,
                status: reviewReplies.status,
              })
              .from(reviewReplies)
              .where(and(
                lte(reviewReplies.reviewRating, 2),
                gte(reviewReplies.reviewDate, sevenDaysAgo),
              ))
              .orderBy(desc(reviewReplies.reviewDate))
              .limit(input.limit);
            return {
              title: "Negative Reviews (last 7d)",
              subtitle: "Reply within 24h preserves trust score.",
              rows: rows.map((r: { id: number; reviewerName: string | null; reviewRating: number | null; reviewText: string | null; reviewDate: Date | null; status: string | null }) => ({
                id: r.id,
                primary: r.reviewerName || "Anonymous",
                secondary: `${r.reviewRating || "?"}★ · status ${r.status || "draft"}`,
                meta: r.reviewText?.slice(0, 100) || "",
                value: r.reviewDate ? new Date(r.reviewDate).toLocaleDateString() : "",
              })),
            };
          }
          case "today_bookings": {
            const { bookings } = await import("../../drizzle/schema");
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
            const rows = await d
              .select({
                id: bookings.id,
                name: bookings.name,
                phone: bookings.phone,
                vehicle: bookings.vehicle,
                service: bookings.service,
                status: bookings.status,
                preferredTime: bookings.preferredTime,
              })
              .from(bookings)
              .where(sql`${bookings.preferredDate} BETWEEN ${todayStart} AND ${todayEnd}`)
              .orderBy(desc(bookings.createdAt))
              .limit(input.limit);
            return {
              title: "Today's Bookings",
              subtitle: `${rows.length} booking${rows.length === 1 ? "" : "s"} expected today`,
              rows: rows.map((r: { id: number; name: string; phone: string; vehicle: string | null; service: string; status: string; preferredTime: string }) => ({
                id: r.id,
                primary: r.name,
                secondary: `${r.phone} · ${r.vehicle || "—"}`,
                meta: r.service,
                value: `${r.status} · ${r.preferredTime}`,
              })),
            };
          }
          default:
            return empty;
        }
      } catch (err) {
        return { ...empty, title: "Error", subtitle: err instanceof Error ? err.message : "Drilldown failed" };
      }
    }),

  /**
   * Today's Brief — top actionable items right now. Powers the
   * intelligence strip at top of Overview ("here's what to do now").
   *
   * Pulls from multiple signals + ranks by urgency × $ value:
   *   - Pending callbacks (lost calls waiting for return)
   *   - New leads under 4 hours (golden response window)
   *   - No-show risk bookings today
   *   - Walk-away ALG estimates with high $ value
   *   - Negative reviews from last 7d (need response)
   *   - Specials expiring soon
   */
  todaysBrief: adminProcedure.query(async () => {
    const briefs: Array<{
      id: string;
      variant: "primary" | "warning" | "danger" | "info" | "success";
      icon: string;
      message: string;
      metric: string;
      cta: { label: string; section: string; settingsTab?: string };
      score: number;
    }> = [];

    try {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) return { briefs: [], generatedAt: new Date().toISOString() };

      const { callbackRequests, leads, bookings, algEstimates, reviewReplies, specials } = await import("../../drizzle/schema");
      const { sql, eq, and, gte, lte, isNull } = await import("drizzle-orm");

      // 1. Pending callbacks (highest urgency — every minute = lost trust)
      try {
        const cb = await d
          .select({ count: sql<number>`count(*)` })
          .from(callbackRequests)
          .where(sql`${callbackRequests.status} IN ('new', 'pending')`);
        const cbCount = Number(cb[0]?.count || 0);
        if (cbCount > 0) {
          briefs.push({
            id: "callbacks",
            variant: "danger",
            icon: "phone",
            message: `Customers waiting for a call back. Every hour drops conversion ~10%.`,
            metric: `${cbCount} callback${cbCount === 1 ? "" : "s"} pending`,
            cta: { label: "Call them", section: "callTrackingView" },
            score: 100 + cbCount * 5,
          });
        }
      } catch (e) { log.warn("[todaysBrief] callbacks check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // 2. Fresh leads in golden response window (<4h)
      try {
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const fl = await d
          .select({ count: sql<number>`count(*)` })
          .from(leads)
          .where(and(
            eq(leads.status, "new"),
            gte(leads.createdAt, fourHoursAgo),
          ));
        const flCount = Number(fl[0]?.count || 0);
        if (flCount > 0) {
          briefs.push({
            id: "fresh_leads",
            variant: "warning",
            icon: "users",
            message: `Fresh leads under 4 hours old — close them before they shop around.`,
            metric: `${flCount} hot lead${flCount === 1 ? "" : "s"}`,
            cta: { label: "Open Leads", section: "leads" },
            score: 90 + flCount * 3,
          });
        }
      } catch (e) { log.warn("[todaysBrief] fresh leads check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // 3. Walk-away ALG estimates with high $
      try {
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const wa = await d
          .select({
            count: sql<number>`count(*)`,
            total: sql<number>`COALESCE(SUM(${algEstimates.estimatedAmount}), 0)`,
          })
          .from(algEstimates)
          .where(and(
            isNull(algEstimates.matchedInvoiceId),
            gte(algEstimates.estimateDate, sixtyDaysAgo),
          ));
        const waCount = Number(wa[0]?.count || 0);
        const waTotal = Math.round(Number(wa[0]?.total || 0) / 100);
        if (waCount >= 3 && waTotal >= 500) {
          briefs.push({
            id: "walkaway",
            variant: "primary",
            icon: "dollar",
            message: `Walked-away estimates from last 60 days. SMS recovery cron targets these (currently DRY-RUN — set env flag).`,
            metric: `$${waTotal.toLocaleString()} on the table`,
            cta: { label: "Open Declined Work", section: "declinedEstimates" },
            score: 80 + Math.min(20, Math.round(waTotal / 100)),
          });
        }
      } catch (e) { log.warn("[todaysBrief] walk-away estimates check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // 4. Negative reviews needing response (last 7d, ≤2 stars)
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const neg = await d
          .select({ count: sql<number>`count(*)` })
          .from(reviewReplies)
          .where(and(
            lte(reviewReplies.reviewRating, 2),
            gte(reviewReplies.reviewDate, sevenDaysAgo),
            sql`(${reviewReplies.status} IS NULL OR ${reviewReplies.status} IN ('draft', 'pending'))`,
          ));
        const negCount = Number(neg[0]?.count || 0);
        if (negCount > 0) {
          briefs.push({
            id: "neg_reviews",
            variant: "danger",
            icon: "star",
            message: `Negative reviews waiting for response. Public response within 24h preserves trust score.`,
            metric: `${negCount} review${negCount === 1 ? "" : "s"} pending`,
            cta: { label: "Open Re-engagement", section: "reEngagement" },
            score: 95 + negCount * 5,
          });
        }
      } catch (e) { log.warn("[todaysBrief] negative reviews check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // 5. Bookings today that haven't been confirmed
      try {
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
        const tb = await d
          .select({ count: sql<number>`count(*)` })
          .from(bookings)
          .where(and(
            sql`${bookings.preferredDate} BETWEEN ${todayStart} AND ${todayEnd}`,
            eq(bookings.status, "new"),
          ));
        const tbCount = Number(tb[0]?.count || 0);
        if (tbCount > 0) {
          briefs.push({
            id: "today_bookings",
            variant: "warning",
            icon: "calendar",
            message: `Bookings dropping in today still unconfirmed. Confirm to lock the slot + reduce no-shows.`,
            metric: `${tbCount} booking${tbCount === 1 ? "" : "s"} unconfirmed`,
            cta: { label: "Open Dashboard", section: "overview" },
            score: 85 + tbCount * 4,
          });
        }
      } catch (e) { log.warn("[todaysBrief] today bookings check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // 6. Specials expiring within 3 days
      try {
        const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        const exp = await d
          .select({
            id: specials.id,
            title: specials.title,
            expiresAt: specials.expiresAt,
          })
          .from(specials)
          .where(and(
            eq(specials.isActive, true),
            sql`${specials.expiresAt} IS NOT NULL`,
            sql`${specials.expiresAt} <= ${threeDaysFromNow}`,
            sql`${specials.expiresAt} > NOW()`,
          ))
          .limit(3);
        if (exp.length > 0) {
          briefs.push({
            id: "specials_expiring",
            variant: "info",
            icon: "tag",
            message: `Active special${exp.length === 1 ? "" : "s"} expiring soon: ${exp.map((s: { title: string }) => s.title).join(", ")}. Renew or replace.`,
            metric: `${exp.length} expiring`,
            cta: { label: "Open Content", section: "content" },
            score: 50 + exp.length * 2,
          });
        }
      } catch (e) { log.warn("[todaysBrief] expiring specials check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // Sort by score (highest urgency first), cap at 5
      briefs.sort((a, b) => b.score - a.score);
      return {
        briefs: briefs.slice(0, 5),
        totalFlagged: briefs.length,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      // Never crash the UI — return empty briefs on error
      return {
        briefs: [],
        totalFlagged: 0,
        generatedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : "Failed to compute brief",
      };
    }
  }),

  /**
   * Section Insight — single actionable callout for a specific admin
   * section. Returns the highest-priority signal RELEVANT TO THAT SECTION,
   * not the global Today's Brief.
   *
   * Used by the InsightStrip primitive at the top of each section so
   * Nour sees "for Customers: 12 lapsed VIPs need outreach" or "for
   * Revenue: MTD pace is 8% behind".
   *
   * Returns null when no actionable signal — section just renders no strip.
   */
  sectionInsight: adminProcedure
    .input(z.object({
      section: z.enum([
        "customers", "revenue", "leads", "campaigns", "callTrackingView",
        "declinedEstimates", "noShowRisk", "reEngagement", "content",
        "intelligence", "settings", "trafficFunnel", "snapDashboard",
      ]),
    }))
    .query(async ({ input }) => {
      try {
        const { getDb } = await import("../db");
        const d = await getDb();
        if (!d) return null;
        const { sql, eq, and, gte, isNull } = await import("drizzle-orm");

        switch (input.section) {
          case "customers": {
            // Lapsed VIP customers — high LTV, haven't visited in 6+ months
            try {
              const { customers } = await import("../../drizzle/schema");
              const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
              const [vipLapsed] = await d
                .select({ count: sql<number>`count(*)` })
                .from(customers)
                .where(and(
                  sql`${customers.totalSpent} >= 50000`, // $500+ lifetime spend (cents)
                  sql`${customers.lastVisitDate} < ${sixMonthsAgo}`,
                ));
              const cnt = Number(vipLapsed?.count || 0);
              if (cnt >= 3) {
                return {
                  variant: "primary" as const,
                  message: `Lapsed VIPs (>$500 lifetime, no visit in 6+ months) — these are your highest-LTV winback targets.`,
                  metric: `${cnt} VIPs lapsed`,
                  cta: { label: "Run Win-Back", section: "reEngagement" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "revenue": {
            // MTD pace vs target
            try {
              const { invoices } = await import("../../drizzle/schema");
              const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
              const dayOfMonth = new Date().getDate();
              const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
              const [mtd] = await d
                .select({ total: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)` })
                .from(invoices)
                .where(and(
                  gte(invoices.invoiceDate, monthStart),
                  eq(invoices.paymentStatus, "paid"),
                ));
              const mtdRevenue = Number(mtd?.total || 0) / 100;
              const targetMonthly = 60000; // baseline target
              const expectedAtThisPoint = (targetMonthly * dayOfMonth) / daysInMonth;
              const pace = mtdRevenue / expectedAtThisPoint;
              if (pace < 0.85 && dayOfMonth > 7) {
                const gap = Math.round(expectedAtThisPoint - mtdRevenue);
                return {
                  variant: "warning" as const,
                  message: `Revenue MTD is below pace for monthly target. Push specials, fire win-back, follow up declined work.`,
                  metric: `~$${gap.toLocaleString()} behind pace`,
                  cta: { label: "Open Outreach", section: "campaigns" },
                };
              }
              if (pace > 1.15) {
                return {
                  variant: "success" as const,
                  message: `MTD revenue is running ahead of pace — strong month so far.`,
                  metric: `+${Math.round((pace - 1) * 100)}% vs target`,
                  cta: { label: "See Details", section: "revenue" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "leads": {
            // Stale unactioned leads
            try {
              const { leads } = await import("../../drizzle/schema");
              const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
              const [stale] = await d
                .select({ count: sql<number>`count(*)` })
                .from(leads)
                .where(and(
                  eq(leads.status, "new"),
                  sql`${leads.createdAt} < ${oneDayAgo}`,
                ));
              const cnt = Number(stale?.count || 0);
              if (cnt > 0) {
                return {
                  variant: "warning" as const,
                  message: `Leads sitting unactioned for 24+ hours. Conversion drops 80% after the first day.`,
                  metric: `${cnt} stale lead${cnt === 1 ? "" : "s"}`,
                  cta: { label: "Open Leads", section: "leads" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "callTrackingView": {
            // Pending callbacks
            try {
              const { callbackRequests } = await import("../../drizzle/schema");
              const [pending] = await d
                .select({ count: sql<number>`count(*)` })
                .from(callbackRequests)
                .where(sql`${callbackRequests.status} IN ('new', 'pending')`);
              const cnt = Number(pending?.count || 0);
              if (cnt > 0) {
                return {
                  variant: "danger" as const,
                  message: `Customers waiting for a return call. Every hour drops conversion ~10%.`,
                  metric: `${cnt} callback${cnt === 1 ? "" : "s"} pending`,
                  cta: { label: "Call them", section: "callTrackingView" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "declinedEstimates": {
            // Walk-aways pending recovery
            try {
              const { algEstimates } = await import("../../drizzle/schema");
              const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
              const [wa] = await d
                .select({
                  count: sql<number>`count(*)`,
                  total: sql<number>`COALESCE(SUM(${algEstimates.estimatedAmount}), 0)`,
                })
                .from(algEstimates)
                .where(and(
                  isNull(algEstimates.matchedInvoiceId),
                  gte(algEstimates.estimateDate, sixtyDaysAgo),
                ));
              const cnt = Number(wa?.count || 0);
              const total = Math.round(Number(wa?.total || 0) / 100);
              if (cnt > 0) {
                return {
                  variant: "primary" as const,
                  message: `Walked-away estimates from last 60 days. SMS recovery cron targets these — set FEATURE_DECLINED_RECOVERY=1 to activate.`,
                  metric: `$${total.toLocaleString()} recoverable`,
                  cta: { label: "See Status", section: "settings", settingsTab: "shopdriver" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "reEngagement": {
            // Negative reviews from last 7 days
            try {
              const { reviewReplies } = await import("../../drizzle/schema");
              const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
              const [neg] = await d
                .select({ count: sql<number>`count(*)` })
                .from(reviewReplies)
                .where(and(
                  sql`${reviewReplies.reviewRating} <= 2`,
                  gte(reviewReplies.reviewDate, sevenDaysAgo),
                  sql`(${reviewReplies.status} IS NULL OR ${reviewReplies.status} IN ('draft', 'pending'))`,
                ));
              const cnt = Number(neg?.count || 0);
              if (cnt > 0) {
                return {
                  variant: "danger" as const,
                  message: `Negative reviews waiting for response. Public reply within 24h preserves trust score.`,
                  metric: `${cnt} review${cnt === 1 ? "" : "s"}`,
                  cta: { label: "Open Re-engagement", section: "reEngagement" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "settings": {
            // ALG mirror health + env-flag status
            const featureRecovery = process.env.FEATURE_DECLINED_RECOVERY === "1";
            const vapiKey = !!process.env.VAPI_API_KEY;
            if (!featureRecovery && vapiKey) {
              return {
                variant: "info" as const,
                message: `Vapi receptionist is connected. FEATURE_DECLINED_RECOVERY is still off — flip it to activate the SMS recovery cron for walk-away estimates.`,
                metric: "1 env flag pending",
                cta: { label: "ShopDriver HQ", section: "settings", settingsTab: "shopdriver" },
              };
            }
            return null;
          }
          default:
            return null;
        }
      } catch (err) {
        return null;
      }
    }),
});

export const analyticsRouter = router({
  snapshots: adminProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input }) => {
      return getAnalyticsSnapshots(input?.days ?? 30);
    }),
  serviceBreakdown: adminProcedure.query(async () => {
    return getBookingServiceBreakdown();
  }),
  funnel: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { bookings: 0, leads: 0, completed: 0, converted: 0 };
    const [bookingCount] = await d.select({ count: sql<number>`count(*)` }).from(bookings);
    const [leadCount] = await d.select({ count: sql<number>`count(*)` }).from(leads);
    const [completedCount] = await d.select({ count: sql<number>`count(*)` }).from(bookings).where(eq(bookings.status, "completed"));
    const [convertedCount] = await d.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.status, "booked"));
    return {
      bookings: bookingCount?.count ?? 0,
      leads: leadCount?.count ?? 0,
      completed: completedCount?.count ?? 0,
      converted: convertedCount?.count ?? 0,
    };
  }),
});

export const followUpsRouter = router({
  run: adminProcedure.mutation(async () => {
    const { runFollowUps } = await import("../follow-ups");
    return runFollowUps();
  }),
  pending: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    return d.select().from(customerNotifications)
      .where(eq(customerNotifications.status, "pending"))
      .orderBy(desc(customerNotifications.createdAt))
      .limit(50);
  }),
  recent: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    return d.select().from(customerNotifications)
      .orderBy(desc(customerNotifications.createdAt))
      .limit(50);
  }),
  // wave-115 — per-item cancel: marks a pending follow-up as "skipped"
  // so it never sends. Useful when the customer already called back or
  // the booking was canceled.
  cancel: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await d.select().from(customerNotifications)
        .where(eq(customerNotifications.id, input.id)).limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Follow-up not found" });
      }
      if (existing.status !== "pending") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Can only cancel pending follow-ups (this one is "${existing.status}")`,
        });
      }
      await d.update(customerNotifications)
        .set({ status: "skipped" })
        .where(eq(customerNotifications.id, input.id));
      return { ok: true as const, id: input.id };
    }),
  // wave-115 — per-item retry: takes a "failed" follow-up and re-queues
  // it as "pending" so the next runFollowUps() picks it up. Idempotent —
  // does nothing on already-pending or already-sent rows.
  retry: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await d.select().from(customerNotifications)
        .where(eq(customerNotifications.id, input.id)).limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Follow-up not found" });
      }
      if (existing.status !== "failed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Can only retry failed follow-ups (this one is "${existing.status}")`,
        });
      }
      await d.update(customerNotifications)
        .set({ status: "pending" })
        .where(eq(customerNotifications.id, input.id));
      return { ok: true as const, id: input.id };
    }),
});

export const weeklyReportRouter = router({
  generate: adminProcedure.mutation(async () => {
    const d = await db();
    if (!d) return { error: "Database not available" };

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const weekBookings = await d.select().from(bookings)
      .where(gte(bookings.createdAt, weekAgo))
      .orderBy(desc(bookings.createdAt));

    const weekLeads = await d.select().from(leads)
      .where(gte(leads.createdAt, weekAgo))
      .orderBy(desc(leads.createdAt));

    const weekCallbacks = await d.select().from(callbackRequests)
      .where(gte(callbackRequests.createdAt, weekAgo))
      .orderBy(desc(callbackRequests.createdAt));

    const weekNotifs = await d.select().from(customerNotifications)
      .where(gte(customerNotifications.createdAt, weekAgo));

    type Booking = typeof weekBookings[number];
    type Lead = typeof weekLeads[number];
    type Callback = typeof weekCallbacks[number];
    type Notif = typeof weekNotifs[number];

    const serviceBreakdown: Record<string, number> = {};
    weekBookings.forEach((b: Booking) => {
      serviceBreakdown[b.service] = (serviceBreakdown[b.service] || 0) + 1;
    });

    const urgencyBreakdown: Record<string, number> = {};
    weekBookings.forEach((b: Booking) => {
      const u = b.urgency || "whenever";
      urgencyBreakdown[u] = (urgencyBreakdown[u] || 0) + 1;
    });

    const report = {
      period: { start: weekAgo.toISOString(), end: now.toISOString() },
      bookings: {
        total: weekBookings.length,
        completed: weekBookings.filter((b: Booking) => b.status === "completed").length,
        cancelled: weekBookings.filter((b: Booking) => b.status === "cancelled").length,
        emergency: weekBookings.filter((b: Booking) => b.urgency === "emergency").length,
        serviceBreakdown,
        urgencyBreakdown,
      },
      leads: {
        total: weekLeads.length,
        highUrgency: weekLeads.filter((l: Lead) => l.urgencyScore >= 4).length,
        converted: weekLeads.filter((l: Lead) => l.status === "booked").length,
        sources: weekLeads.reduce((acc: Record<string, number>, l: Lead) => { acc[l.source] = (acc[l.source] || 0) + 1; return acc; }, {} as Record<string, number>),
      },
      callbacks: {
        total: weekCallbacks.length,
        completed: weekCallbacks.filter((c: Callback) => c.status === "completed").length,
        pending: weekCallbacks.filter((c: Callback) => c.status === "new").length,
      },
      notifications: {
        sent: weekNotifs.filter((n: Notif) => n.status === "sent").length,
        pending: weekNotifs.filter((n: Notif) => n.status === "pending").length,
      },
    };

    const topServices = Object.entries(serviceBreakdown)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([s, c]) => `  ${s}: ${c}`)
      .join("\n");

    sendNotification({
      category: "weekly_report",
      subject: `Weekly Report: ${weekBookings.length} bookings, ${weekLeads.length} leads`,
      body: `NICK'S TIRE & AUTO — WEEKLY INTELLIGENCE REPORT\n${"-".repeat(50)}\nPeriod: ${weekAgo.toLocaleDateString()} — ${now.toLocaleDateString()}\n\nBOOKINGS: ${report.bookings.total} total\n  Completed: ${report.bookings.completed}\n  Emergency: ${report.bookings.emergency}\n  Cancelled: ${report.bookings.cancelled}\n\nTop Services:\n${topServices || "  No bookings this week"}\n\nLEADS: ${report.leads.total} total\n  High Urgency: ${report.leads.highUrgency}\n  Converted to Booking: ${report.leads.converted}\n\nCALLBACKS: ${report.callbacks.total} total\n  Completed: ${report.callbacks.completed}\n  Still Pending: ${report.callbacks.pending}\n\nFOLLOW-UPS SENT: ${report.notifications.sent}\nFOLLOW-UPS PENDING: ${report.notifications.pending}`,
    }).catch((e) => { log.warn("[routers/admin] fire-and-forget failed:", e); });

    return report;
  }),
});

// ─── CALL REVIEW REQUEST (auto-SMS after call CTA) ────
/**
 * Schedule a review request SMS 2 hours after someone clicks a Call CTA.
 * Uses the existing review request infrastructure (createReviewRequest + processQueue cron).
 * Gated behind the `sms_review_requests` feature flag.
 */
async function scheduleCallReviewRequest(phoneNumber: string): Promise<void> {
  const { isEnabled } = await import("../services/featureFlags");
  if (!(await isEnabled("sms_review_requests"))) return;

  const { isPhoneOnReviewCooldown, createReviewRequest, getReviewSettings } = await import("../db");
  const crypto = await import("crypto");

  const digits = phoneNumber.replace(/\D/g, "");
  const normalizedPhone = digits.slice(-10);
  if (normalizedPhone.length !== 10) return;

  const settings = await getReviewSettings();
  if (!settings.enabled) return;

  // Check cooldown — don't spam people who already got a review request
  const onCooldown = await isPhoneOnReviewCooldown(normalizedPhone, settings.cooldownDays);
  if (onCooldown) return;

  // Schedule 2 hours from now
  const scheduledAt = new Date();
  scheduledAt.setMinutes(scheduledAt.getMinutes() + 120);

  const trackingToken = crypto.randomBytes(24).toString("hex");

  await createReviewRequest({
    bookingId: 0, // no booking — triggered by call CTA
    customerName: "Caller",
    phone: normalizedPhone,
    service: "Phone Inquiry",
    status: "pending",
    scheduledAt,
    trackingToken,
  });

  console.info(`[calltracking:review] Scheduled for ${normalizedPhone} at ${scheduledAt.toISOString()}`);
}

// ─── CALL TRACKING ─────────────────────────────────────
export const callTrackingRouter = router({
  /** Log a phone click event from the frontend */
  logCall: publicProcedure
    // NULLISH fields — frontend sends `null` when UTM is absent.
    // Previous `.optional()` only allowed missing keys, not `null` values,
    // which made the whole payload fail validation and meant we had
    // ZERO rows in call_events despite active phone-click instrumentation.
    .input(z.object({
      phoneNumber: z.string().max(20),
      sourcePage: z.string().max(500).nullish(),
      clickElement: z.string().max(200).nullish(),
      utmSource: z.string().max(100).nullish(),
      utmMedium: z.string().max(100).nullish(),
      utmCampaign: z.string().max(255).nullish(),
      landingPage: z.string().max(500).nullish(),
      referrer: z.string().max(500).nullish(),
      userAgent: z.string().max(500).nullish(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };
      try {
        await d.insert(callEvents).values({
          phoneNumber: input.phoneNumber,
          sourcePage: input.sourcePage || null,
          clickElement: input.clickElement || null,
          utmSource: input.utmSource || null,
          utmMedium: input.utmMedium || null,
          utmCampaign: input.utmCampaign || null,
          landingPage: input.landingPage || null,
          referrer: input.referrer || null,
          userAgent: input.userAgent || null,
        });

        // Schedule review request SMS 2 hours after call CTA click
        // Gated behind sms_review_requests feature flag
        scheduleCallReviewRequest(input.phoneNumber).catch((err) => {
          log.error("[CallTracking] Review request scheduling failed:", err);
        });

        return { success: true };
      } catch (err) {
        log.error("[CallTracking] Error logging call:", err);
        return { success: false };
      }
    }),

  /** Get all call events (admin) */
  list: adminProcedure
    .input(z.object({ limit: z.number().default(100) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      return d.select().from(callEvents)
        .orderBy(desc(callEvents.createdAt))
        .limit(input?.limit ?? 100);
    }),
});

// ─── CUSTOMER EVENTS — generic visual/interaction event log ─────────
/**
 * Generic event sink for the customer-facing site (PhotoRibbon photo
 * views, sticky-CTA Hold-A-Bay clicks, scroll-depth milestones, etc.).
 * Pairs with callTracking — that one is phone-only; this is everything
 * else. Public log, admin summary.
 */
export const customerEventsRouter = router({
  /** Log a customer-facing event from the frontend */
  log: publicProcedure
    .input(z.object({
      eventName: z.string().min(1).max(64),
      eventData: z.record(z.string(), z.unknown()).optional(),
      sourcePage: z.string().max(500).nullish(),
      utmSource: z.string().max(100).nullish(),
      utmMedium: z.string().max(100).nullish(),
      utmCampaign: z.string().max(255).nullish(),
      referrer: z.string().max(500).nullish(),
      userAgent: z.string().max(500).nullish(),
      sessionId: z.string().max(64).nullish(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };
      try {
        const { customerEvents } = await import("../../drizzle/schema");
        await d.insert(customerEvents).values({
          eventName: input.eventName,
          eventData: (input.eventData ?? null) as unknown as object,
          sourcePage: input.sourcePage || null,
          utmSource: input.utmSource || null,
          utmMedium: input.utmMedium || null,
          utmCampaign: input.utmCampaign || null,
          referrer: input.referrer || null,
          userAgent: input.userAgent || null,
          sessionId: input.sessionId || null,
        });
        return { success: true };
      } catch (err) {
        log.error("[CustomerEvents] Error logging event:", err);
        return { success: false };
      }
    }),

  /** Per-event totals + last-N-day series for the admin dashboard.
   *  Keep response small — full timeline lives in `recent` if needed. */
  summary: adminProcedure
    .input(z.object({
      days: z.number().min(1).max(180).default(30),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { totals: [], recent: [], days: 30 };
      const { customerEvents } = await import("../../drizzle/schema");
      const days = input?.days ?? 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const { sql, gte } = await import("drizzle-orm");

      // Per-event totals over the window
      const totalsRows = await d
        .select({
          eventName: customerEvents.eventName,
          count: sql<number>`COUNT(*)`,
        })
        .from(customerEvents)
        .where(gte(customerEvents.createdAt, since))
        .groupBy(customerEvents.eventName)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(20);

      // Most-recent 50 events for the dashboard "live tail"
      const recent = await d
        .select()
        .from(customerEvents)
        .orderBy(desc(customerEvents.createdAt))
        .limit(50);

      return {
        totals: totalsRows.map((r: typeof totalsRows[number]) => ({
          eventName: r.eventName,
          count: Number(r.count),
        })),
        recent,
        days,
      };
    }),

  /** Top photos in PhotoRibbon by view count — supports the admin
   *  "which photos are working?" question for content tuning. */
  topRibbonPhotos: adminProcedure
    .input(z.object({
      days: z.number().min(1).max(180).default(30),
      limit: z.number().min(1).max(50).default(20),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      const { customerEvents } = await import("../../drizzle/schema");
      const days = input?.days ?? 30;
      const limit = input?.limit ?? 20;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const { sql, and, eq, gte } = await import("drizzle-orm");

      // Pull JSON.src from eventData. MySQL's JSON_EXTRACT works here
      // because we typed the column as `json`. Drizzle's runtime helper
      // is overkill — raw sql is fine and indexable on (eventName,
      // createdAt) which is the access pattern.
      const rows = await d
        .select({
          src: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${customerEvents.eventData}, '$.src'))`,
          count: sql<number>`COUNT(*)`,
        })
        .from(customerEvents)
        .where(and(
          eq(customerEvents.eventName, "ribbon_photo_view"),
          gte(customerEvents.createdAt, since),
        ))
        .groupBy(sql`JSON_UNQUOTE(JSON_EXTRACT(${customerEvents.eventData}, '$.src'))`)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit);

      return rows.map((r: typeof rows[number]) => ({
        src: r.src,
        count: Number(r.count),
      }));
    }),
});

// ─── DATA EXPORT ───────────────────────────────────────
export const exportRouter = router({
  bookings: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(bookings).orderBy(desc(bookings.createdAt)).limit(10000);
    const headers = ["ID", "Name", "Phone", "Email", "Service", "Vehicle", "Status", "Urgency", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map((r: typeof rows[number]) => [
      r.id, csvSafe(r.name), csvSafe(r.phone), csvSafe(r.email), csvSafe(r.service), csvSafe(r.vehicle), r.status, r.urgency || "",
      csvSafe(r.utmSource), csvSafe(r.utmMedium), csvSafe(r.utmCampaign), csvSafe(r.landingPage), csvSafe(r.referrer),
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),

  leads: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(leads).orderBy(desc(leads.createdAt)).limit(10000);
    const headers = ["ID", "Name", "Phone", "Email", "Source", "Problem", "Urgency Score", "Status", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map((r: typeof rows[number]) => [
      r.id, csvSafe(r.name), csvSafe(r.phone), csvSafe(r.email), r.source, csvSafe(r.problem), r.urgencyScore ?? "", r.status,
      csvSafe(r.utmSource), csvSafe(r.utmMedium), csvSafe(r.utmCampaign), csvSafe(r.landingPage), csvSafe(r.referrer),
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),

  calls: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(callEvents).orderBy(desc(callEvents.createdAt)).limit(10000);
    const headers = ["ID", "Phone Number", "Source Page", "Click Element", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map((r: typeof rows[number]) => [
      r.id, csvSafe(r.phoneNumber), csvSafe(r.sourcePage), csvSafe(r.clickElement),
      csvSafe(r.utmSource), csvSafe(r.utmMedium), csvSafe(r.utmCampaign), csvSafe(r.landingPage), csvSafe(r.referrer),
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),

  callbacks: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(callbackRequests).orderBy(desc(callbackRequests.createdAt)).limit(10000);
    const headers = ["ID", "Name", "Phone", "Context", "Source Page", "Status", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map((r: typeof rows[number]) => [
      r.id, csvSafe(r.name), csvSafe(r.phone), csvSafe(r.context), csvSafe(r.sourcePage), r.status,
      csvSafe(r.utmSource), csvSafe(r.utmMedium), csvSafe(r.utmCampaign), csvSafe(r.landingPage), csvSafe(r.referrer),
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),
});
