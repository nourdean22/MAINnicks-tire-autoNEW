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
