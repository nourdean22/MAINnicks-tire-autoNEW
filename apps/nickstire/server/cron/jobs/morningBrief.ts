/**
 * Nick AI Morning Brief — Full Circle Operator Intelligence
 *
 * This isn't just numbers. Nick AI analyzes everything, spots patterns,
 * and sends Nour a brief that covers business + life + execution.
 *
 * Uses Gemini / OpenRouter to generate the actual brief content
 * so it reads like a chief of staff wrote it, not a database query.
 */
import { createLogger } from "../../lib/logger";
import { eq, gte, sql, and, desc } from "drizzle-orm";
import { invokeLLM } from "../../_core/llm";

import { db } from "../../lib/db-helper";

import { BUSINESS } from "@shared/business";
import { countActionableLeads } from "@shared/leadSource";
const log = createLogger("cron:morning-brief");

/**
 * ROS-083 · the TOP DECISIONS block, and why it is a named function.
 *
 * It used to be built inline and left as "" whenever the opportunity queue came
 * back empty — which collapsed THREE different states into one: the queue was
 * read and is genuinely clear, the queue could not be consulted (no database
 * handle, or migration 0099 unapplied so revenue_opportunities does not exist),
 * and the read threw.
 *
 * An absent block does not read as "nothing to decide" to the model. The FORMAT
 * RULES in the system prompt mandate a "Top 3 priorities" section, so with no
 * block the LLM writes the operator's priorities for the day FROM SCRATCH, out
 * of whatever else happens to be in the data blob — and sends them to Telegram
 * every morning, indistinguishable from a real queue-backed list.
 *
 * So the block is now ALWAYS present and always says which of the three states
 * produced it. The exceptions block further down this same file already does
 * exactly this ("waiting-customer count UNKNOWN (read failed ...)"); this is
 * that idiom, not a new one.
 *
 * Extracted so the three branches can be asserted directly — the surrounding
 * function is ~400 lines of sequential reads and cannot be exercised in a unit
 * test, which is the reason this went unnoticed.
 */
export const DECISIONS_UNAVAILABLE_READ_FAILED =
  "\nTOP DECISIONS: UNAVAILABLE — reading the opportunity queue FAILED. This is NOT the same as an empty queue.";

export function buildDecisionsBlock(top: {
  decisions: Array<{
    urgency: string;
    recommendedAction: string;
    reason: string;
    dataQuality: string;
    attempts: number;
    factors: { valueDollars: number };
  }>;
  excludedNoConsent: number;
  excludedSnoozed: number;
  totalLive: number;
  queryable: boolean;
}): string {
  if (!top.queryable) {
    return "\nTOP DECISIONS: UNAVAILABLE — the opportunity queue could not be consulted (no database handle, or revenue_opportunities is missing). This is NOT the same as an empty queue.";
  }
  if (top.decisions.length === 0) {
    return `\nTOP DECISIONS: none — the opportunity queue was read successfully and holds no actionable decisions right now (${top.totalLive} live, ${top.excludedNoConsent} excluded for no contact consent, ${top.excludedSnoozed} snoozed).`;
  }
  let block = "\nTOP DECISIONS (opportunity queue — lead with these, verbatim):";
  top.decisions.forEach((dec, i) => {
    const value = dec.factors.valueDollars > 0 ? `$${dec.factors.valueDollars.toLocaleString()}` : "value unknown";
    block += `\n${i + 1}. [${dec.urgency.toUpperCase()}] ${dec.recommendedAction} — ${value} · ${dec.reason} (evidence: ${dec.dataQuality}, attempts: ${dec.attempts})`;
  });
  if (top.excludedNoConsent > 0) {
    block += `\n(${top.excludedNoConsent} opportunities excluded — no contact consent)`;
  }
  return block;
}

