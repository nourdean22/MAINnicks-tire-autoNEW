/**
 * Nick AI Intelligence Layer — Learning, Projecting, Proactive Alerts
 *
 * This is the brain that connects all systems and makes Nick AI
 * actually smart — not just reactive, but proactive.
 *
 * Runs on a schedule and on-demand to:
 * 1. Analyze cross-pipeline patterns (estimates → invoices conversion)
 * 2. Spot trends (revenue, leads, customer behavior)
 * 3. Generate proactive alerts when something needs attention
 * 4. Learn from outcomes and adjust recommendations
 * 5. Project revenue and identify growth opportunities
 */

import { createLogger } from "../lib/logger";
import { eq, gte, sql, and, desc, lte } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";

const log = createLogger("nick-intelligence");

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── CROSS-PIPELINE ANALYTICS ─────────────────────────

export async function analyzeConversionPipeline(): Promise<{
  estimateToInvoice: number;
  leadToBooking: number;
  bookingToInvoice: number;
  staleLeads: number;
  staleEstimates: number;
  insights: string[];
}> {
  const d = await db();
  if (!d) return { estimateToInvoice: 0, leadToBooking: 0, bookingToInvoice: 0, staleLeads: 0, staleEstimates: 0, insights: [] };

  const { leads, bookings, invoices } = await import("../../drizzle/schema");
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalEstimateLeads, bookedEstimateLeads,
    totalLeads, bookedLeads,
    totalBookings, completedBookings,
    staleNewLeads, staleEstimateLeads,
  ] = await Promise.all([
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.source, "estimate"), gte(leads.createdAt, monthAgo))),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.source, "estimate"), eq(leads.status, "booked"), gte(leads.createdAt, monthAgo))),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(gte(leads.createdAt, monthAgo)),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.status, "booked"), gte(leads.createdAt, monthAgo))),
    d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, monthAgo)),
    d.select({ count: sql<number>`count(*)` }).from(bookings).where(and(eq(bookings.status, "completed"), gte(bookings.createdAt, monthAgo))),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.status, "new"), lte(leads.createdAt, weekAgo))),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.source, "estimate"), eq(leads.status, "new"), lte(leads.createdAt, weekAgo))),
  ]);

  const estTotal = totalEstimateLeads[0]?.count ?? 0;
  const estBooked = bookedEstimateLeads[0]?.count ?? 0;
  const leadTotal = totalLeads[0]?.count ?? 0;
  const leadBooked = bookedLeads[0]?.count ?? 0;
  const bookTotal = totalBookings[0]?.count ?? 0;
  const bookComplete = completedBookings[0]?.count ?? 0;

  const estimateToInvoice = estTotal > 0 ? Math.round((estBooked / estTotal) * 100) : 0;
  const leadToBooking = leadTotal > 0 ? Math.round((leadBooked / leadTotal) * 100) : 0;
  const bookingToInvoice = bookTotal > 0 ? Math.round((bookComplete / bookTotal) * 100) : 0;

  const insights: string[] = [];

  // Generate insights based on data
  if (estimateToInvoice < 20 && estTotal > 5) {
    insights.push(`LOST REVENUE: Only ${estimateToInvoice}% of estimates convert to jobs. ${estTotal - estBooked} estimates sitting unconverted.`);
  }
  if ((staleNewLeads[0]?.count ?? 0) > 3) {
    insights.push(`STALE LEADS: ${staleNewLeads[0]?.count} leads older than 7 days still marked "new". Follow up or close them.`);
  }
  if ((staleEstimateLeads[0]?.count ?? 0) > 2) {
    insights.push(`LOST SALES: ${staleEstimateLeads[0]?.count} estimate requests over 7 days with no follow-up. These are customers who wanted work done.`);
  }
  if (bookingToInvoice < 50 && bookTotal > 10) {
    insights.push(`COMPLETION GAP: Only ${bookingToInvoice}% of drop-offs result in completed jobs. Check what's blocking completion.`);
  }

  return {
    estimateToInvoice,
    leadToBooking,
    bookingToInvoice,
    staleLeads: staleNewLeads[0]?.count ?? 0,
    staleEstimates: staleEstimateLeads[0]?.count ?? 0,
    insights,
  };
}

// ─── REVENUE PROJECTION ───────────────────────────────

export async function projectRevenue(): Promise<{
  thisWeekProjection: number;
  thisMonthProjection: number;
  trend: "up" | "down" | "flat";
  weekOverWeek: number;
  avgDailyRevenue: number;
}> {
  const d = await db();
  if (!d) return { thisWeekProjection: 0, thisMonthProjection: 0, trend: "flat", weekOverWeek: 0, avgDailyRevenue: 0 };

  const { invoices } = await import("../../drizzle/schema");
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [thisWeekInvoices, lastWeekInvoices, monthInvoices] = await Promise.all([
    d.select().from(invoices).where(and(gte(invoices.invoiceDate, weekAgo), eq(invoices.paymentStatus, "paid"))),
    d.select().from(invoices).where(and(gte(invoices.invoiceDate, twoWeeksAgo), lte(invoices.invoiceDate, weekAgo), eq(invoices.paymentStatus, "paid"))),
    d.select().from(invoices).where(and(gte(invoices.invoiceDate, monthAgo), eq(invoices.paymentStatus, "paid"))),
  ]);

  const thisWeekRev = thisWeekInvoices.reduce((s, i) => s + i.totalAmount, 0) / 100;
  const lastWeekRev = lastWeekInvoices.reduce((s, i) => s + i.totalAmount, 0) / 100;
  const monthRev = monthInvoices.reduce((s, i) => s + i.totalAmount, 0) / 100;

  const dayOfWeek = now.getDay(); // 0=Sun
  const daysIntoWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
  const avgDailyThisWeek = daysIntoWeek > 0 ? thisWeekRev / daysIntoWeek : 0;
  const thisWeekProjection = Math.round(avgDailyThisWeek * 7);

  const avgDailyMonth = monthRev / 30;
  const daysLeft = 30 - now.getDate();
  const thisMonthProjection = Math.round(monthRev + (avgDailyMonth * daysLeft));

  const weekOverWeek = lastWeekRev > 0 ? Math.round(((thisWeekRev - lastWeekRev) / lastWeekRev) * 100) : 0;
  const trend = weekOverWeek > 5 ? "up" : weekOverWeek < -5 ? "down" : "flat";

  return {
    thisWeekProjection,
    thisMonthProjection,
    trend,
    weekOverWeek,
    avgDailyRevenue: Math.round(avgDailyMonth),
  };
}

