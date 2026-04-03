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
import { eq, gte, sql, and, lte } from "drizzle-orm";
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
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(sql`${leads.source} = 'estimate'`, sql`${leads.createdAt} >= ${monthAgo}`)),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(sql`${leads.source} = 'estimate'`, eq(leads.status, "booked"), sql`${leads.createdAt} >= ${monthAgo}`)),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(sql`${leads.createdAt} >= ${monthAgo}`),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.status, "booked"), sql`${leads.createdAt} >= ${monthAgo}`)),
    d.select({ count: sql<number>`count(*)` }).from(bookings).where(sql`${bookings.createdAt} >= ${monthAgo}`),
    d.select({ count: sql<number>`count(*)` }).from(bookings).where(and(eq(bookings.status, "completed"), sql`${bookings.createdAt} >= ${monthAgo}`)),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.status, "new"), sql`${leads.createdAt} <= ${weekAgo}`)),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(sql`${leads.source} = 'estimate'`, eq(leads.status, "new"), sql`${leads.createdAt} <= ${weekAgo}`)),
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
    const content = response.choices?.[0]?.message?.content;
    return (typeof content === "string" ? content : null) || "No insight generated";
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
      log.error("Proactive alert failed:", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { recordsProcessed: allAlerts.length, details: `${allAlerts.length} alerts, pipeline: ${pipeline.estimateToInvoice}% est→job` };
}

// ─── AUTO-ACTIONS (Nick AI acts without being asked) ──

export async function runAutoActions(): Promise<{ recordsProcessed?: number; details?: string }> {
  const d = await db();
  if (!d) return { details: "DB unavailable" };

  const pulse = await getShopPulse();
  const pipeline = await analyzeConversionPipeline();
  const { sendTelegram } = await import("./telegram");
  let actions = 0;

  // AUTO-ACTION 1: High walk rate alert + suggestion
  if (pulse.thisWeek.walkRate > 40 && pulse.thisWeek.jobsClosed > 5) {
    await sendTelegram(
      `⚠️ NICK AI AUTO-ACTION: Walk Rate ${pulse.thisWeek.walkRate}%\n\n` +
      `${Math.round(pulse.thisWeek.walkRate)}% of customers this week got estimates but didn't convert.\n\n` +
      `Suggestions:\n` +
      `• Follow up on recent estimates — call them back\n` +
      `• Consider running a "come back" promo ($25 off with estimate)\n` +
      `• Review pricing vs competitors\n` +
      `• Are techs explaining value clearly during inspections?`
    );
    actions++;
  }

  // AUTO-ACTION 2: Great day celebration
  const revenue = await projectRevenue();
  if (pulse.today.revenue > revenue.avgDailyRevenue * 1.5 && pulse.today.revenue > 500) {
    await sendTelegram(
      `🎉 GREAT DAY! Revenue $${pulse.today.revenue.toLocaleString()} — ` +
      `${Math.round((pulse.today.revenue / Math.max(revenue.avgDailyRevenue, 1)) * 100)}% of daily average!\n\n` +
      `${pulse.today.jobsClosed} jobs closed. Avg ticket: $${pulse.today.avgTicket}. Keep it going!`
    );
    actions++;
  }

  // AUTO-ACTION 3: Slow day by noon — push marketing
  const hour = new Date().getHours();
  if (hour >= 12 && hour <= 14 && pulse.today.jobsClosed < 2 && pulse.shopStatus === "slow") {
    await sendTelegram(
      `📉 NICK AI: Slow day alert — only ${pulse.today.jobsClosed} jobs by noon.\n\n` +
      `Suggestions:\n` +
      `• Post a same-day special on Instagram/Facebook\n` +
      `• Text recent estimate customers: "Still need that repair? Come in today"\n` +
      `• Check if there are pending callbacks to return`
    );
    actions++;
  }

  // AUTO-ACTION 4: Learn day-of-week patterns
  try {
    const { remember } = await import("./nickMemory");
    const { invoices } = await import("../../drizzle/schema");
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const dayRevenue = await d.execute(
      sql`SELECT DAYOFWEEK(invoiceDate) as dow, COUNT(*) as cnt, SUM(totalAmount) as rev
          FROM invoices WHERE invoiceDate >= ${thirtyDaysAgo} AND paymentStatus = 'paid'
          GROUP BY dow ORDER BY rev DESC`
    );

    if (Array.isArray(dayRevenue) && dayRevenue.length > 0) {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const best = dayRevenue[0] as any;
      const worst = dayRevenue[dayRevenue.length - 1] as any;
      const bestDay = days[Number(best.dow) - 1] || "?";
      const worstDay = days[Number(worst.dow) - 1] || "?";

      await remember({
        type: "pattern",
        content: `Busiest day: ${bestDay} ($${Math.round(Number(best.rev) / 100 / 4)}/avg). Slowest: ${worstDay} ($${Math.round(Number(worst.rev) / 100 / 4)}/avg).`,
        source: "auto_analysis",
        confidence: 0.85,
      });
    }
  } catch {}

  return { recordsProcessed: actions, details: `${actions} auto-actions taken` };
}

// ─── SHOP PULSE (real-time business awareness) ────────

