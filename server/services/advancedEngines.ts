/**
 * Advanced Intelligence Engines #19–#34
 *
 * Customer Behavior Engines (19-23)
 * Operational Engines (24-28)
 * Marketing Engines (29-34)
 *
 * All engines query existing DB tables using the same pattern as intelligenceEngines.ts.
 * Revenue values in invoices are stored in CENTS — divide by 100 for display.
 */

import { getDb } from "../db";
import { invoices, customers, bookings, leads, chatSessions, callEvents, workOrders, workOrderItems, smsMessages, smsConversations, reviewReplies, reviewRequests, technicians, jobAssignments, smsCampaigns, smsCampaignSends } from "../../drizzle/schema";
import { sql, eq, gte, and, desc } from "drizzle-orm";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

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

// ═══════════════════════════════════════════════════════════
// #19 REPEAT VISIT PREDICTOR
// ═══════════════════════════════════════════════════════════

export async function predictRepeatVisits(): Promise<{
  dueSoon: Array<{ name: string; phone: string; predictedDate: string; avgGapDays: number; confidence: number }>;
  overdueCount: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT c.firstName, c.lastName, c.phone, c.totalVisits,
        DATEDIFF(NOW(), c.lastVisitDate) as daysSinceLast,
        DATEDIFF(c.lastVisitDate, c.firstVisitDate) as totalSpanDays
      FROM customers c
      WHERE c.totalVisits >= 2
        AND c.lastVisitDate IS NOT NULL
        AND c.firstVisitDate IS NOT NULL
      ORDER BY c.lastVisitDate DESC
      LIMIT 500
    `);

    const results = (rows as any[])[0] || rows;
    const dueSoon: Array<{ name: string; phone: string; predictedDate: string; avgGapDays: number; confidence: number }> = [];
    let overdueCount = 0;

    for (const r of (Array.isArray(results) ? results : [])) {
      const visits = Number(r.totalVisits || 2);
      const spanDays = Number(r.totalSpanDays || 0);
      const daysSince = Number(r.daysSinceLast || 0);
      if (spanDays <= 0 || visits < 2) continue;
      const avgGap = Math.round(spanDays / (visits - 1));
      if (avgGap <= 0) continue;
      const daysUntilDue = avgGap - daysSince;
      const confidence = Math.min(0.95, 0.5 + (visits - 2) * 0.1);
      const predicted = new Date(Date.now() + daysUntilDue * 86400000);

      if (daysUntilDue < 0) overdueCount++;
      if (daysUntilDue <= 14) {
        dueSoon.push({
          name: `${r.firstName || ""} ${r.lastName || ""}`.trim(),
          phone: r.phone || "",
          predictedDate: predicted.toISOString().split("T")[0],
          avgGapDays: avgGap,
          confidence: Math.round(confidence * 100) / 100,
        });
      }
    }

    dueSoon.sort((a, b) => a.predictedDate.localeCompare(b.predictedDate));
    return { dueSoon: dueSoon.slice(0, 30), overdueCount };
  } catch {
    return { dueSoon: [], overdueCount: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #20 CUSTOMER VALUE TREND
// ═══════════════════════════════════════════════════════════

export async function analyzeCustomerValueTrend(): Promise<{
  growing: Array<{ name: string; trend: number; lastTicket: number; avgTicket: number }>;
  shrinking: Array<{ name: string; trend: number; lastTicket: number; avgTicket: number }>;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT i.customerId, c.firstName, c.lastName, i.totalAmount, i.invoiceDate,
        ROW_NUMBER() OVER (PARTITION BY i.customerId ORDER BY i.invoiceDate DESC) as rn
      FROM invoices i
      JOIN customers c ON c.id = i.customerId
      WHERE i.customerId IS NOT NULL AND i.invoiceDate >= DATE_SUB(NOW(), INTERVAL 24 MONTH)
      ORDER BY i.customerId, i.invoiceDate DESC
    `);

    const results = (rows as any[])[0] || rows;
    const byCustomer: Record<number, { name: string; amounts: number[] }> = {};
    for (const r of (Array.isArray(results) ? results : [])) {
      const cid = Number(r.customerId);
      const rn = Number(r.rn);
      if (rn > 5) continue;
      if (!byCustomer[cid]) byCustomer[cid] = { name: `${r.firstName || ""} ${r.lastName || ""}`.trim(), amounts: [] };
      byCustomer[cid].amounts.push(Number(r.totalAmount || 0) / 100);
    }

    const growing: Array<{ name: string; trend: number; lastTicket: number; avgTicket: number }> = [];
    const shrinking: Array<{ name: string; trend: number; lastTicket: number; avgTicket: number }> = [];

    for (const [, data] of Object.entries(byCustomer)) {
      if (data.amounts.length < 2) continue;
      const avg = data.amounts.reduce((s, v) => s + v, 0) / data.amounts.length;
      const lastTicket = data.amounts[0];
      const trend = avg > 0 ? Math.round(((lastTicket - avg) / avg) * 100) : 0;
      const entry = { name: data.name, trend, lastTicket: Math.round(lastTicket), avgTicket: Math.round(avg) };
      if (trend > 10) growing.push(entry);
      else if (trend < -10) shrinking.push(entry);
    }

    growing.sort((a, b) => b.trend - a.trend);
    shrinking.sort((a, b) => a.trend - b.trend);
    return { growing: growing.slice(0, 20), shrinking: shrinking.slice(0, 20) };
  } catch {
    return { growing: [], shrinking: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #21 SERVICE AFFINITY MAP
// ═══════════════════════════════════════════════════════════

export async function buildServiceAffinityMap(): Promise<{
  affinities: Array<{ customerId: number; name: string; topServices: string[]; predictedNext: string }>;
}> {
  try {
    const allInv = await (await db()).select({
      customerId: invoices.customerId,
      serviceDescription: invoices.serviceDescription,
    }).from(invoices)
      .where(and(sql`${invoices.customerId} IS NOT NULL`, gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 24 MONTH)`)));

    const custServices: Record<number, Record<string, number>> = {};
    for (const inv of allInv) {
      const cid = inv.customerId!;
      const cats = categorizeService(inv.serviceDescription || "");
      if (!custServices[cid]) custServices[cid] = {};
      for (const cat of cats) custServices[cid][cat] = (custServices[cid][cat] || 0) + 1;
    }

    const custNames = await (await db()).select({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName })
      .from(customers).where(gte(customers.totalVisits, 2));
    const nameMap: Record<number, string> = {};
    for (const c of custNames) nameMap[c.id] = `${c.firstName || ""} ${c.lastName || ""}`.trim();

    const affinities: Array<{ customerId: number; name: string; topServices: string[]; predictedNext: string }> = [];
    for (const [cidStr, svcMap] of Object.entries(custServices)) {
      const cid = Number(cidStr);
      const sorted = Object.entries(svcMap).sort((a, b) => b[1] - a[1]);
      if (sorted.length === 0) continue;
      const topServices = sorted.slice(0, 3).map(s => s[0]);
      const allServiceKeys = SERVICE_CATEGORIES.map(c => c.key);
      const unused = allServiceKeys.filter(k => !svcMap[k]);
      const predictedNext = unused.length > 0 ? unused[0] : topServices[0];
      affinities.push({ customerId: cid, name: nameMap[cid] || `Customer #${cid}`, topServices, predictedNext });
    }

    return { affinities: affinities.slice(0, 50) };
  } catch {
    return { affinities: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #22 FIRST VISIT CONVERSION
// ═══════════════════════════════════════════════════════════

export async function analyzeFirstVisitConversion(): Promise<{
  overallRate: number;
  bySource: Array<{ source: string; firstVisits: number; repeated: number; rate: number }>;
  avgDaysToRepeat: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT c.id, c.totalVisits, c.firstVisitDate, c.lastVisitDate,
        COALESCE(l.source, b.utmSource, 'walk-in') as leadSource
      FROM customers c
      LEFT JOIN leads l ON RIGHT(l.phone, 10) = RIGHT(c.phone, 10)
      LEFT JOIN bookings b ON RIGHT(b.phone, 10) = RIGHT(c.phone, 10) AND b.id = (
        SELECT MIN(b2.id) FROM bookings b2 WHERE RIGHT(b2.phone, 10) = RIGHT(c.phone, 10)
      )
      WHERE c.firstVisitDate IS NOT NULL
      GROUP BY c.id
    `);

    const results = (rows as any[])[0] || rows;
    const data = Array.isArray(results) ? results : [];
    const sourceStats: Record<string, { first: number; repeated: number; totalDays: number }> = {};
    let totalRepeatDays = 0;
    let totalRepeaters = 0;

    for (const r of data) {
      const src = r.leadSource || "walk-in";
      if (!sourceStats[src]) sourceStats[src] = { first: 0, repeated: 0, totalDays: 0 };
      sourceStats[src].first++;
      if (Number(r.totalVisits) >= 2) {
        sourceStats[src].repeated++;
        if (r.firstVisitDate && r.lastVisitDate) {
          const days = Math.floor((new Date(r.lastVisitDate).getTime() - new Date(r.firstVisitDate).getTime()) / 86400000);
          if (days > 0) { sourceStats[src].totalDays += days; totalRepeatDays += days; totalRepeaters++; }
        }
      }
    }

    const totalFirst = data.length;
    const totalRepeated = data.filter((r: any) => Number(r.totalVisits) >= 2).length;
    const overallRate = totalFirst > 0 ? Math.round((totalRepeated / totalFirst) * 100) : 0;
    const avgDaysToRepeat = totalRepeaters > 0 ? Math.round(totalRepeatDays / totalRepeaters) : 0;

    const bySource = Object.entries(sourceStats).map(([source, s]) => ({
      source, firstVisits: s.first, repeated: s.repeated,
      rate: s.first > 0 ? Math.round((s.repeated / s.first) * 100) : 0,
    })).sort((a, b) => b.firstVisits - a.firstVisits);

    return { overallRate, bySource, avgDaysToRepeat };
  } catch {
    return { overallRate: 0, bySource: [], avgDaysToRepeat: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #23 CUSTOMER RISK SCORE
// ═══════════════════════════════════════════════════════════

export async function computeCustomerRiskScores(): Promise<{
  highRisk: Array<{ name: string; phone: string; riskScore: number; factors: string[] }>;
  totalAtRisk: number;
  totalCustomers: number;
}> {
  try {
    const allCust = await (await db()).select({
      id: customers.id, firstName: customers.firstName, lastName: customers.lastName,
      phone: customers.phone, totalSpent: customers.totalSpent, totalVisits: customers.totalVisits,
      lastVisitDate: customers.lastVisitDate, firstVisitDate: customers.firstVisitDate,
    }).from(customers).where(gte(customers.totalVisits, 1));

    const highRisk: Array<{ name: string; phone: string; riskScore: number; factors: string[] }> = [];

    for (const c of allCust) {
      let risk = 0;
      const factors: string[] = [];
      const daysSince = c.lastVisitDate ? Math.floor((Date.now() - new Date(c.lastVisitDate).getTime()) / 86400000) : 999;

      // Churn: 0-40 points based on days since last visit
      if (daysSince > 180) { risk += 40; factors.push("No visit in 6+ months"); }
      else if (daysSince > 90) { risk += 25; factors.push("No visit in 3+ months"); }
      else if (daysSince > 60) { risk += 15; factors.push("No visit in 2+ months"); }

      // Declining value: check if totalSpent/visits is low
      const avgTicket = (c.totalVisits || 1) > 0 ? (c.totalSpent || 0) / 100 / (c.totalVisits || 1) : 0;
      if (avgTicket < 50 && (c.totalVisits || 0) >= 2) { risk += 15; factors.push("Low avg ticket (<$50)"); }

      // Low engagement: single visit customers
      if ((c.totalVisits || 0) === 1) { risk += 20; factors.push("Single visit only"); }

      // Declined work check
      const woRows = await (await db()).execute(sql`
        SELECT COUNT(*) as cnt FROM work_orders
        WHERE customer_id = ${String(c.id)} AND has_declined_work = 1
        AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      `);
      const declinedCount = Number((woRows as any)?.[0]?.[0]?.cnt || (woRows as any)?.[0]?.cnt || 0);
      if (declinedCount > 0) { risk += 25; factors.push(`${declinedCount} declined work order(s)`); }

      risk = Math.min(100, risk);
      if (risk >= 40) highRisk.push({
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
        phone: c.phone || "", riskScore: risk, factors,
      });
    }

    highRisk.sort((a, b) => b.riskScore - a.riskScore);
    return { highRisk: highRisk.slice(0, 30), totalAtRisk: highRisk.length, totalCustomers: allCust.length };
  } catch {
    return { highRisk: [], totalAtRisk: 0, totalCustomers: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #24 TECH EFFICIENCY
// ═══════════════════════════════════════════════════════════

export async function analyzeTechEfficiency(): Promise<{
  rankings: Array<{ name: string; revenuePerHour: number; jobsPerDay: number; comebackRate: number; score: number }>;
}> {
  try {
    const techs = await (await db()).select({
      id: technicians.id, name: technicians.name,
      comebackRate: technicians.comebackRate, totalJobs: technicians.totalJobsCompleted,
    }).from(technicians).where(eq(technicians.isActive, 1));

    const rankings: Array<{ name: string; revenuePerHour: number; jobsPerDay: number; comebackRate: number; score: number }> = [];

    for (const tech of techs) {
      const revenueRows = await (await db()).execute(sql`
        SELECT COALESCE(SUM(CAST(wo.total AS DECIMAL(10,2))), 0) as totalRev,
          COUNT(*) as jobCount,
          COALESCE(SUM(TIMESTAMPDIFF(HOUR, wo.started_at, wo.completed_at)), 1) as totalHours,
          DATEDIFF(MAX(wo.completed_at), MIN(wo.started_at)) as spanDays
        FROM work_orders wo
        WHERE wo.assigned_tech_id = ${tech.id}
          AND wo.status = 'completed'
          AND wo.completed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      `);
      const r = (revenueRows as any)?.[0]?.[0] || (revenueRows as any)?.[0] || {};
      const totalRev = Number(r.totalRev || 0);
      const totalHours = Math.max(1, Number(r.totalHours || 1));
      const jobCount = Number(r.jobCount || 0);
      const spanDays = Math.max(1, Number(r.spanDays || 1));
      const comeback = Number(tech.comebackRate || 0);

      const revenuePerHour = Math.round(totalRev / totalHours);
      const jobsPerDay = Math.round((jobCount / spanDays) * 100) / 100;
      const score = Math.round(revenuePerHour * 0.4 + jobsPerDay * 20 - comeback * 50);

      rankings.push({ name: tech.name, revenuePerHour, jobsPerDay, comebackRate: comeback, score });
    }

    rankings.sort((a, b) => b.score - a.score);
    return { rankings };
  } catch {
    return { rankings: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #25 BAY UTILIZATION
// ═══════════════════════════════════════════════════════════

export async function analyzeBayUtilization(): Promise<{
  avgOccupancyRate: number;
  peakHours: number[];
  idleHours: number[];
  totalBays: number;
}> {
  try {
    const TOTAL_BAYS = 6; // Nick's shop bay count
    const OPERATING_HOURS = { start: 8, end: 17 }; // 8 AM - 5 PM

    const rows = await (await db()).execute(sql`
      SELECT HOUR(wo.started_at) as startHour, COUNT(*) as jobCount
      FROM work_orders wo
      WHERE wo.started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND wo.assigned_bay IS NOT NULL
      GROUP BY HOUR(wo.started_at)
      ORDER BY startHour
    `);

    const results = (rows as any[])[0] || rows;
    const hourCounts: Record<number, number> = {};
    for (let h = OPERATING_HOURS.start; h < OPERATING_HOURS.end; h++) hourCounts[h] = 0;
    for (const r of (Array.isArray(results) ? results : [])) {
      const h = Number(r.startHour);
      if (h >= OPERATING_HOURS.start && h < OPERATING_HOURS.end) hourCounts[h] = Number(r.jobCount || 0);
    }

    const totalSlots = TOTAL_BAYS * 30 * (OPERATING_HOURS.end - OPERATING_HOURS.start);
    const totalUsed = Object.values(hourCounts).reduce((s, v) => s + v, 0);
    const avgOccupancy = totalSlots > 0 ? Math.round((totalUsed / totalSlots) * 100) : 0;

    const avgPerHour = totalUsed / Math.max(1, Object.keys(hourCounts).length);
    const peakHours = Object.entries(hourCounts).filter(([, v]) => v > avgPerHour * 1.3).map(([h]) => Number(h));
    const idleHours = Object.entries(hourCounts).filter(([, v]) => v < avgPerHour * 0.5).map(([h]) => Number(h));

    return { avgOccupancyRate: avgOccupancy, peakHours, idleHours, totalBays: TOTAL_BAYS };
  } catch {
    return { avgOccupancyRate: 0, peakHours: [], idleHours: [], totalBays: 6 };
  }
}

// ═══════════════════════════════════════════════════════════
// #26 TURNAROUND TIME
// ═══════════════════════════════════════════════════════════

export async function analyzeTurnaroundTime(): Promise<{
  byService: Array<{ service: string; avgHours: number; targetHours: number; onTarget: boolean }>;
  overallAvg: number;
}> {
  try {
    const SERVICE_TARGETS: Record<string, number> = {
      oil: 1.5, tires: 2, brakes: 4, diagnostic: 2, electrical: 3,
      suspension: 5, cooling: 4, exhaust: 3, engine: 8, transmission: 10,
    };

    const rows = await (await db()).execute(sql`
      SELECT wo.service_description,
        AVG(TIMESTAMPDIFF(HOUR, wo.started_at, wo.completed_at)) as avgHours
      FROM work_orders wo
      WHERE wo.status = 'completed'
        AND wo.started_at IS NOT NULL AND wo.completed_at IS NOT NULL
        AND wo.completed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY wo.service_description
    `);

    const results = (rows as any[])[0] || rows;
    const catTotals: Record<string, { totalHours: number; count: number }> = {};
    let overallTotal = 0;
    let overallCount = 0;

    for (const r of (Array.isArray(results) ? results : [])) {
      const hours = Number(r.avgHours || 0);
      if (hours <= 0) continue;
      const cats = categorizeService(r.service_description || "");
      for (const cat of cats) {
        if (!catTotals[cat]) catTotals[cat] = { totalHours: 0, count: 0 };
        catTotals[cat].totalHours += hours;
        catTotals[cat].count++;
      }
      overallTotal += hours;
      overallCount++;
    }

    const byService = Object.entries(catTotals).map(([service, data]) => {
      const avgHours = Math.round((data.totalHours / data.count) * 10) / 10;
      const target = SERVICE_TARGETS[service] || 4;
      return { service, avgHours, targetHours: target, onTarget: avgHours <= target };
    }).sort((a, b) => b.avgHours - a.avgHours);

    return { byService, overallAvg: overallCount > 0 ? Math.round((overallTotal / overallCount) * 10) / 10 : 0 };
  } catch {
    return { byService: [], overallAvg: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #27 PARTS COST OPTIMIZER
// ═══════════════════════════════════════════════════════════

export async function analyzePartsCostRatio(): Promise<{
  avgPartsPercent: number;
  outliers: Array<{ invoiceId: number; service: string; partsPercent: number; totalAmount: number }>;
  savingsOpportunity: number;
}> {
  try {
    const rows = await (await db()).select({
      id: invoices.id, totalAmount: invoices.totalAmount,
      partsCost: invoices.partsCost, laborCost: invoices.laborCost,
      serviceDescription: invoices.serviceDescription,
    }).from(invoices)
      .where(and(gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`), sql`${invoices.totalAmount} > 0`));

    let totalParts = 0;
    let totalAll = 0;
    const outliers: Array<{ invoiceId: number; service: string; partsPercent: number; totalAmount: number }> = [];

    for (const inv of rows) {
      const total = (inv.totalAmount || 0) / 100;
      const parts = (inv.partsCost || 0) / 100;
      if (total <= 0) continue;
      totalParts += parts;
      totalAll += total;
      const pct = Math.round((parts / total) * 100);
      if (pct > 65) {
        outliers.push({
          invoiceId: inv.id, service: (inv.serviceDescription || "").slice(0, 80),
          partsPercent: pct, totalAmount: Math.round(total),
        });
      }
    }

    const avgPartsPercent = totalAll > 0 ? Math.round((totalParts / totalAll) * 100) : 0;
    outliers.sort((a, b) => b.partsPercent - a.partsPercent);

    // Savings if outliers were at average parts %
    const savings = outliers.reduce((s, o) => {
      const excess = (o.partsPercent - avgPartsPercent) / 100 * o.totalAmount;
      return s + Math.max(0, excess);
    }, 0);

    return { avgPartsPercent, outliers: outliers.slice(0, 15), savingsOpportunity: Math.round(savings) };
  } catch {
    return { avgPartsPercent: 0, outliers: [], savingsOpportunity: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #28 CAPACITY FORECASTER
// ═══════════════════════════════════════════════════════════

export async function forecastCapacity(): Promise<{
  tomorrow: { expectedJobs: number; expectedRevenue: number; staffingRecommendation: string };
  nextWeek: { expectedJobs: number; expectedRevenue: number; busiestDay: string };
}> {
  try {
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    // Get daily averages from last 8 weeks
    const rows = await (await db()).execute(sql`
      SELECT DAYOFWEEK(invoiceDate) as dow,
        COUNT(*) / COUNT(DISTINCT DATE(invoiceDate)) as avgJobs,
        AVG(totalAmount) as avgTicket,
        SUM(totalAmount) / COUNT(DISTINCT DATE(invoiceDate)) as avgDailyRev
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 56 DAY)
      GROUP BY DAYOFWEEK(invoiceDate)
    `);

    const results = (rows as any[])[0] || rows;
    const dowStats: Record<number, { avgJobs: number; avgDailyRev: number }> = {};
    for (const r of (Array.isArray(results) ? results : [])) {
      const dow = Number(r.dow);
      dowStats[dow] = { avgJobs: Math.round(Number(r.avgJobs || 0)), avgDailyRev: Math.round(Number(r.avgDailyRev || 0) / 100) };
    }

    // Tomorrow
    const tomorrowDow = ((new Date().getDay() + 1) % 7) + 1; // MySQL DAYOFWEEK: 1=Sun
    const tmrw = dowStats[tomorrowDow] || { avgJobs: 0, avgDailyRev: 0 };
    const staffRec = tmrw.avgJobs > 8 ? "Full staff + overflow prep" : tmrw.avgJobs > 5 ? "Standard staffing" : "Light day — schedule training or catch-up";

    // Next week: sum Monday-Saturday
    let weekJobs = 0;
    let weekRev = 0;
    let busiestDow = 2;
    let busiestCount = 0;
    for (let d = 2; d <= 7; d++) { // Mon=2 through Sat=7 in MySQL
      const stat = dowStats[d] || { avgJobs: 0, avgDailyRev: 0 };
      weekJobs += stat.avgJobs;
      weekRev += stat.avgDailyRev;
      if (stat.avgJobs > busiestCount) { busiestCount = stat.avgJobs; busiestDow = d; }
    }

    return {
      tomorrow: { expectedJobs: tmrw.avgJobs, expectedRevenue: tmrw.avgDailyRev, staffingRecommendation: staffRec },
      nextWeek: { expectedJobs: weekJobs, expectedRevenue: weekRev, busiestDay: DAYS[busiestDow - 1] || "Monday" },
    };
  } catch {
    return {
      tomorrow: { expectedJobs: 0, expectedRevenue: 0, staffingRecommendation: "Unable to forecast" },
      nextWeek: { expectedJobs: 0, expectedRevenue: 0, busiestDay: "Unknown" },
    };
  }
}

// ═══════════════════════════════════════════════════════════
// #29 CHANNEL ROI
// ═══════════════════════════════════════════════════════════

export async function analyzeChannelROI(): Promise<{
  channels: Array<{ channel: string; leads: number; conversions: number; revenue: number; costPerLead: number; roi: string }>;
  bestChannel: string;
  worstChannel: string;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT l.source as channel,
        COUNT(DISTINCT l.id) as leadCount,
        COUNT(DISTINCT CASE WHEN l.status IN ('booked', 'completed') THEN l.id END) as conversions,
        COALESCE(SUM(i.totalAmount), 0) as totalRev
      FROM leads l
      LEFT JOIN customers c ON RIGHT(c.phone, 10) = RIGHT(l.phone, 10)
      LEFT JOIN invoices i ON i.customerId = c.id AND i.invoiceDate >= l.createdAt
      WHERE l.createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY l.source
      ORDER BY totalRev DESC
    `);

    const results = (rows as any[])[0] || rows;
    const channels: Array<{ channel: string; leads: number; conversions: number; revenue: number; costPerLead: number; roi: string }> = [];

    for (const r of (Array.isArray(results) ? results : [])) {
      const leads = Number(r.leadCount || 0);
      const conversions = Number(r.conversions || 0);
      const revenue = Math.round(Number(r.totalRev || 0) / 100);
      const costPerLead = 0; // No ad spend data in DB — placeholder
      const roi = leads > 0 ? `${Math.round((conversions / leads) * 100)}% conversion` : "N/A";
      channels.push({ channel: r.channel || "unknown", leads, conversions, revenue, costPerLead, roi });
    }

    const best = channels.length > 0 ? channels[0].channel : "N/A";
    const worst = channels.length > 0 ? channels[channels.length - 1].channel : "N/A";

    return { channels, bestChannel: best, worstChannel: worst };
  } catch {
    return { channels: [], bestChannel: "N/A", worstChannel: "N/A" };
  }
}

// ═══════════════════════════════════════════════════════════
// #30 REVIEW VELOCITY
// ═══════════════════════════════════════════════════════════

export async function analyzeReviewVelocity(): Promise<{
  thisMonth: number;
  lastMonth: number;
  velocity: number;
  trend: "accelerating" | "decelerating" | "steady";
  projectedAnnual: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT
        SUM(CASE WHEN review_date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 ELSE 0 END) as thisMonth,
        SUM(CASE WHEN review_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-01')
                   AND review_date < DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 ELSE 0 END) as lastMonth,
        COUNT(*) as totalReviews
      FROM review_replies
      WHERE review_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
    `);

    const r = (rows as any)?.[0]?.[0] || (rows as any)?.[0] || {};
    const thisMonth = Number(r.thisMonth || 0);
    const lastMonth = Number(r.lastMonth || 0);
    const totalReviews = Number(r.totalReviews || 0);
    const velocity = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;
    const trend = velocity > 10 ? "accelerating" : velocity < -10 ? "decelerating" : "steady";
    const avgPerMonth = totalReviews / 12;
    const projectedAnnual = Math.round(avgPerMonth * 12);

    return { thisMonth, lastMonth, velocity, trend, projectedAnnual };
  } catch {
    return { thisMonth: 0, lastMonth: 0, velocity: 0, trend: "steady", projectedAnnual: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #31 SMS ENGAGEMENT
// ═══════════════════════════════════════════════════════════

export async function analyzeSmsEngagement(): Promise<{
  byCampaign: Array<{ campaign: string; sent: number; replies: number; optOuts: number; responseRate: number }>;
  bestPerforming: string;
  optOutRate: number;
}> {
  try {
    const campaigns = await (await db()).select({
      id: smsCampaigns.id, name: smsCampaigns.name,
      sentCount: smsCampaigns.sentCount,
    }).from(smsCampaigns)
      .where(gte(smsCampaigns.createdAt, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`));

    const byCampaign: Array<{ campaign: string; sent: number; replies: number; optOuts: number; responseRate: number }> = [];
    let totalSent = 0;
    let totalOptOuts = 0;

    for (const camp of campaigns) {
      const sent = camp.sentCount || 0;
      totalSent += sent;

      // Count replies — inbound messages within 48h of campaign sends
      const replyRows = await (await db()).execute(sql`
        SELECT COUNT(*) as cnt FROM sms_messages
        WHERE direction = 'inbound'
          AND createdAt >= (SELECT MIN(createdAt) FROM sms_campaign_sends WHERE campaignId = ${camp.id})
          AND createdAt <= DATE_ADD((SELECT MAX(createdAt) FROM sms_campaign_sends WHERE campaignId = ${camp.id}), INTERVAL 48 HOUR)
      `);
      const replies = Number((replyRows as any)?.[0]?.[0]?.cnt || (replyRows as any)?.[0]?.cnt || 0);

      // Opt-outs approximation
      const optRows = await (await db()).execute(sql`
        SELECT COUNT(*) as cnt FROM sms_messages
        WHERE direction = 'inbound' AND LOWER(body) IN ('stop', 'unsubscribe', 'opt out', 'cancel')
          AND createdAt >= (SELECT MIN(createdAt) FROM sms_campaign_sends WHERE campaignId = ${camp.id})
      `);
      const optOuts = Number((optRows as any)?.[0]?.[0]?.cnt || (optRows as any)?.[0]?.cnt || 0);
      totalOptOuts += optOuts;

      byCampaign.push({
        campaign: camp.name, sent, replies, optOuts,
        responseRate: sent > 0 ? Math.round((replies / sent) * 100) : 0,
      });
    }

    byCampaign.sort((a, b) => b.responseRate - a.responseRate);
    return {
      byCampaign,
      bestPerforming: byCampaign.length > 0 ? byCampaign[0].campaign : "N/A",
      optOutRate: totalSent > 0 ? Math.round((totalOptOuts / totalSent) * 100 * 100) / 100 : 0,
    };
  } catch {
    return { byCampaign: [], bestPerforming: "N/A", optOutRate: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #32 LEAD RESPONSE TIME
// ═══════════════════════════════════════════════════════════

export async function analyzeLeadResponseTime(): Promise<{
  avgMinutes: number;
  under5min: number;
  under30min: number;
  over1hour: number;
  conversionBySpeed: Array<{ bucket: string; leads: number; converted: number; rate: number }>;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT l.id, l.status,
        TIMESTAMPDIFF(MINUTE, l.createdAt, l.contactedAt) as responseMinutes
      FROM leads l
      WHERE l.createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        AND l.contactedAt IS NOT NULL
    `);

    const results = (rows as any[])[0] || rows;
    const data = Array.isArray(results) ? results : [];

    let totalMinutes = 0;
    let under5 = 0;
    let under30 = 0;
    let over60 = 0;
    const buckets: Record<string, { leads: number; converted: number }> = {
      "Under 5 min": { leads: 0, converted: 0 },
      "5-30 min": { leads: 0, converted: 0 },
      "30-60 min": { leads: 0, converted: 0 },
      "Over 1 hour": { leads: 0, converted: 0 },
    };

    for (const r of data) {
      const mins = Number(r.responseMinutes || 0);
      const converted = ["booked", "completed"].includes(r.status);
      totalMinutes += mins;

      if (mins < 5) { under5++; buckets["Under 5 min"].leads++; if (converted) buckets["Under 5 min"].converted++; }
      else if (mins < 30) { under30++; buckets["5-30 min"].leads++; if (converted) buckets["5-30 min"].converted++; }
      else if (mins < 60) { buckets["30-60 min"].leads++; if (converted) buckets["30-60 min"].converted++; }
      else { over60++; buckets["Over 1 hour"].leads++; if (converted) buckets["Over 1 hour"].converted++; }
    }

    const conversionBySpeed = Object.entries(buckets).map(([bucket, d]) => ({
      bucket, leads: d.leads, converted: d.converted,
      rate: d.leads > 0 ? Math.round((d.converted / d.leads) * 100) : 0,
    }));

    return {
      avgMinutes: data.length > 0 ? Math.round(totalMinutes / data.length) : 0,
      under5min: under5, under30min: under30 + under5, over1hour: over60,
      conversionBySpeed,
    };
  } catch {
    return { avgMinutes: 0, under5min: 0, under30min: 0, over1hour: 0, conversionBySpeed: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #33 CONTENT PERFORMANCE
// ═══════════════════════════════════════════════════════════

export async function analyzeContentPerformance(): Promise<{
  topPages: Array<{ page: string; leads: number; bookings: number; conversionRate: number }>;
  topReferrers: Array<{ source: string; visits: number; leads: number }>;
}> {
  try {
    // Analyze landing pages that generate leads
    const pageRows = await (await db()).execute(sql`
      SELECT landingPage as page,
        COUNT(*) as leadCount,
        SUM(CASE WHEN status IN ('booked', 'completed') THEN 1 ELSE 0 END) as bookingCount
      FROM leads
      WHERE landingPage IS NOT NULL AND landingPage != ''
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY landingPage
      ORDER BY leadCount DESC
      LIMIT 15
    `);

    const pageResults = (pageRows as any[])[0] || pageRows;
    const topPages = (Array.isArray(pageResults) ? pageResults : []).map((r: any) => ({
      page: r.page || "",
      leads: Number(r.leadCount || 0),
      bookings: Number(r.bookingCount || 0),
      conversionRate: Number(r.leadCount) > 0 ? Math.round((Number(r.bookingCount) / Number(r.leadCount)) * 100) : 0,
    }));

    // Analyze referrers
    const refRows = await (await db()).execute(sql`
      SELECT referrer as source,
        COUNT(*) as visits,
        SUM(CASE WHEN status != 'new' THEN 1 ELSE 0 END) as leadCount
      FROM leads
      WHERE referrer IS NOT NULL AND referrer != ''
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY referrer
      ORDER BY visits DESC
      LIMIT 10
    `);

    const refResults = (refRows as any[])[0] || refRows;
    const topReferrers = (Array.isArray(refResults) ? refResults : []).map((r: any) => ({
      source: r.source || "",
      visits: Number(r.visits || 0),
      leads: Number(r.leadCount || 0),
    }));

    return { topPages, topReferrers };
  } catch {
    return { topPages: [], topReferrers: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #34 COMPETITOR GAP ANALYSIS
// ═══════════════════════════════════════════════════════════

export async function analyzeCompetitorGap(): Promise<{
  us: { rating: number; reviewCount: number; responseRate: number };
  competitors: Array<{ name: string; rating: number; reviewCount: number; gap: string }>;
  advantage: string;
}> {
  try {
    // Our review stats from review_replies table
    const ourRows = await (await db()).execute(sql`
      SELECT
        ROUND(AVG(review_rating), 1) as avgRating,
        COUNT(*) as totalReviews,
        SUM(CASE WHEN final_reply IS NOT NULL AND final_reply != '' THEN 1 ELSE 0 END) as repliedCount
      FROM review_replies
      WHERE review_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
    `);

    const our = (ourRows as any)?.[0]?.[0] || (ourRows as any)?.[0] || {};
    const rating = Number(our.avgRating || 4.5);
    const reviewCount = Number(our.totalReviews || 0);
    const repliedCount = Number(our.repliedCount || 0);
    const responseRate = reviewCount > 0 ? Math.round((repliedCount / reviewCount) * 100) : 0;

    // Known Cleveland-area competitor benchmarks (static — updated periodically)
    const competitors = [
      { name: "Conrad's Tire Express", rating: 4.3, reviewCount: 450, gap: "" },
      { name: "Rad Air Complete Car Care", rating: 4.4, reviewCount: 380, gap: "" },
      { name: "Tire Choice Auto Service", rating: 3.9, reviewCount: 200, gap: "" },
      { name: "Midas Cleveland", rating: 3.7, reviewCount: 160, gap: "" },
    ];

    for (const c of competitors) {
      const ratingDiff = Math.round((rating - c.rating) * 10) / 10;
      const countDiff = reviewCount - c.reviewCount;
      c.gap = ratingDiff > 0
        ? `+${ratingDiff} stars ahead, ${countDiff > 0 ? `+${countDiff}` : countDiff} reviews`
        : `${ratingDiff} stars behind, ${countDiff > 0 ? `+${countDiff}` : countDiff} reviews`;
    }

    const beatingAll = competitors.every(c => rating >= c.rating);
    const advantage = beatingAll
      ? `Leading all competitors with ${rating} stars and ${responseRate}% response rate`
      : `Focus on review collection — ${reviewCount} reviews vs avg ${Math.round(competitors.reduce((s, c) => s + c.reviewCount, 0) / competitors.length)} competitor reviews`;

    return { us: { rating, reviewCount, responseRate }, competitors, advantage };
  } catch {
    return {
      us: { rating: 0, reviewCount: 0, responseRate: 0 },
      competitors: [],
      advantage: "Unable to analyze",
    };
  }
}

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

    const results = (rows as any[])[0] || rows;
    const data = (Array.isArray(results) ? results : []).map((r: any) => ({
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
    const hist = (histRows as any)?.[0]?.[0] || (histRows as any)?.[0] || {};
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

    const results = (rows as any[])[0] || rows;
    const atRisk: Array<{ bookingId: number; name: string; phone: string; probability: number; reason: string }> = [];

    for (const r of (Array.isArray(results) ? results : [])) {
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
          name: r.name || "",
          phone: r.phone || "",
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

    const results = (rows as any[])[0] || rows;
    const weekday: Array<{ day: string; hour: number; avgJobs: number; avgRevenue: number }> = [];
    const scored: Array<{ day: string; hour: number; score: number }> = [];

    for (const r of (Array.isArray(results) ? results : [])) {
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
    const avgDaily = Number(((avgRows as any)?.[0]?.[0] || (avgRows as any)?.[0] || {}).avgDailyRev || 0) / 100;

    // Outstanding AR (pending/partial invoices)
    const arRows = await (await db()).execute(sql`
      SELECT COALESCE(SUM(totalAmount), 0) as outstanding
      FROM invoices
      WHERE paymentStatus IN ('pending', 'partial')
    `);
    const outstandingAR = Math.round(Number(((arRows as any)?.[0]?.[0] || (arRows as any)?.[0] || {}).outstanding || 0) / 100);

    // Booked jobs coming up (confirmed bookings)
    const bookedRows = await (await db()).execute(sql`
      SELECT COUNT(*) as cnt FROM bookings
      WHERE status IN ('new', 'confirmed')
        AND preferredDate >= CURDATE()
        AND preferredDate <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
    `);
    const upcomingBookings = Number(((bookedRows as any)?.[0]?.[0] || (bookedRows as any)?.[0] || {}).cnt || 0);

    // Estimated avg ticket from recent data
    const ticketRows = await (await db()).execute(sql`
      SELECT AVG(totalAmount) as avgTicket FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND totalAmount > 0
    `);
    const avgTicket = Number(((ticketRows as any)?.[0]?.[0] || (ticketRows as any)?.[0] || {}).avgTicket || 0) / 100;

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
    const ourReviews = Number(((ourRows as any)?.[0]?.[0] || (ourRows as any)?.[0] || {}).cnt || 0);

    // Our review growth (this quarter vs last quarter)
    const growthRows = await (await db()).execute(sql`
      SELECT
        SUM(CASE WHEN review_date >= DATE_SUB(NOW(), INTERVAL 3 MONTH) THEN 1 ELSE 0 END) as thisQ,
        SUM(CASE WHEN review_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
                   AND review_date < DATE_SUB(NOW(), INTERVAL 3 MONTH) THEN 1 ELSE 0 END) as lastQ
      FROM review_replies
    `);
    const g = (growthRows as any)?.[0]?.[0] || (growthRows as any)?.[0] || {};
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

    const currentResults = (currentRows as any[])[0] || currentRows;
    const prevResults = (prevRows as any[])[0] || prevRows;

    const prevMap: Record<string, number> = {};
    for (const r of (Array.isArray(prevResults) ? prevResults : [])) {
      prevMap[r.paymentMethod || "other"] = Number(r.cnt || 0);
    }

    let totalCount = 0;
    let totalRev = 0;
    const methods: Array<{ method: string; count: number; revenue: number; percentOfTotal: number; trend: string }> = [];

    for (const r of (Array.isArray(currentResults) ? currentResults : [])) {
      const count = Number(r.cnt || 0);
      const revenue = Math.round(Number(r.totalRev || 0) / 100);
      totalCount += count;
      totalRev += revenue;
      methods.push({ method: r.paymentMethod || "other", count, revenue, percentOfTotal: 0, trend: "" });
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

    const results = (rows as any[])[0] || rows;
    const monthly = (Array.isArray(results) ? results : []).map((r: any) => ({
      month: r.month || "",
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

    const results = (rows as any[])[0] || rows;
    const data = (Array.isArray(results) ? results : []).map((r: any) => Number(r.custRev || 0) / 100);

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

// ═══════════════════════════════════════════════════════════
// #44 CHAT CONVERSION FUNNEL
// ═══════════════════════════════════════════════════════════

export async function analyzeChatFunnel(): Promise<{
  opened: number;
  engaged: number;
  sharedInfo: number;
  convertedToLead: number;
  booked: number;
  dropOffStage: string;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT cs.id, cs.messagesJson, cs.converted, cs.leadId,
        (SELECT l.status FROM leads l WHERE l.id = cs.leadId) as leadStatus
      FROM chat_sessions cs
      WHERE cs.createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `);

    const results = (rows as any[])[0] || rows;
    const sessions = Array.isArray(results) ? results : [];

    let opened = sessions.length;
    let engaged = 0;
    let sharedInfo = 0;
    let convertedToLead = 0;
    let booked = 0;

    for (const s of sessions) {
      try {
        const messages = JSON.parse(s.messagesJson || "[]");
        const userMessages = messages.filter((m: any) => m.role === "user");
        if (userMessages.length >= 3) engaged++;

        // Shared info: user provided phone or name in messages
        const hasContactInfo = userMessages.some((m: any) => {
          const content = String(m.content || "");
          return /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(content) || content.length > 20;
        });
        if (hasContactInfo) sharedInfo++;
      } catch {
        // invalid JSON — skip message parsing
      }

      if (Number(s.converted) === 1 || s.leadId) convertedToLead++;
      if (s.leadStatus === "booked" || s.leadStatus === "completed") booked++;
    }

    // Find biggest drop-off
    const funnelSteps = [
      { name: "opened→engaged", from: opened, to: engaged },
      { name: "engaged→sharedInfo", from: engaged, to: sharedInfo },
      { name: "sharedInfo→lead", from: sharedInfo, to: convertedToLead },
      { name: "lead→booked", from: convertedToLead, to: booked },
    ];
    let maxDrop = 0;
    let dropOffStage = "None";
    for (const step of funnelSteps) {
      if (step.from > 0) {
        const dropRate = (step.from - step.to) / step.from;
        if (dropRate > maxDrop) { maxDrop = dropRate; dropOffStage = step.name; }
      }
    }

    return { opened, engaged, sharedInfo, convertedToLead, booked, dropOffStage };
  } catch {
    return { opened: 0, engaged: 0, sharedInfo: 0, convertedToLead: 0, booked: 0, dropOffStage: "Unknown" };
  }
}

// ═══════════════════════════════════════════════════════════
// #45 REVIEW SENTIMENT BREAKDOWN
// ═══════════════════════════════════════════════════════════

export async function analyzeReviewSentiment(): Promise<{
  topics: Array<{ topic: string; positive: number; negative: number; neutral: number; score: number }>;
  overallSentiment: number;
  trendingPositive: string[];
  trendingNegative: string[];
}> {
  try {
    const TOPIC_PATTERNS: Record<string, RegExp> = {
      pricing: /price|cost|expensive|cheap|affordable|deal|fair|overcharge|rip.?off|worth/i,
      "wait time": /wait|slow|fast|quick|took.?long|hours|prompt|delay|time/i,
      quality: /quality|great.?work|perfect|excellent|terrible|sloppy|professional|thorough|right/i,
      friendliness: /friendly|nice|rude|helpful|kind|welcom|attitude|courteous|pleasant|mean/i,
      cleanliness: /clean|dirty|neat|messy|organized|tidy|filthy/i,
      communication: /communicat|explain|inform|updat|call|text|told|honest|transparent/i,
      trust: /trust|honest|reliable|recommend|integrity|dependable|scam/i,
    };

    const rows = await (await db()).execute(sql`
      SELECT review_text, review_rating
      FROM review_replies
      WHERE review_text IS NOT NULL AND review_text != ''
        AND review_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
    `);

    const results = (rows as any[])[0] || rows;
    const reviews = Array.isArray(results) ? results : [];

    const topicStats: Record<string, { positive: number; negative: number; neutral: number }> = {};
    for (const topic of Object.keys(TOPIC_PATTERNS)) {
      topicStats[topic] = { positive: 0, negative: 0, neutral: 0 };
    }

    let totalRating = 0;

    for (const r of reviews) {
      const text = String(r.review_text || "");
      const rating = Number(r.review_rating || 3);
      totalRating += rating;

      for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
        if (pattern.test(text)) {
          if (rating >= 4) topicStats[topic].positive++;
          else if (rating <= 2) topicStats[topic].negative++;
          else topicStats[topic].neutral++;
        }
      }
    }

    const topics = Object.entries(topicStats).map(([topic, data]) => {
      const total = data.positive + data.negative + data.neutral;
      const score = total > 0 ? Math.round(((data.positive - data.negative) / total) * 100) : 0;
      return { topic, ...data, score };
    }).sort((a, b) => b.score - a.score);

    const overallSentiment = reviews.length > 0 ? Math.round((totalRating / reviews.length) * 10) / 10 : 0;
    const trendingPositive = topics.filter(t => t.score > 50 && (t.positive + t.negative + t.neutral) > 3).map(t => t.topic);
    const trendingNegative = topics.filter(t => t.score < -20 && (t.positive + t.negative + t.neutral) > 3).map(t => t.topic);

    return { topics, overallSentiment, trendingPositive, trendingNegative };
  } catch {
    return { topics: [], overallSentiment: 0, trendingPositive: [], trendingNegative: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #46 WEBSITE JOURNEY ANALYSIS
// ═══════════════════════════════════════════════════════════

export async function analyzeWebsiteJourneys(): Promise<{
  topLandingPages: Array<{ page: string; leads: number; conversionRate: number }>;
  topConversionPaths: Array<{ path: string; count: number }>;
}> {
  try {
    // Landing pages that generate leads
    const pageRows = await (await db()).execute(sql`
      SELECT landingPage as page,
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('booked', 'completed') THEN 1 ELSE 0 END) as converted
      FROM leads
      WHERE landingPage IS NOT NULL AND landingPage != ''
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY landingPage
      ORDER BY total DESC
      LIMIT 15
    `);

    const pageResults = (pageRows as any[])[0] || pageRows;
    const topLandingPages = (Array.isArray(pageResults) ? pageResults : []).map((r: any) => ({
      page: r.page || "",
      leads: Number(r.total || 0),
      conversionRate: Number(r.total) > 0 ? Math.round((Number(r.converted) / Number(r.total)) * 100) : 0,
    }));

    // Source→landing page paths
    const pathRows = await (await db()).execute(sql`
      SELECT CONCAT(COALESCE(source, 'direct'), ' → ', COALESCE(landingPage, '/')) as path,
        COUNT(*) as cnt
      FROM leads
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY CONCAT(COALESCE(source, 'direct'), ' → ', COALESCE(landingPage, '/'))
      ORDER BY cnt DESC
      LIMIT 10
    `);

    const pathResults = (pathRows as any[])[0] || pathRows;
    const topConversionPaths = (Array.isArray(pathResults) ? pathResults : []).map((r: any) => ({
      path: r.path || "",
      count: Number(r.cnt || 0),
    }));

    return { topLandingPages, topConversionPaths };
  } catch {
    return { topLandingPages: [], topConversionPaths: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #47 CALL PATTERN ANALYSIS
// ═══════════════════════════════════════════════════════════

export async function analyzeCallPatterns(): Promise<{
  hourlyVolume: Array<{ hour: number; calls: number }>;
  topSourcePages: Array<{ page: string; calls: number }>;
  callToBookingRate: number;
  peakCallHour: number;
}> {
  try {
    // Hourly distribution
    const hourRows = await (await db()).execute(sql`
      SELECT HOUR(createdAt) as hr, COUNT(*) as cnt
      FROM call_events
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY HOUR(createdAt)
      ORDER BY hr
    `);

    const hourResults = (hourRows as any[])[0] || hourRows;
    const hourlyVolume: Array<{ hour: number; calls: number }> = [];
    let peakCallHour = 0;
    let peakCount = 0;

    for (const r of (Array.isArray(hourResults) ? hourResults : [])) {
      const hr = Number(r.hr);
      const calls = Number(r.cnt || 0);
      hourlyVolume.push({ hour: hr, calls });
      if (calls > peakCount) { peakCount = calls; peakCallHour = hr; }
    }

    // Source pages
    const srcRows = await (await db()).execute(sql`
      SELECT sourcePage as page, COUNT(*) as cnt
      FROM call_events
      WHERE sourcePage IS NOT NULL AND sourcePage != ''
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY sourcePage
      ORDER BY cnt DESC
      LIMIT 10
    `);

    const srcResults = (srcRows as any[])[0] || srcRows;
    const topSourcePages = (Array.isArray(srcResults) ? srcResults : []).map((r: any) => ({
      page: r.page || "",
      calls: Number(r.cnt || 0),
    }));

    // Call-to-booking rate: calls that have matching phone in bookings
    const convRows = await (await db()).execute(sql`
      SELECT
        COUNT(DISTINCT ce.id) as totalCalls,
        COUNT(DISTINCT b.id) as matchedBookings
      FROM call_events ce
      LEFT JOIN bookings b ON RIGHT(b.phone, 10) = RIGHT(ce.phoneNumber, 10)
        AND b.createdAt >= ce.createdAt
        AND b.createdAt <= DATE_ADD(ce.createdAt, INTERVAL 7 DAY)
      WHERE ce.createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `);

    const conv = (convRows as any)?.[0]?.[0] || (convRows as any)?.[0] || {};
    const totalCalls = Number(conv.totalCalls || 0);
    const matchedBookings = Number(conv.matchedBookings || 0);
    const callToBookingRate = totalCalls > 0 ? Math.round((matchedBookings / totalCalls) * 100) : 0;

    return { hourlyVolume, topSourcePages, callToBookingRate, peakCallHour };
  } catch {
    return { hourlyVolume: [], topSourcePages: [], callToBookingRate: 0, peakCallHour: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #48 NEW CUSTOMER VELOCITY
// ═══════════════════════════════════════════════════════════

export async function analyzeNewCustomerVelocity(): Promise<{
  thisMonth: number;
  lastMonth: number;
  velocity: number;
  trend: "accelerating" | "decelerating" | "steady";
  projectedYearEnd: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT
        SUM(CASE WHEN firstVisitDate >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 ELSE 0 END) as thisMonth,
        SUM(CASE WHEN firstVisitDate >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-01')
                   AND firstVisitDate < DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 ELSE 0 END) as lastMonth,
        SUM(CASE WHEN firstVisitDate >= DATE_SUB(NOW(), INTERVAL 12 MONTH) THEN 1 ELSE 0 END) as lastYear
      FROM customers
      WHERE firstVisitDate IS NOT NULL
    `);

    const r = (rows as any)?.[0]?.[0] || (rows as any)?.[0] || {};
    const thisMonth = Number(r.thisMonth || 0);
    const lastMonth = Number(r.lastMonth || 0);
    const lastYear = Number(r.lastYear || 0);
    const velocity = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;
    const trend = velocity > 10 ? "accelerating" : velocity < -10 ? "decelerating" : "steady";

    // Project year-end based on monthly average
    const avgPerMonth = lastYear / 12;
    const monthsRemaining = 12 - new Date().getMonth();
    const projectedYearEnd = Math.round(lastYear + avgPerMonth * monthsRemaining);

    return { thisMonth, lastMonth, velocity, trend, projectedYearEnd };
  } catch {
    return { thisMonth: 0, lastMonth: 0, velocity: 0, trend: "steady", projectedYearEnd: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #49 REFERRAL NETWORK MAP
// ═══════════════════════════════════════════════════════════

export async function analyzeReferralNetwork(): Promise<{
  topReferrers: Array<{ name: string; phone: string; referralCount: number; convertedCount: number; totalRevenue: number }>;
  networkSize: number;
  avgReferralValue: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT r.referrerName as name, r.referrerPhone as phone,
        COUNT(*) as referralCount,
        SUM(CASE WHEN r.status IN ('visited', 'redeemed') THEN 1 ELSE 0 END) as convertedCount
      FROM referrals r
      GROUP BY r.referrerPhone, r.referrerName
      ORDER BY referralCount DESC
      LIMIT 30
    `);

    const results = (rows as any[])[0] || rows;
    const topReferrers: Array<{ name: string; phone: string; referralCount: number; convertedCount: number; totalRevenue: number }> = [];

    for (const r of (Array.isArray(results) ? results : [])) {
      // Get revenue from referred customers
      const revRows = await (await db()).execute(sql`
        SELECT COALESCE(SUM(i.totalAmount), 0) as totalRev
        FROM referrals ref
        JOIN customers c ON RIGHT(c.phone, 10) = RIGHT(ref.refereePhone, 10)
        JOIN invoices i ON i.customerId = c.id
        WHERE RIGHT(ref.referrerPhone, 10) = RIGHT(${r.phone}, 10)
      `);
      const totalRevenue = Math.round(Number(((revRows as any)?.[0]?.[0] || (revRows as any)?.[0] || {}).totalRev || 0) / 100);

      topReferrers.push({
        name: r.name || "",
        phone: r.phone || "",
        referralCount: Number(r.referralCount || 0),
        convertedCount: Number(r.convertedCount || 0),
        totalRevenue,
      });
    }

    const networkSize = topReferrers.reduce((s, r) => s + r.referralCount, 0);
    const totalRefRevenue = topReferrers.reduce((s, r) => s + r.totalRevenue, 0);
    const avgReferralValue = networkSize > 0 ? Math.round(totalRefRevenue / networkSize) : 0;

    topReferrers.sort((a, b) => b.totalRevenue - a.totalRevenue);
    return { topReferrers: topReferrers.slice(0, 15), networkSize, avgReferralValue };
  } catch {
    return { topReferrers: [], networkSize: 0, avgReferralValue: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #50 LIFETIME VALUE FORECAST
// ═══════════════════════════════════════════════════════════

export async function forecastPortfolioLTV(): Promise<{
  totalProjectedLTV: number;
  avgCustomerLTV: number;
  ltvBySegment: Array<{ segment: string; count: number; avgLTV: number; totalLTV: number }>;
  growthRate: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT c.id, c.totalSpent, c.totalVisits, c.firstVisitDate, c.lastVisitDate,
        c.customerType
      FROM customers c
      WHERE c.totalVisits >= 1 AND c.firstVisitDate IS NOT NULL
    `);

    const results = (rows as any[])[0] || rows;
    const customers_data = Array.isArray(results) ? results : [];

    const segments: Record<string, { count: number; totalLTV: number }> = {
      "VIP (10+ visits)": { count: 0, totalLTV: 0 },
      "Loyal (5-9 visits)": { count: 0, totalLTV: 0 },
      "Repeat (2-4 visits)": { count: 0, totalLTV: 0 },
      "Single visit": { count: 0, totalLTV: 0 },
      "Commercial": { count: 0, totalLTV: 0 },
    };

    let totalProjectedLTV = 0;
    let recentSpend = 0;
    let olderSpend = 0;

    for (const c of customers_data) {
      const spent = Number(c.totalSpent || 0) / 100;
      const visits = Number(c.totalVisits || 1);
      const firstDate = c.firstVisitDate ? new Date(c.firstVisitDate) : new Date();
      const lastDate = c.lastVisitDate ? new Date(c.lastVisitDate) : new Date();
      const tenureDays = Math.max(1, (Date.now() - firstDate.getTime()) / 86400000);
      const daysSinceLast = (Date.now() - lastDate.getTime()) / 86400000;

      // Project 5-year LTV based on current spend velocity
      const spendPerDay = spent / tenureDays;
      const retentionFactor = daysSinceLast > 365 ? 0.2 : daysSinceLast > 180 ? 0.5 : daysSinceLast > 90 ? 0.8 : 1.0;
      const projectedLTV = Math.round(spendPerDay * 365 * 5 * retentionFactor);

      totalProjectedLTV += projectedLTV;

      // Segment
      let segment: string;
      if (c.customerType === "commercial") segment = "Commercial";
      else if (visits >= 10) segment = "VIP (10+ visits)";
      else if (visits >= 5) segment = "Loyal (5-9 visits)";
      else if (visits >= 2) segment = "Repeat (2-4 visits)";
      else segment = "Single visit";

      segments[segment].count++;
      segments[segment].totalLTV += projectedLTV;

      // Growth rate: last 6 months vs prior 6 months
      if (lastDate.getTime() > Date.now() - 180 * 86400000) recentSpend += spent;
      else if (lastDate.getTime() > Date.now() - 360 * 86400000) olderSpend += spent;
    }

    const avgCustomerLTV = customers_data.length > 0 ? Math.round(totalProjectedLTV / customers_data.length) : 0;

    const ltvBySegment = Object.entries(segments)
      .filter(([, data]) => data.count > 0)
      .map(([segment, data]) => ({
        segment,
        count: data.count,
        avgLTV: Math.round(data.totalLTV / data.count),
        totalLTV: Math.round(data.totalLTV),
      }))
      .sort((a, b) => b.totalLTV - a.totalLTV);

    const growthRate = olderSpend > 0 ? Math.round(((recentSpend - olderSpend) / olderSpend) * 100) : 0;

    return { totalProjectedLTV: Math.round(totalProjectedLTV), avgCustomerLTV, ltvBySegment, growthRate };
  } catch {
    return { totalProjectedLTV: 0, avgCustomerLTV: 0, ltvBySegment: [], growthRate: 0 };
  }
}
