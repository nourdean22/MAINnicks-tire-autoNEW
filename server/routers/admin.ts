/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, router } from "../_core/trpc";
import { sendNotification, getDeliveryLog } from "../email-notify";
import { isSheetConfigured, getSpreadsheetUrl } from "../sheets-sync";
import { getAnalyticsSnapshots, getBookingServiceBreakdown } from "../db";
import { getDashboardStats, getSiteHealth } from "../admin-stats";
import { z } from "zod";
import { eq, desc, gte, sql } from "drizzle-orm";
import { bookings, leads, callbackRequests, customerNotifications } from "../../drizzle/schema";

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

  /** Unified sync health check — shows status of all integrations */
  syncHealth: adminProcedure.query(async () => {
    const d = await db();
    const checks: Array<{
      name: string;
      status: "connected" | "degraded" | "disconnected";
      details: string;
      lastActivity?: string;
    }> = [];

    // 1. Database
    if (d) {
      try {
        await d.execute(sql`SELECT 1`);
        checks.push({ name: "Database", status: "connected", details: "MySQL/TiDB responding" });
      } catch {
        checks.push({ name: "Database", status: "degraded", details: "Query failed" });
      }
    } else {
      checks.push({ name: "Database", status: "disconnected", details: "No connection" });
    }

    // 2. Google Sheets CRM
    if (isSheetConfigured()) {
      checks.push({
        name: "Google Sheets CRM",
        status: "connected",
        details: `6 tabs syncing — ${getSpreadsheetUrl()}`,
      });
    } else {
      checks.push({ name: "Google Sheets CRM", status: "disconnected", details: "No spreadsheet ID configured" });
    }

    // 3. Gmail Notifications
    const recentLog = getDeliveryLog(5);
    const recentSuccess = recentLog.filter(l => l.emailSent).length;
    if (recentLog.length === 0) {
      checks.push({ name: "Gmail Notifications", status: "connected", details: "No recent sends (idle)" });
    } else if (recentSuccess > 0) {
      checks.push({
        name: "Gmail Notifications",
        status: "connected",
        details: `${recentSuccess}/${recentLog.length} recent emails sent successfully`,
        lastActivity: recentLog[0]?.timestamp,
      });
    } else {
      checks.push({ name: "Gmail Notifications", status: "degraded", details: "Recent sends failed" });
    }

    // 4. Gateway Tire B2B
    checks.push({
      name: "Gateway Tire B2B",
      status: process.env.GATEWAY_TIRE_USERNAME ? "connected" : "disconnected",
      details: process.env.GATEWAY_TIRE_USERNAME ? "Credentials configured" : "No credentials",
    });

    // 5. Twilio SMS
    checks.push({
      name: "Twilio SMS",
      status: process.env.TWILIO_ACCOUNT_SID ? "connected" : "disconnected",
      details: process.env.TWILIO_ACCOUNT_SID ? "Account configured" : "No credentials",
    });

    // 6. Stripe Payments
    checks.push({
      name: "Stripe Payments",
      status: process.env.STRIPE_SECRET_KEY ? "connected" : "disconnected",
      details: process.env.STRIPE_SECRET_KEY ? "Keys configured" : "No keys",
    });

    // 7. Auto Labor Guide
    checks.push({
      name: "Auto Labor Guide",
      status: process.env.AUTO_LABOR_USERNAME ? "connected" : "disconnected",
      details: process.env.AUTO_LABOR_USERNAME ? "Credentials configured" : "No credentials",
    });

    const overallStatus = checks.every(c => c.status === "connected")
      ? "all_systems_operational"
      : checks.some(c => c.status === "disconnected")
        ? "some_systems_offline"
        : "degraded";

    return {
      overallStatus,
      checks,
      checkedAt: new Date().toISOString(),
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
