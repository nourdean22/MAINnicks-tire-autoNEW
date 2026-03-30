/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { sendNotification, getDeliveryLog } from "../email-notify";
import { getAnalyticsSnapshots, getBookingServiceBreakdown } from "../db";
import { getDashboardStats, getSiteHealth } from "../admin-stats";
import { z } from "zod";
import { eq, desc, gte, sql } from "drizzle-orm";
import { bookings, leads, callbackRequests, customerNotifications, callEvents } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone } from "../sanitize";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const adminDashboardRouter = router({
  stats: adminProcedure.query(async () => {
    return getDashboardStats();
  }),
  siteHealth: adminProcedure.query(async () => {
    return getSiteHealth();
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

  /** Run smoke tests on all integrations */
  smokeTest: adminProcedure.mutation(async () => {
    const { runSmokeTests } = await import("../services/integrationLogger");
    return runSmokeTests();
  }),

  /** Get integration event log */
  integrationLog: adminProcedure
    .input(z.object({
      vendor: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const { getRecentEvents, getEventSummary } = await import("../services/integrationLogger");
      return {
        events: getRecentEvents({ vendor: input?.vendor, limit: input?.limit }),
        summary: getEventSummary(),
      };
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

    const serviceBreakdown: Record<string, number> = {};
    weekBookings.forEach(b => {
      serviceBreakdown[b.service] = (serviceBreakdown[b.service] || 0) + 1;
    });

    const urgencyBreakdown: Record<string, number> = {};
    weekBookings.forEach(b => {
      const u = b.urgency || "whenever";
      urgencyBreakdown[u] = (urgencyBreakdown[u] || 0) + 1;
    });

    const report = {
      period: { start: weekAgo.toISOString(), end: now.toISOString() },
      bookings: {
        total: weekBookings.length,
        completed: weekBookings.filter(b => b.status === "completed").length,
        cancelled: weekBookings.filter(b => b.status === "cancelled").length,
        emergency: weekBookings.filter(b => b.urgency === "emergency").length,
        serviceBreakdown,
        urgencyBreakdown,
      },
      leads: {
        total: weekLeads.length,
        highUrgency: weekLeads.filter(l => l.urgencyScore >= 4).length,
        converted: weekLeads.filter(l => l.status === "booked").length,
        sources: weekLeads.reduce((acc, l) => { acc[l.source] = (acc[l.source] || 0) + 1; return acc; }, {} as Record<string, number>),
      },
      callbacks: {
        total: weekCallbacks.length,
        completed: weekCallbacks.filter(c => c.status === "completed").length,
        pending: weekCallbacks.filter(c => c.status === "new").length,
      },
      notifications: {
        sent: weekNotifs.filter(n => n.status === "sent").length,
        pending: weekNotifs.filter(n => n.status === "pending").length,
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
    }).catch(() => {});

    return report;
  }),
});

// ─── CALL TRACKING ─────────────────────────────────────
export const callTrackingRouter = router({
  /** Log a phone click event from the frontend */
  logCall: publicProcedure
    .input(z.object({
      phoneNumber: z.string(),
      sourcePage: z.string().optional(),
      clickElement: z.string().optional(),
      utmSource: z.string().optional(),
      utmMedium: z.string().optional(),
      utmCampaign: z.string().optional(),
      landingPage: z.string().optional(),
      referrer: z.string().optional(),
      userAgent: z.string().optional(),
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
        return { success: true };
      } catch (err) {
        console.error("[CallTracking] Error logging call:", err);
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

// ─── DATA EXPORT ───────────────────────────────────────
export const exportRouter = router({
  bookings: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(bookings).orderBy(desc(bookings.createdAt)).limit(10000);
    const headers = ["ID", "Name", "Phone", "Email", "Service", "Vehicle", "Status", "Urgency", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map(r => [
      r.id, r.name, r.phone, r.email || "", r.service, r.vehicle || "", r.status, r.urgency || "",
      r.utmSource || "", r.utmMedium || "", r.utmCampaign || "", r.landingPage || "", r.referrer || "",
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),

  leads: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(leads).orderBy(desc(leads.createdAt)).limit(10000);
    const headers = ["ID", "Name", "Phone", "Email", "Source", "Problem", "Urgency Score", "Status", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map(r => [
      r.id, r.name, r.phone, r.email || "", r.source, r.problem || "", r.urgencyScore ?? "", r.status,
      r.utmSource || "", r.utmMedium || "", r.utmCampaign || "", r.landingPage || "", r.referrer || "",
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),

  calls: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(callEvents).orderBy(desc(callEvents.createdAt)).limit(10000);
    const headers = ["ID", "Phone Number", "Source Page", "Click Element", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map(r => [
      r.id, r.phoneNumber, r.sourcePage || "", r.clickElement || "",
      r.utmSource || "", r.utmMedium || "", r.utmCampaign || "", r.landingPage || "", r.referrer || "",
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),

  callbacks: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(callbackRequests).orderBy(desc(callbackRequests.createdAt)).limit(10000);
    const headers = ["ID", "Name", "Phone", "Context", "Source Page", "Status", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map(r => [
      r.id, r.name, r.phone, r.context || "", r.sourcePage || "", r.status,
      r.utmSource || "", r.utmMedium || "", r.utmCampaign || "", r.landingPage || "", r.referrer || "",
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),
});
