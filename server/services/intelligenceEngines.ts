/**
 * Intelligence Engines — 5 predictive systems + 6 unused data analyzers
 *
 * #1 Revenue Forecasting — day-of-week + seasonal + trend model
 * #2 Service Cross-Sell — "customers who got X also needed Y"
 * #3 Dynamic Lead Scoring — multi-factor scoring model
 * #4 Campaign Attribution — SMS/review → booking tracking
 * #5 Customer LTV Prediction — scoring engine
 *
 * Unused Data Rewiring:
 * - Chat transcripts → demand signal extraction
 * - Click-to-call → booking attribution
 * - Vehicle make/model → fleet analysis
 * - Customer zip codes → geographic intelligence
 * - Booking stage timing → bottleneck detection
 * - Declined work → pattern analysis
 */

import { getDb } from "../db";
import { invoices, customers, customerMetrics, leads, bookings, chatSessions, callEvents, workOrders, reviewRequests } from "../../drizzle/schema";
import { sql, eq, gte, lte, and, asc } from "drizzle-orm";
import { BUSINESS } from "@shared/business";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// ═══════════════════════════════════════════════════════════
// #1 REVENUE FORECASTING
// ═══════════════════════════════════════════════════════════

export async function forecastRevenue() {
  const now = new Date();
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dayOfWeek = etNow.getDay(); // 0=Sun

  // Pull daily revenue for last 90 days (paid invoices only)
  const dailyRevenue = await (await db()).select({
    day: sql<string>`DATE(${invoices.invoiceDate})`.as("day"),
    dow: sql<number>`DAYOFWEEK(${invoices.invoiceDate})`.as("dow"),
    total: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`.as("total"),
    count: sql<number>`COUNT(*)`.as("cnt"),
  }).from(invoices)
    .where(and(gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`), eq(invoices.paymentStatus, "paid")))
    .groupBy(sql`DATE(${invoices.invoiceDate})`);

  // Day-of-week averages
  const dowAvg: Record<number, { avg: number; count: number }> = {};
  for (const r of dailyRevenue) {
    const d = r.dow;
    if (!dowAvg[d]) dowAvg[d] = { avg: 0, count: 0 };
    dowAvg[d].avg += r.total;
    dowAvg[d].count += 1;
  }
  for (const d in dowAvg) dowAvg[d].avg = Math.round(dowAvg[d].avg / dowAvg[d].count);

  // Today's revenue so far (paid invoices only)
  const todayRev = await (await db()).select({
    total: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`.as("total"),
    count: sql<number>`COUNT(*)`.as("cnt"),
  }).from(invoices)
    .where(and(gte(invoices.invoiceDate, sql`CURDATE()`), eq(invoices.paymentStatus, "paid")));

  const todaySoFar = (todayRev[0]?.total || 0) / 100; // cents → dollars
  const todayExpected = (dowAvg[dayOfWeek + 1]?.avg || 0) / 100; // MySQL DAYOFWEEK is 1-indexed

  // This week so far (paid invoices only)
  const weekRev = await (await db()).select({
    total: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`.as("total"),
  }).from(invoices)
    .where(and(gte(invoices.invoiceDate, sql`DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)`), eq(invoices.paymentStatus, "paid")));

  const weekSoFar = (weekRev[0]?.total || 0) / 100;

  // Project remaining week days
  let weekProjection = weekSoFar;
  for (let d = dayOfWeek + 1; d <= 6; d++) { // rest of week through Saturday
    weekProjection += (dowAvg[d + 1]?.avg || 0) / 100;
  }

  // Monthly revenue + projection (paid invoices only)
  const monthRev = await (await db()).select({
    total: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`.as("total"),
  }).from(invoices)
    .where(and(gte(invoices.invoiceDate, sql`DATE_FORMAT(CURDATE(), '%Y-%m-01')`), eq(invoices.paymentStatus, "paid")));

  const monthSoFar = (monthRev[0]?.total || 0) / 100;
  const dayOfMonth = etNow.getDate();
  const daysInMonth = new Date(etNow.getFullYear(), etNow.getMonth() + 1, 0).getDate();
  const monthProjection = dayOfMonth > 0 ? Math.round(monthSoFar * (daysInMonth / dayOfMonth)) : 0;

  // Last 4 weeks trend (paid invoices only)
  const weeklyTrend = await (await db()).select({
    week: sql<string>`DATE_FORMAT(${invoices.invoiceDate}, '%Y-%u')`.as("week"),
    total: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`.as("total"),
  }).from(invoices)
    .where(and(gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 28 DAY)`), eq(invoices.paymentStatus, "paid")))
    .groupBy(sql`DATE_FORMAT(${invoices.invoiceDate}, '%Y-%u')`)
    .orderBy(sql`week`);

  const weeks = weeklyTrend.map((w: any) => w.total / 100);
  const trend = weeks.length >= 2
    ? weeks[weeks.length - 1] > weeks[weeks.length - 2] ? "up" : weeks[weeks.length - 1] < weeks[weeks.length - 2] ? "down" : "flat"
    : "flat";

  const TARGET = BUSINESS.revenueTarget.monthly;
  const onPace = monthProjection >= TARGET;
  const gap = TARGET - monthProjection;

  return {
    today: { soFar: todaySoFar, expected: todayExpected, pct: todayExpected > 0 ? Math.round((todaySoFar / todayExpected) * 100) : 0 },
    week: { soFar: weekSoFar, projection: Math.round(weekProjection) },
    month: { soFar: monthSoFar, projection: monthProjection, target: TARGET, onPace, gap: Math.round(gap) },
    trend,
    dowAverages: Object.fromEntries(Object.entries(dowAvg).map(([k, v]) => [k, Math.round(v.avg / 100)])),
    weeklyTrend: weeks,
  };
}

// ═══════════════════════════════════════════════════════════
// #2 SERVICE CROSS-SELL ENGINE
// ═══════════════════════════════════════════════════════════

const SERVICE_CATEGORIES = [
  { key: "brakes", pattern: /brake|rotor|pad|caliper/i },
  { key: "tires", pattern: /tire|mount|balance|rotation|alignment/i },
  { key: "oil", pattern: /oil.?change|lube|filter/i },
  { key: "suspension", pattern: /strut|shock|spring|suspension|control.?arm|ball.?joint|tie.?rod/i },
  { key: "engine", pattern: /engine|timing|head.?gasket|valve|compression/i },
  { key: "electrical", pattern: /battery|alternator|starter|wiring|fuse/i },
  { key: "exhaust", pattern: /exhaust|muffler|catalytic|pipe/i },
  { key: "cooling", pattern: /coolant|radiator|thermostat|water.?pump|heater.?core/i },
  { key: "transmission", pattern: /transmission|trans.?fluid|clutch/i },
  { key: "diagnostic", pattern: /diagnos|check.?engine|scan|inspect/i },
];

function categorizeService(desc: string): string[] {
  return SERVICE_CATEGORIES.filter(c => c.pattern.test(desc)).map(c => c.key);
}

export async function generateCrossSellRecommendations() {
  // Get all invoices with customer linkage
  const allInvoices = await (await db()).select({
    customerId: invoices.customerId,
    customerPhone: invoices.customerPhone,
    serviceDescription: invoices.serviceDescription,
    invoiceDate: invoices.invoiceDate,
  }).from(invoices)
    .where(gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 24 MONTH)`))
    .orderBy(asc(invoices.invoiceDate));

  // Build customer service timelines
  const customerServices: Record<string, { categories: string[]; date: Date }[]> = {};
  for (const inv of allInvoices) {
    const key = inv.customerId?.toString() || inv.customerPhone || "";
    if (!key) continue;
    const cats = categorizeService(inv.serviceDescription || "");
    if (cats.length > 0 && inv.invoiceDate) {
      if (!customerServices[key]) customerServices[key] = [];
      customerServices[key].push({ categories: cats, date: new Date(inv.invoiceDate) });
    }
  }

  // Find patterns: "after X, customers got Y within N months"
  const transitions: Record<string, { count: number; avgDays: number; totalDays: number }> = {};
  for (const timeline of Object.values(customerServices)) {
    for (let i = 0; i < timeline.length - 1; i++) {
      for (let j = i + 1; j < timeline.length; j++) {
        const daysBetween = Math.floor((timeline[j].date.getTime() - timeline[i].date.getTime()) / 86400000);
        if (daysBetween > 365) break; // only within 1 year
        for (const from of timeline[i].categories) {
          for (const to of timeline[j].categories) {
            if (from === to) continue;
            const key = `${from}→${to}`;
            if (!transitions[key]) transitions[key] = { count: 0, avgDays: 0, totalDays: 0 };
            transitions[key].count++;
            transitions[key].totalDays += daysBetween;
          }
        }
      }
    }
  }

  // Calculate averages and sort by frequency
  const patterns = Object.entries(transitions)
    .map(([key, val]) => ({
      from: key.split("→")[0],
      to: key.split("→")[1],
      count: val.count,
      avgDays: Math.round(val.totalDays / val.count),
    }))
    .filter(p => p.count >= 3) // minimum 3 occurrences
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Find customers due for cross-sell
  const recommendations: { customerId: string; phone: string; name: string; service: string; reason: string; urgency: string }[] = [];

  for (const pattern of patterns.slice(0, 10)) {
    // Find customers who got the "from" service but not the "to" service yet
    for (const [custKey, timeline] of Object.entries(customerServices)) {
      const lastFrom = [...timeline].reverse().find(t => t.categories.includes(pattern.from));
      const hasTo = timeline.some(t => t.categories.includes(pattern.to) && t.date > (lastFrom?.date || new Date(0)));
      if (lastFrom && !hasTo) {
        const daysSince = Math.floor((Date.now() - lastFrom.date.getTime()) / 86400000);
        if (daysSince >= pattern.avgDays * 0.8 && daysSince <= pattern.avgDays * 1.5) {
          const cust = await (await db()).select({ firstName: customers.firstName, lastName: customers.lastName, phone: customers.phone })
            .from(customers).where(eq(customers.id, parseInt(custKey) || 0)).limit(1);
          if (cust[0]) {
            recommendations.push({
              customerId: custKey,
              phone: cust[0].phone || "",
              name: `${cust[0].firstName || ""} ${cust[0].lastName || ""}`.trim(),
              service: pattern.to,
              reason: `Got ${pattern.from} ${daysSince}d ago — ${pattern.count} customers followed up with ${pattern.to} around this time`,
              urgency: daysSince > pattern.avgDays ? "overdue" : "upcoming",
            });
          }
        }
      }
    }
  }

  return { patterns, recommendations: recommendations.slice(0, 25) };
}

