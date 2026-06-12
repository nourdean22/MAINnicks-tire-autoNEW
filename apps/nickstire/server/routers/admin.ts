/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { sendNotification, getDeliveryLog } from "../email-notify";
import { getAnalyticsSnapshots, getBookingServiceBreakdown } from "../db";
import { getDashboardStats, getSiteHealth } from "../admin-stats";
import { z } from "zod";
import { eq, ne, desc, gte, sql, inArray, and, isNull } from "drizzle-orm";
import { bookings, leads, callbackRequests, customerNotifications, callEvents } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone, csvSafe } from "../sanitize";
import { saveReviewStatsToDb } from "../google-reviews";

import { db } from "../lib/db-helper";
import { BoundedTtlMap } from "../lib/boundedTtlMap";

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

  /**
   * Recent integration failures (read-only) — sheets_sync / email / sms / capi /
   * review_request / reminders / invoice. Surfaces silent breakage that can lose
   * leads. Returns SAFE fields only: the raw errorDetails payload is never
   * exposed and the message is scrubbed of key/token text.
   * See server/integration-failures.ts:getRecentIntegrationFailures.
   */
  integrationFailures: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(async ({ input }) => {
      const { getRecentIntegrationFailures } = await import("../integration-failures");
      return getRecentIntegrationFailures(input?.limit ?? 30);
    }),

  /**
   * Meta CAPI configuration status (read-only, booleans ONLY — env values
   * are never returned). Lets the owner see dormant-vs-active on Site
   * Health instead of asking. Activation runbook:
   * docs/runbooks/CAPI-ACTIVATION.md.
   */
  capiStatus: adminProcedure.query(() => ({
    tokenConfigured: Boolean(process.env.META_CAPI_ACCESS_TOKEN),
    pixelIdOverridden: Boolean(process.env.META_CAPI_PIXEL_ID),
  })),

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
        // wave-125 — intake_today: unified feed across all 5 sources
        // (leads, callbacks, chat sessions, bookings, vapi calls) in
        // time order. Closes the "what came in today" gap.
        "intake_today",
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
                // wave-168: redact phone to last-4 in drilldown rows. Admin
                // surface is screen-shared / phone-mirrored / browser-extension-
                // scrapable; full PII shouldn't ride in listing payloads. The
                // detail panel can fetch full info on demand.
                const tail = r.phone ? r.phone.slice(-4) : "";
                return {
                  id: r.id,
                  primary: r.name,
                  secondary: tail ? `•••${tail}` : "",
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
          // wave-125 — intake_today: unified feed across 5 sources.
          // Operator's answer to "what came in today" without hopping
          // between Leads, CallTracking, and Overview. Each source is
          // queried separately and merged in JS by createdAt desc since
          // the tables differ in shape (no clean SQL UNION). 24h window.
          case "intake_today": {
            const { leads, callbackRequests, chatSessions, bookings, vapiCallLogs } = await import("../../drizzle/schema");
            const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            // Query each source. Each returns a {createdAt, kind, ...} shape.
            const [leadRows, callbackRows, chatRows, bookingRows, vapiRows] = await Promise.all([
              d.select({ id: leads.id, name: leads.name, phone: leads.phone, source: leads.source, problem: leads.problem, urgencyScore: leads.urgencyScore, createdAt: leads.createdAt })
                .from(leads).where(gte(leads.createdAt, dayAgo)).orderBy(desc(leads.createdAt)).limit(50),
              d.select({ id: callbackRequests.id, name: callbackRequests.name, phone: callbackRequests.phone, context: callbackRequests.context, sourcePage: callbackRequests.sourcePage, createdAt: callbackRequests.createdAt })
                .from(callbackRequests).where(gte(callbackRequests.createdAt, dayAgo)).orderBy(desc(callbackRequests.createdAt)).limit(50),
              d.select({ id: chatSessions.id, vehicleInfo: chatSessions.vehicleInfo, problemSummary: chatSessions.problemSummary, converted: chatSessions.converted, createdAt: chatSessions.createdAt })
                .from(chatSessions).where(gte(chatSessions.createdAt, dayAgo)).orderBy(desc(chatSessions.createdAt)).limit(50),
              d.select({ id: bookings.id, name: bookings.name, phone: bookings.phone, service: bookings.service, status: bookings.status, createdAt: bookings.createdAt })
                .from(bookings).where(gte(bookings.createdAt, dayAgo)).orderBy(desc(bookings.createdAt)).limit(50),
              // vapi_call_logs may not exist yet (pre-migration); defensive try/catch.
              d.select({ id: vapiCallLogs.id, customerName: vapiCallLogs.customerName, phoneNumber: vapiCallLogs.phoneNumber, aiSummary: vapiCallLogs.aiSummary, serviceMention: vapiCallLogs.serviceMention, durationSeconds: vapiCallLogs.durationSeconds, createdAt: vapiCallLogs.createdAt })
                .from(vapiCallLogs).where(gte(vapiCallLogs.createdAt, dayAgo)).orderBy(desc(vapiCallLogs.createdAt)).limit(50)
                .catch(() => []),
            ]);
            // Merge into a single unified shape
            type Unified = { id: string; primary: string; secondary?: string; meta?: string; value?: string; createdAt: Date };
            const merged: Unified[] = [
              ...(leadRows as Array<{ id: number; name: string; phone: string; source: string; problem: string | null; urgencyScore: number; createdAt: Date }>).map((r) => ({
                id: `lead-${r.id}`,
                primary: r.name,
                // wave-168: phone tail-redacted in intake feed; full phone is
                // pulled by the detail view on click.
                secondary: `LEAD · ${r.source} · •••${r.phone ? r.phone.slice(-4) : ""}`,
                meta: r.problem?.slice(0, 80) ?? "",
                value: `urg ${r.urgencyScore}/5`,
                createdAt: r.createdAt,
              })),
              ...(callbackRows as Array<{ id: number; name: string; phone: string; context: string | null; sourcePage: string | null; createdAt: Date }>).map((r) => ({
                id: `cb-${r.id}`,
                primary: r.name,
                secondary: `CALLBACK · •••${r.phone ? r.phone.slice(-4) : ""}${r.sourcePage ? ` · from ${r.sourcePage}` : ""}`,
                meta: r.context?.slice(0, 80) ?? "",
                value: "📞",
                createdAt: r.createdAt,
              })),
              ...(chatRows as Array<{ id: number; vehicleInfo: string | null; problemSummary: string | null; converted: number; createdAt: Date }>).map((r) => ({
                id: `chat-${r.id}`,
                primary: r.vehicleInfo || "Anonymous chat visitor",
                secondary: `CHAT · ${r.converted ? "→ converted" : "no conversion"}`,
                meta: r.problemSummary?.slice(0, 80) ?? "",
                value: r.converted ? "✓" : "—",
                createdAt: r.createdAt,
              })),
              // wave-178 STRIDE I: phone tail-redacted across all four
              // drilldown row types. Pattern matches the wave-168 fix
              // already applied to pending_callbacks + intake_today
              // leads/callbacks. Bookings + VAPI rows were missed.
              ...(bookingRows as Array<{ id: number; name: string; phone: string; service: string | null; status: string; createdAt: Date }>).map((r) => ({
                id: `booking-${r.id}`,
                primary: r.name,
                secondary: `BOOKING · ${r.service ?? "general"} · •••${r.phone ? r.phone.slice(-4) : ""}`,
                meta: `status: ${r.status}`,
                value: "📅",
                createdAt: r.createdAt,
              })),
              ...(Array.isArray(vapiRows) ? vapiRows as Array<{ id: number; customerName: string | null; phoneNumber: string | null; aiSummary: string | null; serviceMention: string | null; durationSeconds: number; createdAt: Date }> : []).map((r) => ({
                id: `vapi-${r.id}`,
                primary: r.customerName || (r.phoneNumber ? `Caller •••${r.phoneNumber.slice(-4)}` : "VAPI caller"),
                secondary: `CALL · ${r.serviceMention ?? "no service mention"} · ${r.durationSeconds}s`,
                meta: r.aiSummary?.slice(0, 80) ?? "",
                value: "📞 AI",
                createdAt: r.createdAt,
              })),
            ];
            merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return {
              title: "Intake — last 24h",
              subtitle: "Every lead, callback, chat, booking, and AI call across all 5 sources, in time order.",
              rows: merged.slice(0, input.limit).map((r) => ({
                id: r.id,
                primary: r.primary,
                secondary: r.secondary,
                meta: r.meta,
                value: r.value,
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
                  // wave-178 STRIDE I: phone tail-redacted in lapsed_vips drilldown
                  secondary: r.phone ? `•••${r.phone.slice(-4)}` : "—",
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
                // wave-178 STRIDE I: phone tail-redacted in today_bookings drilldown
                secondary: `${r.phone ? `•••${r.phone.slice(-4)}` : "—"} · ${r.vehicle || "—"}`,
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
                // wave-181.72 (highest-leverage move) · the recovery cron
                // has been DRY-RUNNING for months because FEATURE_DECLINED_
                // RECOVERY env flag was never set. With wave-181.60 (at-
                // most-once) + wave-181.68 (durable rate-limit) + wave-181.69
                // (alert dedup), the cron is now production-safe. Single
                // env flag flip on Railway unleashes the entire pipeline.
                const featureOn = process.env.FEATURE_DECLINED_RECOVERY === "1";
                if (!featureOn && total >= 50_000) {
                  return {
                    variant: "danger" as const,
                    message: `$${total.toLocaleString()} in walked-away estimates sitting IDLE. SMS recovery cron is in DRY-RUN mode — set FEATURE_DECLINED_RECOVERY=1 on Railway to unleash auto-send (at-most-once protected · TCPA opt-out enforced · 20 sends/run cap). 30 seconds of operator time → live pipeline.`,
                    metric: `$${total.toLocaleString()} idle · ${cnt} estimates · 1 env flag`,
                    cta: { label: "See Status", section: "settings", settingsTab: "shopdriver" },
                  };
                }
                return {
                  variant: featureOn ? "primary" as const : "warning" as const,
                  message: featureOn
                    ? `Walked-away estimates from last 60 days · recovery cron actively processing.`
                    : `Walked-away estimates from last 60 days. SMS recovery cron targets these — set FEATURE_DECLINED_RECOVERY=1 to activate.`,
                  metric: `$${total.toLocaleString()} ${featureOn ? "in flight" : "recoverable"}`,
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
            // wave-181.80 (week-audit revenue-flag sweep) · consolidated
            // check across all 3 revenue-cron gates that have been silently
            // OFF in prod:
            //   1. FEATURE_DECLINED_RECOVERY env flag · declined-recovery cron
            //   2. retention_7day DB flag · D7 post-visit check-in (wave-181.47)
            //   3. retention_14day DB flag · D14 reactivation (wave-181.47)
            // cron_log audit showed 112+ runs in 7 days producing 0 records
            // for each. Production-safe to flip thanks to the wave-181.59
            // at-most-once claim + wave-181.60 TCPA opt-out + wave-181.68
            // durable rate-limit + wave-181.64 sending-hours guard.
            const featureRecovery = process.env.FEATURE_DECLINED_RECOVERY === "1";

            // Read DB flag state · read-only, fail-soft (return null if the
            // table query errors so the dashboard never breaks on a flag bug).
            let retention7dOn = true;
            let retention14dOn = true;
            try {
              const { featureFlags } = await import("../../drizzle/schema");
              const flags = await d
                .select({ key: featureFlags.key, value: featureFlags.value })
                .from(featureFlags)
                .where(inArray(featureFlags.key, ["retention_7day", "retention_14day"]));
              for (const f of flags) {
                if (f.key === "retention_7day") retention7dOn = Number(f.value) === 1;
                if (f.key === "retention_14day") retention14dOn = Number(f.value) === 1;
              }
            } catch { /* fail-soft · assume on so we don't false-alarm */ }

            const blockers: string[] = [];
            if (!featureRecovery) blockers.push("FEATURE_DECLINED_RECOVERY (Railway env)");
            if (!retention7dOn) blockers.push("retention_7day (DB flag)");
            if (!retention14dOn) blockers.push("retention_14day (DB flag)");

            if (blockers.length > 0) {
              return {
                variant: blockers.length >= 2 ? "danger" as const : "warning" as const,
                message: `${blockers.length} revenue-cron gate${blockers.length === 1 ? "" : "s"} OFF · pipelines running but producing 0 sends. Blockers: ${blockers.join(" · ")}. All gates are production-safe to flip (at-most-once + TCPA + rate-limit guards verified wave-181.58 → wave-181.79).`,
                metric: `${blockers.length} of 3 gates OFF`,
                cta: { label: "Operator runbook", section: "settings", settingsTab: "flags" },
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

  dbCleanupScan: adminProcedure.query(async () => {
    const d = await db();
    if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    const { eq, and, gte, lte } = await import("drizzle-orm");

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const maskPhoneNum = (numString: string) => {
      const digits = numString.replace(/\D/g, "");
      return digits.length > 4 ? `***-***-${digits.slice(-4)}` : numString;
    };

    const maskPersonName = (fullName: string) => {
      const parts = fullName.split(" ");
      return parts.map(p => p.slice(0, 1) + ".").join(" ");
    };

    const isFakePattern = (name: string, phone: string, problemOrMessage: string | null) => {
      const n = name.toLowerCase();
      const p = (problemOrMessage || "").toLowerCase();
      const ph = phone.replace(/\D/g, "");

      // Exclude Vapi AI receptionist logs
      if (p.includes("[voice-agent]")) {
        return false;
      }

      if (
        n.includes("test") ||
        n.includes("asdf") ||
        n.includes("qwerty") ||
        n.includes("dummy") ||
        n.includes("demo") ||
        n.includes("foo bar") ||
        n === "foo" ||
        n === "bar" ||
        n.includes("john doe") ||
        n.includes("jane doe") ||
        n.includes("john smith") ||
        n.includes("jane smith") ||
        p.includes("this is a test") ||
        p.includes("test message")
      ) {
        return true;
      }

      if (
        ph.includes("555") ||
        ph.length < 7 ||
        /^(.)\1+$/.test(ph) ||
        ph === "1234567890" ||
        ph === "0123456789"
      ) {
        return true;
      }

      if ((n === "caller" || n === "customer") && ph.length < 10) {
        return true;
      }

      return false;
    };

    const dbLeads = await d.select().from(leads);
    const dbBookings = await d.select().from(bookings);
    const dbCallbacks = await d.select().from(callbackRequests);

    const fakeLeads: any[] = [];
    const duplicateLeads: any[] = [];
    const staleLeads: any[] = [];
    const processedLeadIds = new Set<number>();

    for (const l of dbLeads) {
      const isVoiceAgent = (l.problem || "").toLowerCase().includes("[voice-agent]");
      if (!isVoiceAgent && isFakePattern(l.name, l.phone, l.problem)) {
        fakeLeads.push({
          id: l.id,
          name: maskPersonName(l.name),
          phone: maskPhoneNum(l.phone),
          createdAt: l.createdAt,
          details: l.problem ? l.problem.slice(0, 100) : "",
          table: "leads"
        });
      }
    }

    const sortedLeads = [...dbLeads].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < sortedLeads.length; i++) {
      const leadA = sortedLeads[i];
      const pA = leadA.phone.replace(/\D/g, "");
      if (processedLeadIds.has(leadA.id) || fakeLeads.some(f => f.id === leadA.id) || pA.length < 7) continue;

      for (let j = i + 1; j < sortedLeads.length; j++) {
        const leadB = sortedLeads[j];
        const pB = leadB.phone.replace(/\D/g, "");
        if (processedLeadIds.has(leadB.id) || fakeLeads.some(f => f.id === leadB.id) || pB.length < 7) continue;

        if (pA === pB) {
          const timeDiffHours = Math.abs(leadA.createdAt.getTime() - leadB.createdAt.getTime()) / (1000 * 60 * 60);
          if (timeDiffHours <= 24) {
            duplicateLeads.push({
              id: leadB.id,
              name: maskPersonName(leadB.name),
              phone: maskPhoneNum(leadB.phone),
              createdAt: leadB.createdAt,
              details: `Duplicate of Lead #${leadA.id} within 24h`,
              table: "leads"
            });
            processedLeadIds.add(leadB.id);
          }
        }
      }
    }

    for (const l of dbLeads) {
      if (fakeLeads.some(f => f.id === l.id) || duplicateLeads.some(d => d.id === l.id)) continue;
      if (l.status === "new" && l.createdAt < ninetyDaysAgo) {
        staleLeads.push({
          id: l.id,
          name: maskPersonName(l.name),
          phone: maskPhoneNum(l.phone),
          createdAt: l.createdAt,
          details: `New lead older than 90 days`,
          table: "leads"
        });
      }
    }

    const fakeBookings: any[] = [];
    const duplicateBookings: any[] = [];
    const staleBookings: any[] = [];
    const processedBookingIds = new Set<number>();

    for (const b of dbBookings) {
      const isVoiceAgent = (b.message || "").toLowerCase().includes("[voice-agent]");
      if (!isVoiceAgent && (isFakePattern(b.name, b.phone, b.message) || (b.phone.replace(/\D/g, "").length < 10 && b.phone.replace(/\D/g, "").length > 0))) {
        fakeBookings.push({
          id: b.id,
          name: maskPersonName(b.name),
          phone: maskPhoneNum(b.phone),
          createdAt: b.createdAt,
          details: b.service || "",
          table: "bookings"
        });
      }
    }

    const sortedBookings = [...dbBookings].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < sortedBookings.length; i++) {
      const bookingA = sortedBookings[i];
      const pA = bookingA.phone.replace(/\D/g, "");
      if (processedBookingIds.has(bookingA.id) || fakeBookings.some(f => f.id === bookingA.id) || pA.length < 7) continue;

      for (let j = i + 1; j < sortedBookings.length; j++) {
        const bookingB = sortedBookings[j];
        const pB = bookingB.phone.replace(/\D/g, "");
        if (processedBookingIds.has(bookingB.id) || fakeBookings.some(f => f.id === bookingB.id) || pB.length < 7) continue;

        if (pA === pB) {
          const timeDiffHours = Math.abs(bookingA.createdAt.getTime() - bookingB.createdAt.getTime()) / (1000 * 60 * 60);
          if (timeDiffHours <= 24) {
            duplicateBookings.push({
              id: bookingB.id,
              name: maskPersonName(bookingB.name),
              phone: maskPhoneNum(bookingB.phone),
              createdAt: bookingB.createdAt,
              details: `Duplicate booking for phone within 24h`,
              table: "bookings"
            });
            processedBookingIds.add(bookingB.id);
          }
        }
      }
    }

    for (const b of dbBookings) {
      if (fakeBookings.some(f => f.id === b.id) || duplicateBookings.some(d => d.id === b.id)) continue;
      if (b.status === "new" && b.createdAt < ninetyDaysAgo) {
        staleBookings.push({
          id: b.id,
          name: maskPersonName(b.name),
          phone: maskPhoneNum(b.phone),
          createdAt: b.createdAt,
          details: `New booking older than 90 days`,
          table: "bookings"
        });
      }
    }

    const fakeCallbacks: any[] = [];
    const duplicateCallbacks: any[] = [];
    const staleCallbacks: any[] = [];
    const processedCallbackIds = new Set<number>();

    for (const c of dbCallbacks) {
      const isVoiceAgent = (c.context || "").toLowerCase().includes("[voice-agent]");
      if (!isVoiceAgent && isFakePattern(c.name, c.phone, c.context)) {
        fakeCallbacks.push({
          id: c.id,
          name: maskPersonName(c.name),
          phone: maskPhoneNum(c.phone),
          createdAt: c.createdAt,
          details: c.context || "",
          table: "callbacks"
        });
      }
    }

    const sortedCallbacks = [...dbCallbacks].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < sortedCallbacks.length; i++) {
      const callbackA = sortedCallbacks[i];
      const pA = callbackA.phone.replace(/\D/g, "");
      if (processedCallbackIds.has(callbackA.id) || fakeCallbacks.some(f => f.id === callbackA.id) || pA.length < 7) continue;

      for (let j = i + 1; j < sortedCallbacks.length; j++) {
        const callbackB = sortedCallbacks[j];
        const pB = callbackB.phone.replace(/\D/g, "");
        if (processedCallbackIds.has(callbackB.id) || fakeCallbacks.some(f => f.id === callbackB.id) || pB.length < 7) continue;

        if (pA === pB) {
          const timeDiffHours = Math.abs(callbackA.createdAt.getTime() - callbackB.createdAt.getTime()) / (1000 * 60 * 60);
          if (timeDiffHours <= 24) {
            duplicateCallbacks.push({
              id: callbackB.id,
              name: maskPersonName(callbackB.name),
              phone: maskPhoneNum(callbackB.phone),
              createdAt: callbackB.createdAt,
              details: `Duplicate callback within 24h`,
              table: "callbacks"
            });
            processedCallbackIds.add(callbackB.id);
          }
        }
      }
    }

    for (const c of dbCallbacks) {
      if (fakeCallbacks.some(f => f.id === c.id) || duplicateCallbacks.some(d => d.id === c.id)) continue;
      if ((c.status === "new" || c.status === "pending") && c.createdAt < ninetyDaysAgo) {
        staleCallbacks.push({
          id: c.id,
          name: maskPersonName(c.name),
          phone: maskPhoneNum(c.phone),
          createdAt: c.createdAt,
          details: `New/pending callback older than 90 days`,
          table: "callbacks"
        });
      }
    }

    return {
      fake: [...fakeLeads, ...fakeBookings, ...fakeCallbacks],
      duplicates: [...duplicateLeads, ...duplicateBookings, ...duplicateCallbacks],
      stale: [...staleLeads, ...staleBookings, ...staleCallbacks],
    };
  }),

  dbCleanupPrune: adminProcedure
    .input(z.object({
      fakeIds: z.array(z.object({ id: z.number(), table: z.enum(["leads", "bookings", "callbacks"]) })),
      duplicateIds: z.array(z.object({ id: z.number(), table: z.enum(["leads", "bookings", "callbacks"]) })),
      staleIds: z.array(z.object({ id: z.number(), table: z.enum(["leads", "bookings", "callbacks"]) })),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { eq } = await import("drizzle-orm");

      let deletedCount = 0;
      let archivedCount = 0;

      for (const item of input.fakeIds) {
        if (item.table === "leads") {
          await d.delete(leads).where(eq(leads.id, item.id));
        } else if (item.table === "bookings") {
          await d.delete(bookings).where(eq(bookings.id, item.id));
        } else if (item.table === "callbacks") {
          await d.delete(callbackRequests).where(eq(callbackRequests.id, item.id));
        }
        deletedCount++;
      }

      for (const item of input.duplicateIds) {
        if (item.table === "leads") {
          await d.delete(leads).where(eq(leads.id, item.id));
        } else if (item.table === "bookings") {
          await d.delete(bookings).where(eq(bookings.id, item.id));
        } else if (item.table === "callbacks") {
          await d.delete(callbackRequests).where(eq(callbackRequests.id, item.id));
        }
        deletedCount++;
      }

      for (const item of input.staleIds) {
        if (item.table === "leads") {
          await d.update(leads)
            .set({ status: "closed", contacted: 0, contactNotes: "[SYSTEM: Closed as stale]" })
            .where(eq(leads.id, item.id));
        } else if (item.table === "bookings") {
          await d.update(bookings)
            .set({ status: "cancelled", adminNotes: "[SYSTEM: Cancelled as stale]" })
            .where(eq(bookings.id, item.id));
        } else if (item.table === "callbacks") {
          await d.update(callbackRequests)
            .set({ status: "no-answer", notes: "[SYSTEM: Closed as stale]" })
            .where(eq(callbackRequests.id, item.id));
        }
        archivedCount++;
      }

      const { logAdminAction } = await import("../services/auditTrail");
      logAdminAction({
        action: "database.hygiene_prune",
        entityType: "system",
        entityId: 0,
        details: `Database cleanup: deleted ${deletedCount} records, archived/closed ${archivedCount} stale records.`,
      }).catch((e) => { log.warn("[routers/admin] audit trail logging failed:", e); });

      return { success: true, deleted: deletedCount, archived: archivedCount };
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
    // Exclude status='pending' — those rows are already shown in the
    // `pending` query above. Without this filter, when total rows < 50
    // the operator sees every pending item twice (once in PENDING, once
    // in RECENT). `recent` is the sent/failed/skipped history list.
    return d.select().from(customerNotifications)
      .where(ne(customerNotifications.status, "pending"))
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

    // wave-168: replaced unbounded `select().from(...)` row-scans with COUNT/SUM
    // aggregates. Pre-fix this fetched every row in bookings/leads/callbacks/
    // notifications from the last 7 days into Node memory just to compute
    // totals + breakdowns. At hundreds of weekly rows it OOMs the dyno; the
    // exact same class of bug wave-158 fixed for getDashboardStats().

    const [bookingAgg] = await d.select({
      total: sql<number>`COUNT(*)`,
      completed: sql<number>`SUM(CASE WHEN ${bookings.status} = 'completed' THEN 1 ELSE 0 END)`,
      cancelled: sql<number>`SUM(CASE WHEN ${bookings.status} = 'cancelled' THEN 1 ELSE 0 END)`,
      emergency: sql<number>`SUM(CASE WHEN ${bookings.urgency} = 'emergency' THEN 1 ELSE 0 END)`,
    }).from(bookings).where(gte(bookings.createdAt, weekAgo));

    const bookingByService = await d.select({
      service: bookings.service,
      count: sql<number>`COUNT(*)`,
    }).from(bookings).where(gte(bookings.createdAt, weekAgo)).groupBy(bookings.service);

    const bookingByUrgency = await d.select({
      urgency: sql<string>`COALESCE(${bookings.urgency}, 'whenever')`,
      count: sql<number>`COUNT(*)`,
    }).from(bookings).where(gte(bookings.createdAt, weekAgo)).groupBy(sql`COALESCE(${bookings.urgency}, 'whenever')`);

    const [leadAgg] = await d.select({
      total: sql<number>`COUNT(*)`,
      highUrgency: sql<number>`SUM(CASE WHEN ${leads.urgencyScore} >= 4 THEN 1 ELSE 0 END)`,
      converted: sql<number>`SUM(CASE WHEN ${leads.status} = 'booked' THEN 1 ELSE 0 END)`,
    }).from(leads).where(gte(leads.createdAt, weekAgo));

    const leadBySource = await d.select({
      source: leads.source,
      count: sql<number>`COUNT(*)`,
    }).from(leads).where(gte(leads.createdAt, weekAgo)).groupBy(leads.source);

    const [callbackAgg] = await d.select({
      total: sql<number>`COUNT(*)`,
      completed: sql<number>`SUM(CASE WHEN ${callbackRequests.status} = 'completed' THEN 1 ELSE 0 END)`,
      pending: sql<number>`SUM(CASE WHEN ${callbackRequests.status} = 'new' THEN 1 ELSE 0 END)`,
    }).from(callbackRequests).where(gte(callbackRequests.createdAt, weekAgo));

    const [notifAgg] = await d.select({
      sent: sql<number>`SUM(CASE WHEN ${customerNotifications.status} = 'sent' THEN 1 ELSE 0 END)`,
      pending: sql<number>`SUM(CASE WHEN ${customerNotifications.status} = 'pending' THEN 1 ELSE 0 END)`,
    }).from(customerNotifications).where(gte(customerNotifications.createdAt, weekAgo));

    const serviceBreakdown: Record<string, number> = {};
    bookingByService.forEach((r: { service: string; count: number }) => { serviceBreakdown[r.service] = Number(r.count); });

    const urgencyBreakdown: Record<string, number> = {};
    bookingByUrgency.forEach((r: { urgency: string; count: number }) => { urgencyBreakdown[r.urgency] = Number(r.count); });

    const sources: Record<string, number> = {};
    leadBySource.forEach((r: { source: string; count: number }) => { sources[r.source] = Number(r.count); });

    const report = {
      period: { start: weekAgo.toISOString(), end: now.toISOString() },
      bookings: {
        total: Number(bookingAgg?.total ?? 0),
        completed: Number(bookingAgg?.completed ?? 0),
        cancelled: Number(bookingAgg?.cancelled ?? 0),
        emergency: Number(bookingAgg?.emergency ?? 0),
        serviceBreakdown,
        urgencyBreakdown,
      },
      leads: {
        total: Number(leadAgg?.total ?? 0),
        highUrgency: Number(leadAgg?.highUrgency ?? 0),
        converted: Number(leadAgg?.converted ?? 0),
        sources,
      },
      callbacks: {
        total: Number(callbackAgg?.total ?? 0),
        completed: Number(callbackAgg?.completed ?? 0),
        pending: Number(callbackAgg?.pending ?? 0),
      },
      notifications: {
        sent: Number(notifAgg?.sent ?? 0),
        pending: Number(notifAgg?.pending ?? 0),
      },
    };

    const topServices = Object.entries(serviceBreakdown)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([s, c]) => `  ${s}: ${c}`)
      .join("\n");

    sendNotification({
      category: "weekly_report",
      subject: `Weekly Report: ${report.bookings.total} bookings, ${report.leads.total} leads`,
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

  // wave-165: redact phone PII in Railway stdout. console.info bypasses
  // the createLogger redaction layer, so full customer phones were
  // landing in retained dyno logs visible to anyone with project access.
  const phoneTail = normalizedPhone.slice(-4);
  console.info(`[calltracking:review] Scheduled for phone ending ***${phoneTail} at ${scheduledAt.toISOString()}`);
}

// ─── CALL TRACKING ─────────────────────────────────────

// wave-141b — IP rate limit on logCall (15 events/min/IP). The procedure
// is publicProcedure because legit phone-click tracking fires from the
// public site, but the SMS-scheduling side-effect (scheduleCallReviewRequest)
// made it an SMS-spam vector — any actor could POST arbitrary phone
// numbers + trigger review-request SMS to them. Combined with the
// per-phone cooldown already inside scheduleCallReviewRequest, this
// prevents both burst-spray attacks and same-target floods.
const logCallIpLimit = new BoundedTtlMap<number>({ ttlMs: 60_000, maxEntries: 10_000 });
const LOG_CALL_MAX_PER_MIN = 15;

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
      // journey-join migration 0068 — localStorage visitor id + the Meta
      // pixel event_id the client's Contact event fired with.
      sessionId: z.string().max(64).nullish(),
      eventId: z.string().max(64).nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      // wave-141b — per-IP rate limit guards the SMS side-effect.
      const ip = ctx.req?.ip || ctx.req?.socket?.remoteAddress || "unknown";
      const count = (logCallIpLimit.get(ip) ?? 0) + 1;
      logCallIpLimit.set(ip, count);
      if (count > LOG_CALL_MAX_PER_MIN) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many call-tracking events from this client" });
      }

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
          sessionId: input.sessionId || null,
          eventId: input.eventId || null,
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
