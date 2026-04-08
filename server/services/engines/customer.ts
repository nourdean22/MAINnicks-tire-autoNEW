/**
 * Customer Behavior Engines (#19-23)
 *
 * predictRepeatVisits, analyzeCustomerValueTrend, buildServiceAffinityMap,
 * analyzeFirstVisitConversion, computeCustomerRiskScores
 */

import { invoices, customers } from "../../../drizzle/schema";
import { sql, gte, and } from "drizzle-orm";
import { RawRow, extractRows, extractOne, db, categorizeService } from "./shared";

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

    const results = extractRows(rows);
    const dueSoon: Array<{ name: string; phone: string; predictedDate: string; avgGapDays: number; confidence: number }> = [];
    let overdueCount = 0;

    for (const r of results) {
      const visits = Number(r.totalVisits || 2);
      const spanDays = Number(r.totalSpanDays || 0);
      const daysSince = Number(r.daysSinceLast || 0);
      if (spanDays <= 0 || visits < 2) continue;
      const avgGap = Math.round(spanDays / (visits - 1));
      if (avgGap <= 0) continue;
      const daysUntilDue = avgGap - daysSince;
      const confidence = Math.min(95, Math.round((0.5 + (visits - 2) * 0.1) * 100));
      const predicted = new Date(Date.now() + daysUntilDue * 86400000);

      if (daysUntilDue < 0) overdueCount++;
      if (daysUntilDue <= 14) {
        dueSoon.push({
          name: `${String(r.firstName || "")} ${String(r.lastName || "")}`.trim(),
          phone: String(r.phone || ""),
          predictedDate: predicted.toISOString().split("T")[0],
          avgGapDays: avgGap,
          confidence,
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

    const results = extractRows(rows);
    const byCustomer: Record<number, { name: string; amounts: number[] }> = {};
    for (const r of results) {
      const cid = Number(r.customerId);
      const rn = Number(r.rn);
      if (rn > 5) continue;
      if (!byCustomer[cid]) byCustomer[cid] = { name: `${String(r.firstName || "")} ${String(r.lastName || "")}`.trim(), amounts: [] };
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

    // Compute global service frequency to predict next service by popularity, not alphabetical order
    const globalServiceFreq: Record<string, number> = {};
    for (const svcMap of Object.values(custServices)) {
      for (const [svc, count] of Object.entries(svcMap)) {
        globalServiceFreq[svc] = (globalServiceFreq[svc] || 0) + count;
      }
    }
    const servicesByPopularity = Object.entries(globalServiceFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([svc]) => svc);

    const affinities: Array<{ customerId: number; name: string; topServices: string[]; predictedNext: string }> = [];
    for (const [cidStr, svcMap] of Object.entries(custServices)) {
      const cid = Number(cidStr);
      const sorted = Object.entries(svcMap).sort((a, b) => b[1] - a[1]);
      if (sorted.length === 0) continue;
      const topServices = sorted.slice(0, 3).map(s => s[0]);
      const predictedNext = servicesByPopularity.find(svc => !svcMap[svc]) || topServices[0];
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

    const results = extractRows(rows);
    const data = results;
    const sourceStats: Record<string, { first: number; repeated: number; totalDays: number }> = {};
    let totalRepeatDays = 0;
    let totalRepeaters = 0;

    for (const r of data) {
      const src = String(r.leadSource || "walk-in");
      if (!sourceStats[src]) sourceStats[src] = { first: 0, repeated: 0, totalDays: 0 };
      sourceStats[src].first++;
      if (Number(r.totalVisits) >= 2) {
        sourceStats[src].repeated++;
        if (r.firstVisitDate && r.lastVisitDate) {
          const days = Math.floor((new Date(String(r.lastVisitDate)).getTime() - new Date(String(r.firstVisitDate)).getTime()) / 86400000);
          if (days > 0) { sourceStats[src].totalDays += days; totalRepeatDays += days; totalRepeaters++; }
        }
      }
    }

    const totalFirst = data.length;
    const totalRepeated = data.filter((r: RawRow) => Number(r.totalVisits) >= 2).length;
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
      balanceDue: customers.balanceDue,
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

      // Declined work proxy: pending invoices indicate unresolved/declined work
      const pendingBalance = Number(c.balanceDue || 0) / 100;
      if (pendingBalance > 200) { risk += 25; factors.push(`$${Math.round(pendingBalance)} outstanding balance`); }
      else if (pendingBalance > 0) { risk += 10; factors.push(`$${Math.round(pendingBalance)} outstanding balance`); }

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