export async function sendMorningBrief(): Promise<{ recordsProcessed?: number; details?: string }> {
  const { sendTelegram } = await import("../../services/telegram");

  // 2026-08-09 · Morning-window self-gate, mirroring dailyReport's evening one.
  //
  // This job sits on the 12-hour "briefings" tier, so it fires TWICE a day —
  // and it had no clock gate at all, unlike its tier-mate daily-report which
  // skips its morning run with `if (etHour < 18) return`. The result: two
  // "morning" briefs per day, at whatever two times the process happened to
  // start, drifting on every redeploy. `runOnStartup` excludes this tier, so
  // the phase is process-start + 12h — nothing anchored it to a clock.
  //
  // Paired with `oncePerShopDay: true` on the scheduler entry: the flag stops
  // a second SHOP-DAY run, this window stops it landing at 2am.
  // FAIL-CLOSED on an unreadable clock. `parseInt` returns NaN if the locale
  // string ever changes shape or the timezone is unresolvable, and NaN fails
  // BOTH comparisons — so a naive `hour < 6 || hour >= 12` would SEND rather
  // than skip. For a proactive push that is the wrong direction: a brief that
  // does not arrive is a missed glance; a brief that arrives at 3am is the
  // thing this gate exists to prevent. Not sending is always the safe answer
  // here, so an indeterminate hour must skip.
  const { BUSINESS } = await import("@shared/business");
  const etHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }),
    10,
  );
  if (!Number.isFinite(etHour)) {
    log.warn("Could not resolve shop-TZ hour — skipping morning brief (fail-closed)");
    return { recordsProcessed: 0, details: "Shop-TZ hour unresolvable — skipped (fail-closed)" };
  }
  if (etHour < 6 || etHour >= 12) {
    return { recordsProcessed: 0, details: `Outside the morning window (${etHour}:00 ET) — skipped` };
  }

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
      d.select({ source: leads.source, callbackId: leads.callbackId }).from(leads).where(eq(leads.status, "new")),
      d.select({ count: sql<number>`count(*)` }).from(callbackRequests).where(eq(callbackRequests.status, "new")),
      d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, weekAgo)),
      d.select({ count: sql<number>`count(*)` }).from(leads).where(gte(leads.createdAt, weekAgo)),
      d.select().from(invoices).where(and(gte(invoices.invoiceDate, monthAgo), eq(invoices.paymentStatus, "paid"))),
      d.select({ count: sql<number>`count(*)` }).from(customers),
      d.select({ count: sql<number>`count(*)` }).from(customers).where(gte(customers.createdAt, monthAgo)),
      d.select({ count: sql<number>`count(*)` }).from(workOrders).where(sql`${workOrders.status} NOT IN ('closed', 'invoiced', 'picked_up', 'cancelled')`),
      d.select({ count: sql<number>`count(*)` }).from(chatSessions)
        .where(and(gte(chatSessions.createdAt, yesterdayStart), sql`${chatSessions.createdAt} < ${todayStart}`)),
      d.select({ source: leads.source, callbackId: leads.callbackId }).from(leads)
        .where(and(eq(leads.status, "new"), sql`${leads.createdAt} < ${weekAgo}`)),
      d.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(gte(reviewRequests.createdAt, monthAgo)),
      d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, monthAgo)),
    ]);

    const monthRevenue = Math.round(monthPaidInvoices.reduce((s: any, inv: any) => s + inv.totalAmount, 0) / 100);
    const avgTicket = monthPaidInvoices.length > 0 ? Math.round(monthRevenue / monthPaidInvoices.length) : 0;
    const jobsWon = monthPaidInvoices.length;
    // revenue-truth-correction (2026-07-28): the old "conversionRate"
    // divided paid invoices by bookings — DIFFERENT COHORTS (walk-ins
    // invoice without ever booking; fresh bookings haven't invoiced yet),
    // so the % was meaningless and could exceed 100. Removed. The honest
    // funnel number is pipeline.estimateToInvoice in the enrichment block.
    // Pace baseline is the shop's own trailing 30 days — no invented target.
    const monthBookings = monthBookingsTotal[0]?.count ?? 0;
    const trailingDailyPace = Math.round(monthRevenue / 30);

    // Linked callback-form leads are the SAME person as a callback_requests row
    // (counted separately as pendingCallbacks), so exclude them from the lead-side
    // tallies — otherwise one caller inflates both. Voice rack-check leads
    // (callbackId null) and real web leads still count. See shared/leadSource.ts.
    const pendingLeadsCount = countActionableLeads(pendingLeads);
    const staleCount = countActionableLeads(staleLeads);
    const pendingCount = pendingLeadsCount + (pendingCallbacks[0]?.count ?? 0);

    // ─── Build raw data for AI to analyze ──────────────
    const dayName = now.toLocaleDateString("en-US", { weekday: "long", timeZone: BUSINESS.timezone });
    const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: BUSINESS.timezone });

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
- Jobs won (paid invoices): ${jobsWon}
- Avg ticket: $${avgTicket}
- Bookings (30d): ${monthBookings} — NOTE: paid invoices and bookings are DIFFERENT COHORTS (walk-ins invoice without booking; fresh bookings haven't invoiced yet). Never derive a conversion %% from these two numbers; the funnel number is Est→Job in PIPELINE data below when present.

PIPELINE:
- Pending leads (new): ${pendingLeadsCount}
- Pending callbacks: ${pendingCallbacks[0]?.count ?? 0}
- Stale leads (>7d untouched): ${staleCount}
- Open work orders: ${openWorkOrders[0]?.count ?? 0}

CUSTOMERS:
- Total: ${totalCustomers[0]?.count ?? 0}
- New this month: ${newCustomersMonth[0]?.count ?? 0}

MARKETING:
- Review requests sent (30d): ${monthReviews[0]?.count ?? 0}

ESTIMATE SEMANTICS: an estimate without a matched invoice is UNRESOLVED — the customer may be undecided, may have fixed it elsewhere, or the sync may lag. It is NOT proof they walked. Never call unresolved estimates "walked customers" or "lost revenue".

PRIORITIES FOR TODAY:
${staleCount > 3 ? `- ⚠️ ${staleCount} STALE LEADS >7 days — call them before they go to a competitor` : "- ✅ Lead queue is clean"}
${(pendingCallbacks[0]?.count ?? 0) > 0 ? `- 📞 ${pendingCallbacks[0]?.count} CALLBACKS WAITING — clear these first thing` : "- ✅ No pending callbacks"}
- 💰 Pace: trailing 30d averages $${trailingDailyPace.toLocaleString()}/day. Today's bar = beat the trailing average. (No fixed monthly target — the forecast engine's dynamic target below is the only valid one.)`;


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
        enrichmentBlock += `\nDECLINED WORK: $${totalRecoverable} in open declined items across ${unrecovered.length} customers (pool, not a recovery forecast). ${unrecovered.filter(e => e.hasSafetyItems).length} have SAFETY items that need follow-up calls.`;
      }

      // Intelligence data
      const { analyzeConversionPipeline, projectRevenue } = await import("../../services/nickIntelligence");
      const [pipeline, revenue] = await Promise.all([analyzeConversionPipeline(), projectRevenue()]);
      enrichmentBlock += `\nPROJECTIONS: This week $${revenue.thisWeekProjection}, this month $${revenue.thisMonthProjection}. WoW: ${revenue.weekOverWeek > 0 ? "+" : ""}${revenue.weekOverWeek}% (${revenue.trend}).`;
      enrichmentBlock += `\nPIPELINE: Est→Job ${pipeline.estimateToInvoice}%, Lead→Booking ${pipeline.leadToBooking}%. ${pipeline.staleEstimates} stale estimates.`;
    } catch (e) { log.warn("[morningBrief] enrichment data (revenue/pipeline/declined) failed:", e); }

    // ─── Owner Decision Inbox: top 5 from the opportunity queue ────
    // Wave 4: evidence-backed decision cards lead the brief.
    //
    // ROS-083 · this block used to collapse THREE different states into the
    // same empty string: the queue was read and is genuinely clear, the queue
    // could not be consulted (no DB, or migration 0099 unapplied), and the read
    // threw. An absent block does not mean "nothing to decide" to the model —
    // the FORMAT RULES below mandate a "Top 3 priorities" section, so with no
    // block the LLM writes the operator's priorities for the day FROM SCRATCH,
    // out of whatever else happens to be in the data blob. Every morning, in
    // Telegram, indistinguishable from a real queue-backed list.
    //
    // So the block is now always present and always says which of the three it
    // is. The exceptions block twenty lines below already does exactly this
    // ("waiting-customer count UNKNOWN (read failed ...)"); this is the same
    // idiom, not a new one.
    let decisionsBlock: string;
    try {
      const { topDecisions } = await import("../../services/opportunityQueue");
      decisionsBlock = buildDecisionsBlock(await topDecisions(5));
    } catch (e) {
      log.warn("[morningBrief] opportunity queue load failed:", e);
      decisionsBlock = DECISIONS_UNAVAILABLE_READ_FAILED;
    }

    // ─── Exception brief (Autopilot Wave 2) — what needs Nick, not a feed ──
    // Only real, load-bearing exceptions: waiting customers past SLA, blocked
    // sends, a stalled queue, delivery failures. Every line sources from a
    // durable table; a failed read renders as UNKNOWN, never as "all clear".
    let exceptionsBlock = "";
    try {
      const parts: string[] = [];
      try {
        const { humanPendingSummary } = await import("../../services/smsResponseJobs");
        const hp = await humanPendingSummary();
        if (hp.humanPending > 0) {
          parts.push(
            `${hp.humanPending} customer(s) waiting on a HUMAN reply` +
            `${hp.overdue > 0 ? ` (${hp.overdue} past the 30-min SLA)` : ""}` +
            `${hp.oldestWaitingMinutes != null ? ` — oldest ${hp.oldestWaitingMinutes}m` : ""}`,
          );
        }
      } catch { parts.push("waiting-customer count UNKNOWN (read failed — check the SMS admin)"); }
      try {
        const { getDb } = await import("../../db");
        const { sql } = await import("drizzle-orm");
        const db = await getDb();
        if (db) {
          const [bRows] = await db.execute(sql`
            SELECT SUM(status = 'blocked') AS blocked, SUM(status = 'drafted') AS drafted
            FROM sms_orchestrations
            WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          `);
          const b = (Array.isArray(bRows) ? bRows[0] : undefined) as { blocked?: unknown; drafted?: unknown } | undefined;
          if (Number(b?.blocked ?? 0) > 0) parts.push(`${Number(b?.blocked)} send(s) BLOCKED by safety gates in 24h`);
          if (Number(b?.drafted ?? 0) > 0) parts.push(`${Number(b?.drafted)} AI draft(s) awaiting your approve/edit`);
          const [qRows] = await db.execute(sql`
            SELECT SUM(status = 'queued') AS queued, SUM(status = 'failed' AND createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS failed24h
            FROM sms_messages WHERE direction = 'outbound'
          `);
          const q = (Array.isArray(qRows) ? qRows[0] : undefined) as { queued?: unknown; failed24h?: unknown } | undefined;
          if (Number(q?.queued ?? 0) > 0) parts.push(`${Number(q?.queued)} text(s) held in the send queue`);
          if (Number(q?.failed24h ?? 0) > 0) parts.push(`${Number(q?.failed24h)} delivery failure(s) in 24h (replayable from SMS Ops)`);
        }
      } catch { parts.push("queue/suppression counts UNKNOWN (read failed)"); }
      if (parts.length > 0) {
        exceptionsBlock = "\nEXCEPTIONS (needs Nick — everything else is handled):\n- " + parts.join("\n- ");
      }
    } catch (e) { log.warn("[morningBrief] exception brief failed:", e); }

    // ─── Promise ledger truth (W4) — kept-rate from real resolutions ──
    // Only renders once promises EXIST; zero-promise days say nothing
    // (no invented rates, no nagging about an unused feature).
    let promisesBlock = "";
    try {
      const { promiseLedgerStats } = await import("../../services/promiseLedger");
      const ps = await promiseLedgerStats(30);
      if (ps && ps.created > 0) {
        const kept = ps.keptOnTime + ps.keptLate;
        promisesBlock =
          `
PROMISES (30d, from the ledger): ${ps.created} made · ${kept} kept` +
          `${ps.keptLate > 0 ? ` (${ps.keptLate} late${ps.avgKeptLateHours != null ? `, avg ${ps.avgKeptLateHours}h over` : ""})` : ""}` +
          `${ps.missed > 0 ? ` · ${ps.missed} MISSED` : ""}` +
          `${ps.open > 0 ? ` · ${ps.open} open` : ""}`;
      }
    } catch (e) { log.warn("[morningBrief] promise ledger stats failed:", e); }

    // ─── Brief self-review: did yesterday's brief drive action? ────
    let briefReviewBlock = "";
    try {
      const { getBriefEngagement } = await import("../../services/feedbackLoop");
      const engagement = getBriefEngagement();
      if (engagement.sent) {
        briefReviewBlock = `\nYESTERDAY'S BRIEF: ${engagement.engagementRate === "engaged" ? "Nour read it and engaged ✓" : "Sent but no response — maybe adjust timing or content."}`;
      }
    } catch (e) { log.warn("[morningBrief] brief engagement review failed:", e); }

    // ─── Inject memory + personal context + customer intel ────
    let memoryBlock = "";
    try {
      const { getWarmupContext } = await import("../../services/nickMemory");
      memoryBlock = await getWarmupContext();
    } catch (e) { log.warn("[morningBrief] memory warmup context failed:", e); }

    let personalBlock = "";
    try {
      const { getNourPersonalContext } = await import("../../services/nourContext");
      personalBlock = getNourPersonalContext();
    } catch (e) { log.warn("[morningBrief] personal context load failed:", e); }

    let customerBlock = "";
    try {
      const { getCustomerBrief } = await import("../../services/customerIntelligence");
      customerBlock = await getCustomerBrief();
    } catch (e) { log.warn("[morningBrief] customer brief load failed:", e); }

    // ─── Master Intelligence Report ─────────────────────
    let masterBlock = "";
    try {
      const { generateMasterIntelligenceReport } = await import("../../services/masterIntelligence");
      const master = await generateMasterIntelligenceReport();
      const s = master.summary;
      const hrArr = master.customers.churnRisk?.highRisk;
      const churnCount = Array.isArray(hrArr) ? hrArr.length : 0;
      const rv = master.marketing.reviewVelocity;
      const reviewRate = (typeof rv?.weeklyRate === "number" ? rv.weeklyRate : 0) || (typeof rv?.monthlyRate === "number" ? rv.monthlyRate : 0);
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
        forecastRevenue().catch((e) => { log.warn("[jobs/morningBrief] optional operation failed:", e); return null; }),
        predictCustomerLTV().catch((e) => { log.warn("[jobs/morningBrief] optional operation failed:", e); return null; }),
        scoreLeads().catch((e) => { log.warn("[jobs/morningBrief] optional operation failed:", e); return null; }),
        generateCrossSellRecommendations().catch((e) => { log.warn("[jobs/morningBrief] optional operation failed:", e); return null; }),
        analyzeDeclinedWork().catch((e) => { log.warn("[jobs/morningBrief] optional operation failed:", e); return null; }),
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
        // revenue-truth-correction: report the declined POOL only — the
        // old "recoverable (20% est.)" was an invented rate as dollars.
        intelligenceBlock += `\n💸 Declined Work — $${declined.totalDeclinedValue} total declined (90d pool; recovery rate not yet measured)`;
      }
    } catch (e) { log.warn("[morningBrief] intelligence engines data load failed:", e); }

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
- A TOP DECISIONS block is ALWAYS present and says one of three things. If it LISTS decisions, those ARE the top priorities — put them first, keep each recommended action verbatim, and never invent decisions beyond them. If it says "none", the queue was read and is genuinely clear: say so in one short line and draw the remaining priorities only from data that IS present. If it says "UNAVAILABLE", the queue could not be read: write "Priority queue unavailable this morning — these are not queue-backed" as the first line of the Top 3 priorities section, and do NOT present anything as a ranked or evidence-backed priority. Never fill an unavailable queue with priorities you inferred.
- If stale leads > 3, call it out as lost money.
- If revenue is strong, acknowledge it. If weak, flag it.
- Reference a SPECIFIC customer by name if there's a follow-up opportunity.
- If you have memories from past patterns, USE them: "Last week X happened, this week watch for Y."
- Include ONE personal check-in: weight progress (230→186 target), workout consistency, daily score.
- Watch for BUILD-DRIFT-RESET: if memories show new tools/projects being explored while current work is unfinished, call it "drift mode."
- If it's been >3 days since last daily score logged, flag it: "You haven't scored yourself in X days — that's drift."
- End with energy AND a specific dollar number pulled FROM THE DATA (today's expected revenue from the forecast, or the trailing daily pace). NEVER invent a monthly revenue target — the only valid targets are the forecast engine's dynamic month target (trailing-pace-based) and the trailing daily average given in the data.
- Frame everything through: "Boring repetition beats intensity spikes. What's the ONE boring thing to do today?"`,
          },
          {
            role: "user",
            content: `Write today's morning brief based on this data:\n\n${dataBlock}\n${exceptionsBlock}${decisionsBlock}${promisesBlock}\n\n${enrichmentBlock}\n\n${masterBlock}\n\n${intelligenceBlock}\n\n${briefReviewBlock}\n\n${customerBlock}\n\n${memoryBlock}`,
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

30-DAY: $${monthRevenue.toLocaleString()} revenue | ${jobsWon} jobs won | $${avgTicket} avg ticket | ~$${trailingDailyPace.toLocaleString()}/day pace

PIPELINE: ${pendingLeadsCount} new leads | ${pendingCallbacks[0]?.count ?? 0} callbacks | ${staleCount} stale leads | ${openWorkOrders[0]?.count ?? 0} open WOs
${exceptionsBlock}${decisionsBlock}

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
    } catch (e) { log.warn("[morningBrief] brief delivery tracking failed:", e); }

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
