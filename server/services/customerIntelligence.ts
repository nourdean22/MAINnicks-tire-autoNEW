/**
 * Customer Intelligence — Ingest, understand, and surface insights about customers.
 *
 * Pulls ALL customer data from DB + ShopDriver, cleans it, analyzes patterns,
 * and provides KPIs like:
 * - Customer lifetime value (CLV)
 * - Visit frequency
 * - Service patterns (what they keep coming back for)
 * - At-risk customers (haven't visited in X days)
 * - Top spenders
 * - Referral potential
 */

import { createLogger } from "../lib/logger";
import { sql, eq, desc, gte, asc } from "drizzle-orm";

const log = createLogger("customer-intelligence");

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export interface CustomerInsight {
  totalCustomers: number;
  activeCustomers: number; // visited in last 90 days
  lapsedCustomers: number; // 90-365 days
  lostCustomers: number; // 365+ days
  newThisMonth: number;
  avgLifetimeValue: number;
  topSpenders: Array<{ name: string; total: number; visits: number }>;
  atRiskCustomers: Array<{ name: string; phone: string; lastVisit: string; daysSince: number }>;
  servicePatterns: Array<{ service: string; count: number; revenue: number }>;
  dayOfWeekPattern: number[]; // Mon-Sun booking counts
  peakHours: number[]; // 0-23 booking counts
  retentionRate: number; // % of customers who came back
  avgTicket: number;
  avgVisitsPerCustomer: number;
}