export async function getShopPulse(): Promise<{
  today: {
    jobsClosed: number;     // Invoices created today = jobs done
    customersWalked: number; // Estimates without invoice = walked away
    revenue: number;         // Today's paid invoice total
    avgTicket: number;       // Average ticket today
    dropOffs: number;        // Bookings/walk-ins today
    pendingPayments: number; // Invoices with pending payment
    callbacksWaiting: number;
  };
  thisWeek: {
    jobsClosed: number;
    revenue: number;
    avgTicket: number;
    walkRate: number;        // % of estimates that didn't convert
  };
  shopStatus: string;        // "busy" | "steady" | "slow" | "closed"
  shopInsight: string;       // One-liner about current state
}> {
  const d = await db();
  const empty = {
    today: { jobsClosed: 0, customersWalked: 0, revenue: 0, avgTicket: 0, dropOffs: 0, pendingPayments: 0, callbacksWaiting: 0 },
    thisWeek: { jobsClosed: 0, revenue: 0, avgTicket: 0, walkRate: 0 },
    shopStatus: "unknown" as string,
    shopInsight: "No data",
  };
  if (!d) return empty;

  const { invoices, leads, bookings, callbackRequests } = await import("../../drizzle/schema");
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const hour = now.getHours();

  const [
    todayInvoicesPaid, todayInvoicesPending, todayEstimateLeads,
    todayBookings, todayCallbacks,
    weekInvoicesPaid, weekEstimateLeads,
  ] = await Promise.all([
    // Today's closed jobs (paid invoices)
    d.select().from(invoices).where(and(
      sql`${invoices.invoiceDate} >= ${todayStart}`,
      eq(invoices.paymentStatus, "paid")
    )),
    // Today's pending payments
    d.select({ count: sql<number>`count(*)` }).from(invoices).where(and(
      sql`${invoices.invoiceDate} >= ${todayStart}`,
      eq(invoices.paymentStatus, "pending")
    )),
    // Today's estimates (potential walks)
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(
      sql`${leads.source} = 'estimate'`,
      sql`${leads.createdAt} >= ${todayStart}`
    )),
    // Today's drop-offs
    d.select({ count: sql<number>`count(*)` }).from(bookings).where(
      sql`${bookings.createdAt} >= ${todayStart}`
    ),
    // Pending callbacks
    d.select({ count: sql<number>`count(*)` }).from(callbackRequests).where(
      eq(callbackRequests.status, "new")
    ),
    // This week's closed jobs
    d.select().from(invoices).where(and(
      sql`${invoices.invoiceDate} >= ${weekAgo}`,
      eq(invoices.paymentStatus, "paid")
    )),
    // This week's estimates
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(
      sql`${leads.source} = 'estimate'`,
      sql`${leads.createdAt} >= ${weekAgo}`
    )),
  ]);

  // Calculate today
  const todayRevenue = todayInvoicesPaid.reduce((s, i) => s + i.totalAmount, 0) / 100;
  const todayJobsClosed = todayInvoicesPaid.length;
  const todayAvgTicket = todayJobsClosed > 0 ? Math.round(todayRevenue / todayJobsClosed) : 0;
  const todayEstimates = todayEstimateLeads[0]?.count ?? 0;

  // Calculate week
  const weekRevenue = weekInvoicesPaid.reduce((s, i) => s + i.totalAmount, 0) / 100;
  const weekJobsClosed = weekInvoicesPaid.length;
  const weekAvgTicket = weekJobsClosed > 0 ? Math.round(weekRevenue / weekJobsClosed) : 0;
  const weekEstimates = weekEstimateLeads[0]?.count ?? 0;
  const weekWalkRate = weekEstimates > 0 && weekJobsClosed > 0
    ? Math.round((1 - weekJobsClosed / (weekJobsClosed + weekEstimates)) * 100)
    : 0;

  // Determine shop status
  let shopStatus: string;
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 0 && hour >= 16) { shopStatus = "closed"; }
  else if (hour < 8 || hour >= 18) { shopStatus = "closed"; }
  else if (todayJobsClosed >= 8 || (todayJobsClosed >= 4 && hour < 12)) { shopStatus = "busy"; }
  else if (todayJobsClosed >= 3 || (todayJobsClosed >= 1 && hour < 11)) { shopStatus = "steady"; }
  else { shopStatus = "slow"; }

  // Generate quick insight
  let shopInsight: string;
  if (shopStatus === "busy") {
    shopInsight = `Strong day — ${todayJobsClosed} jobs closed, $${todayRevenue.toLocaleString()} revenue so far.`;
  } else if (shopStatus === "slow" && hour >= 12) {
    shopInsight = `Slow afternoon — only ${todayJobsClosed} jobs closed. ${todayEstimates} estimates given (potential walks). Push follow-ups.`;
  } else if (todayEstimates > todayJobsClosed && todayEstimates > 0) {
    shopInsight = `More estimates (${todayEstimates}) than closed jobs (${todayJobsClosed}). Customers are walking — check pricing or follow-up.`;
  } else if (weekWalkRate > 40) {
    shopInsight = `Walk rate is ${weekWalkRate}% this week. Nearly half of estimates aren't converting. Time to review pricing strategy.`;
  } else {
    shopInsight = `${todayJobsClosed} jobs, $${todayRevenue.toLocaleString()} today. Avg ticket: $${todayAvgTicket}.`;
  }

  return {
    today: {
      jobsClosed: todayJobsClosed,
      customersWalked: todayEstimates, // estimates = inspections where customer walked
      revenue: todayRevenue,
      avgTicket: todayAvgTicket,
      dropOffs: todayBookings[0]?.count ?? 0,
      pendingPayments: todayInvoicesPending[0]?.count ?? 0,
      callbacksWaiting: todayCallbacks[0]?.count ?? 0,
    },
    thisWeek: {
      jobsClosed: weekJobsClosed,
      revenue: weekRevenue,
      avgTicket: weekAvgTicket,
      walkRate: weekWalkRate,
    },
    shopStatus,
    shopInsight,
  };
}
