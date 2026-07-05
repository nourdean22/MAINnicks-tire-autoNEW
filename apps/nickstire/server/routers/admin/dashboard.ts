/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { sendNotification, getDeliveryLog } from "../../email-notify";
import { getAnalyticsSnapshots, getBookingServiceBreakdown } from "../../db";
import { getDashboardStats, getSiteHealth } from "../../admin-stats";
import { z } from "zod";
import { eq, ne, desc, gte, sql, inArray, and, isNull } from "drizzle-orm";
import { bookings, leads, callbackRequests, customerNotifications, callEvents } from "../../../drizzle/schema";
import { sanitizeText, sanitizePhone, csvSafe } from "../../sanitize";
import { saveReviewStatsToDb } from "../../google-reviews";

import { db } from "../../lib/db-helper";
import { BoundedTtlMap } from "../../lib/boundedTtlMap";

import { createLogger } from "../../lib/logger";

const log = createLogger("routers:admin");
import { runHygieneScan } from "./hygiene";

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
    const { getOverviewMediumBundle } = await import("../../services/adminBundle");
    return getOverviewMediumBundle();
  }),

  /** Full system diagnostics — predictive health, trends, anomalies, recovery history */
  systemDiagnostics: adminProcedure.query(async () => {
    const { generateDiagnosticReport } = await import("../../lib/self-healing");
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
      const { getRecentIntegrationFailures } = await import("../../integration-failures");
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
    const { getVendorHealthReport } = await import("../../services/vendorHealth");
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
    const { clearHealthCache, getVendorHealthReport } = await import("../../services/vendorHealth");
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
    const { runSmokeTests } = await import("../../services/integrationLogger");
    return runSmokeTests();
  }),

  /** Get integration event log */
  integrationLog: adminProcedure
    .input(z.object({
      vendor: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const { getRecentEvents, getEventSummary } = await import("../../services/integrationLogger");
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
        const { getDb } = await import("../../db");
        const d = await getDb();
        if (!d) return empty;
        const { sql, eq, and, gte, isNull, lte, desc } = await import("drizzle-orm");

        switch (input.kind) {
          case "cars_in_shop": {
            const { workOrders } = await import("../../../drizzle/schema");
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
            const { invoices } = await import("../../../drizzle/schema");
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
            const { callbackRequests } = await import("../../../drizzle/schema");
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
            const { algEstimates } = await import("../../../drizzle/schema");
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
            const { leads } = await import("../../../drizzle/schema");
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
            const { chatSessions, leads } = await import("../../../drizzle/schema");
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
            const { leads, callbackRequests, chatSessions, bookings, vapiCallLogs } = await import("../../../drizzle/schema");
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
            const { customers } = await import("../../../drizzle/schema");
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
            const { reviewReplies } = await import("../../../drizzle/schema");
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
            const { bookings } = await import("../../../drizzle/schema");
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
      const { getDb } = await import("../../db");
      const d = await getDb();
      if (!d) return { briefs: [], generatedAt: new Date().toISOString() };

      const { callbackRequests, leads, bookings, algEstimates, reviewReplies, specials } = await import("../../../drizzle/schema");
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
        const { getDb } = await import("../../db");
        const d = await getDb();
        if (!d) return null;
        const { sql, eq, and, gte, isNull } = await import("drizzle-orm");

        switch (input.section) {
          case "customers": {
            // Lapsed VIP customers — high LTV, haven't visited in 6+ months
            try {
              const { customers } = await import("../../../drizzle/schema");
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
            return null;
          }
          case "leads": {
            // Stale unactioned leads
            try {
              const { leads } = await import("../../../drizzle/schema");
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
              const { callbackRequests } = await import("../../../drizzle/schema");
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
              const { algEstimates } = await import("../../../drizzle/schema");
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
              const { reviewReplies } = await import("../../../drizzle/schema");
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
              const { featureFlags } = await import("../../../drizzle/schema");
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
    return runHygieneScan();
  }),

  dbCleanupPrune: adminProcedure
    .input(z.object({
      fakeIds: z.array(z.object({ id: z.number(), table: z.enum(["leads", "bookings", "callbacks"]) })),
      duplicateIds: z.array(z.object({ id: z.number(), table: z.enum(["leads", "bookings", "callbacks"]) })),
      staleIds: z.array(z.object({ id: z.number(), table: z.enum(["leads", "bookings", "callbacks"]) })),
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Run scanner to retrieve valid cleanup candidates
      const candidates = await runHygieneScan();

      // 2. Validate all requested IDs exist in candidate pools
      for (const item of input.fakeIds) {
        const isValid = candidates.fake.some(c => c.id === item.id && c.table === item.table);
        if (!isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Record ID ${item.id} in table ${item.table} is not a valid candidate for fake cleanup.`,
          });
        }
      }

      for (const item of input.duplicateIds) {
        const isValid = candidates.duplicates.some(c => c.id === item.id && c.table === item.table);
        if (!isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Record ID ${item.id} in table ${item.table} is not a valid candidate for duplicate cleanup.`,
          });
        }
      }

      for (const item of input.staleIds) {
        const isValid = candidates.stale.some(c => c.id === item.id && c.table === item.table);
        if (!isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Record ID ${item.id} in table ${item.table} is not a valid candidate for stale cleanup.`,
          });
        }
      }

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

      const { logAdminAction } = await import("../../services/auditTrail");
      logAdminAction({
        action: "database.hygiene_prune",
        entityType: "system",
        entityId: 0,
        details: `Database cleanup: deleted ${deletedCount} records, archived/closed ${archivedCount} stale records.`,
        actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
      }).catch((e) => { log.warn("[routers/admin] audit trail logging failed:", e); });

      return { success: true, deleted: deletedCount, archived: archivedCount };
    }),
});
