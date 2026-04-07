/**
 * Nick AI Morning Brief — Full Circle Operator Intelligence
 *
 * This isn't just numbers. Nick AI analyzes everything, spots patterns,
 * and sends Nour a brief that covers business + life + execution.
 *
 * Uses Venice AI (llama-3.3-70b) to generate the actual brief content
 * so it reads like a chief of staff wrote it, not a database query.
 */
import { createLogger } from "../../lib/logger";
import { eq, gte, sql, and, desc } from "drizzle-orm";
import { invokeLLM } from "../../_core/llm";

const log = createLogger("cron:morning-brief");

async function db() {
  const { getDb } = await import("../../db");
  return getDb();
}

export async function sendMorningBrief(): Promise<{ recordsProcessed?: number; details?: string }> {
  const { sendTelegram } = await import("../../services/telegram");
  const d = await db();

  if (!d) {
    log.warn("DB not available, skipping morning brief");
    return { details: "DB unavailable" };
  }

  try {
    const { leads, bookings, invoices, callbackRequests, customers, reviewRequests, workOrders, chatSessions } =
      await import("../../../drizzle/schema");

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ─── Gather comprehensive data ─────────────────────
    const [
      yesterdayLeads, yesterdayBookings, pendingLeads, pendingCallbacks,
      weekBookings, weekLeads, monthPaidInvoices, totalCustomers,
      newCustomersMonth, openWorkOrders, yesterdayChats,
      staleLeads, monthReviews, monthBookingsTotal,
    ] = await Promise.all([
      d.select({ count: sql<number>`count(*)` }).from(leads)
        .where(and(gte(leads.createdAt, yesterdayStart), sql`${leads.createdAt} < ${todayStart}`)),
      d.select({ count: sql<number>`count(*)` }).from(bookings)
        .where(and(gte(bookings.createdAt, yesterdayStart), sql`${bookings.createdAt} < ${todayStart}`)),
      d.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.status, "new")),
      d.select({ count: sql<number>`count(*)` }).from(callbackRequests).where(eq(callbackRequests.status, "new")),
      d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, weekAgo)),
      d.select({ count: sql<number>`count(*)` }).from(leads).where(gte(leads.createdAt, weekAgo)),
      d.select().from(invoices).where(and(gte(invoices.invoiceDate, monthAgo), eq(invoices.paymentStatus, "paid"))),
      d.select({ count: sql<number>`count(*)` }).from(customers),
      d.select({ count: sql<number>`count(*)` }).from(customers).where(gte(customers.createdAt, monthAgo)),
      d.select({ count: sql<number>`count(*)` }).from(workOrders).where(sql`${workOrders.status} NOT IN ('closed', 'invoiced', 'picked_up', 'cancelled')`),
      d.select({ count: sql<number>`count(*)` }).from(chatSessions)
        .where(and(gte(chatSessions.createdAt, yesterdayStart), sql`${chatSessions.createdAt} < ${todayStart}`)),
      d.select({ count: sql<number>`count(*)` }).from(leads)
        .where(and(eq(leads.status, "new"), sql`${leads.createdAt} < ${weekAgo}`)),
      d.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(gte(reviewRequests.createdAt, monthAgo)),
      d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, monthAgo)),
    ]);

    const monthRevenue = Math.round(monthPaidInvoices.reduce((s: any, inv: any) => s + inv.totalAmount, 0) / 100);
    const avgTicket = monthPaidInvoices.length > 0 ? Math.round(monthRevenue / monthPaidInvoices.length) : 0;
    const jobsWon = monthPaidInvoices.length;
    const conversionRate = (monthBookingsTotal[0]?.count ?? 0) > 0
      ? Math.round((jobsWon / (monthBookingsTotal[0]?.count ?? 1)) * 100)
      : 0;

    const pendingCount = (pendingLeads[0]?.count ?? 0) + (pendingCallbacks[0]?.count ?? 0);
    const staleCount = staleLeads[0]?.count ?? 0;

    // ─── Build raw data for AI to analyze ──────────────
    const dayName = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
    const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

    const dataBlock = `DATE: ${dayName}, ${dateStr}

YESTERDAY:
- Leads: ${yesterdayLeads[0]?.count ?? 0}
- Drop-offs: ${yesterdayBookings[0]?.count ?? 0}
- Chat sessions: ${yesterdayChats[0]?.count ?? 0}

THIS WEEK:
- Drop-offs: ${weekBookings[0]?.count ?? 0}
- Leads: ${weekLeads[0]?.count ?? 0}

30-DAY FINANCIALS:
- Revenue: $${monthRevenue.toLocaleString()}
- Jobs won (invoices): ${jobsWon}
- Avg ticket: $${avgTicket}
- Conversion rate: ${conversionRate}%

PIPELINE:
- Pending leads (new): ${pendingLeads[0]?.count ?? 0}
- Pending callbacks: ${pendingCallbacks[0]?.count ?? 0}
- Stale leads (>7d untouched): ${staleCount}
- Open work orders: ${openWorkOrders[0]?.count ?? 0}

CUSTOMERS:
- Total: ${totalCustomers[0]?.count ?? 0}
- New this month: ${newCustomersMonth[0]?.count ?? 0}

MARKETING:
- Review requests sent (30d): ${monthReviews[0]?.count ?? 0}

WALK RATE: ${jobsWon > 0 ? Math.round((1 - jobsWon / Math.max(jobsWon + (staleCount || 0), 1)) * 100) : 0}% of estimates walked without converting.
KEY: Invoice = job WON. Estimate without invoice = customer WALKED.

PRIORITIES FOR TODAY:
${staleCount > 3 ? `- ⚠️ ${staleCount} STALE LEADS >7 days — call them before they go to a competitor` : "- ✅ Lead queue is clean"}
${(pendingCallbacks[0]?.count ?? 0) > 0 ? `- 📞 ${pendingCallbacks[0]?.count} CALLBACKS WAITING — clear these first thing` : "- ✅ No pending callbacks"}
${conversionRate < 40 ? `- 📉 Conversion rate ${conversionRate}% is below 40% — review estimate follow-up process` : `- ✅ Conversion rate ${conversionRate}% is healthy`}
- 💰 Revenue target: $${Math.round((10000 / 26) * 1)} today ($10K/month pace = ~$385/day)`;


    // ─── Add yesterday's revenue, today's bookings, declined work ────
    let enrichmentBlock = "";
    try {
      // Yesterday's revenue
      const yesterdayPaid = await d.select().from(invoices)
        .where(and(gte(invoices.invoiceDate, yesterdayStart), sql`${invoices.invoiceDate} < ${todayStart}`, eq(invoices.paymentStatus, "paid")));
      const yesterdayRevenue = Math.round(yesterdayPaid.reduce((s: any, inv: any) => s + inv.totalAmount, 0) / 100);
      enrichmentBlock += `\nYESTERDAY'S REVENUE: $${yesterdayRevenue.toLocaleString()} from ${yesterdayPaid.length} paid invoices.`;

      // Today's scheduled bookings
      const todayBookings = await d.select({ count: sql<number>`count(*)` }).from(bookings)
        .where(gte(bookings.createdAt, todayStart));
      enrichmentBlock += `\nTODAY'S BOOKINGS SO FAR: ${todayBookings[0]?.count ?? 0}`;

      // Declined work recoverable
      const { getDeclinedWorkLedger } = await import("../../services/declinedWorkRecovery");
      const declined = await getDeclinedWorkLedger(10);
      const unrecovered = declined.filter(e => e.declinedItems.some(i => !i.recovered));
      const totalRecoverable = unrecovered.reduce((s, e) => s + e.totalDeclinedValue, 0);
      if (totalRecoverable > 0) {
        enrichmentBlock += `\nDECLINED WORK: $${totalRecoverable} recoverable from ${unrecovered.length} customers. ${unrecovered.filter(e => e.hasSafetyItems).length} have SAFETY items that need follow-up calls.`;
      }

      // Intelligence data
      const { analyzeConversionPipeline, projectRevenue } = await import("../../services/nickIntelligence");
      const [pipeline, revenue] = await Promise.all([analyzeConversionPipeline(), projectRevenue()]);
      enrichmentBlock += `\nPROJECTIONS: This week $${revenue.thisWeekProjection}, this month $${revenue.thisMonthProjection}. WoW: ${revenue.weekOverWeek > 0 ? "+" : ""}${revenue.weekOverWeek}% (${revenue.trend}).`;
      enrichmentBlock += `\nPIPELINE: Est→Job ${pipeline.estimateToInvoice}%, Lead→Booking ${pipeline.leadToBooking}%. ${pipeline.staleEstimates} stale estimates.`;
    } catch {}

    // ─── Brief self-review: did yesterday's brief drive action? ────
    let briefReviewBlock = "";
    try {
      const { getBriefEngagement } = await import("../../services/feedbackLoop");
      const engagement = getBriefEngagement();
      if (engagement.sent) {
        briefReviewBlock = `\nYESTERDAY'S BRIEF: ${engagement.engagementRate === "engaged" ? "Nour read it and engaged ✓" : "Sent but no response — maybe adjust timing or content."}`;
      }
    } catch {}

    // ─── Inject memory + personal context + customer intel ────
    let memoryBlock = "";
    try {
      const { getWarmupContext } = await import("../../services/nickMemory");
      memoryBlock = await getWarmupContext();
    } catch {}

    let personalBlock = "";
    try {
      const { getNourPersonalContext } = await import("../../services/nourContext");
      personalBlock = getNourPersonalContext();
    } catch {}

    let customerBlock = "";
    try {
      const { getCustomerBrief } = await import("../../services/customerIntelligence");
      customerBlock = await getCustomerBrief();
    } catch {}

    // ─── Master Intelligence Report ─────────────────────
    let masterBlock = "";
    try {
      const { generateMasterIntelligenceReport } = await import("../../services/masterIntelligence");
      const master = await generateMasterIntelligenceReport();
      const s = master.summary;
      const churnCount = master.customers.churnRisk?.highRisk?.length || 0;
      const reviewRate = (master.marketing.reviewVelocity as any)?.weeklyRate || (master.marketing.reviewVelocity as any)?.monthlyRate || 0;
      masterBlock = `\nBUSINESS HEALTH: ${s.score}/100`;
      masterBlock += `\n🔔 Alert: ${s.topAlert}`;
      masterBlock += `\n💡 Opportunity: ${s.topOpportunity}`;
      masterBlock += `\n⚠️ Risk: ${s.topRisk}`;
      masterBlock += `\nKEY: Churn risk: ${churnCount} | New customers: ${newCustomersMonth[0]?.count ?? 0} | Reviews/wk: ${reviewRate}`;
    } catch (e) {
      log.warn("Master intelligence for brief failed:", { error: e instanceof Error ? e.message : String(e) });
    }

    // ─── Intelligence Engines data ────────────────────
    let intelligenceBlock = "";
    try {
      const {
        forecastRevenue, predictCustomerLTV, scoreLeads,
        generateCrossSellRecommendations, analyzeDeclinedWork,
      } = await import("../../services/intelligenceEngines");

      const [forecast, ltv, scoredLeads, crossSell, declined] = await Promise.all([
        forecastRevenue().catch(() => null),
        predictCustomerLTV().catch(() => null),
        scoreLeads().catch(() => null),
        generateCrossSellRecommendations().catch(() => null),
        analyzeDeclinedWork().catch(() => null),
      ]);

      intelligenceBlock = "\nINTELLIGENCE:";

      if (forecast) {
        const monthPct = forecast.month.target > 0 ? Math.round((forecast.month.soFar / forecast.month.target) * 100) : 0;
        intelligenceBlock += `\n📊 Revenue Forecast — Today expected: $${Math.round(forecast.today.expected)} | Week projection: $${forecast.week.projection} | Month: $${Math.round(forecast.month.soFar)}/$${(forecast.month.target / 1000)}K (${monthPct}%)`;
      }

      if (ltv && ltv.atRiskHighValue && ltv.atRiskHighValue.length > 0) {
        const top3 = ltv.atRiskHighValue.slice(0, 3);
        const lines = top3.map((c: any) => `  - ${c.name || "Unknown"} ($${Math.round(c.totalSpent)} spent, ${c.daysSinceLastVisit}d ago)`).join("\n");
        intelligenceBlock += `\n⚠️ At-Risk High-Value Customers:\n${lines}`;
      }

      if (scoredLeads && Array.isArray(scoredLeads)) {
        const hotLeads = scoredLeads.filter((l: any) => l.score > 70);
        intelligenceBlock += `\n🎯 Lead Scoring — ${hotLeads.length} high-score leads (>70) waiting for contact`;
      }

      if (crossSell && crossSell.recommendations) {
        intelligenceBlock += `\n🔄 Cross-Sell — ${crossSell.recommendations.length} customers due for follow-up service`;
      }

      if (declined) {
        intelligenceBlock += `\n💸 Declined Work Recovery — $${declined.totalDeclinedValue} total declined | $${declined.recoveryOpportunity} recoverable (20% est.)`;
      }
    } catch {}

    // ─── Use Nick AI to write the brief ────────────────
    let briefText: string;
    try {
      const aiResponse = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are Nick AI writing Nour's morning brief for Telegram. Nour is the CEO of Nick's Tire & Auto (Cleveland).

YOU KNOW NOUR DEEPLY:
${personalBlock ? personalBlock.slice(0, 600) : "Nour is the CEO/owner-operator. He has ADHD, runs on systems over motivation, and his core pattern is Build-Drift-Reset. Catch him early when drifting."}

FORMAT RULES:
- Use Telegram-friendly formatting (no markdown, use emoji sparingly)
- Keep it under 2000 characters total
- Structure: Greeting → Headline number → Yesterday recap → Pipeline status → Money snapshot → Customer insight → Pattern from memory → Top 3 priorities → Personal check-in → Motivational closer
- Be direct. No fluff. Like a chief of staff briefing the CEO.
- If stale leads > 3, call it out as lost money.
- If revenue is strong, acknowledge it. If weak, flag it.
- Reference a SPECIFIC customer by name if there's a follow-up opportunity.
- If you have memories from past patterns, USE them: "Last week X happened, this week watch for Y."
- Include ONE personal check-in: weight progress (230→186 target), workout consistency, daily score.
- Watch for BUILD-DRIFT-RESET: if memories show new tools/projects being explored while current work is unfinished, call it "drift mode."
- If it's been >3 days since last daily score logged, flag it: "You haven't scored yourself in X days — that's drift."
- End with energy AND a specific dollar number: "To hit $10K this month, you need $X/day for the remaining Y days."
- Frame everything through: "Boring repetition beats intensity spikes. What's the ONE boring thing to do today?"`,
          },
          {
            role: "user",
            content: `Write today's morning brief based on this data:\n\n${dataBlock}\n\n${enrichmentBlock}\n\n${masterBlock}\n\n${intelligenceBlock}\n\n${briefReviewBlock}\n\n${customerBlock}\n\n${memoryBlock}`,
          },
        ],
        maxTokens: 800,
      });

      const rawContent = aiResponse.choices?.[0]?.message?.content;
      briefText = (typeof rawContent === "string" ? rawContent : null) || "";
    } catch (aiErr) {
      log.warn("AI brief generation failed, using template:", { error: aiErr instanceof Error ? aiErr.message : String(aiErr) });
      briefText = "";
    }

    // Fallback to template if AI fails
    if (!briefText || briefText.length < 50) {
      const urgencyEmoji = pendingCount > 5 ? "🔴" : pendingCount > 2 ? "🟡" : "🟢";
      briefText = `NICK AI — ${dayName}, ${dateStr}

${urgencyEmoji} ${pendingCount} items need attention

YESTERDAY: ${yesterdayLeads[0]?.count ?? 0} leads | ${yesterdayBookings[0]?.count ?? 0} drop-offs | ${yesterdayChats[0]?.count ?? 0} chats

THIS WEEK: ${weekBookings[0]?.count ?? 0} drop-offs | ${weekLeads[0]?.count ?? 0} leads

30-DAY: $${monthRevenue.toLocaleString()} revenue | ${jobsWon} jobs won | $${avgTicket} avg ticket | ${conversionRate}% conversion

PIPELINE: ${pendingLeads[0]?.count ?? 0} new leads | ${pendingCallbacks[0]?.count ?? 0} callbacks | ${staleCount} stale leads | ${openWorkOrders[0]?.count ?? 0} open WOs

CUSTOMERS: ${totalCustomers[0]?.count ?? 0} total | ${newCustomersMonth[0]?.count ?? 0} new this month
${masterBlock}
${intelligenceBlock}

Systems over motivation. Let's go.`;
    }

    await sendTelegram(briefText);
    log.info("Morning brief sent via Telegram");

    // Track brief delivery for feedback loop
    try {
      const { recordBriefSent } = await import("../../services/feedbackLoop");
      recordBriefSent();
    } catch {}

    return { recordsProcessed: 1, details: `Full brief sent. ${pendingCount} pending. $${monthRevenue.toLocaleString()} 30d rev.` };
  } catch (err) {
    log.error("Morning brief failed:", { error: err instanceof Error ? err.message : String(err) });
    return { details: `Error: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

/**
 * Send an urgent brief when something critical happens
 */
export async function sendUrgentBrief(reason: string, details: string): Promise<void> {
  try {
    const { sendTelegram } = await import("../../services/telegram");
    const msg = `🚨 NICK AI ALERT

${reason}

${details}

Command Center: https://nickstire.org/admin`;

    await sendTelegram(msg);
    log.info(`Urgent brief sent: ${reason}`);
  } catch (err) {
    log.error("Urgent brief failed:", { error: err instanceof Error ? err.message : String(err) });
  }
}
