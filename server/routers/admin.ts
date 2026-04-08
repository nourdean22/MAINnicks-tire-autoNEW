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
import { sanitizeText, sanitizePhone } from "../sanitize";
import { saveReviewStatsToDb } from "../google-reviews";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

/**
 * Sanitize a CSV cell value to prevent formula injection (CSV injection / DDE attacks).
 * If a cell starts with =, +, -, @, tab, or CR, prefix with a single quote to neutralize it.
 * These characters trigger formula execution when opened in Excel/Google Sheets.
 */
function csvSafe(val: unknown): string {
  const s = String(val ?? "");
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

export const adminDashboardRouter = router({
  stats: adminProcedure.query(async () => {
    return getDashboardStats();
  }),
  siteHealth: adminProcedure.query(async () => {
    return getSiteHealth();
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
    weekBookings.forEach((b: any) => {
      serviceBreakdown[b.service] = (serviceBreakdown[b.service] || 0) + 1;
    });

    const urgencyBreakdown: Record<string, number> = {};
    weekBookings.forEach((b: any) => {
      const u = b.urgency || "whenever";
      urgencyBreakdown[u] = (urgencyBreakdown[u] || 0) + 1;
    });

    const report = {
      period: { start: weekAgo.toISOString(), end: now.toISOString() },
      bookings: {
        total: weekBookings.length,
        completed: weekBookings.filter((b: any) => b.status === "completed").length,
        cancelled: weekBookings.filter((b: any) => b.status === "cancelled").length,
        emergency: weekBookings.filter((b: any) => b.urgency === "emergency").length,
        serviceBreakdown,
        urgencyBreakdown,
      },
      leads: {
        total: weekLeads.length,
        highUrgency: weekLeads.filter((l: any) => l.urgencyScore >= 4).length,
        converted: weekLeads.filter((l: any) => l.status === "booked").length,
        sources: weekLeads.reduce((acc: any, l: any) => { acc[l.source] = (acc[l.source] || 0) + 1; return acc; }, {} as Record<string, number>),
      },
      callbacks: {
        total: weekCallbacks.length,
        completed: weekCallbacks.filter((c: any) => c.status === "completed").length,
        pending: weekCallbacks.filter((c: any) => c.status === "new").length,
      },
      notifications: {
        sent: weekNotifs.filter((n: any) => n.status === "sent").length,
        pending: weekNotifs.filter((n: any) => n.status === "pending").length,
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
    .input(z.object({
      phoneNumber: z.string().max(20),
      sourcePage: z.string().max(500).optional(),
      clickElement: z.string().max(200).optional(),
      utmSource: z.string().max(100).optional(),
      utmMedium: z.string().max(100).optional(),
      utmCampaign: z.string().max(255).optional(),
      landingPage: z.string().max(500).optional(),
      referrer: z.string().max(500).optional(),
      userAgent: z.string().max(500).optional(),
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
          console.error("[CallTracking] Review request scheduling failed:", err);
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
    const csvRows = rows.map((r: any) => [
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
    const csvRows = rows.map((r: any) => [
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
    const csvRows = rows.map((r: any) => [
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
    const csvRows = rows.map((r: any) => [
      r.id, csvSafe(r.name), csvSafe(r.phone), csvSafe(r.context), csvSafe(r.sourcePage), r.status,
      csvSafe(r.utmSource), csvSafe(r.utmMedium), csvSafe(r.utmCampaign), csvSafe(r.landingPage), csvSafe(r.referrer),
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),
});