// ═══════════════════════════════════════════════════════════
// #3 DYNAMIC LEAD SCORING
// ═══════════════════════════════════════════════════════════

const SERVICE_VALUES: Record<string, number> = {
  engine: 90, transmission: 85, suspension: 70, brakes: 65, tires: 60,
  electrical: 55, exhaust: 50, cooling: 50, diagnostic: 40, oil: 20,
};

const SOURCE_QUALITY: Record<string, number> = {
  manual: 80, callback: 75, booking: 70, chat: 50, popup: 40, fleet: 90,
};

export async function scoreLeads() {
  const openLeads = await (await db()).select().from(leads)
    .where(sql`${leads.status} IN ('new', 'contacted')`);

  const scored = await Promise.all(openLeads.map(async (lead: any) => {
    let score = 0;
    const factors: string[] = [];

    // 1. Service value (0-30 points)
    const cats = categorizeService(lead.problem || lead.recommendedService || "");
    const serviceScore = Math.max(...cats.map(c => SERVICE_VALUES[c] || 30), 30);
    const servicePoints = Math.round((serviceScore / 100) * 30);
    score += servicePoints;
    factors.push(`service:${servicePoints}`);

    // 2. Source quality (0-20 points)
    const sourcePoints = Math.round(((SOURCE_QUALITY[lead.source || "popup"] || 40) / 100) * 20);
    score += sourcePoints;
    factors.push(`source:${sourcePoints}`);

    // 3. Existing customer bonus (0-15 points)
    let existingBonus = 0;
    if (lead.phone) {
      const existing = await (await db()).select({ totalSpent: customers.totalSpent, totalVisits: customers.totalVisits })
        .from(customers).where(sql`RIGHT(${customers.phone}, 10) = RIGHT(${lead.phone}, 10)`).limit(1);
      if (existing[0]) {
        existingBonus = Math.min(15, Math.round((existing[0].totalSpent || 0) / 100 / 100)); // $1 = 0.01 points, max 15
        if (existingBonus < 5 && (existing[0].totalVisits || 0) > 0) existingBonus = 5; // min 5 for any existing customer
      }
    }
    score += existingBonus;
    if (existingBonus > 0) factors.push(`existing:${existingBonus}`);

    // 4. Fleet bonus (0-15 points)
    if (lead.source === "fleet" || (lead.fleetSize && lead.fleetSize > 1)) {
      const fleetPoints = Math.min(15, (lead.fleetSize || 2) * 3);
      score += fleetPoints;
      factors.push(`fleet:${fleetPoints}`);
    }

    // 5. Urgency (0-10 points)
    const urgencyPoints = Math.min(10, (lead.urgencyScore || 3) * 2);
    score += urgencyPoints;
    factors.push(`urgency:${urgencyPoints}`);

    // 6. Freshness decay (0 to -10 points)
    const ageHours = lead.createdAt ? (Date.now() - new Date(lead.createdAt).getTime()) / 3600000 : 0;
    const decay = ageHours > 24 ? -Math.min(10, Math.round(ageHours / 24)) : 0;
    score += decay;
    if (decay < 0) factors.push(`decay:${decay}`);

    return { id: lead.id, name: lead.name, phone: lead.phone, score: Math.max(0, Math.min(100, score)), factors, vehicle: lead.vehicle, problem: lead.problem };
  }));

  // Update urgencyScore in DB for top leads
  for (const s of scored) {
    await (await db()).update(leads).set({ urgencyScore: s.score }).where(eq(leads.id, s.id));
  }

  return scored.sort((a, b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════
// #4 CAMPAIGN ATTRIBUTION
// ═══════════════════════════════════════════════════════════

export async function trackCampaignAttribution() {
  // Find review requests that were sent + subsequent bookings/invoices within 14 days
  const sentReviews = await (await db()).select().from(reviewRequests)
    .where(and(eq(reviewRequests.status, "sent"), gte(reviewRequests.sentAt, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`)));

  const reviewAttribution: { sent: number; clicked: number; bookedAfter: number; revenueGenerated: number } = {
    sent: sentReviews.length,
    clicked: sentReviews.filter((r: any) => r.clickedAt).length,
    bookedAfter: 0,
    revenueGenerated: 0,
  };

  // Check if review request customers booked again within 30 days
  for (const rev of sentReviews) {
    if (!rev.phone) continue;
    const followUp = await (await db()).select({ id: bookings.id }).from(bookings)
      .where(and(
        sql`RIGHT(${bookings.phone}, 10) = RIGHT(${rev.phone}, 10)`,
        gte(bookings.createdAt, rev.sentAt!),
        lte(bookings.createdAt, sql`DATE_ADD(${rev.sentAt}, INTERVAL 30 DAY)`)
      )).limit(1);
    if (followUp.length > 0) reviewAttribution.bookedAfter++;
  }

  // SMS campaign attribution — find customers who received campaign SMS and then booked
  const campaignSms = await (await db()).select({
    phone: customers.phone,
    campaignDate: customers.smsCampaignDate,
  }).from(customers)
    .where(and(eq(customers.smsCampaignSent, 1), gte(customers.smsCampaignDate, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`)));

  const smsAttribution: { sent: number; bookedAfter: number; revenueAfter: number } = {
    sent: campaignSms.length,
    bookedAfter: 0,
    revenueAfter: 0,
  };

  for (const c of campaignSms) {
    if (!c.phone || !c.campaignDate) continue;
    const followInvoice = await (await db()).select({ total: invoices.totalAmount }).from(invoices)
      .where(and(
        sql`RIGHT(${invoices.customerPhone}, 10) = RIGHT(${c.phone}, 10)`,
        gte(invoices.invoiceDate, c.campaignDate),
        lte(invoices.invoiceDate, sql`DATE_ADD(${c.campaignDate}, INTERVAL 14 DAY)`)
      ));
    if (followInvoice.length > 0) {
      smsAttribution.bookedAfter++;
      smsAttribution.revenueAfter += followInvoice.reduce((s: number, i: any) => s + (i.total || 0), 0) / 100;
    }
  }

  return { reviewAttribution, smsAttribution };
}

// ═══════════════════════════════════════════════════════════
// #5 CUSTOMER LTV PREDICTION
// ═══════════════════════════════════════════════════════════

export async function predictCustomerLTV() {
  try {
    const allCustomers = await (await db()).select({
      id: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
      phone: customers.phone,
      totalSpent: customers.totalSpent,
      totalVisits: customers.totalVisits,
      lastVisitDate: customers.lastVisitDate,
      firstVisitDate: customers.firstVisitDate,
      segment: customers.segment,
      city: customers.city,
      zip: customers.zip,
    }).from(customers)
      .where(gte(customers.totalVisits, 1));

    const scored = allCustomers.map((c: any) => {
      let ltvScore = 0;

      // 1. Historical spend (0-30)
      const spent = (c.totalSpent || 0) / 100;
      ltvScore += Math.min(30, Math.round(spent / 100)); // $100 = 1 point

      // 2. Visit frequency (0-25)
      const visits = c.totalVisits || 0;
      const firstVisit = c.firstVisitDate ? new Date(c.firstVisitDate) : new Date();
      const monthsActive = Math.max(1, (Date.now() - firstVisit.getTime()) / (30 * 86400000));
      const visitsPerMonth = visits / monthsActive;
      ltvScore += Math.min(25, Math.round(visitsPerMonth * 15));

      // 3. Recency (0-20)
      const daysSince = c.lastVisitDate ? Math.floor((Date.now() - new Date(c.lastVisitDate).getTime()) / 86400000) : 999;
      const recencyScore = daysSince <= 30 ? 20 : daysSince <= 60 ? 15 : daysSince <= 90 ? 10 : daysSince <= 180 ? 5 : 0;
      ltvScore += recencyScore;

      // 4. Average ticket value (0-15)
      const avgTicket = visits > 0 ? spent / visits : 0;
      ltvScore += Math.min(15, Math.round(avgTicket / 30));

      // 5. Loyalty tenure (0-10)
      const tenureMonths = monthsActive;
      ltvScore += Math.min(10, Math.round(tenureMonths / 3));

      const churnRisk = daysSince > 180 ? "high" : daysSince > 90 ? "medium" : "low";

      return {
        id: c.id,
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
        phone: c.phone,
        ltvScore: Math.min(100, ltvScore),
        totalSpent: spent,
        visits,
        avgTicket: Math.round(avgTicket),
        daysSinceLastVisit: daysSince,
        churnRisk,
        segment: c.segment,
      };
    });

    // Update customer_metrics in background (fire-and-forget, don't block the response)
    const dbRef = await db();
    Promise.resolve().then(async () => {
      try {
        for (const s of scored.slice(0, 200)) {
          await dbRef.update(customerMetrics)
            .set({ churnRisk: s.churnRisk as any, isVip: s.ltvScore >= 70 ? 1 : 0 })
            .where(eq(customerMetrics.customerId, s.id));
        }
      } catch (e) {
        console.error("[intelligence:ltv] background metrics update failed:", e);
      }
    });

    const sorted = scored.sort((a: any, b: any) => b.ltvScore - a.ltvScore);
    const atRiskHighValue = sorted.filter((c: any) => c.ltvScore >= 50 && c.daysSinceLastVisit > 60).slice(0, 15);

    return {
      topCustomers: sorted.slice(0, 20),
      atRiskHighValue,
      segments: {
        whales: sorted.filter((c: any) => c.ltvScore >= 70).length,
        regulars: sorted.filter((c: any) => c.ltvScore >= 40 && c.ltvScore < 70).length,
        occasional: sorted.filter((c: any) => c.ltvScore >= 15 && c.ltvScore < 40).length,
        oneTimers: sorted.filter((c: any) => c.ltvScore < 15).length,
      },
    };
  } catch (e) {
    console.error("[intelligence:ltv] predictCustomerLTV failed:", e);
    return { topCustomers: [], atRiskHighValue: [], segments: { whales: 0, regulars: 0, occasional: 0, oneTimers: 0 } };
  }
}

// ═══════════════════════════════════════════════════════════
// UNUSED DATA REWIRING
// ═══════════════════════════════════════════════════════════

/** Chat transcripts → demand signal extraction */
export async function analyzeChatDemand() {
  const sessions = await (await db()).select({
    messagesJson: chatSessions.messagesJson,
    vehicleInfo: chatSessions.vehicleInfo,
    problemSummary: chatSessions.problemSummary,
    converted: chatSessions.converted,
    createdAt: chatSessions.createdAt,
  }).from(chatSessions)
    .where(gte(chatSessions.createdAt, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`));

  const demandSignals: Record<string, { mentions: number; converted: number }> = {};
  for (const s of sessions) {
    const text = `${s.problemSummary || ""} ${s.vehicleInfo || ""}`;
    for (const cat of SERVICE_CATEGORIES) {
      if (cat.pattern.test(text)) {
        if (!demandSignals[cat.key]) demandSignals[cat.key] = { mentions: 0, converted: 0 };
        demandSignals[cat.key].mentions++;
        if (s.converted) demandSignals[cat.key].converted++;
      }
    }
  }

  return {
    totalSessions: sessions.length,
    converted: sessions.filter((s: any) => s.converted).length,
    conversionRate: sessions.length > 0 ? Math.round((sessions.filter((s: any) => s.converted).length / sessions.length) * 100) : 0,
    demandByService: Object.entries(demandSignals).sort((a, b) => b[1].mentions - a[1].mentions),
  };
}

/** Click-to-call → booking attribution */
export async function analyzeCallAttribution() {
  const calls = await (await db()).select().from(callEvents)
    .where(gte(callEvents.createdAt, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`));

  // Match calls to bookings by phone within 24 hours
  let attributed = 0;
  const pagePerformance: Record<string, { calls: number; bookings: number }> = {};

  for (const call of calls) {
    const page = call.sourcePage || "unknown";
    if (!pagePerformance[page]) pagePerformance[page] = { calls: 0, bookings: 0 };
    pagePerformance[page].calls++;

    if (call.phoneNumber) {
      const booking = await (await db()).select({ id: bookings.id }).from(bookings)
        .where(and(
          sql`RIGHT(${bookings.phone}, 10) = RIGHT(${call.phoneNumber}, 10)`,
          gte(bookings.createdAt, call.createdAt!),
          lte(bookings.createdAt, sql`DATE_ADD(${call.createdAt}, INTERVAL 24 HOUR)`)
        )).limit(1);
      if (booking.length > 0) {
        attributed++;
        pagePerformance[page].bookings++;
      }
    }
  }

  return {
    totalCalls: calls.length,
    attributedToBookings: attributed,
    conversionRate: calls.length > 0 ? Math.round((attributed / calls.length) * 100) : 0,
    topPages: Object.entries(pagePerformance).sort((a, b) => b[1].calls - a[1].calls).slice(0, 10),
    peakHours: calls.reduce((acc: Record<number, number>, c: any) => {
      const h = c.createdAt ? new Date(c.createdAt).getHours() : 0;
      acc[h] = (acc[h] || 0) + 1;
      return acc;
    }, {} as Record<number, number>),
  };
}

/** Vehicle make/model → fleet analysis */
export async function analyzeFleet() {
  const vehicles = await (await db()).select({
    make: customers.vehicleMake,
    model: customers.vehicleModel,
    year: customers.vehicleYear,
    totalSpent: customers.totalSpent,
    totalVisits: customers.totalVisits,
  }).from(customers)
    .where(sql`${customers.vehicleMake} IS NOT NULL AND ${customers.vehicleMake} != ''`);

  const makeStats: Record<string, { count: number; revenue: number; avgSpend: number }> = {};
  for (const v of vehicles) {
    const make = (v.make || "").toUpperCase();
    if (!makeStats[make]) makeStats[make] = { count: 0, revenue: 0, avgSpend: 0 };
    makeStats[make].count++;
    makeStats[make].revenue += (v.totalSpent || 0) / 100;
  }
  for (const m in makeStats) makeStats[m].avgSpend = Math.round(makeStats[m].revenue / makeStats[m].count);

  return {
    totalVehicles: vehicles.length,
    topMakes: Object.entries(makeStats).sort((a, b) => b[1].count - a[1].count).slice(0, 15),
    topByRevenue: Object.entries(makeStats).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10),
  };
}

/** Customer zip codes → geographic intelligence */
export async function analyzeGeography() {
  const geoData = await (await db()).select({
    zip: customers.zip,
    city: customers.city,
    cnt: sql<number>`COUNT(*)`.as("cnt"),
    totalRev: sql<number>`COALESCE(SUM(${customers.totalSpent}), 0)`.as("totalRev"),
  }).from(customers)
    .where(sql`${customers.zip} IS NOT NULL AND ${customers.zip} != ''`)
    .groupBy(customers.zip, customers.city)
    .orderBy(sql`cnt DESC`)
    .limit(30);

  return {
    totalWithZip: geoData.reduce((s: number, g: any) => s + g.cnt, 0),
    hotZones: geoData.map((g: any) => ({
      zip: g.zip,
      city: g.city,
      customers: g.cnt,
      revenue: Math.round(g.totalRev / 100),
      avgRevPerCustomer: g.cnt > 0 ? Math.round(g.totalRev / 100 / g.cnt) : 0,
    })),
  };
}

/** Booking stage timing → bottleneck detection */
export async function analyzeBottlenecks() {
  const recentBookings = await (await db()).select({
    stage: bookings.stage,
    stageUpdatedAt: bookings.stageUpdatedAt,
    createdAt: bookings.createdAt,
    status: bookings.status,
  }).from(bookings)
    .where(gte(bookings.createdAt, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`));

  const stageMetrics: Record<string, { count: number; avgHours: number; totalHours: number }> = {};
  for (const b of recentBookings) {
    const stage = b.stage || "received";
    if (!stageMetrics[stage]) stageMetrics[stage] = { count: 0, avgHours: 0, totalHours: 0 };
    stageMetrics[stage].count++;
    if (b.stageUpdatedAt && b.createdAt) {
      const hours = (new Date(b.stageUpdatedAt).getTime() - new Date(b.createdAt).getTime()) / 3600000;
      stageMetrics[stage].totalHours += hours;
    }
  }
  for (const s in stageMetrics) stageMetrics[s].avgHours = Math.round(stageMetrics[s].totalHours / stageMetrics[s].count * 10) / 10;

  const bottleneck = Object.entries(stageMetrics).sort((a, b) => b[1].avgHours - a[1].avgHours)[0];

  return {
    totalBookings: recentBookings.length,
    stageMetrics,
    bottleneck: bottleneck ? { stage: bottleneck[0], avgHours: bottleneck[1].avgHours } : null,
    completionRate: recentBookings.length > 0
      ? Math.round((recentBookings.filter((b: any) => b.status === "completed").length / recentBookings.length) * 100) : 0,
  };
}

/** Declined work → pattern analysis */
export async function analyzeDeclinedWork() {
  const wosWithDeclined = await (await db()).select({
    declinedWorkJson: workOrders.declinedWorkJson,
    serviceDescription: workOrders.serviceDescription,
    total: workOrders.total,
    createdAt: workOrders.createdAt,
  }).from(workOrders)
    .where(and(eq(workOrders.hasDeclinedWork, true), gte(workOrders.createdAt, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`)));

  let totalDeclinedValue = 0;
  const declinedCategories: Record<string, { count: number; totalValue: number }> = {};

  for (const wo of wosWithDeclined) {
    try {
      const declined = typeof wo.declinedWorkJson === "string" ? JSON.parse(wo.declinedWorkJson) : wo.declinedWorkJson;
      if (Array.isArray(declined)) {
        for (const item of declined) {
          const desc = item.description || item.service || "";
          const value = parseFloat(item.amount || item.price || "0");
          totalDeclinedValue += value;
          for (const cat of categorizeService(desc)) {
            if (!declinedCategories[cat]) declinedCategories[cat] = { count: 0, totalValue: 0 };
            declinedCategories[cat].count++;
            declinedCategories[cat].totalValue += value;
          }
        }
      }
    } catch {}
  }

  return {
    totalWithDeclined: wosWithDeclined.length,
    totalDeclinedValue: Math.round(totalDeclinedValue),
    topDeclinedServices: Object.entries(declinedCategories).sort((a, b) => b[1].totalValue - a[1].totalValue),
    recoveryOpportunity: Math.round(totalDeclinedValue * 0.2), // assume 20% recovery rate
  };
}

// ═══════════════════════════════════════════════════════════
// #6 SEASONAL DEMAND FORECASTING
// ═══════════════════════════════════════════════════════════

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const SEASONAL_PREP_ACTIONS: Record<string, string> = {
  tires: "Stock seasonal tires, promote alignment bundles",
  brakes: "Run brake inspection special, stock pads/rotors",
  oil: "Promote oil change + multi-point inspection combo",
  cooling: "Stock coolant, push radiator flush packages",
  suspension: "Prep spring pothole damage repair marketing",
  electrical: "Stock batteries, push battery + charging system checks",
  engine: "Schedule diagnostic bay availability",
  exhaust: "Prep emissions/exhaust marketing for inspection season",
  transmission: "Promote transmission fluid flush packages",
  diagnostic: "Extend diagnostic bay hours for seasonal volume",
};

export async function forecastSeasonalDemand(): Promise<{
  currentMonth: string;
  hotServices: Array<{ service: string; lastYearCount: number; trend: string }>;
  upcomingDemand: Array<{ service: string; expectedIncrease: string; prepAction: string }>;
}> {
  const now = new Date();
  const currentMonthNum = now.getMonth() + 1; // 1-12
  const nextMonthNum = currentMonthNum === 12 ? 1 : currentMonthNum + 1;

  // Get invoice service descriptions grouped by month for the last 24 months
  const monthlyServices = await (await db()).select({
    monthNum: sql<number>`MONTH(${invoices.invoiceDate})`.as("monthNum"),
    yearNum: sql<number>`YEAR(${invoices.invoiceDate})`.as("yearNum"),
    serviceDescription: invoices.serviceDescription,
    cnt: sql<number>`COUNT(*)`.as("cnt"),
  }).from(invoices)
    .where(gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 24 MONTH)`))
    .groupBy(sql`MONTH(${invoices.invoiceDate})`, sql`YEAR(${invoices.invoiceDate})`, invoices.serviceDescription);

  // Categorize and aggregate by month + service category
  const monthCategoryTotals: Record<number, Record<string, { count: number; years: Set<number> }>> = {};
  for (let m = 1; m <= 12; m++) monthCategoryTotals[m] = {};

  for (const row of monthlyServices) {
    const cats = categorizeService(row.serviceDescription || "");
    for (const cat of cats) {
      if (!monthCategoryTotals[row.monthNum][cat]) {
        monthCategoryTotals[row.monthNum][cat] = { count: 0, years: new Set() };
      }
      monthCategoryTotals[row.monthNum][cat].count += row.cnt;
      monthCategoryTotals[row.monthNum][cat].years.add(row.yearNum);
    }
  }

  // Hot services for current month (sorted by count, top 5)
  const currentMonthData = monthCategoryTotals[currentMonthNum];
  const hotServices = Object.entries(currentMonthData)
    .map(([service, data]) => {
      const yearCount = data.years.size || 1;
      const avgPerYear = Math.round(data.count / yearCount);
      // Compare to overall average across all months for this service
      let totalAllMonths = 0;
      let monthsWithData = 0;
      for (let m = 1; m <= 12; m++) {
        if (monthCategoryTotals[m][service]) {
          totalAllMonths += monthCategoryTotals[m][service].count;
          monthsWithData++;
        }
      }
      const overallAvg = monthsWithData > 0 ? totalAllMonths / monthsWithData : 0;
      const trend = data.count > overallAvg * 1.2 ? "above-average" : data.count < overallAvg * 0.8 ? "below-average" : "normal";
      return { service, lastYearCount: avgPerYear, trend };
    })
    .sort((a, b) => b.lastYearCount - a.lastYearCount)
    .slice(0, 5);

  // Upcoming demand for next month
  const nextMonthData = monthCategoryTotals[nextMonthNum];
  const upcomingDemand = Object.entries(nextMonthData)
    .map(([service, data]) => {
      const currentCount = currentMonthData[service]?.count || 0;
      const nextCount = data.count;
      const yearCount = data.years.size || 1;
      const pctChange = currentCount > 0 ? Math.round(((nextCount / yearCount - currentCount / (currentMonthData[service]?.years.size || 1)) / (currentCount / (currentMonthData[service]?.years.size || 1))) * 100) : 100;
      return {
        service,
        expectedIncrease: pctChange > 0 ? `+${pctChange}%` : `${pctChange}%`,
        prepAction: SEASONAL_PREP_ACTIONS[service] || "Review inventory and staffing",
      };
    })
    .sort((a, b) => {
      const aNum = parseInt(a.expectedIncrease);
      const bNum = parseInt(b.expectedIncrease);
      return bNum - aNum;
    })
    .slice(0, 5);

  return {
    currentMonth: MONTH_NAMES[currentMonthNum - 1],
    hotServices,
    upcomingDemand,
  };
}

// ═══════════════════════════════════════════════════════════
// #7 GEOGRAPHIC REVENUE INTELLIGENCE
// ═══════════════════════════════════════════════════════════

export async function analyzeGeographicRevenue(): Promise<{
  topZipCodes: Array<{ zip: string; customerCount: number; totalRevenue: number; avgTicket: number }>;
  growthAreas: Array<{ zip: string; newCustomersLast90d: number }>;
  underservedAreas: Array<{ zip: string; impressions: number; customers: number; gap: string }>;
}> {
  // Top zip codes by revenue — join customers with their invoices
  const zipRevenue = await (await db()).select({
    zip: customers.zip,
    customerCount: sql<number>`COUNT(DISTINCT ${customers.id})`.as("customerCount"),
    totalRevenue: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`.as("totalRevenue"),
    invoiceCount: sql<number>`COUNT(${invoices.id})`.as("invoiceCount"),
  }).from(customers)
    .leftJoin(invoices, eq(customers.id, invoices.customerId))
    .where(sql`${customers.zip} IS NOT NULL AND ${customers.zip} != ''`)
    .groupBy(customers.zip)
    .orderBy(sql`totalRevenue DESC`)
    .limit(10);

  const topZipCodes = zipRevenue.map((z: any) => ({
    zip: z.zip || "",
    customerCount: z.customerCount,
    totalRevenue: Math.round(z.totalRevenue / 100), // cents to dollars
    avgTicket: z.invoiceCount > 0 ? Math.round(z.totalRevenue / 100 / z.invoiceCount) : 0,
  }));

  // Growth areas — new customers in last 90 days by zip
  const growthData = await (await db()).select({
    zip: customers.zip,
    newCustomers: sql<number>`COUNT(*)`.as("newCustomers"),
  }).from(customers)
    .where(and(
      sql`${customers.zip} IS NOT NULL AND ${customers.zip} != ''`,
      gte(customers.createdAt, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`)
    ))
    .groupBy(customers.zip)
    .orderBy(sql`newCustomers DESC`)
    .limit(10);

  const growthAreas = growthData.map((g: any) => ({
    zip: g.zip || "",
    newCustomersLast90d: g.newCustomers,
  }));

  // Underserved areas — zips with customers but low revenue vs. customer count
  // This indicates areas where we have reach but aren't converting well
  const underservedData = await (await db()).select({
    zip: customers.zip,
    totalCustomers: sql<number>`COUNT(DISTINCT ${customers.id})`.as("totalCustomers"),
    activeCustomers: sql<number>`COUNT(DISTINCT CASE WHEN ${customers.totalVisits} > 0 THEN ${customers.id} END)`.as("activeCustomers"),
    totalRevenue: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`.as("totalRevenue"),
  }).from(customers)
    .leftJoin(invoices, eq(customers.id, invoices.customerId))
    .where(sql`${customers.zip} IS NOT NULL AND ${customers.zip} != ''`)
    .groupBy(customers.zip)
    .having(sql`COUNT(DISTINCT ${customers.id}) >= 3`)
    .orderBy(sql`(COUNT(DISTINCT ${customers.id}) - COUNT(DISTINCT CASE WHEN ${customers.totalVisits} > 0 THEN ${customers.id} END)) DESC`)
    .limit(10);

  const underservedAreas = underservedData
    .filter((u: any) => u.totalCustomers > u.activeCustomers)
    .map((u: any) => {
      const conversionRate = u.totalCustomers > 0 ? Math.round((u.activeCustomers / u.totalCustomers) * 100) : 0;
      return {
        zip: u.zip || "",
        impressions: u.totalCustomers, // total known customers in zip
        customers: u.activeCustomers,
        gap: `${u.totalCustomers - u.activeCustomers} known contacts, only ${conversionRate}% converted`,
      };
    });

  return { topZipCodes, growthAreas, underservedAreas };
}

