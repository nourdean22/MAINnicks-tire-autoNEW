/**
 * Advanced Features Router — Job Assignments, Invoices, CLV, KPIs, Customer Portal
 * AUDIT-FIXED: Rate limiting, session cleanup, invoice CRUD, optimized KPI, auto-stage
 */
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import { z } from "zod";
import { BUSINESS } from "../../../shared/business";

const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;
import { eq, desc, gte, lte, and, sql, asc } from "drizzle-orm";
import {
  jobAssignments, invoices, customerMetrics, kpiSnapshots, portalSessions,
  bookings, customers, technicians, reviewRequests, leads, serviceHistory,
} from "../../../drizzle/schema";

import { db } from "../../lib/db-helper";

import { createLogger } from "../../lib/logger";

const log = createLogger("routers:advanced");
// ─── JOB ASSIGNMENTS ────────────────────────────────────

// ─── KPI COMMAND CENTER ─────────────────────────────────
export const kpiRouter = router({
  /** Get current KPIs (computed live) — OPTIMIZED: uses SQL aggregation */
  current: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return null;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // This week's bookings
    const weekBookings = await d.select().from(bookings).where(gte(bookings.createdAt, weekAgo));
    const monthBookings = await d.select().from(bookings).where(gte(bookings.createdAt, monthAgo));
    const weekLeads = await d.select().from(leads).where(gte(leads.createdAt, weekAgo));
    const monthLeads = await d.select().from(leads).where(gte(leads.createdAt, monthAgo));

    // Revenue this month
    const monthInvoices = await d.select().from(invoices)
      .where(and(gte(invoices.invoiceDate, monthAgo), eq(invoices.paymentStatus, "paid")));
    const monthRevenue = Math.round(monthInvoices.reduce((sum: number, inv: typeof monthInvoices[number]) => sum + inv.totalAmount, 0) / 100);

    // Review stats
    const monthReviews = await d.select().from(reviewRequests).where(gte(reviewRequests.createdAt, monthAgo));
    const reviewsSent = monthReviews.filter((r: typeof monthReviews[number]) => r.status === "sent" || r.status === "clicked").length;
    const reviewsClicked = monthReviews.filter((r: typeof monthReviews[number]) => r.status === "clicked").length;

    // Conversion rate
    const totalLeads = monthLeads.length;
    const convertedLeads = monthLeads.filter((l: typeof monthLeads[number]) => l.status === "booked").length;
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    // Customer counts
    const [customerCount] = await d.select({ count: sql<number>`count(*)` }).from(customers);
    const [newCustomerCount] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(gte(customers.createdAt, monthAgo));

    // Booking by day of week (OPTIMIZED: SQL aggregation instead of fetching all rows)
    // NOTE: Use raw SQL to avoid TiDB mismatch between SELECT/GROUP BY column qualification
    const dayOfWeekRaw = await d.execute(
      sql`SELECT DAYOFWEEK(createdAt) as dow, count(*) as cnt FROM bookings GROUP BY dow`
    );

    type RawRow2 = Record<string, unknown>;
    const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    for (const r of (dayOfWeekRaw as [RawRow2[], unknown])[0]) {
      const idx = Number(r.dow) - 1;
      if (idx >= 0 && idx < 7) dayOfWeekCounts[idx] = Number(r.cnt);
    }

    // Booking by hour (OPTIMIZED: SQL aggregation)
    const hourRaw = await d.execute(
      sql`SELECT HOUR(createdAt) as hr, count(*) as cnt FROM bookings GROUP BY hr`
    );

    const hourCounts = new Array(24).fill(0);
    for (const r of (hourRaw as [RawRow2[], unknown])[0]) {
      if (Number(r.hr) >= 0 && Number(r.hr) < 24) hourCounts[Number(r.hr)] = Number(r.cnt);
    }

    return {
      weekBookings: weekBookings.length,
      monthBookings: monthBookings.length,
      weekLeads: weekLeads.length,
      monthLeads: monthLeads.length,
      monthRevenue,
      avgTicket: monthInvoices.length > 0 ? Math.round(monthRevenue / monthInvoices.length) : 0,
      conversionRate,
      reviewsSent,
      reviewsClicked,
      totalCustomers: customerCount?.count ?? 0,
      newCustomersThisMonth: newCustomerCount?.count ?? 0,
      dayOfWeekCounts,
      hourCounts,
      completedThisWeek: weekBookings.filter((b: typeof weekBookings[number]) => b.status === "completed").length,
      completedThisMonth: monthBookings.filter((b: typeof monthBookings[number]) => b.status === "completed").length,
      emergencyThisWeek: weekBookings.filter((b: typeof weekBookings[number]) => b.urgency === "emergency").length,
    };
  }),

  /** Get historical KPI snapshots for trend charts */
  history: adminProcedure
    .input(z.object({ weeks: z.number().default(12) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      return d.select().from(kpiSnapshots)
        .orderBy(desc(kpiSnapshots.weekStart))
        .limit(input?.weeks ?? 12);
    }),
});
