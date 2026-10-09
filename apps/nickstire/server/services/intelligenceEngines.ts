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
import { invoices, customers, customerMetrics, leads, bookings, chatSessions, callEvents, workOrders, reviewRequests, algEstimates } from "../../drizzle/schema";
import { sql, eq, gte, lte, and, asc } from "drizzle-orm";
import { BUSINESS } from "@shared/business";
import { SERVICE_CATEGORIES, categorizeService } from "./engines/shared";

import { createLogger } from "../lib/logger";

const log = createLogger("services:intelligenceEngines");
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
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone }));
  const dayOfWeek = etNow.getDay(); // 0=Sun

  // Pull daily revenue for last 90 days (paid invoices only).
  // Use raw SQL to guarantee SELECT and GROUP BY expressions match textually
  // — Drizzle's template renders `${invoices.invoiceDate}` inconsistently
  // (unqualified in SELECT, qualified in GROUP BY), which TiDB strict mode
  // treats as non-matching expressions and rejects under only_full_group_by.
  const dailyRevenueRaw = await (await db()).execute(sql`
    SELECT
      DATE(\`invoiceDate\`) AS day,
      MIN(DAYOFWEEK(\`invoiceDate\`)) AS dow,
      COALESCE(SUM(\`totalAmount\`), 0) AS total,
      COUNT(*) AS cnt
    FROM \`invoices\`
    WHERE \`invoiceDate\` >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      AND \`paymentStatus\` = 'paid'
    GROUP BY DATE(\`invoiceDate\`)
  `);
  // mysql2 .execute returns [rows, fields] — rows is an array of plain objects
  const dailyRevenue = ((dailyRevenueRaw as unknown as any[])[0] || []) as Array<{
    day: string;
    dow: number;
    total: number;
    cnt: number;
  }>;

  // Day-of-week averages.
  //
  // BUG FIX: mysql2's `.execute()` returns BIGINT/DECIMAL columns as STRINGS
  // (for precision safety). Prior code did `dowAvg[d].avg += r.total` which
  // is string concatenation when r.total is "1500" — producing absurd numbers
  // like $48,300,279,697,500,690,000,000,000,000,000 in the dashboard. The
  // huge string then cast to a number when divided in the projections.
  // Number(r.total) forces numeric addition. Same fix applied to .dow.
  const dowAvg: Record<number, { avg: number; count: number }> = {};
  for (const r of dailyRevenue) {
    const d = Number(r.dow);
    if (!dowAvg[d]) dowAvg[d] = { avg: 0, count: 0 };
    dowAvg[d].avg += Number(r.total) || 0;
    dowAvg[d].count += 1;
  }
  for (const d in dowAvg) dowAvg[d].avg = Math.round(dowAvg[d].avg / dowAvg[d].count);

  // Today's revenue so far (paid invoices only)
  const todayRev = await (await db()).select({
    total: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`.as("total"),
    count: sql<number>`COUNT(*)`.as("cnt"),
  }).from(invoices)
    .where(and(gte(invoices.invoiceDate, sql`CURDATE()`), eq(invoices.paymentStatus, "paid")));

  // Number() guards: mysql2 returns SUM(BIGINT) as a string for precision
  // safety. Division coerces to number, but explicit Number() makes intent
  // clear and prevents string-concat regressions if the math is reordered.
  const todaySoFar = (Number(todayRev[0]?.total) || 0) / 100; // cents → dollars
  const todayExpected = (dowAvg[dayOfWeek + 1]?.avg || 0) / 100; // MySQL DAYOFWEEK is 1-indexed

  // This week so far (paid invoices only)
  const weekRev = await (await db()).select({
    total: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`.as("total"),
  }).from(invoices)
    .where(and(gte(invoices.invoiceDate, sql`DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)`), eq(invoices.paymentStatus, "paid")));

  const weekSoFar = (Number(weekRev[0]?.total) || 0) / 100;

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

  const monthSoFar = (Number(monthRev[0]?.total) || 0) / 100;
  const dayOfMonth = etNow.getDate();
  const daysInMonth = new Date(etNow.getFullYear(), etNow.getMonth() + 1, 0).getDate();
  const monthProjection = dayOfMonth > 0 ? Math.round(monthSoFar * (daysInMonth / dayOfMonth)) : 0;

  // Last 4 weeks trend (paid invoices only) — raw SQL for consistent column qualification.
  const weeklyTrendRaw = await (await db()).execute(sql`
    SELECT
      DATE_FORMAT(\`invoiceDate\`, '%Y-%u') AS week,
      COALESCE(SUM(\`totalAmount\`), 0) AS total
    FROM \`invoices\`
    WHERE \`invoiceDate\` >= DATE_SUB(NOW(), INTERVAL 28 DAY)
      AND \`paymentStatus\` = 'paid'
    GROUP BY DATE_FORMAT(\`invoiceDate\`, '%Y-%u')
    ORDER BY week
  `);
  const weeklyTrend = ((weeklyTrendRaw as unknown as any[])[0] || []) as Array<{
    week: string;
    total: number;
  }>;

  const weeks = weeklyTrend.map((w: typeof weeklyTrend[number]) => Number(w.total) / 100);
  const trend = weeks.length >= 2
    ? weeks[weeks.length - 1] > weeks[weeks.length - 2] ? "up" : weeks[weeks.length - 1] < weeks[weeks.length - 2] ? "down" : "flat"
    : "flat";

  // Trailing 90-day daily average — used as the DYNAMIC target floor in
  // health-score pacing. Auto-scales as the business grows so we don't have
  // to bump a fixed goal every 6 months.
  const totalRev90 = dailyRevenue.reduce((s, r) => s + (Number(r.total) || 0), 0) / 100;
  const trailing90DayAvgDaily = dailyRevenue.length > 0 ? totalRev90 / dailyRevenue.length : 0;

  // Dynamic monthly target: trailing daily avg × ~30 days × 1.1 growth target.
  // Fallback to the static config value as a floor (handles cold-start case).
  const dynamicTarget = Math.max(
    Math.round(trailing90DayAvgDaily * 30 * 1.1),
    BUSINESS.revenueTarget.monthly,
  );
  const onPace = monthProjection >= dynamicTarget;
  const gap = dynamicTarget - monthProjection;

  return {
    today: { soFar: todaySoFar, expected: todayExpected, pct: todayExpected > 0 ? Math.round((todaySoFar / todayExpected) * 100) : 0 },
    week: { soFar: weekSoFar, projection: Math.round(weekProjection) },
    month: { soFar: monthSoFar, projection: monthProjection, target: dynamicTarget, onPace, gap: Math.round(gap) },
    trend,
    dowAverages: Object.fromEntries(Object.entries(dowAvg).map(([k, v]) => [k, Math.round(v.avg / 100)])),
    weeklyTrend: weeks,
    trailing90DayAvgDaily: Math.round(trailing90DayAvgDaily),
  };
}