// ═══════════════════════════════════════════════════════════
// #8 SERVICE BUNDLING INTELLIGENCE
// ═══════════════════════════════════════════════════════════

export async function analyzeServiceBundles(): Promise<{
  frequentBundles: Array<{ services: string[]; count: number; avgTotal: number }>;
  recommendedUpsells: Array<{ ifService: string; thenService: string; probability: number }>;
}> {
  // Pull invoices with customer linkage — look for same customer, same day
  const recentInvoices = await (await db()).select({
    customerId: invoices.customerId,
    customerPhone: invoices.customerPhone,
    serviceDescription: invoices.serviceDescription,
    invoiceDate: invoices.invoiceDate,
    totalAmount: invoices.totalAmount,
  }).from(invoices)
    .where(gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 12 MONTH)`))
    .orderBy(asc(invoices.invoiceDate));

  // Group invoices by customer + date window (same day)
  const visits: Record<string, Array<{ categories: string[]; total: number; date: Date }>> = {};
  for (const inv of recentInvoices) {
    const custKey = inv.customerId?.toString() || inv.customerPhone || "";
    if (!custKey || !inv.serviceDescription) continue;
    const cats = categorizeService(inv.serviceDescription);
    if (cats.length === 0) continue;
    const dateKey = inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().slice(0, 10) : "";
    if (!dateKey) continue;
    const groupKey = `${custKey}|${dateKey}`;
    if (!visits[groupKey]) visits[groupKey] = [];
    visits[groupKey].push({ categories: cats, total: inv.totalAmount || 0, date: new Date(inv.invoiceDate!) });
  }

  // Find bundles — visits with 2+ distinct service categories on the same day
  const bundleCounts: Record<string, { count: number; totalRevenue: number }> = {};
  const pairCounts: Record<string, number> = {};
  const serviceTotals: Record<string, number> = {};

  for (const items of Object.values(visits)) {
    // Collect all unique categories for this visit
    const allCats = new Set<string>();
    let visitTotal = 0;
    for (const item of items) {
      for (const cat of item.categories) allCats.add(cat);
      visitTotal += item.total;
    }
    const catArray = [...allCats].sort();

    // Track individual service frequency
    for (const cat of catArray) {
      serviceTotals[cat] = (serviceTotals[cat] || 0) + 1;
    }

    if (catArray.length >= 2) {
      const bundleKey = catArray.join("+");
      if (!bundleCounts[bundleKey]) bundleCounts[bundleKey] = { count: 0, totalRevenue: 0 };
      bundleCounts[bundleKey].count++;
      bundleCounts[bundleKey].totalRevenue += visitTotal;

      // Track pairs for upsell probability
      for (let i = 0; i < catArray.length; i++) {
        for (let j = i + 1; j < catArray.length; j++) {
          const pairKey = `${catArray[i]}|${catArray[j]}`;
          pairCounts[pairKey] = (pairCounts[pairKey] || 0) + 1;
        }
      }
    }
  }

  // Top bundles
  const frequentBundles = Object.entries(bundleCounts)
    .map(([key, val]) => ({
      services: key.split("+"),
      count: val.count,
      avgTotal: Math.round(val.totalRevenue / val.count / 100), // cents to dollars
    }))
    .filter(b => b.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Upsell recommendations — "if service A, then service B" with probability
  const recommendedUpsells = Object.entries(pairCounts)
    .flatMap(([pairKey, count]) => {
      const [a, b] = pairKey.split("|");
      const results: Array<{ ifService: string; thenService: string; probability: number }> = [];
      // Both directions
      if (serviceTotals[a] && serviceTotals[a] > 0) {
        results.push({
          ifService: a,
          thenService: b,
          probability: Math.round((count / serviceTotals[a]) * 100),
        });
      }
      if (serviceTotals[b] && serviceTotals[b] > 0) {
        results.push({
          ifService: b,
          thenService: a,
          probability: Math.round((count / serviceTotals[b]) * 100),
        });
      }
      return results;
    })
    .filter(u => u.probability >= 5) // at least 5% correlation
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 15);

  return { frequentBundles, recommendedUpsells };
}

// ═══════════════════════════════════════════════════════════
// UNIFIED INTELLIGENCE REPORT
// ═══════════════════════════════════════════════════════════

export async function generateFullIntelligenceReport() {
  const [forecast, crossSell, leadScores, attribution, ltv, chatDemand, callAttr, fleet, geo, bottlenecks, declined, seasonal, geoRevenue, bundles] = await Promise.all([
    forecastRevenue().catch(e => ({ error: String(e) })),
    generateCrossSellRecommendations().catch(e => ({ error: String(e) })),
    scoreLeads().catch(e => ({ error: String(e) })),
    trackCampaignAttribution().catch(e => ({ error: String(e) })),
    predictCustomerLTV().catch(e => ({ error: String(e) })),
    analyzeChatDemand().catch(e => ({ error: String(e) })),
    analyzeCallAttribution().catch(e => ({ error: String(e) })),
    analyzeFleet().catch(e => ({ error: String(e) })),
    analyzeGeography().catch(e => ({ error: String(e) })),
    analyzeBottlenecks().catch(e => ({ error: String(e) })),
    analyzeDeclinedWork().catch(e => ({ error: String(e) })),
    forecastSeasonalDemand().catch(e => ({ error: String(e) })),
    analyzeGeographicRevenue().catch(e => ({ error: String(e) })),
    analyzeServiceBundles().catch(e => ({ error: String(e) })),
  ]);

  return { forecast, crossSell, leadScores, attribution, ltv, chatDemand, callAttr, fleet, geo, bottlenecks, declined, seasonal, geoRevenue, bundles, generatedAt: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════
// #9 PREDICTIVE CHURN MODELING
// ═══════════════════════════════════════════════════════════

interface ChurnCustomer {
  name: string;
  phone: string;
  daysSinceVisit: number;
  churnProbability: number;
  reason: string;
}

/**
 * Predict which customers are likely to churn.
 *
 * Factors:
 * - Days since last visit (primary signal)
 * - Declining ticket size trend
 * - Declined work history (estimates but no invoice)
 * - No review left after service
 * - VIP status (loyal customers churn slower)
 */
export async function predictChurn(): Promise<{
  highRisk: ChurnCustomer[];
  mediumRisk: ChurnCustomer[];
}> {
  try {
  // Pull all customers with at least 1 visit
  const allCustomers = await (await db()).select({
    id: customers.id,
    firstName: customers.firstName,
    lastName: customers.lastName,
    phone: customers.phone,
    totalSpent: customers.totalSpent,
    totalVisits: customers.totalVisits,
    lastVisitDate: customers.lastVisitDate,
    segment: customers.segment,
  }).from(customers)
    .where(gte(customers.totalVisits, 1));

  // Get VIP flags from customer_metrics
  const vipMap = new Map<number, boolean>();
  try {
    const metrics = await (await db()).select({
      customerId: customerMetrics.customerId,
      isVip: customerMetrics.isVip,
    }).from(customerMetrics);
    for (const m of metrics) {
      vipMap.set(m.customerId, m.isVip === 1);
    }
  } catch {}

  // Get customers who had estimates but no paid invoice (declined work signal)
  const declinedSet = new Set<number>();
  try {
    const withDeclined = await (await db()).select({
      customerId: workOrders.customerId,
    }).from(workOrders)
      .where(and(
        eq(workOrders.hasDeclinedWork, true),
        gte(workOrders.createdAt, sql`DATE_SUB(NOW(), INTERVAL 180 DAY)`)
      ));
    for (const w of withDeclined) {
      if (w.customerId) declinedSet.add(w.customerId);
    }
  } catch {}

  // Get customers who left reviews (review signal)
  const reviewedSet = new Set<string>();
  try {
    const reviewed = await (await db()).select({
      phone: reviewRequests.phone,
    }).from(reviewRequests)
      .where(eq(reviewRequests.status, "clicked"));
    for (const r of reviewed) {
      if (r.phone) reviewedSet.add(r.phone.replace(/\D/g, "").slice(-10));
    }
  } catch {}

  // Get ticket size trends per customer (last 3 invoices)
  const ticketTrends = new Map<number, number[]>();
  try {
    const recentInvoices = await (await db()).select({
      customerId: invoices.customerId,
      totalAmount: invoices.totalAmount,
      invoiceDate: invoices.invoiceDate,
    }).from(invoices)
      .where(and(
        sql`${invoices.customerId} IS NOT NULL`,
        gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 365 DAY)`)
      ))
      .orderBy(asc(invoices.invoiceDate));

    for (const inv of recentInvoices) {
      if (!inv.customerId) continue;
      if (!ticketTrends.has(inv.customerId)) ticketTrends.set(inv.customerId, []);
      ticketTrends.get(inv.customerId)!.push(inv.totalAmount || 0);
    }
  } catch {}

  const highRisk: ChurnCustomer[] = [];
  const mediumRisk: ChurnCustomer[] = [];

  for (const c of allCustomers) {
    const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
    const phone = c.phone || "";
    const phone10 = phone.replace(/\D/g, "").slice(-10);

    // Base: days since last visit
    const daysSince = c.lastVisitDate
      ? Math.floor((Date.now() - new Date(c.lastVisitDate).getTime()) / (24 * 60 * 60 * 1000))
      : 999;

    // Skip very recent customers (no churn risk)
    if (daysSince <= 30) continue;

    let probability = 0;
    const reasons: string[] = [];

    // Factor 1: Days since last visit (primary)
    if (daysSince > 120) {
      probability += 90;
      reasons.push(`${daysSince}d since last visit`);
    } else if (daysSince > 90) {
      probability += 70;
      reasons.push(`${daysSince}d since last visit`);
    } else if (daysSince > 60) {
      probability += 50;
      reasons.push(`${daysSince}d since last visit`);
    } else {
      probability += 20;
      reasons.push(`${daysSince}d since last visit`);
    }

    // Factor 2: Declining ticket size (-10% loyalty)
    const tickets = ticketTrends.get(c.id);
    if (tickets && tickets.length >= 2) {
      const recent = tickets.slice(-2);
      const older = tickets.slice(0, -2);
      if (older.length > 0) {
        const avgRecent = recent.reduce((s, v) => s + v, 0) / recent.length;
        const avgOlder = older.reduce((s, v) => s + v, 0) / older.length;
        if (avgRecent < avgOlder * 0.7) {
          probability += 10;
          reasons.push("declining ticket size");
        }
      }
    }

    // Factor 3: Declined work history (+20%)
    if (declinedSet.has(c.id)) {
      probability += 20;
      reasons.push("has declined work");
    }

    // Factor 4: No review left (+10%)
    if (!reviewedSet.has(phone10) && (c.totalVisits || 0) >= 1) {
      probability += 10;
      reasons.push("no review left");
    }

    // Factor 5: VIP status (-20%)
    if (vipMap.get(c.id)) {
      probability -= 20;
      reasons.push("VIP (reduced risk)");
    }

    // Clamp
    probability = Math.max(0, Math.min(100, probability));

    const entry: ChurnCustomer = {
      name,
      phone,
      daysSinceVisit: daysSince,
      churnProbability: probability,
      reason: reasons.join("; "),
    };

    if (probability >= 70) {
      highRisk.push(entry);
    } else if (probability >= 40) {
      mediumRisk.push(entry);
    }
  }

  // Sort by probability descending
  highRisk.sort((a, b) => b.churnProbability - a.churnProbability);
  mediumRisk.sort((a, b) => b.churnProbability - a.churnProbability);

  return {
    highRisk: highRisk.slice(0, 25),
    mediumRisk: mediumRisk.slice(0, 25),
  };
  } catch (e) {
    console.error("[intelligence:churn] predictChurn failed:", e);
    return { highRisk: [], mediumRisk: [] };
  }
}
