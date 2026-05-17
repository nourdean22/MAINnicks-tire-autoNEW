/**
 * Operational Engines (#24-28)
 *
 * analyzeTechEfficiency, analyzeBayUtilization, analyzeTurnaroundTime,
 * analyzePartsCostRatio, forecastCapacity
 */

import { invoices } from "../../../drizzle/schema";
import { sql, gte, and } from "drizzle-orm";
import { extractRows, db, categorizeService } from "./shared";

// ═══════════════════════════════════════════════════════════
// #24 TECH EFFICIENCY
// ═══════════════════════════════════════════════════════════

export async function analyzeTechEfficiency(): Promise<{
  rankings: Array<{ name: string; revenuePerHour: number; jobsPerDay: number; comebackRate: number; score: number }>;
}> {
  try {
    // Single aggregated query instead of N+1 per tech
    const rows = await (await db()).execute(sql`
      SELECT t.name, t.id,
        COALESCE(SUM(CAST(wo.total AS DECIMAL(10,2))), 0) as totalRev,
        COUNT(wo.id) as jobCount,
        COALESCE(SUM(TIMESTAMPDIFF(HOUR, wo.started_at, wo.completed_at)), 1) as totalHours,
        COALESCE(DATEDIFF(MAX(wo.completed_at), MIN(wo.started_at)), 1) as spanDays,
        t.comeback_rate as comebackRate
      FROM technicians t
      LEFT JOIN work_orders wo ON wo.assigned_tech_id = t.id
        AND wo.status = 'completed'
        AND wo.completed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      WHERE t.is_active = 1
      GROUP BY t.id, t.name, t.comeback_rate
      ORDER BY totalRev DESC
    `);

    const results = extractRows(rows);
    const rankings: Array<{ name: string; revenuePerHour: number; jobsPerDay: number; comebackRate: number; score: number }> = [];

    for (const r of results) {
      const totalRev = Number(r.totalRev || 0);
      const totalHours = Math.max(1, Number(r.totalHours || 1));
      const jobCount = Number(r.jobCount || 0);
      const spanDays = Math.max(1, Number(r.spanDays || 1));
      const comeback = Number(r.comebackRate || 0);

      const revenuePerHour = Math.round(totalRev / totalHours);
      const jobsPerDay = Math.round((jobCount / spanDays) * 100) / 100;
      const score = Math.round(revenuePerHour * 0.4 + jobsPerDay * 20 - comeback * 50);

      rankings.push({ name: String(r.name || ""), revenuePerHour, jobsPerDay, comebackRate: comeback, score });
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
    const OPERATING_HOURS = { start: 8, end: 18 }; // 8 AM - 6 PM

    const rows = await (await db()).execute(sql`
      SELECT HOUR(wo.started_at) as startHour, COUNT(*) as jobCount
      FROM work_orders wo
      WHERE wo.started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND wo.assigned_bay IS NOT NULL
      GROUP BY HOUR(wo.started_at)
      ORDER BY startHour
    `);

    const results = extractRows(rows);
    const hourCounts: Record<number, number> = {};
    for (let h = OPERATING_HOURS.start; h < OPERATING_HOURS.end; h++) hourCounts[h] = 0;
    for (const r of results) {
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

    const results = extractRows(rows);
    const catTotals: Record<string, { totalHours: number; count: number }> = {};
    let overallTotal = 0;
    let overallCount = 0;

    for (const r of results) {
      const hours = Number(r.avgHours || 0);
      if (hours <= 0) continue;
      const cats = categorizeService(String(r.service_description || ""));
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

    const results = extractRows(rows);
    const dowStats: Record<number, { avgJobs: number; avgDailyRev: number }> = {};
    for (const r of results) {
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
