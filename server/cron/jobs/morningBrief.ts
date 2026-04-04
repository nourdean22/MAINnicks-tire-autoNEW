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
      d.select({ count: sql<number>`count(*)` }).from(workOrders).where(sql`${workOrders.status} != 'completed' AND ${workOrders.status} != 'cancelled'`),
      d.select({ count: sql<number>`count(*)` }).from(chatSessions)
        .where(and(gte(chatSessions.createdAt, yesterdayStart), sql`${chatSessions.createdAt} < ${todayStart}`)),
      d.select({ count: sql<number>`count(*)` }).from(leads)
        .where(and(eq(leads.status, "new"), sql`${leads.createdAt} < ${weekAgo}`)),
      d.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(gte(reviewRequests.createdAt, monthAgo)),
      d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, monthAgo)),
    ]);

    const monthRevenue = monthPaidInvoices.reduce((s, inv) => s + inv.totalAmount, 0);
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
KEY: Invoice = job WON. Estimate without invoice = customer WALKED.`;

    // ─── Use Nick AI to write the brief ────────────────
    let briefText: string;
    try {
      const aiResponse = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are Nick AI writing Nour's morning brief for Telegram. Nour is the CEO of Nick's Tire & Auto (Cleveland).

FORMAT RULES:
- Use Telegram-friendly formatting (no markdown, use emoji sparingly)
- Keep it under 1500 characters total
- Structure: Greeting → Headline number → Yesterday recap → Pipeline status → Money snapshot → ONE insight/pattern → Top 3 priorities for today → Motivational closer
- Be direct. No fluff. Like a chief of staff briefing the CEO.
- If stale leads > 3, call it out as lost money.
- If revenue is strong, acknowledge it. If weak, flag it.
- The insight should be something non-obvious: a trend, a pattern, a risk, or an opportunity.
- Priorities should be specific and actionable.
- End with energy. Nour runs on systems over motivation.`,
          },
          {
            role: "user",
            content: `Write today's morning brief based on this data:\n\n${dataBlock}`,
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

Systems over motivation. Let's go.`;
    }

    await sendTelegram(briefText);
    log.info("Morning brief sent via Telegram");

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
