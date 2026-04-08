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
    // Estimate leads = leads with a recommendedService (from AI scoring), since 'estimate' is not a valid source enum value
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(sql`${leads.recommendedService} IS NOT NULL`, sql`${leads.createdAt} >= ${monthAgo}`)),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(sql`${leads.recommendedService} IS NOT NULL`, eq(leads.status, "booked"), sql`${leads.createdAt} >= ${monthAgo}`)),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(sql`${leads.createdAt} >= ${monthAgo}`),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.status, "booked"), sql`${leads.createdAt} >= ${monthAgo}`)),
    d.select({ count: sql<number>`count(*)` }).from(bookings).where(sql`${bookings.createdAt} >= ${monthAgo}`),
    d.select({ count: sql<number>`count(*)` }).from(bookings).where(and(eq(bookings.status, "completed"), sql`${bookings.createdAt} >= ${monthAgo}`)),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.status, "new"), sql`${leads.createdAt} <= ${weekAgo}`)),
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(sql`${leads.recommendedService} IS NOT NULL`, eq(leads.status, "new"), sql`${leads.createdAt} <= ${weekAgo}`)),
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

  const thisWeekRev = thisWeekInvoices.reduce((s: any, i: any) => s + i.totalAmount, 0) / 100;
  const lastWeekRev = lastWeekInvoices.reduce((s: any, i: any) => s + i.totalAmount, 0) / 100;
  const monthRev = monthInvoices.reduce((s: any, i: any) => s + i.totalAmount, 0) / 100;

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

  const urgentLeadCount = urgentLeads[0]?.count ?? 0;
  const callbackCount = urgentCallbacks[0]?.count ?? 0;
  const bookingCount = todayBookings[0]?.count ?? 0;
  const etHour = parseInt(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
  const dayOfWeek = now.getDay(); // 0=Sun

  if (urgentLeadCount > 0) {
    alerts.push(`🔴 ${urgentLeadCount} URGENT lead${urgentLeadCount > 1 ? "s" : ""} — these are high-intent, call within 5 minutes`);
  }
  if (callbackCount > 0) {
    alerts.push(`📞 ${callbackCount} callback${callbackCount > 1 ? "s" : ""} waiting — every hour of delay = lower conversion rate`);
  }
  if (bookingCount === 0 && etHour >= 10 && dayOfWeek >= 1 && dayOfWeek <= 6) {
    alerts.push(`⚠️ Zero drop-offs today by ${etHour > 12 ? etHour - 12 + "pm" : etHour + "am"} — check if tracking is working or push marketing`);
  }

  // Check for estimates aging without follow-up
  try {
    const twoHoursAgoDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const [agingEstimates] = await d.select({ count: sql<number>`count(*)` }).from(leads)
      .where(and(
        sql`${leads.recommendedService} IS NOT NULL`,
        eq(leads.status, "new"),
        sql`${leads.createdAt} <= ${twoHoursAgoDate}`,
        gte(leads.createdAt, new Date(now.getFullYear(), now.getMonth(), now.getDate()))
      ));
    const agingCount = agingEstimates?.count ?? 0;
    if (agingCount > 0) {
      alerts.push(`💸 ${agingCount} estimate${agingCount > 1 ? "s" : ""} aging without follow-up — conversion drops 50% after 2 hours`);
    }
  } catch (e) { console.warn("[intelligence:proactiveAlerts] aging estimates check failed:", e); }

  // Check pending payments (invoices sent but not paid)
  try {
    const { invoices } = await import("../../drizzle/schema");
    const [pendingPayments] = await d.select({ count: sql<number>`count(*)`, total: sql<number>`SUM(totalAmount)` }).from(invoices)
      .where(eq(invoices.paymentStatus, "pending"));
    const pendingCount = pendingPayments?.count ?? 0;
    const pendingTotal = Math.round((pendingPayments?.total ?? 0) / 100);
    if (pendingCount > 3 && pendingTotal > 500) {
      alerts.push(`💳 $${pendingTotal} in ${pendingCount} unpaid invoices — follow up on outstanding payments`);
    }
  } catch (e) { console.warn("[intelligence:proactiveAlerts] pending payments check failed:", e); }

  // Check if review requests are being sent
  try {
    const { reviewRequests } = await import("../../drizzle/schema");
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [recentReviews] = await d.select({ count: sql<number>`count(*)` }).from(reviewRequests)
      .where(gte(reviewRequests.createdAt, weekAgo));
    if ((recentReviews?.count ?? 0) === 0 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      alerts.push(`⭐ Zero review requests sent this week — reviews are the #1 growth lever, send 3-5 today`);
    }
  } catch (e) { console.warn("[intelligence:proactiveAlerts] review requests check failed:", e); }

  // Monday morning special: weekly planning prompt
  if (dayOfWeek === 1 && etHour >= 8 && etHour <= 10) {
    alerts.push(`📋 MONDAY: Set this week's revenue target and top 3 priorities. Last week walk rate: ${(await getShopPulse().catch(() => ({ thisWeek: { walkRate: 0 } }))).thisWeek.walkRate}%`);
  }

  // Friday afternoon: week wrap-up prompt
  if (dayOfWeek === 5 && etHour >= 15 && etHour <= 17) {
    alerts.push(`📊 FRIDAY: Review this week's numbers, declined work recovery, and schedule next week's follow-ups`);
  }

  // At-risk high-value customers — more important than stale leads
  try {
    const { analyzeCustomers } = await import("./customerIntelligence");
    const ci = await analyzeCustomers();
    if (ci.atRiskCustomers.length > 0) {
      const topRisk = ci.atRiskCustomers[0];
      alerts.push(`💸 AT-RISK CUSTOMER: ${topRisk.name} (${topRisk.daysSince}d since last visit) — call ${topRisk.phone} before they go elsewhere`);
    }
    if (ci.lapsedCustomers > ci.activeCustomers && ci.totalCustomers > 20) {
      alerts.push(`📉 More lapsed (${ci.lapsedCustomers}) than active (${ci.activeCustomers}) customers — retention needs attention`);
    }
  } catch (e) { console.warn("[intelligence:proactiveAlerts] at-risk customer check failed:", e); }

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

      // Track alert outcomes — schedule a check to see if action was taken
      try {
        const { trackAlertOutcome } = await import("./feedbackLoop");
        // Record each alert type for outcome tracking
        for (const alert of allAlerts) {
          const alertType = alert.includes("STALE") ? "stale_leads" : alert.includes("LOST") ? "lost_revenue" : "proactive";
          // For now mark as unknown — a follow-up check in the feedback cycle will verify
          await trackAlertOutcome(alertType, "unknown");
        }
      } catch (e) { console.warn("[intelligence:proactiveCheck] alert outcome tracking failed:", e); }

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

  // Load memories for smarter decisions
  let memoryInsights: string[] = [];
  try {
    const { recall } = await import("./nickMemory");
    const memories = await recall({ type: "pattern", limit: 5 });
    memoryInsights = memories.map(m => m.content);
  } catch (e) { console.warn("[intelligence:autoActions] memory recall for patterns failed:", e); }

  // AUTO-ACTION 1: High walk rate alert + suggestion
  if (pulse.thisWeek.walkRate > 40 && pulse.thisWeek.jobsClosed > 5) {
    try {
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
    } catch (e) { console.warn("[intelligence:autoAction1] high walk rate alert failed:", e); }
  }

  // AUTO-ACTION 2: Great day celebration
  const revenue = await projectRevenue();
  if (pulse.today.revenue > revenue.avgDailyRevenue * 1.5 && pulse.today.revenue > 500) {
    try {
      await sendTelegram(
        `🎉 GREAT DAY! Revenue $${pulse.today.revenue.toLocaleString()} — ` +
        `${Math.round((pulse.today.revenue / Math.max(revenue.avgDailyRevenue, 1)) * 100)}% of daily average!\n\n` +
        `${pulse.today.jobsClosed} jobs closed. Avg ticket: $${pulse.today.avgTicket}. Keep it going!`
      );
      actions++;
    } catch (e) { console.warn("[intelligence:autoAction2] great day celebration alert failed:", e); }
  }

  // AUTO-ACTION 3: Slow day by noon — push marketing + measure revenue impact
  const hour = new Date().getHours();
  const etHour = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
  if (hour >= 12 && hour <= 14 && pulse.today.jobsClosed < 2 && pulse.shopStatus === "slow") {
    const beforeRevenue = pulse.today.revenue;
    await sendTelegram(
      `📉 NICK AI: Slow day alert — only ${pulse.today.jobsClosed} jobs by noon.\n\n` +
      `Suggestions:\n` +
      `• Post a same-day special on Instagram/Facebook\n` +
      `• Text recent estimate customers: "Still need that repair? Come in today"\n` +
      `• Check if there are pending callbacks to return`
    );

    // Measure if this alert drove action — check revenue later
    try {
      const { measureRevenueImpact, trackAlertOutcome } = await import("./feedbackLoop");
      // Schedule revenue comparison (will run on next feedback cycle)
      measureRevenueImpact("slow_day_push", beforeRevenue).catch(e => console.warn("[intelligence:autoAction3] revenue impact measurement failed:", e));
      await trackAlertOutcome("slow_day_push", "unknown");
    } catch (e) { console.warn("[intelligence:autoAction3] slow day feedback tracking failed:", e); }

    actions++;
  }

  // AUTO-ACTION 4: Auto-follow-up on hot estimates (>$500, no invoice within 4h)
  try {
    const { leads: leadsTable, invoices: invoicesTable } = await import("../../drizzle/schema");
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));

    const hotEstimates = await d.select().from(leadsTable)
      .where(and(
        sql`${leadsTable.recommendedService} IS NOT NULL`,
        eq(leadsTable.status, "new"),
        gte(leadsTable.createdAt, todayStart),
        sql`${leadsTable.createdAt} <= ${fourHoursAgo}`
      ))
      .limit(5);

    if (hotEstimates.length > 0) {
      await sendTelegram(
        `🔥 NICK AUTO-ACTION: ${hotEstimates.length} estimate leads need follow-up!\n\n` +
        hotEstimates.slice(0, 3).map((l: any) =>
          `${l.name || "?"} (${l.phone || "no phone"}) — ${l.recommendedService || "estimate"} — ${Math.round((Date.now() - new Date(l.createdAt).getTime()) / 3600000)}h ago`
        ).join("\n") +
        `\n\n⚡ Call them NOW — estimates convert 3x better within 4 hours.`
      );
      actions++;
    }
  } catch (e) { console.warn("[intelligence:autoAction4] hot estimate follow-up failed:", e); }

  // AUTO-ACTION 5: Detect revenue anomaly (today vs same day last week)
  try {
    const revenue = await projectRevenue();
    const etHour = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
    if (etHour >= 14 && pulse.today.revenue < revenue.avgDailyRevenue * 0.3 && revenue.avgDailyRevenue > 200) {
      await sendTelegram(
        `📉 NICK AUTO-ACTION: Revenue anomaly detected\n\n` +
        `Today: $${pulse.today.revenue} (only ${Math.round((pulse.today.revenue / revenue.avgDailyRevenue) * 100)}% of daily average)\n` +
        `Average: $${revenue.avgDailyRevenue}/day\n` +
        `Jobs: ${pulse.today.jobsClosed}\n\n` +
        `Possible causes: slow traffic, missed leads, or tracking issue.\n` +
        `Check: Are callbacks returned? Are estimates being followed up?`
      );
      actions++;
    }
  } catch (e) { console.warn("[intelligence:autoAction5] revenue anomaly detection failed:", e); }

  // AUTO-ACTION 6: Detect callback backlog (>3 unanswered)
  if (pulse.today.callbacksWaiting > 3) {
    try {
      await sendTelegram(
        `📞 NICK AUTO-ACTION: ${pulse.today.callbacksWaiting} callbacks waiting!\n\n` +
        `These customers are expecting a call back. Every hour of delay = lower conversion.\n` +
        `⚡ Clear the callback queue NOW.`
      );
      actions++;
    } catch (e) { console.warn("[intelligence:autoAction6] callback backlog alert failed:", e); }
  }

  // AUTO-ACTION 7: Evening debrief (auto-generated at 5-6pm with AI analysis)
  try {
    const etHour2 = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
    if (etHour2 >= 17 && etHour2 <= 18) {
      const { analyzeCustomers, getCustomerActionPlan } = await import("./customerIntelligence");
      const ci = await analyzeCustomers();
      const plan = await getCustomerActionPlan();
      const rev = await projectRevenue();

      // Calculate today's score (0-100)
      const revenueScore = Math.min(100, Math.round((pulse.today.revenue / Math.max(rev.avgDailyRevenue, 1)) * 100));
      const walkScore = Math.max(0, 100 - pulse.thisWeek.walkRate * 2);
      const callbackScore = pulse.today.callbacksWaiting === 0 ? 100 : Math.max(0, 100 - pulse.today.callbacksWaiting * 20);
      const dayScore = Math.round((revenueScore + walkScore + callbackScore) / 3);

      const grade = dayScore >= 90 ? "A+" : dayScore >= 80 ? "A" : dayScore >= 70 ? "B" : dayScore >= 60 ? "C" : dayScore >= 50 ? "D" : "F";

      // Calculate remaining days + daily target for $10K/month
      const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      const dayOfMonth = new Date().getDate();
      const remainingDays = Math.max(1, daysInMonth - dayOfMonth);
      const monthTarget = 10000;
      const earnedSoFar = rev.thisMonthProjection ? Math.round(rev.thisMonthProjection * (dayOfMonth / daysInMonth)) : pulse.thisWeek.revenue;
      const remainingToTarget = Math.max(0, monthTarget - earnedSoFar);
      const dailyTargetRemaining = Math.round(remainingToTarget / remainingDays);

      await sendTelegram(
        `📊 NICK EVENING DEBRIEF — ${grade} DAY (${dayScore}/100)\n\n` +
        `💰 Revenue: $${pulse.today.revenue} (${revenueScore}% of target)\n` +
        `🔧 Jobs: ${pulse.today.jobsClosed} completed | ${pulse.today.customersWalked} walked\n` +
        `📊 Walk rate: ${pulse.thisWeek.walkRate}% | Avg ticket: $${pulse.today.avgTicket}\n` +
        `📞 Callbacks: ${pulse.today.callbacksWaiting} still pending\n` +
        `📈 Week: $${Math.round(pulse.thisWeek.revenue)} / $${rev.thisWeekProjection} projected\n` +
        `📅 Month: $${rev.thisMonthProjection} projected (${rev.trend})\n\n` +
        `SCORING: Revenue ${revenueScore}/100 | Walk ${walkScore}/100 | Callbacks ${callbackScore}/100\n\n` +
        `🎯 $10K TARGET: $${remainingToTarget} left → need $${dailyTargetRemaining}/day for ${remainingDays} remaining days\n\n` +
        `PERSONAL CHECK:\n` +
        `- Did you work out today? Body affects business.\n` +
        `- Did you follow up on yesterday's priorities?\n` +
        `- Are you building or drifting? Boring repetition > intensity spikes.\n\n` +
        (ci.atRiskCustomers.length > 0 ? `⚠️ ${ci.atRiskCustomers.length} at-risk customers — call them FIRST tomorrow\n` : "") +
        (plan ? `\n${plan.slice(0, 300)}` : "") +
        `\n\n${pulse.shopInsight}`
      );

      // Store daily score in memory
      const { remember: remScore } = await import("./nickMemory");
      await remScore({
        type: "pattern",
        content: `Day score: ${grade} (${dayScore}/100). Revenue $${pulse.today.revenue}, ${pulse.today.jobsClosed} jobs, ${pulse.today.customersWalked} walked, ${pulse.today.callbacksWaiting} callbacks pending. Walk rate ${pulse.thisWeek.walkRate}%.`,
        source: "daily_score",
        confidence: 0.95,
      });

      actions++;
    }
  } catch (e) { console.warn("[intelligence:autoAction7] evening debrief generation failed:", e); }

  // AUTO-ACTION 8: Learn day-of-week patterns
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
  } catch (e) { console.warn("[intelligence:autoAction8] day-of-week pattern learning failed:", e); }

  // ═══ VERSION 2.1 AUTO-ACTIONS ═══

  // AUTO-ACTION 9: Invoice aging escalation (unpaid >7d, >14d, >30d)
  try {
    const { invoices: invTable } = await import("../../drizzle/schema");
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const agingInvoices = await d.select().from(invTable)
      .where(and(eq(invTable.paymentStatus, "pending"), sql`${invTable.invoiceDate} <= ${sevenDaysAgo}`))
      .orderBy(sql`${invTable.invoiceDate} ASC`)
      .limit(10);

    if (agingInvoices.length > 0) {
      const critical = agingInvoices.filter((inv: any) => new Date(inv.invoiceDate) < fourteenDaysAgo);
      const totalOwed = Math.round(agingInvoices.reduce((s: number, inv: any) => s + inv.totalAmount, 0) / 100);

      await sendTelegram(
        `💰 INVOICE AGING ALERT\n\n` +
        `${agingInvoices.length} unpaid invoices >7 days ($${totalOwed} total)\n` +
        (critical.length > 0 ? `🔴 ${critical.length} are >14 days old — ESCALATE\n\n` : "\n") +
        agingInvoices.slice(0, 5).map((inv: any) => {
          const days = Math.round((Date.now() - new Date(inv.invoiceDate).getTime()) / (24 * 60 * 60 * 1000));
          return `${inv.customerName || "?"}: $${Math.round(inv.totalAmount / 100)} — ${days}d overdue`;
        }).join("\n") +
        `\n\n⚡ Call these customers today for payment`
      );
      actions++;
    }
  } catch (e) { console.warn("[intelligence:autoAction9] invoice aging escalation failed:", e); }

  // AUTO-ACTION 10: Cross-sell intelligence (service pattern → recommendation)
  try {
    const { remember } = await import("./nickMemory");
    const { invoices: invTable2 } = await import("../../drizzle/schema");
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Find customers who got brakes but not tires (or vice versa)
    const recentInvoices = await d.select().from(invTable2)
      .where(and(gte(invTable2.invoiceDate, ninetyDaysAgo), eq(invTable2.paymentStatus, "paid")))
      .limit(100);

    const customerServices: Record<string, Set<string>> = {};
    for (const inv of recentInvoices) {
      const name = (inv as any).customerName || "unknown";
      if (!customerServices[name]) customerServices[name] = new Set();
      const desc = ((inv as any).serviceDescription || "").toLowerCase();
      if (desc.includes("brake")) customerServices[name].add("brakes");
      if (desc.includes("tire")) customerServices[name].add("tires");
      if (desc.includes("oil")) customerServices[name].add("oil");
      if (desc.includes("diag") || desc.includes("check engine")) customerServices[name].add("diagnostics");
    }

    const crossSellOpps: string[] = [];
    for (const [name, services] of Object.entries(customerServices)) {
      if (services.has("brakes") && !services.has("tires")) crossSellOpps.push(`${name}: did brakes → check tires`);
      if (services.has("oil") && services.size === 1) crossSellOpps.push(`${name}: oil only → upsell inspection`);
    }

    if (crossSellOpps.length > 3) {
      await remember({
        type: "insight",
        content: `Cross-sell opportunities: ${crossSellOpps.slice(0, 5).join("; ")}. ${crossSellOpps.length} total customers could benefit from additional services.`,
        source: "cross_sell_analysis",
        confidence: 0.75,
      });
      actions++;
    }
  } catch (e) { console.warn("[intelligence:autoAction10] cross-sell analysis failed:", e); }

  // AUTO-ACTION 11: Capacity utilization check
  try {
    const { getDispatchLoad } = await import("./dispatch");
    const load = await getDispatchLoad();
    const clockedIn = (load.techs as any[]).filter((t: any) => t.clockedIn).length;
    const freeBays = (load.bays as any[]).filter((b: any) => !b.occupied).length;
    const totalBays = (load.bays as any[]).length;
    const utilizationPct = totalBays > 0 ? Math.round(((totalBays - freeBays) / totalBays) * 100) : 0;

    if (clockedIn > 0 && freeBays === totalBays && etHour >= 10 && etHour <= 15) {
      await sendTelegram(
        `🔧 CAPACITY ALERT: ${totalBays} bays ALL EMPTY with ${clockedIn} techs clocked in\n\n` +
        `Utilization: ${utilizationPct}%\n` +
        `⚡ Push walk-in traffic or follow up on pending estimates`
      );
      actions++;
    }

    // Learn utilization patterns
    const { remember: rem } = await import("./nickMemory");
    await rem({
      type: "pattern",
      content: `Bay utilization at ${etHour}:00: ${utilizationPct}% (${totalBays - freeBays}/${totalBays} bays, ${clockedIn} techs). ${freeBays === 0 ? "FULL — consider expanding hours." : freeBays === totalBays ? "EMPTY — need more traffic." : "Normal utilization."}`,
      source: "capacity_analysis",
      confidence: 0.7,
    });
  } catch (e) { console.warn("[intelligence:autoAction11] capacity utilization check failed:", e); }

  // AUTO-ACTION 12: Repeat customer detection + VIP treatment
  try {
    const { invoices: invTable3 } = await import("../../drizzle/schema");
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const recentPaid = await d.select().from(invTable3)
      .where(and(gte(invTable3.invoiceDate, sixtyDaysAgo), eq(invTable3.paymentStatus, "paid")))
      .limit(200);

    const visitCounts: Record<string, { count: number; total: number; phone: string }> = {};
    for (const inv of recentPaid) {
      const name = (inv as any).customerName || "unknown";
      if (!visitCounts[name]) visitCounts[name] = { count: 0, total: 0, phone: (inv as any).customerPhone || "" };
      visitCounts[name].count++;
      visitCounts[name].total += (inv as any).totalAmount;
    }

    const vips = Object.entries(visitCounts)
      .filter(([_, v]) => v.count >= 3)
      .sort((a, b) => b[1].total - a[1].total);

    if (vips.length > 0) {
      const { remember: remVip } = await import("./nickMemory");
      await remVip({
        type: "customer",
        content: `VIP customers (3+ visits in 60d): ${vips.slice(0, 5).map(([name, v]) => `${name} (${v.count} visits, $${Math.round(v.total / 100)})`).join(", ")}. These customers deserve priority treatment and proactive outreach.`,
        source: "vip_detection",
        confidence: 0.9,
      });
      actions++;
    }
  } catch (e) { console.warn("[intelligence:autoAction12] VIP customer detection failed:", e); }

  // AUTO-ACTION 13: Service mix analysis (what's selling, what's not)
  try {
    const { remember: remMix } = await import("./nickMemory");
    const { invoices: invTable4 } = await import("../../drizzle/schema");
    const thirtyDaysBack = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const monthInvoices = await d.select().from(invTable4)
      .where(and(gte(invTable4.invoiceDate, thirtyDaysBack), eq(invTable4.paymentStatus, "paid")))
      .limit(200);

    const serviceMix: Record<string, { count: number; revenue: number }> = {};
    for (const inv of monthInvoices) {
      const desc = ((inv as any).serviceDescription || "General").split("\n")[0].slice(0, 40);
      if (!serviceMix[desc]) serviceMix[desc] = { count: 0, revenue: 0 };
      serviceMix[desc].count++;
      serviceMix[desc].revenue += (inv as any).totalAmount;
    }

    const sorted = Object.entries(serviceMix).sort((a, b) => b[1].revenue - a[1].revenue);
    if (sorted.length > 2) {
      await remMix({
        type: "pattern",
        content: `Service mix (30d): Top sellers: ${sorted.slice(0, 3).map(([svc, d]) => `${svc} (${d.count}x, $${Math.round(d.revenue / 100)})`).join(", ")}. Low performers: ${sorted.slice(-2).map(([svc, d]) => `${svc} (${d.count}x)`).join(", ")}. Consider promoting low performers or dropping them.`,
        source: "service_mix_analysis",
        confidence: 0.8,
      });
      actions++;
    }
  } catch (e) { console.warn("[intelligence:autoAction13] service mix analysis failed:", e); }

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
  const hour = parseInt(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);

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
    // Today's estimates (potential walks) — use recommendedService IS NOT NULL as estimate indicator
    d.select({ count: sql<number>`count(*)` }).from(leads).where(and(
      sql`${leads.recommendedService} IS NOT NULL`,
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
      sql`${leads.recommendedService} IS NOT NULL`,
      sql`${leads.createdAt} >= ${weekAgo}`
    )),
  ]);

  // Calculate today
  const todayRevenue = todayInvoicesPaid.reduce((s: any, i: any) => s + i.totalAmount, 0) / 100;
  const todayJobsClosed = todayInvoicesPaid.length;
  const todayAvgTicket = todayJobsClosed > 0 ? Math.round(todayRevenue / todayJobsClosed) : 0;
  const todayEstimates = todayEstimateLeads[0]?.count ?? 0;

  // Calculate week
  const weekRevenue = weekInvoicesPaid.reduce((s: any, i: any) => s + i.totalAmount, 0) / 100;
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