// ═══════════════════════════════════════════════════════════
// #2 SERVICE CROSS-SELL ENGINE
// ═══════════════════════════════════════════════════════════

// SERVICE_CATEGORIES + categorizeService come from ./engines/shared (imported
// above): this file used to carry an identical private copy of both.

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

  // Pre-fetch all customer names/phones (eliminates N+1 per pattern match)
  const custLookup = await (await db()).select({
    id: customers.id,
    firstName: customers.firstName,
    lastName: customers.lastName,
    phone: customers.phone,
  }).from(customers);
  type CustEntry = typeof custLookup[number];
  const custMap = new Map<string, CustEntry>(custLookup.map((c: CustEntry) => [c.id.toString(), c]));

  // Find customers due for cross-sell
  const recommendations: { customerId: string; phone: string; name: string; service: string; reason: string; urgency: string }[] = [];

  for (const pattern of patterns.slice(0, 10)) {
    for (const [custKey, timeline] of Object.entries(customerServices)) {
      const lastFrom = [...timeline].reverse().find(t => t.categories.includes(pattern.from));
      const hasTo = timeline.some(t => t.categories.includes(pattern.to) && t.date > (lastFrom?.date || new Date(0)));
      if (lastFrom && !hasTo) {
        const daysSince = Math.floor((Date.now() - lastFrom.date.getTime()) / 86400000);
        if (daysSince >= pattern.avgDays * 0.8 && daysSince <= pattern.avgDays * 1.5) {
          const cust = custMap.get(custKey);
          if (cust) {
            recommendations.push({
              customerId: custKey,
              phone: cust.phone || "",
              name: `${cust.firstName || ""} ${cust.lastName || ""}`.trim(),
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
  // /diagnose symptom-checker lead: described a real symptom and left a
  // number asking for an inspection — warmer than a popup, cooler than a
  // booking. Red-flag urgency is scored separately (urgencyScore).
  diagnose: 55,
};

export async function scoreLeads() {
  const d = await db();
  const openLeads = await d.select().from(leads)
    .where(sql`${leads.status} IN ('new', 'contacted')`);

  // Pre-fetch all customers with phone numbers (eliminates N+1 per lead)
  const allCustomers = await d.select({
    phone: customers.phone,
    totalSpent: customers.totalSpent,
    totalVisits: customers.totalVisits,
  }).from(customers).where(sql`${customers.phone} IS NOT NULL AND ${customers.phone} != ''`);

  // Build phone lookup map (last 10 digits → customer data)
  const customerByPhone = new Map<string, { totalSpent: number | null; totalVisits: number | null }>();
  for (const c of allCustomers) {
    if (c.phone) customerByPhone.set(c.phone.slice(-10), c);
  }

  const scored = openLeads.map((lead: typeof openLeads[number]) => {
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

    // 3. Existing customer bonus (0-15 points) — lookup from pre-fetched map
    let existingBonus = 0;
    if (lead.phone) {
      const existing = customerByPhone.get(lead.phone.slice(-10));
      if (existing) {
        existingBonus = Math.min(15, Math.round((existing.totalSpent || 0) / 100 / 100));
        if (existingBonus < 5 && (existing.totalVisits || 0) > 0) existingBonus = 5;
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
  });

  // Batch UPDATE urgencyScore — one query per score value instead of one per lead.
  // 2026-05-23 · chunk the IN list to keep each UPDATE under TiDB's 64MB
  // query-size limit. With ~50 score buckets and chunks of 500 ids, the
  // worst-case UPDATE is ~500 × 8-byte ids = 4KB — well under any limit.
  // Pre-fix: unbounded IN clause silently broke the urgency-scoring loop
  // once total open-lead count crossed ~10k.
  const scoreGroups = new Map<number, number[]>();
  for (const s of scored) {
    const ids = scoreGroups.get(s.score) || [];
    ids.push(s.id);
    scoreGroups.set(s.score, ids);
  }
  const CHUNK_SIZE = 500;
  for (const [score, ids] of scoreGroups) {
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      await d.execute(sql`UPDATE leads SET urgencyScore = ${score} WHERE id IN (${sql.raw(chunk.join(","))})`);
    }
  }

  type ScoredLead = typeof scored[number];
  return scored.sort((a: ScoredLead, b: ScoredLead) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════
// #4 CAMPAIGN ATTRIBUTION
// ═══════════════════════════════════════════════════════════

export async function trackCampaignAttribution() {
  const d = await db();

  // Find review requests that were sent in last 90 days
  const sentReviews = await d.select().from(reviewRequests)
    .where(and(eq(reviewRequests.status, "sent"), gte(reviewRequests.sentAt, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`)));

  const reviewAttribution: { sent: number; clicked: number; bookedAfter: number; revenueGenerated: number } = {
    sent: sentReviews.length,
    clicked: sentReviews.filter((r: typeof sentReviews[number]) => r.clickedAt).length,
    bookedAfter: 0,
    revenueGenerated: 0,
  };

  // Pre-fetch ALL bookings from last 90 days with phone numbers (eliminates N+1 per review)
  const recentBookings = await d.select({
    phone: bookings.phone,
    createdAt: bookings.createdAt,
  }).from(bookings)
    .where(gte(bookings.createdAt, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`));

  // Build phone → booking dates map for fast in-memory matching
  const bookingsByPhone = new Map<string, Date[]>();
  for (const b of recentBookings) {
    if (!b.phone) continue;
    const key = b.phone.slice(-10);
    const dates = bookingsByPhone.get(key) || [];
    dates.push(new Date(b.createdAt));
    bookingsByPhone.set(key, dates);
  }

  // Match reviews to bookings in memory (was N+1 DB queries)
  for (const rev of sentReviews) {
    if (!rev.phone || !rev.sentAt) continue;
    const phoneKey = rev.phone.slice(-10);
    const custBookings = bookingsByPhone.get(phoneKey);
    if (custBookings) {
      const sentDate = new Date(rev.sentAt);
      const cutoff = new Date(sentDate.getTime() + 30 * 86400000);
      if (custBookings.some(d => d >= sentDate && d <= cutoff)) {
        reviewAttribution.bookedAfter++;
      }
    }
  }

  // SMS campaign attribution
  const campaignSms = await d.select({
    phone: customers.phone,
    campaignDate: customers.smsCampaignDate,
  }).from(customers)
    .where(and(sql`${customers.smsCampaignSent} > 0`, gte(customers.smsCampaignDate, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`)));

  // Pre-fetch ALL invoices from last 90 days with phone + amounts (eliminates N+1)
  const recentInvoices = await d.select({
    customerPhone: invoices.customerPhone,
    invoiceDate: invoices.invoiceDate,
    totalAmount: invoices.totalAmount,
  }).from(invoices)
    .where(gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`));

  // Build phone → invoice data map
  const invoicesByPhone = new Map<string, { date: Date; amount: number }[]>();
  for (const inv of recentInvoices) {
    if (!inv.customerPhone || !inv.invoiceDate) continue;
    const key = inv.customerPhone.slice(-10);
    const entries = invoicesByPhone.get(key) || [];
    entries.push({ date: new Date(inv.invoiceDate), amount: inv.totalAmount || 0 });
    invoicesByPhone.set(key, entries);
  }

  const smsAttribution: { sent: number; bookedAfter: number; revenueAfter: number } = {
    sent: campaignSms.length,
    bookedAfter: 0,
    revenueAfter: 0,
  };

  // Match campaign SMS to invoices in memory (was N+1 DB queries — the biggest bottleneck)
  for (const c of campaignSms) {
    if (!c.phone || !c.campaignDate) continue;
    const phoneKey = c.phone.slice(-10);
    const custInvoices = invoicesByPhone.get(phoneKey);
    if (custInvoices) {
      const campDate = new Date(c.campaignDate);
      const cutoff = new Date(campDate.getTime() + 14 * 86400000);
      const matched = custInvoices.filter(inv => inv.date >= campDate && inv.date <= cutoff);
      if (matched.length > 0) {
        smsAttribution.bookedAfter++;
        smsAttribution.revenueAfter += matched.reduce((s, inv) => s + inv.amount, 0) / 100;
      }
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

    const scored = allCustomers.map((c: typeof allCustomers[number]) => {
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

    // Batch UPDATE customer_metrics by churnRisk group (eliminates N+1)
    // 2026-05-23 · was detached Promise.resolve().then(...) — if the
    // inner execute threw, the cron's recordsProcessed=200 + "completed"
    // status hid the metrics-write failure, dashboard showed wrong
    // churnRisk for weeks. Now awaited + chunked. Same DB, no reason
    // to detach.
    const dbRef = await db();
    try {
      // Score-write ALL customers, not just the top 200. The prior
      // `.slice(0, 200)` left the ~2,300-customer tail stuck on the
      // INSERT-seeded churnRisk='low'/isVip=0 forever, so the churn/at-risk
      // UI read stale 'low' for everyone outside the top cohort.
      // No perf cost to uncapping: the loop below collapses every customer
      // into at most 6 distinct (churnRisk x isVip) groups, then writes each
      // group in <=500-id chunks — so the UPDATE count is O(groups), not
      // O(customers). The scoring itself already ran for all rows above.
      const groups: Record<string, { ids: number[]; isVip: number }> = {};
      for (const s of scored) {
        const key = `${s.churnRisk}:${s.ltvScore >= 70 ? 1 : 0}`;
        if (!groups[key]) groups[key] = { ids: [], isVip: s.ltvScore >= 70 ? 1 : 0 };
        groups[key].ids.push(s.id);
      }
      const CHUNK_SIZE = 500;
      for (const [key, group] of Object.entries(groups)) {
        const risk = key.split(":")[0] as "low" | "medium" | "high";
        if (group.ids.length === 0) continue;
        for (let i = 0; i < group.ids.length; i += CHUNK_SIZE) {
          const chunk = group.ids.slice(i, i + CHUNK_SIZE);
          await dbRef.execute(sql`UPDATE customer_metrics SET churnRisk = ${risk}, isVip = ${group.isVip} WHERE customerId IN (${sql.raw(chunk.join(","))})`);
        }
      }
    } catch (e) {
      log.error("[intelligence:ltv] customer_metrics update failed:", e);
      // Re-throw so the outer catch (line 586) marks the whole
      // predictCustomerLTV call as failed instead of returning a
      // half-completed result.
      throw e;
    }

    type ScoredCustomer = typeof scored[number];
    const sorted = scored.sort((a: ScoredCustomer, b: ScoredCustomer) => b.ltvScore - a.ltvScore);
    const atRiskHighValue = sorted.filter((c: ScoredCustomer) => c.ltvScore >= 50 && c.daysSinceLastVisit > 60).slice(0, 15);

    return {
      topCustomers: sorted.slice(0, 20),
      atRiskHighValue,
      segments: {
        whales: sorted.filter((c: ScoredCustomer) => c.ltvScore >= 70).length,
        regulars: sorted.filter((c: ScoredCustomer) => c.ltvScore >= 40 && c.ltvScore < 70).length,
        occasional: sorted.filter((c: ScoredCustomer) => c.ltvScore >= 15 && c.ltvScore < 40).length,
        oneTimers: sorted.filter((c: ScoredCustomer) => c.ltvScore < 15).length,
      },
    };
  } catch (e) {
    log.error("[intelligence:ltv] predictCustomerLTV failed:", e);
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
    converted: sessions.filter((s: typeof sessions[number]) => s.converted).length,
    conversionRate: sessions.length > 0 ? Math.round((sessions.filter((s: typeof sessions[number]) => s.converted).length / sessions.length) * 100) : 0,
    demandByService: Object.entries(demandSignals).sort((a, b) => b[1].mentions - a[1].mentions),
  };
}

/** Click-to-call → booking attribution */
export async function analyzeCallAttribution() {
  const d = await db();
  const calls = await d.select().from(callEvents)
    .where(gte(callEvents.createdAt, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`));

  // Match calls to bookings by phone within 24 hours
  let attributed = 0;
  const pagePerformance: Record<string, { calls: number; bookings: number }> = {};

  // Reuse the bookingsByPhone map pattern — pre-fetch bookings once
  const recentCallBookings = await d.select({
    phone: bookings.phone,
    createdAt: bookings.createdAt,
  }).from(bookings)
    .where(gte(bookings.createdAt, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`));

  const callBookingsByPhone = new Map<string, Date[]>();
  for (const b of recentCallBookings) {
    if (!b.phone) continue;
    const key = b.phone.slice(-10);
    const dates = callBookingsByPhone.get(key) || [];
    dates.push(new Date(b.createdAt));
    callBookingsByPhone.set(key, dates);
  }

  for (const call of calls) {
    const page = call.sourcePage || "unknown";
    if (!pagePerformance[page]) pagePerformance[page] = { calls: 0, bookings: 0 };
    pagePerformance[page].calls++;

    if (call.phoneNumber && call.createdAt) {
      const phoneKey = call.phoneNumber.slice(-10);
      const custBookings = callBookingsByPhone.get(phoneKey);
      if (custBookings) {
        const callDate = new Date(call.createdAt);
        const cutoff = new Date(callDate.getTime() + 24 * 3600000);
        if (custBookings.some(d => d >= callDate && d <= cutoff)) {
          attributed++;
          pagePerformance[page].bookings++;
        }
      }
    }
  }

  return {
    totalCalls: calls.length,
    attributedToBookings: attributed,
    conversionRate: calls.length > 0 ? Math.round((attributed / calls.length) * 100) : 0,
    topPages: Object.entries(pagePerformance).sort((a, b) => b[1].calls - a[1].calls).slice(0, 10),
    peakHours: calls.reduce((acc: Record<number, number>, c: typeof calls[number]) => {
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
    totalWithZip: geoData.reduce((s: number, g: typeof geoData[number]) => s + g.cnt, 0),
    hotZones: geoData.map((g: typeof geoData[number]) => ({
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
      ? Math.round((recentBookings.filter((b: typeof recentBookings[number]) => b.status === "completed").length / recentBookings.length) * 100) : 0,
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
    } catch (e) { log.warn("[services/intelligenceEngines] operation failed:", e); }
  }

  return {
    totalWithDeclined: wosWithDeclined.length,
    totalDeclinedValue: Math.round(totalDeclinedValue),
    topDeclinedServices: Object.entries(declinedCategories).sort((a, b) => b[1].totalValue - a[1].totalValue),
    // revenue-truth-correction: the old `recoveryOpportunity` field was
    // totalDeclinedValue × 0.2 — an invented recovery rate presented as
    // a dollar figure. Report the real pool only; a recovery RATE is an
    // outcome to MEASURE (recovery sends → matched invoices), not assume.
  };
}

// ═══════════════════════════════════════════════════════════
// #5b WALK-AWAY ESTIMATES (alg_estimates with no matched invoice)
// ═══════════════════════════════════════════════════════════
/**
 * Pulls ALG walk-in estimates that NEVER converted to an invoice.
 *
 * Different signal from analyzeDeclinedWork():
 *  - analyzeDeclinedWork() = LINE ITEMS the customer said no to inside a
 *    work order they otherwise accepted (partial decline).
 *  - analyzeUnmatchedAlgEstimates() = WHOLE estimates where the customer
 *    walked away entirely (full decline / no work done).
 *
 * The latter is the bigger recovery opportunity per Nick's business model
 * (FCFS walk-ins → either close in-person or lose the job entirely).
 *
 * Source of truth: `alg_estimates` table populated by
 * server/services/shopDriverEstimateSync.ts via the
 * shopdriver-estimate-mirror cron.
 *
 * Returns 0s gracefully when:
 *   - Table is empty (estimate sync hasn't fired yet or endpoint unmapped)
 *   - DB is unreachable
 * Brain consumers can still render — they just won't surface the section.
 */
export async function analyzeUnmatchedAlgEstimates(): Promise<{
  unmatchedCount: number;
  unmatchedValueCents: number;
  unmatchedValueDollars: number;
  recoveryWindow: { last7d: number; last30d: number; last60d: number };
  topUnmatched: Array<{ name: string; phone: string | null; service: string | null; amountCents: number; estimateDate: string; daysOld: number }>;
  conversionRate: number;
  totalEstimates: number;
}> {
  const d = await db();
  const now = new Date();
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Pull all estimates from last 60 days. Limit 500 to keep this lightweight.
  const recent = await d
    .select({
      id: algEstimates.id,
      customerName: algEstimates.customerName,
      customerPhone: algEstimates.customerPhone,
      serviceDescription: algEstimates.serviceDescription,
      estimatedAmount: algEstimates.estimatedAmount,
      estimateDate: algEstimates.estimateDate,
      matchedInvoiceId: algEstimates.matchedInvoiceId,
    })
    .from(algEstimates)
    .where(gte(algEstimates.estimateDate, sixtyAgo))
    .limit(500);

  type EstimateRow = {
    id: number;
    customerName: string;
    customerPhone: string | null;
    serviceDescription: string | null;
    estimatedAmount: number;
    estimateDate: Date;
    matchedInvoiceId: number | null;
  };
  const totalEstimates = recent.length;
  const unmatched = (recent as EstimateRow[]).filter((e) => !e.matchedInvoiceId);
  const unmatchedValueCents = unmatched.reduce((sum: number, e: EstimateRow) => sum + (e.estimatedAmount || 0), 0);

  const last7d = unmatched.filter((e: EstimateRow) => e.estimateDate && new Date(e.estimateDate) >= sevenAgo).length;
  const last30d = unmatched.filter((e: EstimateRow) => e.estimateDate && new Date(e.estimateDate) >= thirtyAgo).length;
  const last60d = unmatched.length;

  // Top 5 by amount (most expensive walk-aways = biggest leverage)
  const topUnmatched = [...unmatched]
    .sort((a: EstimateRow, b: EstimateRow) => (b.estimatedAmount || 0) - (a.estimatedAmount || 0))
    .slice(0, 5)
    .map((e: EstimateRow) => {
      const days = e.estimateDate
        ? Math.floor((now.getTime() - new Date(e.estimateDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      return {
        name: e.customerName,
        phone: e.customerPhone,
        service: e.serviceDescription,
        amountCents: e.estimatedAmount || 0,
        estimateDate: e.estimateDate ? new Date(e.estimateDate).toISOString().slice(0, 10) : "",
        daysOld: days,
      };
    });

  // Match rate = matched / total. NaN-safe.
  const conversionRate = totalEstimates > 0
    ? Math.round(((totalEstimates - unmatched.length) / totalEstimates) * 100)
    : 0;

  // revenue-truth-correction: this used to return `recoverableEstimate` =
  // 20% of the pool, sourced to an "industry standard" that was never
  // cited or verified — an invented dollar figure that flowed into the
  // daily digest as "~$X recoverable @ 20% close". Removed. The pool and
  // match rate are facts; a recovery rate must come from measured
  // outcomes (recovery sends → matched invoices), not assumption.
  return {
    unmatchedCount: unmatched.length,
    unmatchedValueCents,
    unmatchedValueDollars: Math.round(unmatchedValueCents / 100),
    recoveryWindow: { last7d, last30d, last60d },
    topUnmatched,
    conversionRate,
    totalEstimates,
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

  // Get invoice service descriptions grouped by month for the last 24 months.
  // Raw SQL to keep SELECT and GROUP BY textually identical — Drizzle template
  // renders column refs inconsistently which breaks TiDB's only_full_group_by.
  const monthlyServicesRaw = await (await db()).execute(sql`
    SELECT
      MONTH(\`invoiceDate\`) AS monthNum,
      YEAR(\`invoiceDate\`) AS yearNum,
      \`serviceDescription\`,
      COUNT(*) AS cnt
    FROM \`invoices\`
    WHERE \`invoiceDate\` >= DATE_SUB(NOW(), INTERVAL 24 MONTH)
    GROUP BY MONTH(\`invoiceDate\`), YEAR(\`invoiceDate\`), \`serviceDescription\`
  `);
  const monthlyServices = ((monthlyServicesRaw as unknown as any[])[0] || []) as Array<{
    monthNum: number;
    yearNum: number;
    serviceDescription: string | null;
    cnt: number;
  }>;

  // Categorize and aggregate by month + service category
  const monthCategoryTotals: Record<number, Record<string, { count: number; years: Set<number> }>> = {};
  for (let m = 1; m <= 12; m++) monthCategoryTotals[m] = {};

  for (const row of monthlyServices) {
    const cats = categorizeService(row.serviceDescription || "");
    for (const cat of cats) {
      if (!monthCategoryTotals[row.monthNum][cat]) {
        monthCategoryTotals[row.monthNum][cat] = { count: 0, years: new Set() };
      }
      // Number() cast — mysql2 raw .execute() returns COUNT/BIGINT as strings.
      // Without this, += does string concat producing junk seasonal counts.
      monthCategoryTotals[row.monthNum][cat].count += Number(row.cnt) || 0;
      monthCategoryTotals[row.monthNum][cat].years.add(Number(row.yearNum));
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

  const topZipCodes = zipRevenue.map((z: typeof zipRevenue[number]) => ({
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

  const growthAreas = growthData.map((g: typeof growthData[number]) => ({
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
    .filter((u: typeof underservedData[number]) => u.totalCustomers > u.activeCustomers)
    .map((u: typeof underservedData[number]) => {
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
  const [forecast, crossSell, leadScores, attribution, ltv, chatDemand, callAttr, fleet, geo, bottlenecks, declined, walkAwayEstimates, seasonal, geoRevenue, bundles] = await Promise.all([
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
    // NEW 2026-05-05 — full walk-aways from ALG estimates (different signal
    // than the per-line declined work above). Brain now sees both.
    analyzeUnmatchedAlgEstimates().catch(e => ({ error: String(e) })),
    forecastSeasonalDemand().catch(e => ({ error: String(e) })),
    analyzeGeographicRevenue().catch(e => ({ error: String(e) })),
    analyzeServiceBundles().catch(e => ({ error: String(e) })),
  ]);

  return { forecast, crossSell, leadScores, attribution, ltv, chatDemand, callAttr, fleet, geo, bottlenecks, declined, walkAwayEstimates, seasonal, geoRevenue, bundles, generatedAt: new Date().toISOString() };
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
  /**
   * Q-23 phase 6 · true only when the customer read failed. The empty lists
   * beside it are then placeholders, not "nobody is at risk": Customer
   * Intelligence reads this to show UNMEASURED instead of "0 High Churn Risk".
   */
  unavailable?: true;
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
  } catch (e) { log.warn("[services/intelligenceEngines] operation failed:", e); }

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
  } catch (e) { log.warn("[services/intelligenceEngines] operation failed:", e); }

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
  } catch (e) { log.warn("[services/intelligenceEngines] operation failed:", e); }

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
  } catch (e) { log.warn("[services/intelligenceEngines] operation failed:", e); }

  const highRisk: ChurnCustomer[] = [];
  const mediumRisk: ChurnCustomer[] = [];

  for (const c of allCustomers) {
    const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
    const phone = c.phone || "";
    const phone10 = phone.replace(/\D/g, "").slice(-10);

    // BUG FIX: customers with no `lastVisitDate` are DATA-INCOMPLETE, not
    // churners. Common pattern: imported from ALG/ShopDriver without visit
    // history populated, OR a record created on first phone-call but the
    // visit was never invoiced. Prior code defaulted these to 999 days,
    // which falsely flagged them at 90% churn probability and produced a
    // bogus "25 customers at high risk" on the dashboard. Verified: every
    // such row has 0 invoices in the DB.
    if (!c.lastVisitDate) continue;
    const daysSince = Math.floor((Date.now() - new Date(c.lastVisitDate).getTime()) / (24 * 60 * 60 * 1000));

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
    log.error("[intelligence:churn] predictChurn failed:", e);
    return { highRisk: [], mediumRisk: [], unavailable: true };
  }
}