export async function analyzeCustomers(): Promise<CustomerInsight> {
  const d = await db();
  const empty: CustomerInsight = {
    totalCustomers: 0, activeCustomers: 0, lapsedCustomers: 0, lostCustomers: 0,
    newThisMonth: 0, avgLifetimeValue: 0, topSpenders: [], atRiskCustomers: [],
    servicePatterns: [], dayOfWeekPattern: [0,0,0,0,0,0,0], peakHours: new Array(24).fill(0),
    retentionRate: 0, avgTicket: 0, avgVisitsPerCustomer: 0,
  };
  if (!d) return empty;

  try {
    const { customers, invoices, bookings } = await import("../../drizzle/schema");
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Basic counts
    const [total, active, lapsed, newMonth] = await Promise.all([
      d.select({ count: sql<number>`count(*)` }).from(customers),
      d.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.segment, "recent")),
      d.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.segment, "lapsed")),
      d.select({ count: sql<number>`count(*)` }).from(customers).where(sql`${customers.createdAt} >= ${monthAgo}`),
    ]);

    // Revenue analysis from invoices
    const paidInvoices = await d.select().from(invoices).where(eq(invoices.paymentStatus, "paid"));
    const totalRevenue = paidInvoices.reduce((s, i) => s + i.totalAmount, 0) / 100;
    const avgTicket = paidInvoices.length > 0 ? Math.round(totalRevenue / paidInvoices.length) : 0;

    // Top spenders (aggregate by customer name)
    const spenderMap = new Map<string, { total: number; visits: number }>();
    for (const inv of paidInvoices) {
      const key = inv.customerName;
      const existing = spenderMap.get(key) || { total: 0, visits: 0 };
      existing.total += inv.totalAmount / 100;
      existing.visits++;
      spenderMap.set(key, existing);
    }
    const topSpenders = Array.from(spenderMap.entries())
      .map(([name, data]) => ({ name, total: Math.round(data.total), visits: data.visits }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const totalCust = total[0]?.count ?? 0;
    const avgLTV = totalCust > 0 ? Math.round(totalRevenue / totalCust) : 0;
    const avgVisits = totalCust > 0 ? Math.round((paidInvoices.length / totalCust) * 10) / 10 : 0;

    // Service patterns from invoice descriptions
    const serviceMap = new Map<string, { count: number; revenue: number }>();
    for (const inv of paidInvoices) {
      const desc = (inv.serviceDescription || "General Service").split("\n")[0].slice(0, 50);
      const existing = serviceMap.get(desc) || { count: 0, revenue: 0 };
      existing.count++;
      existing.revenue += inv.totalAmount / 100;
      serviceMap.set(desc, existing);
    }
    const servicePatterns = Array.from(serviceMap.entries())
      .map(([service, data]) => ({ service, count: data.count, revenue: Math.round(data.revenue) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Retention rate (customers with 2+ invoices / total customers with invoices)
    const repeatCustomers = Array.from(spenderMap.values()).filter(s => s.visits >= 2).length;
    const totalWithInvoices = spenderMap.size;
    const retentionRate = totalWithInvoices > 0 ? Math.round((repeatCustomers / totalWithInvoices) * 100) : 0;

    // At-risk customers: lapsed segment with highest spend (these are the ones worth saving)
    let atRiskCustomers: Array<{ name: string; phone: string; lastVisit: string; daysSince: number }> = [];
    try {
      const lapsedRows = await d.select({
        firstName: customers.firstName,
        lastName: customers.lastName,
        phone: customers.phone,
        lastVisit: customers.lastVisitDate,
      }).from(customers)
        .where(eq(customers.segment, "lapsed"))
        .orderBy(asc(customers.lastVisitDate)) // Oldest visit first = most at-risk
        .limit(10);

      atRiskCustomers = lapsedRows
        .filter(r => r.lastVisit)
        .map(r => ({
          name: `${r.firstName} ${r.lastName || ""}`.trim(),
          phone: r.phone || "",
          lastVisit: r.lastVisit ? new Date(r.lastVisit).toISOString().split("T")[0] : "unknown",
          daysSince: r.lastVisit ? Math.round((now.getTime() - new Date(r.lastVisit).getTime()) / (24 * 60 * 60 * 1000)) : 999,
        }));
    } catch (err) {
      log.warn("Failed to query at-risk customers", { error: String(err) });
    }

    // Day-of-week booking patterns (Mon=0...Sun=6)
    const dayOfWeekPattern = [0,0,0,0,0,0,0];
    const peakHoursArr = new Array(24).fill(0);
    try {
      const allBookings = await d.select({ createdAt: bookings.createdAt }).from(bookings)
        .where(gte(bookings.createdAt, ninetyDaysAgo));

      for (const b of allBookings) {
        if (b.createdAt) {
          const dt = new Date(b.createdAt);
          const dow = dt.getDay(); // 0=Sun
          dayOfWeekPattern[dow]++;
          peakHoursArr[dt.getHours()]++;
        }
      }
    } catch (err) {
      log.warn("Failed to query booking patterns", { error: String(err) });
    }

    return {
      totalCustomers: totalCust,
      activeCustomers: active[0]?.count ?? 0,
      lapsedCustomers: lapsed[0]?.count ?? 0,
      lostCustomers: Math.max(0, totalCust - (active[0]?.count ?? 0) - (lapsed[0]?.count ?? 0)),
      newThisMonth: newMonth[0]?.count ?? 0,
      avgLifetimeValue: avgLTV,
      topSpenders,
      atRiskCustomers,
      servicePatterns,
      dayOfWeekPattern,
      peakHours: peakHoursArr,
      retentionRate,
      avgTicket,
      avgVisitsPerCustomer: avgVisits,
    };
  } catch (err) {
    log.error("Customer analysis failed:", { error: err instanceof Error ? err.message : String(err) });
    return empty;
  }
}

/**
 * Generate a customer intelligence brief for Nick AI.
 */
export async function getCustomerBrief(): Promise<string> {
  const data = await analyzeCustomers();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const busiestDay = data.dayOfWeekPattern.indexOf(Math.max(...data.dayOfWeekPattern));
  const nonZeroDays = data.dayOfWeekPattern.filter(n => n > 0);
  const slowestDay = nonZeroDays.length > 0 ? data.dayOfWeekPattern.indexOf(Math.min(...nonZeroDays)) : -1;
  const peakHour = data.peakHours.indexOf(Math.max(...data.peakHours));

  return `CUSTOMER INTELLIGENCE:
- Total: ${data.totalCustomers} | Active (90d): ${data.activeCustomers} | Lapsed: ${data.lapsedCustomers} | Lost: ${data.lostCustomers}
- New this month: ${data.newThisMonth}
- Avg lifetime value: $${data.avgLifetimeValue} | Avg ticket: $${data.avgTicket} | Avg visits: ${data.avgVisitsPerCustomer}
- Retention rate: ${data.retentionRate}% (customers who came back)
- Top services: ${data.servicePatterns.slice(0, 5).map(s => `${s.service} (${s.count}x, $${s.revenue})`).join(", ")}
- Top spenders: ${data.topSpenders.slice(0, 3).map(s => `${s.name} ($${s.total}, ${s.visits} visits)`).join(", ")}
- At-risk customers: ${data.atRiskCustomers.length > 0 ? data.atRiskCustomers.slice(0, 5).map(c => `${c.name} (${c.daysSince}d ago, ${c.phone})`).join(", ") : "None detected"}
- Busiest day: ${days[busiestDay] || "N/A"} | Slowest: ${days[slowestDay] || "N/A"} | Peak hour: ${peakHour}:00
- Churn risk: ${data.lapsedCustomers > data.activeCustomers ? "HIGH — more lapsed than active" : data.lapsedCustomers > data.activeCustomers * 0.5 ? "MODERATE — lapsed approaching active count" : "LOW"}`;
}

/**
 * Get actionable customer lifecycle insights for Nick AI.
 * Goes beyond raw stats — tells Nick what to DO about each segment.
 */
export async function getCustomerActionPlan(): Promise<string> {
  const data = await analyzeCustomers();
  const actions: string[] = [];

  // At-risk customers — specific call-to-action
  if (data.atRiskCustomers.length > 0) {
    const topRisk = data.atRiskCustomers[0];
    actions.push(`CALL NOW: ${topRisk.name} (${topRisk.phone}) — ${topRisk.daysSince}d since last visit. They're about to become a lost customer.`);
  }

  // Churn prediction
  const churnRate = data.totalCustomers > 0 ? Math.round((data.lostCustomers / data.totalCustomers) * 100) : 0;
  if (churnRate > 30) {
    actions.push(`CHURN ALERT: ${churnRate}% of customers are lost (365+ days). Run a win-back campaign targeting recent churns (90-180d) — they're the easiest to recover.`);
  }

  // High-value customer protection
  if (data.topSpenders.length > 0) {
    const topCustomer = data.topSpenders[0];
    actions.push(`PROTECT: ${topCustomer.name} is your #1 spender ($${topCustomer.total}, ${topCustomer.visits} visits). Make sure they're getting VIP treatment.`);
  }

  // Retention opportunity
  if (data.retentionRate < 40) {
    actions.push(`RETENTION: Only ${data.retentionRate}% of customers come back. Consider a post-service follow-up SMS 30 days after visit.`);
  }

  // New customer momentum
  if (data.newThisMonth > 0) {
    actions.push(`MOMENTUM: ${data.newThisMonth} new customers this month. First impressions matter — ensure fast turnaround and follow-up review request.`);
  }

  return actions.length > 0 ? `\nCUSTOMER ACTION PLAN:\n${actions.map(a => `• ${a}`).join("\n")}` : "";
}