// ─── PREDICTIVE ESCALATION ─────────────────────────────

interface EscalationAlert {
  type: "lead" | "callback" | "estimate" | "booking" | "workorder";
  id: number;
  name: string;
  phone: string | null;
  ageMinutes: number;
  slaMinutes: number;
  severity: "warning" | "critical" | "overdue";
  message: string;
}

/**
 * Predictive escalation — finds items approaching or past SLA thresholds
 * and generates Telegram alerts BEFORE they become emergencies.
 *
 * SLA thresholds:
 * - New leads: warning at 2h, critical at 4h, overdue at 8h
 * - Callbacks: warning at 30min, critical at 1h, overdue at 2h
 * - Estimates (unconverted): warning at 4h, critical at 24h, overdue at 48h
 * - New bookings (unconfirmed): warning at 2h, critical at 8h, overdue at 24h
 */
export async function checkPredictiveEscalations(): Promise<EscalationAlert[]> {
  const d = await db();
  if (!d) return [];

  const { leads, callbackRequests, bookings } = await import("../../drizzle/schema");
  const alerts: EscalationAlert[] = [];
  const now = Date.now();

  try {
    // Check new/uncontacted leads
    const newLeads = await d.select({
      id: leads.id, name: leads.name, phone: leads.phone, createdAt: leads.createdAt,
    }).from(leads)
      .where(and(eq(leads.status, "new"), eq(leads.contacted, 0)))
      .limit(20);

    for (const lead of newLeads) {
      const ageMin = Math.floor((now - new Date(lead.createdAt).getTime()) / 60000);
      if (ageMin >= 480) {
        alerts.push({ type: "lead", id: lead.id, name: lead.name, phone: lead.phone, ageMinutes: ageMin, slaMinutes: 480, severity: "overdue", message: `Lead "${lead.name}" uncontacted for ${Math.floor(ageMin / 60)}h — OVERDUE` });
      } else if (ageMin >= 240) {
        alerts.push({ type: "lead", id: lead.id, name: lead.name, phone: lead.phone, ageMinutes: ageMin, slaMinutes: 240, severity: "critical", message: `Lead "${lead.name}" uncontacted for ${Math.floor(ageMin / 60)}h — approaching SLA breach` });
      } else if (ageMin >= 120) {
        alerts.push({ type: "lead", id: lead.id, name: lead.name, phone: lead.phone, ageMinutes: ageMin, slaMinutes: 120, severity: "warning", message: `Lead "${lead.name}" waiting ${Math.floor(ageMin / 60)}h for contact` });
      }
    }

    // Check pending callbacks
    const pendingCallbacks = await d.select({
      id: callbackRequests.id, name: callbackRequests.name, phone: callbackRequests.phone, createdAt: callbackRequests.createdAt,
    }).from(callbackRequests)
      .where(sql`${callbackRequests.status} IN ('new', 'pending')`)
      .limit(20);

    for (const cb of pendingCallbacks) {
      const ageMin = Math.floor((now - new Date(cb.createdAt).getTime()) / 60000);
      if (ageMin >= 120) {
        alerts.push({ type: "callback", id: cb.id, name: cb.name, phone: cb.phone, ageMinutes: ageMin, slaMinutes: 120, severity: "overdue", message: `Callback for "${cb.name}" waiting ${Math.floor(ageMin / 60)}h — CALL NOW` });
      } else if (ageMin >= 60) {
        alerts.push({ type: "callback", id: cb.id, name: cb.name, phone: cb.phone, ageMinutes: ageMin, slaMinutes: 60, severity: "critical", message: `Callback for "${cb.name}" at ${ageMin}min — they're waiting` });
      } else if (ageMin >= 30) {
        alerts.push({ type: "callback", id: cb.id, name: cb.name, phone: cb.phone, ageMinutes: ageMin, slaMinutes: 30, severity: "warning", message: `Callback for "${cb.name}" at ${ageMin}min` });
      }
    }

    // Check unconfirmed bookings
    const unconfirmedBookings = await d.select({
      id: bookings.id, name: bookings.name, phone: bookings.phone, createdAt: bookings.createdAt,
    }).from(bookings)
      .where(eq(bookings.status, "new"))
      .limit(20);

    for (const bk of unconfirmedBookings) {
      const ageMin = Math.floor((now - new Date(bk.createdAt).getTime()) / 60000);
      if (ageMin >= 1440) {
        alerts.push({ type: "booking", id: bk.id, name: bk.name, phone: bk.phone, ageMinutes: ageMin, slaMinutes: 1440, severity: "overdue", message: `Booking from "${bk.name}" unconfirmed for ${Math.floor(ageMin / 1440)}d — customer may not show up` });
      } else if (ageMin >= 480) {
        alerts.push({ type: "booking", id: bk.id, name: bk.name, phone: bk.phone, ageMinutes: ageMin, slaMinutes: 480, severity: "critical", message: `Booking from "${bk.name}" unconfirmed for ${Math.floor(ageMin / 60)}h` });
      } else if (ageMin >= 120) {
        alerts.push({ type: "booking", id: bk.id, name: bk.name, phone: bk.phone, ageMinutes: ageMin, slaMinutes: 120, severity: "warning", message: `Booking from "${bk.name}" needs confirmation (${Math.floor(ageMin / 60)}h)` });
      }
    }
  } catch (err) {
    log.error("Predictive escalation check failed", { error: String(err) });
  }

  // Sort by severity (overdue first, then critical, then warning)
  const severityOrder = { overdue: 0, critical: 1, warning: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

/**
 * Send predictive escalation alerts via Telegram.
 * Called by the scheduler during business hours.
 */
export async function sendEscalationAlerts(): Promise<{ sent: number }> {
  const alerts = await checkPredictiveEscalations();
  if (alerts.length === 0) return { sent: 0 };

  // Only send critical + overdue via Telegram (warnings surface in admin UI)
  const urgent = alerts.filter(a => a.severity === "overdue" || a.severity === "critical");
  if (urgent.length === 0) return { sent: 0 };

  try {
    const { sendTelegram } = await import("./telegram");
    const lines = urgent.map(a => {
      const icon = a.severity === "overdue" ? "🔴" : "🟡";
      return `${icon} [${a.type.toUpperCase()}] ${a.message}${a.phone ? ` — tel:${a.phone}` : ""}`;
    });

    await sendTelegram(
      `⚠️ NICK AI ESCALATION (${urgent.length} items)\n\n${lines.join("\n")}`
    );

    return { sent: urgent.length };
  } catch (err) {
    log.error("Failed to send escalation alerts", { error: String(err) });
    return { sent: 0 };
  }
}
