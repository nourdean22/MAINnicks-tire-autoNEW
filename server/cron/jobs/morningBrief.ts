/**
 * Morning Brief — Nick AI sends Nour a daily brief via Telegram.
 *
 * Runs at 7:30 AM ET. Gathers execution data, business state,
 * and sends a formatted message through Telegram.
 *
 * Also fires on critical events (high-urgency leads, emergencies)
 * when called via sendUrgentBrief().
 */
import { createLogger } from "../../lib/logger";
import { eq, gte, sql, and, desc } from "drizzle-orm";

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
    const { leads, bookings, invoices, callbackRequests, customers, reviewRequests } =
      await import("../../../drizzle/schema");

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Gather data
    const [
      yesterdayLeads, yesterdayBookings, pendingLeads, pendingCallbacks,
      weekBookings, monthPaidInvoices, totalCustomers,
    ] = await Promise.all([
      d.select({ count: sql<number>`count(*)` }).from(leads)
        .where(and(gte(leads.createdAt, yesterdayStart), sql`${leads.createdAt} < ${todayStart}`)),
      d.select({ count: sql<number>`count(*)` }).from(bookings)
        .where(and(gte(bookings.createdAt, yesterdayStart), sql`${bookings.createdAt} < ${todayStart}`)),
      d.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.status, "new")),
      d.select({ count: sql<number>`count(*)` }).from(callbackRequests).where(eq(callbackRequests.status, "new")),
      d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, weekAgo)),
      d.select().from(invoices).where(and(gte(invoices.invoiceDate, monthAgo), eq(invoices.paymentStatus, "paid"))),
      d.select({ count: sql<number>`count(*)` }).from(customers),
    ]);

    const monthRevenue = monthPaidInvoices.reduce((s, inv) => s + inv.totalAmount, 0);
    const avgTicket = monthPaidInvoices.length > 0 ? Math.round(monthRevenue / monthPaidInvoices.length) : 0;

    // Get execution data from controlCenter
    let execScore = "—";
    let mission = "";
    try {
      const { getDb: getDb2 } = await import("../../db");
      // Execution is tracked in controlCenter router via in-memory state
      // We'll just reference the numbers we have
    } catch {}

    // Build the brief
    const dayName = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
    const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/New_York" });

    const pendingCount = (pendingLeads[0]?.count ?? 0) + (pendingCallbacks[0]?.count ?? 0);
    const urgencyEmoji = pendingCount > 5 ? "🔴" : pendingCount > 2 ? "🟡" : "🟢";

    const brief = `☀️ NICK AI — ${dayName}, ${dateStr}

${urgencyEmoji} ${pendingCount} items need attention

📊 YESTERDAY:
• ${yesterdayLeads[0]?.count ?? 0} leads | ${yesterdayBookings[0]?.count ?? 0} drop-offs

📈 THIS WEEK:
• ${weekBookings[0]?.count ?? 0} drop-offs

💰 30-DAY:
• $${monthRevenue.toLocaleString()} revenue (${monthPaidInvoices.length} jobs won)
• $${avgTicket} avg ticket
• ${totalCustomers[0]?.count ?? 0} total customers

⚡ ACTION ITEMS:
${(pendingLeads[0]?.count ?? 0) > 0 ? `• ${pendingLeads[0]?.count} new leads waiting` : ""}
${(pendingCallbacks[0]?.count ?? 0) > 0 ? `• ${pendingCallbacks[0]?.count} callbacks pending` : ""}
${pendingCount === 0 ? "• Clean slate — nothing pending" : ""}

💪 First come first serve. Let's get it.`;

    await sendTelegram(brief);
    log.info("Morning brief sent via Telegram");

    return { recordsProcessed: 1, details: `Brief sent. ${pendingCount} pending items.` };
  } catch (err) {
    log.error("Morning brief failed:", err instanceof Error ? err.message : err);
    return { details: `Error: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

/**
 * Send an urgent brief when something critical happens
 * (e.g., emergency request, high-value lead)
 */
export async function sendUrgentBrief(reason: string, details: string): Promise<void> {
  try {
    const { sendTelegram } = await import("../../services/telegram");
    const msg = `🚨 NICK AI ALERT

${reason}

${details}

Open Command Center: https://nickstire.org/admin`;

    await sendTelegram(msg);
    log.info(`Urgent brief sent: ${reason}`);
  } catch (err) {
    log.error("Urgent brief failed:", err instanceof Error ? err.message : err);
  }
}
