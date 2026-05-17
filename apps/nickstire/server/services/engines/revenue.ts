/**
 * Revenue Engines (#35-43)
 *
 * detectRevenueAnomalies, predictNoShows, analyzePeakDemandWindows,
 * forecastCashFlow, estimateMarketShare, analyzeProfitMargins,
 * analyzePaymentTrends, analyzeTicketTrend, analyzeRevenueConcentration
 */

import { invoices } from "../../../drizzle/schema";
import { sql, gte, and } from "drizzle-orm";
import { RawRow, extractRows, extractOne, db, categorizeService } from "./shared";

// ═══════════════════════════════════════════════════════════
// #35 REVENUE ANOMALY DETECTOR
// ═══════════════════════════════════════════════════════════

export async function detectRevenueAnomalies(): Promise<{
  anomalies: Array<{ date: string; revenue: number; expected: number; deviation: number; type: "spike" | "dip" }>;
  avgDailyRevenue: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT DATE(invoiceDate) as day, SUM(totalAmount) as dailyRev
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY DATE(invoiceDate)
      ORDER BY day
    `);

    const results = extractRows(rows);
    const data = results.map((r: RawRow) => ({
      day: String(r.day).split("T")[0],
      rev: Number(r.dailyRev || 0) / 100,
    }));

    if (data.length < 15) return { anomalies: [], avgDailyRevenue: 0 };

    const totalRev = data.reduce((s, d) => s + d.rev, 0);
    const avgDailyRevenue = Math.round(totalRev / data.length);

    const anomalies: Array<{ date: string; revenue: number; expected: number; deviation: number; type: "spike" | "dip" }> = [];

    for (let i = 14; i < data.length; i++) {
      const window = data.slice(i - 14, i);
      const windowAvg = window.reduce((s, d) => s + d.rev, 0) / window.length;
      const variance = window.reduce((s, d) => s + Math.pow(d.rev - windowAvg, 2), 0) / window.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev === 0) continue;

      const deviation = (data[i].rev - windowAvg) / stdDev;
      if (Math.abs(deviation) > 2) {
        anomalies.push({
          date: data[i].day,
          revenue: Math.round(data[i].rev),
          expected: Math.round(windowAvg),
          deviation: Math.round(deviation * 100) / 100,
          type: deviation > 0 ? "spike" : "dip",
        });
      }
    }

    return { anomalies: anomalies.slice(-20), avgDailyRevenue };
  } catch {
    return { anomalies: [], avgDailyRevenue: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #36 NO-SHOW PREDICTOR
// ═══════════════════════════════════════════════════════════

export async function predictNoShows(): Promise<{
  atRisk: Array<{ bookingId: number; name: string; phone: string; probability: number; reason: string }>;
  historicalNoShowRate: number;
}> {
  try {
    // Historical no-show rate — track cancelled bookings past their preferred date as no-shows
    // (bookings enum has no 'no-show' status — we detect them by: cancelled + preferredDate in the past)
    const histRows = await (await db()).execute(sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'cancelled' AND preferredDate IS NOT NULL AND preferredDate < CURDATE() THEN 1 ELSE 0 END) as noShows
      FROM bookings
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
    `);
    const hist = extractOne(histRows);
    const totalBookings = Number(hist.total || 0);
    const noShows = Number(hist.noShows || 0);
    const historicalNoShowRate = totalBookings > 0 ? Math.round((noShows / totalBookings) * 100) : 0;

    // Future bookings to score
    const rows = await (await db()).execute(sql`
      SELECT b.id, b.name, b.phone, b.preferredDate, b.preferredTime, b.createdAt,
        DATEDIFF(b.preferredDate, b.createdAt) as leadDays,
        (SELECT COUNT(*) FROM bookings b2 WHERE RIGHT(b2.phone, 10) = RIGHT(b.phone, 10) AND b2.status IN ('confirmed', 'completed')) as priorVisits
      FROM bookings b
      WHERE b.status IN ('new', 'confirmed')
        AND b.preferredDate >= CURDATE()
      ORDER BY b.preferredDate
      LIMIT 100
    `);

    const results = extractRows(rows);
    const atRisk: Array<{ bookingId: number; name: string; phone: string; probability: number; reason: string }> = [];

    for (const r of results) {
      let prob = 10; // base probability
      const reasons: string[] = [];
      const priorVisits = Number(r.priorVisits || 0);
      const leadDays = Number(r.leadDays || 0);

      // First-time customer
      if (priorVisits === 0) { prob += 20; reasons.push("First-time customer"); }

      // Booked far in advance (check longer first)
      if (leadDays > 14) { prob += 25; reasons.push(`Booked ${leadDays} days ahead`); }
      else if (leadDays > 7) { prob += 15; reasons.push(`Booked ${leadDays} days ahead`); }

      // Afternoon slot (historically higher no-show)
      if (r.preferredTime === "afternoon") { prob += 10; reasons.push("Afternoon slot"); }

      prob = Math.min(95, prob);
      if (prob >= 30) {
        atRisk.push({
          bookingId: Number(r.id),
          name: String(r.name || ""),
          phone: String(r.phone || ""),
          probability: prob,
          reason: reasons.join("; "),
        });
      }
    }

    atRisk.sort((a, b) => b.probability - a.probability);
    return { atRisk: atRisk.slice(0, 20), historicalNoShowRate };
  } catch {
    return { atRisk: [], historicalNoShowRate: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #37 PEAK DEMAND WINDOWS
// ═══════════════════════════════════════════════════════════

export async function analyzePeakDemandWindows(): Promise<{
  weekday: Array<{ day: string; hour: number; avgJobs: number; avgRevenue: number }>;
  bestSlots: Array<{ day: string; hour: number; score: number }>;
  worstSlots: Array<{ day: string; hour: number; score: number }>;
}> {
  try {
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    const rows = await (await db()).execute(sql`
      SELECT DAYOFWEEK(invoiceDate) as dow, HOUR(invoiceDate) as hr,
        COUNT(*) / COUNT(DISTINCT DATE(invoiceDate)) as avgJobs,
        AVG(totalAmount) as avgTicket,
        SUM(totalAmount) / COUNT(DISTINCT DATE(invoiceDate)) as avgDailyRev
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      GROUP BY DAYOFWEEK(invoiceDate), HOUR(invoiceDate)
      ORDER BY dow, hr
    `);

    const results = extractRows(rows);
    const weekday: Array<{ day: string; hour: number; avgJobs: number; avgRevenue: number }> = [];
    const scored: Array<{ day: string; hour: number; score: number }> = [];

    for (const r of results) {
      const dow = Number(r.dow);
      const hr = Number(r.hr);
      const avgJobs = Math.round(Number(r.avgJobs || 0) * 100) / 100;
      const avgRevenue = Math.round(Number(r.avgDailyRev || 0) / 100);
      const dayName = DAYS[dow - 1] || "Unknown";

      weekday.push({ day: dayName, hour: hr, avgJobs, avgRevenue });
      scored.push({ day: dayName, hour: hr, score: Math.round(avgJobs * 10 + avgRevenue / 100) });
    }

    scored.sort((a, b) => b.score - a.score);
    const bestSlots = scored.slice(0, 5);
    const worstSlots = scored.slice(-5).reverse();

    return { weekday, bestSlots, worstSlots };
  } catch {
    return { weekday: [], bestSlots: [], worstSlots: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #38 CASH FLOW FORECAST
// ═══════════════════════════════════════════════════════════

export async function forecastCashFlow(): Promise<{
  next7days: { expectedRevenue: number; pendingCollections: number; projectedCash: number };
  next30days: { expectedRevenue: number; pendingCollections: number; projectedCash: number };
  outstandingAR: number;
}> {
  try {
    // Average daily revenue from last 8 weeks
    const avgRows = await (await db()).execute(sql`
      SELECT
        SUM(totalAmount) / COUNT(DISTINCT DATE(invoiceDate)) as avgDailyRev
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 56 DAY)
        AND paymentStatus = 'paid'
    `);
    const avgDaily = Number(extractOne(avgRows).avgDailyRev || 0) / 100;

    // Outstanding AR (pending/partial invoices)
    const arRows = await (await db()).execute(sql`
      SELECT COALESCE(SUM(totalAmount), 0) as outstanding
      FROM invoices
      WHERE paymentStatus IN ('pending', 'partial')
    `);
    const outstandingAR = Math.round(Number(extractOne(arRows).outstanding || 0) / 100);

    // Booked jobs coming up (confirmed bookings)
    const bookedRows = await (await db()).execute(sql`
      SELECT COUNT(*) as cnt FROM bookings
      WHERE status IN ('new', 'confirmed')
        AND preferredDate >= CURDATE()
        AND preferredDate <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
    `);
    const upcomingBookings = Number(extractOne(bookedRows).cnt || 0);

    // Estimated avg ticket from recent data
    const ticketRows = await (await db()).execute(sql`
      SELECT AVG(totalAmount) as avgTicket FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND totalAmount > 0
    `);
    const avgTicket = Number(extractOne(ticketRows).avgTicket || 0) / 100;

    const next7Rev = Math.round(avgDaily * 7);
    const next30Rev = Math.round(avgDaily * 30);
    const pendingCollections7 = Math.round(outstandingAR * 0.3); // expect 30% collected in 7 days
    const pendingCollections30 = Math.round(outstandingAR * 0.8); // expect 80% collected in 30 days

    return {
      next7days: { expectedRevenue: next7Rev, pendingCollections: pendingCollections7, projectedCash: next7Rev + pendingCollections7 },
      next30days: { expectedRevenue: next30Rev, pendingCollections: pendingCollections30, projectedCash: next30Rev + pendingCollections30 },
      outstandingAR,
    };
  } catch {
    return {
      next7days: { expectedRevenue: 0, pendingCollections: 0, projectedCash: 0 },
      next30days: { expectedRevenue: 0, pendingCollections: 0, projectedCash: 0 },
      outstandingAR: 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// #39 MARKET SHARE ESTIMATOR
// ═══════════════════════════════════════════════════════════

export async function estimateMarketShare(): Promise<{
  ourReviews: number;
  totalMarketReviews: number;
  estimatedShare: number;
  trend: "growing" | "stable" | "declining";
}> {
  try {
    // Our review count
    const ourRows = await (await db()).execute(sql`
      SELECT COUNT(*) as cnt FROM review_replies
      WHERE review_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
    `);
    const ourReviews = Number(extractOne(ourRows).cnt || 0);

    // Our review growth (this quarter vs last quarter)
    const growthRows = await (await db()).execute(sql`
      SELECT
        SUM(CASE WHEN review_date >= DATE_SUB(NOW(), INTERVAL 3 MONTH) THEN 1 ELSE 0 END) as thisQ,
        SUM(CASE WHEN review_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
                   AND review_date < DATE_SUB(NOW(), INTERVAL 3 MONTH) THEN 1 ELSE 0 END) as lastQ
      FROM review_replies
    `);
    const g = extractOne(growthRows);
    const thisQ = Number(g.thisQ || 0);
    const lastQ = Number(g.lastQ || 0);

    // Cleveland area competitor benchmarks (static estimates updated periodically)
    const competitorReviews = [450, 380, 200, 160, 300, 250, 220, 180]; // major shops
    const totalMarketReviews = ourReviews + competitorReviews.reduce((s, v) => s + v, 0);
    const estimatedShare = totalMarketReviews > 0 ? Math.round((ourReviews / totalMarketReviews) * 100 * 10) / 10 : 0;

    const trend = thisQ > lastQ * 1.1 ? "growing" : thisQ < lastQ * 0.9 ? "declining" : "stable";

    return { ourReviews, totalMarketReviews, estimatedShare, trend };
  } catch {
    return { ourReviews: 0, totalMarketReviews: 0, estimatedShare: 0, trend: "stable" };
  }
}

// ═══════════════════════════════════════════════════════════
// #40 PROFIT MARGIN ANALYSIS
// ═══════════════════════════════════════════════════════════

export async function analyzeProfitMargins(): Promise<{
  byService: Array<{ service: string; revenue: number; partsCost: number; laborCost: number; margin: number; marginPercent: number }>;
  overallMargin: number;
  bestMarginService: string;
  worstMarginService: string;
}> {
  try {
    const rows = await (await db()).select({
      totalAmount: invoices.totalAmount,
      partsCost: invoices.partsCost,
      laborCost: invoices.laborCost,
      serviceDescription: invoices.serviceDescription,
    }).from(invoices)
      .where(and(gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 6 MONTH)`), sql`${invoices.totalAmount} > 0`));

    const catTotals: Record<string, { revenue: number; parts: number; labor: number }> = {};
    let overallRev = 0;
    let overallCost = 0;

    for (const inv of rows) {
      const rev = (inv.totalAmount || 0) / 100;
      const parts = (inv.partsCost || 0) / 100;
      const labor = (inv.laborCost || 0) / 100;
      overallRev += rev;
      overallCost += parts + labor;

      const cats = categorizeService(inv.serviceDescription || "");
      const effectiveCats = cats.length > 0 ? cats : ["other"];
      for (const cat of effectiveCats) {
        if (!catTotals[cat]) catTotals[cat] = { revenue: 0, parts: 0, labor: 0 };
        catTotals[cat].revenue += rev;
        catTotals[cat].parts += parts;
        catTotals[cat].labor += labor;
      }
    }

    const byService = Object.entries(catTotals).map(([service, data]) => {
      const margin = data.revenue - data.parts - data.labor;
      const marginPercent = data.revenue > 0 ? Math.round((margin / data.revenue) * 100) : 0;
      return {
        service,
        revenue: Math.round(data.revenue),
        partsCost: Math.round(data.parts),
        laborCost: Math.round(data.labor),
        margin: Math.round(margin),
        marginPercent,
      };
    }).sort((a, b) => b.marginPercent - a.marginPercent);

    const overallMargin = overallRev > 0 ? Math.round(((overallRev - overallCost) / overallRev) * 100) : 0;
    const bestMarginService = byService.length > 0 ? byService[0].service : "N/A";
    const worstMarginService = byService.length > 0 ? byService[byService.length - 1].service : "N/A";

    return { byService, overallMargin, bestMarginService, worstMarginService };
  } catch {
    return { byService: [], overallMargin: 0, bestMarginService: "N/A", worstMarginService: "N/A" };
  }
}

// ═══════════════════════════════════════════════════════════
// #41 PAYMENT METHOD TRENDS
// ═══════════════════════════════════════════════════════════

export async function analyzePaymentTrends(): Promise<{
  methods: Array<{ method: string; count: number; revenue: number; percentOfTotal: number; trend: string }>;
  financingGrowth: number;
}> {
  try {
    // Current period (last 3 months)
    const currentRows = await (await db()).execute(sql`
      SELECT paymentMethod, COUNT(*) as cnt, SUM(totalAmount) as totalRev
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
      GROUP BY paymentMethod
    `);

    // Previous period (3-6 months ago)
    const prevRows = await (await db()).execute(sql`
      SELECT paymentMethod, COUNT(*) as cnt
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        AND invoiceDate < DATE_SUB(NOW(), INTERVAL 3 MONTH)
      GROUP BY paymentMethod
    `);

    const currentResults = extractRows(currentRows);
    const prevResults = extractRows(prevRows);

    const prevMap: Record<string, number> = {};
    for (const r of prevResults) {
      prevMap[String(r.paymentMethod || "other")] = Number(r.cnt || 0);
    }

    let totalCount = 0;
    let totalRev = 0;
    const methods: Array<{ method: string; count: number; revenue: number; percentOfTotal: number; trend: string }> = [];

    for (const r of currentResults) {
      const count = Number(r.cnt || 0);
      const revenue = Math.round(Number(r.totalRev || 0) / 100);
      totalCount += count;
      totalRev += revenue;
      methods.push({ method: String(r.paymentMethod || "other"), count, revenue, percentOfTotal: 0, trend: "" });
    }

    for (const m of methods) {
      m.percentOfTotal = totalRev > 0 ? Math.round((m.revenue / totalRev) * 100) : 0;
      const prev = prevMap[m.method] || 0;
      if (prev === 0) m.trend = m.count > 0 ? "new" : "flat";
      else {
        const change = Math.round(((m.count - prev) / prev) * 100);
        m.trend = change > 10 ? `+${change}% growing` : change < -10 ? `${change}% declining` : "stable";
      }
    }

    // Financing growth specifically
    const finCurrent = methods.find(m => m.method === "financing")?.count || 0;
    const finPrev = prevMap["financing"] || 0;
    const financingGrowth = finPrev > 0 ? Math.round(((finCurrent - finPrev) / finPrev) * 100) : 0;

    methods.sort((a, b) => b.revenue - a.revenue);
    return { methods, financingGrowth };
  } catch {
    return { methods: [], financingGrowth: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #42 AVERAGE TICKET TREND
// ═══════════════════════════════════════════════════════════

export async function analyzeTicketTrend(): Promise<{
  monthly: Array<{ month: string; avgTicket: number; jobCount: number }>;
  trend: "increasing" | "decreasing" | "stable";
  percentChange: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT DATE_FORMAT(invoiceDate, '%Y-%m') as month,
        AVG(totalAmount) as avgTicket,
        COUNT(*) as jobCount
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        AND totalAmount > 0
      GROUP BY DATE_FORMAT(invoiceDate, '%Y-%m')
      ORDER BY month
    `);

    const results = extractRows(rows);
    const monthly = results.map((r: RawRow) => ({
      month: String(r.month || ""),
      avgTicket: Math.round(Number(r.avgTicket || 0) / 100),
      jobCount: Number(r.jobCount || 0),
    }));

    let trend: "increasing" | "decreasing" | "stable" = "stable";
    let percentChange = 0;

    if (monthly.length >= 2) {
      const first = monthly[0].avgTicket;
      const last = monthly[monthly.length - 1].avgTicket;
      percentChange = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
      trend = percentChange > 5 ? "increasing" : percentChange < -5 ? "decreasing" : "stable";
    }

    return { monthly, trend, percentChange };
  } catch {
    return { monthly: [], trend: "stable", percentChange: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #43 REVENUE CONCENTRATION
// ═══════════════════════════════════════════════════════════

export async function analyzeRevenueConcentration(): Promise<{
  top10PercentRevenue: number;
  top10PercentCount: number;
  totalRevenue: number;
  concentrationRatio: number;
  risk: "low" | "medium" | "high";
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT customerId, SUM(totalAmount) as custRev
      FROM invoices
      WHERE customerId IS NOT NULL
        AND invoiceDate >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY customerId
      ORDER BY custRev DESC
    `);

    const results = extractRows(rows);
    const data = results.map((r: RawRow) => Number(r.custRev || 0) / 100);

    if (data.length === 0) {
      return { top10PercentRevenue: 0, top10PercentCount: 0, totalRevenue: 0, concentrationRatio: 0, risk: "low" };
    }

    const totalRevenue = Math.round(data.reduce((s, v) => s + v, 0));
    const top10Count = Math.max(1, Math.ceil(data.length * 0.1));
    const top10Revenue = Math.round(data.slice(0, top10Count).reduce((s, v) => s + v, 0));
    const concentrationRatio = totalRevenue > 0 ? Math.round((top10Revenue / totalRevenue) * 100) : 0;

    const risk = concentrationRatio > 60 ? "high" : concentrationRatio > 40 ? "medium" : "low";

    return { top10PercentRevenue: top10Revenue, top10PercentCount: top10Count, totalRevenue, concentrationRatio, risk };
  } catch {
    return { top10PercentRevenue: 0, top10PercentCount: 0, totalRevenue: 0, concentrationRatio: 0, risk: "low" };
  }
}
