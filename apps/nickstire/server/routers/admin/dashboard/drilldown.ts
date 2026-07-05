/**
 * Drilldown drawer data source — the admin's click-into-anything query (the largest single procedure).
 *
 * Carved from admin/dashboard.ts (1,133 lines, one router object holding
 * 17 procedures) in the 2026-07-05 polish wave. Grouped by reason-to-change.
 * Each group is a plain procedure record; ./index.ts spread-merges them into
 * one flat router, so every adminDashboard.<proc> client call path is
 * byte-identical. Pure mechanical move — no procedure body was modified.
 */
/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure } from "../../../_core/trpc";
import { z } from "zod";





export const drilldownProcedures = {
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
        const { getDb } = await import("../../../db");
        const d = await getDb();
        if (!d) return empty;
        const { sql, eq, and, gte, isNull, lte, desc } = await import("drizzle-orm");

        switch (input.kind) {
          case "cars_in_shop": {
            const { workOrders } = await import("../../../../drizzle/schema");
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
            const { invoices } = await import("../../../../drizzle/schema");
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
            const { callbackRequests } = await import("../../../../drizzle/schema");
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
            const { algEstimates } = await import("../../../../drizzle/schema");
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
            const { leads } = await import("../../../../drizzle/schema");
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
            const { chatSessions, leads } = await import("../../../../drizzle/schema");
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
            const { leads, callbackRequests, chatSessions, bookings, vapiCallLogs } = await import("../../../../drizzle/schema");
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
            const { customers } = await import("../../../../drizzle/schema");
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
            const { reviewReplies } = await import("../../../../drizzle/schema");
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
            const { bookings } = await import("../../../../drizzle/schema");
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
};