// ─── PROACTIVE ALERTS ─────────────────────────────────

export async function generateProactiveAlerts(): Promise<string[]> {
  const d = await db();
  if (!d) return [];

  const { leads, callbackRequests, bookings } = await import("../../drizzle/schema");
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const alerts: string[] = [];

  // Check for urgent unhandled items
  const [urgentLeads, urgentCallbacks, todayBookings] = await Promise.all([
    d.select({ count: sql<number>`count(*)` }).from(leads)
      .where(and(eq(leads.status, "new"), sql`${leads.urgencyScore} >= 4`)),
    d.select({ count: sql<number>`count(*)` }).from(callbackRequests)
      .where(eq(callbackRequests.status, "new")),
    d.select({ count: sql<number>`count(*)` }).from(bookings)
      .where(gte(bookings.createdAt, new Date(now.getFullYear(), now.getMonth(), now.getDate()))),
  ]);

  if ((urgentLeads[0]?.count ?? 0) > 0) {
    alerts.push(`🔴 ${urgentLeads[0]?.count} URGENT leads need immediate attention`);
  }
  if ((urgentCallbacks[0]?.count ?? 0) > 2) {
    alerts.push(`📞 ${urgentCallbacks[0]?.count} callbacks waiting — customers expecting a call back`);
  }
  if ((todayBookings[0]?.count ?? 0) === 0 && now.getHours() >= 10 && now.getDay() >= 1 && now.getDay() <= 6) {
    alerts.push(`⚠️ Zero drop-offs today and it's ${now.getHours() > 12 ? "afternoon" : "mid-morning"} — slow day or tracking issue?`);
  }

  return alerts;
}

// ─── AI INSIGHT GENERATOR ─────────────────────────────

export async function generateWeeklyInsight(): Promise<string> {
  const pipeline = await analyzeConversionPipeline();
  const revenue = await projectRevenue();
  const alerts = await generateProactiveAlerts();

  const dataBlock = `CONVERSION PIPELINE (30 days):
- Estimate → Job: ${pipeline.estimateToInvoice}%
- Lead → Booking: ${pipeline.leadToBooking}%
- Booking → Completed: ${pipeline.bookingToInvoice}%
- Stale leads: ${pipeline.staleLeads}
- Stale estimates: ${pipeline.staleEstimates}

REVENUE:
- This week projection: $${revenue.thisWeekProjection}
- This month projection: $${revenue.thisMonthProjection}
- Week over week: ${revenue.weekOverWeek > 0 ? "+" : ""}${revenue.weekOverWeek}%
- Trend: ${revenue.trend}
- Avg daily: $${revenue.avgDailyRevenue}

ALERTS: ${alerts.length > 0 ? alerts.join("; ") : "None"}
INSIGHTS: ${pipeline.insights.join("; ") || "None"}`;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are Nick AI analyzing business performance for Nick's Tire & Auto. Generate ONE sharp, actionable insight in 2-3 sentences. Focus on the highest-leverage opportunity or biggest risk. Be specific — reference the numbers. No fluff.`,
        },
        { role: "user", content: dataBlock },
      ],
      maxTokens: 300,
    });
    return response.choices?.[0]?.message?.content || "No insight generated";
  } catch {
    return pipeline.insights[0] || "Data analysis pending";
  }
}

// ─── PROACTIVE CHECK (runs every 2 hours) ─────────────

export async function runProactiveCheck(): Promise<{ recordsProcessed?: number; details?: string }> {
  const alerts = await generateProactiveAlerts();
  const pipeline = await analyzeConversionPipeline();

  // Combine critical alerts + pipeline insights
  const allAlerts = [...alerts, ...pipeline.insights.filter(i => i.startsWith("LOST") || i.startsWith("STALE"))];

  if (allAlerts.length > 0) {
    try {
      const { sendTelegram } = await import("./telegram");
      const insight = await generateWeeklyInsight();

      await sendTelegram(
        `🧠 NICK AI — Proactive Check\n\n` +
        allAlerts.join("\n") +
        `\n\n💡 INSIGHT: ${insight}\n\n` +
        `Command Center: https://nickstire.org/admin`
      );

      log.info(`Proactive check: ${allAlerts.length} alerts sent`);
    } catch (err) {
      log.error("Proactive alert failed:", err instanceof Error ? err.message : err);
    }
  }

  return { recordsProcessed: allAlerts.length, details: `${allAlerts.length} alerts, pipeline: ${pipeline.estimateToInvoice}% est→job` };
}
