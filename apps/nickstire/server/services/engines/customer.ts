/**
 * Customer Behavior Engines (#19-23)
 *
 * predictRepeatVisits, analyzeCustomerValueTrend, buildServiceAffinityMap,
 * analyzeFirstVisitConversion, computeCustomerRiskScores
 */

import { invoices, customers, algEstimates } from "../../../drizzle/schema";
import { sql, gte, and, isNull } from "drizzle-orm";
import { scoreServiceAffinity } from "./affinityScoring";
import { createLogger } from "../../lib/logger";
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

// v2 (2026-05-24) Service Affinity rewrite per
// docs/2026-05-24-service-affinity-v2.md §2.1 (MODEL layer).
//
// THE v1 PROBLEM (per audit-agent trace · design doc §1.1):
//   v1 was a "complement-by-global-popularity" recommender masquerading
//   as a predictor. Every customer's predictedNext biased toward Nick's
//   most-frequent service. Ignored vehicle, mileage, declined-work
//   history, psycho_profile, seasonality. Operator-actionability ≈ 0.
//
// THE v2 FIX:
//   Weighted-signal score across 4 inputs (mirrors the recoveryScore
//   pattern from DeclinedEstimatesSection · proven heuristic shape):
//
//     score(customer, service) =
//         α · vehicleAgeMileageDue(service, customer.vehicle)
//       + β · declinedRecall(service, customer.alg_estimates)
//       + γ · recencyDecay(service, customer.lastVisit)
//       + δ · seasonalDemand(service, currentMonth)
//       − ε · alreadyHadRecently(service, customer.invoices)
//
//     confidence = sample_size_weight × signal_strength
//
// Per Karpathy "simplest thing that works" + skill-mining-agent honest
// flag · NOT ML / collaborative filtering. The v1 heuristic was wrong
// not because it lacked ML but because it ignored the right features.
// Fix the features first · ML waits for ≥6mo outcome data anyway.
//
// MODEL VERSION: "v2-heuristic-2026-05-24"
//   · Bump on any weight change so the prediction table can track
//     per-version performance via the closed-loop measurement plumbing.
// v3 (2026-07-27, ROS-033): implements signal β (declinedRecall) and replaces
// the `sampleSize × signalStrength` confidence product with normalized signal
// strength plus an evidence PRECONDITION. Bumped so the closed-loop tables can
// tell v2 predictions (which could never clear the outreach gate) from v3.
const MODEL_VERSION = "v3-heuristic-2026-07-27" as const;

const affinityLog = createLogger("service-affinity");

// Seasonal demand multipliers per service category (Cleveland tire shop).
// Tires-snow → fall · A/C → summer · brakes → winter slow-zone.
// Honest calibration: these are operator-judgment-baked priors. Replace
// with learned multipliers when ≥12mo of seasonal invoice data exists.
const SEASONAL_DEMAND: Record<string, number[]> = {
  // months 0-11 · Jan..Dec
  tires:       [1.0, 0.9, 0.9, 0.8, 0.9, 1.0, 1.0, 1.0, 1.1, 1.3, 1.4, 1.2], // snow-tire surge in Oct-Dec
  brakes:      [1.2, 1.1, 1.0, 0.9, 0.9, 1.0, 1.0, 1.0, 1.0, 1.1, 1.2, 1.2], // winter wear
  oil:         [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], // steady · service-interval driven
  cooling:     [0.7, 0.7, 0.8, 0.9, 1.1, 1.4, 1.5, 1.4, 1.1, 0.9, 0.7, 0.7], // A/C peaks summer
  electrical:  [1.3, 1.2, 1.0, 0.9, 0.9, 1.0, 1.0, 1.0, 1.0, 1.1, 1.2, 1.3], // cold-start batteries
  suspension:  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], // pothole + wear · steady
  exhaust:     [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  transmission:[1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  engine:      [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  diagnostic:  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
};

function seasonalMultiplier(service: string, monthIdx: number): number {
  return SEASONAL_DEMAND[service]?.[monthIdx] ?? 1.0;
}

// Days since the customer's most recent invoice in a given category.
// Returns Infinity if they've never had it.
function daysSinceCategory(custInvoices: Array<{ category: string; daysAgo: number }>, category: string): number {
  let min = Infinity;
  for (const ci of custInvoices) {
    if (ci.category === category && ci.daysAgo < min) min = ci.daysAgo;
  }
  return min;
}

export async function buildServiceAffinityMap(): Promise<{
  affinities: Array<{
    customerId: number;
    name: string;
    topServices: string[];
    predictedNext: string;
    confidence: number;
    reason: string;
    modelVersion: string;
  }>;
}> {
  try {
    const d = await db();
    if (!d) return { affinities: [] };

    // Pull 24mo invoice history · we need date for recency-decay
    const allInv = await d.select({
      customerId: invoices.customerId,
      serviceDescription: invoices.serviceDescription,
      invoiceDate: invoices.invoiceDate,
    }).from(invoices)
      .where(and(sql`${invoices.customerId} IS NOT NULL`, gte(invoices.invoiceDate, sql`DATE_SUB(NOW(), INTERVAL 24 MONTH)`)));

    const now = Date.now();
    // Per-customer · invoice list with category + days-ago (recency decay input)
    const custInvoices: Record<number, Array<{ category: string; daysAgo: number }>> = {};
    // Per-customer · category count (top-services derivation)
    const custServices: Record<number, Record<string, number>> = {};

    for (const inv of allInv) {
      const cid = inv.customerId!;
      const cats = categorizeService(inv.serviceDescription || "");
      const invDate = inv.invoiceDate ? new Date(inv.invoiceDate).getTime() : now;
      const daysAgo = Math.floor((now - invDate) / 86_400_000);

      if (!custInvoices[cid]) custInvoices[cid] = [];
      if (!custServices[cid]) custServices[cid] = {};

      for (const cat of cats) {
        custInvoices[cid].push({ category: cat, daysAgo });
        custServices[cid][cat] = (custServices[cid][cat] || 0) + 1;
      }
    }

    // Open declined estimates — signal β from the v2 design, implemented at
    // last (ROS-033). `matchedInvoiceId IS NULL` means the estimate was written
    // and never converted to a paid invoice: the customer was handed this exact
    // work in writing and did not take it. Nothing else in this dataset states
    // intent that plainly, and the previous model never even loaded it.
    const openDeclined = await d.select({
      customerId: algEstimates.customerId,
      customerPhone: algEstimates.customerPhone,
      serviceDescription: algEstimates.serviceDescription,
      serviceCategory: algEstimates.serviceCategory,
      estimateDate: algEstimates.estimateDate,
    }).from(algEstimates)
      .where(and(
        // NOT `customerId IS NOT NULL`. `shopDriverEstimateSync` never sets
        // that column — it has zero references to it — so every estimate the
        // sync writes arrives unlinked, and the only thing that ever fills it
        // is a hand-run backfill (scripts/backfill-estimate-customer-link.mjs).
        // Requiring the id would have made signal β cover only whatever was
        // backfilled once and decay to nothing as new estimates arrived: a
        // signal that quietly stops firing, which is the exact defect this
        // recalibration exists to remove. Fall back to the phone key below.
        // Caught in review on #1140.
        sql`(${algEstimates.customerId} IS NOT NULL OR (${algEstimates.customerPhone} IS NOT NULL AND ${algEstimates.customerPhone} <> ''))`,
        isNull(algEstimates.matchedInvoiceId),
        gte(algEstimates.estimateDate, sql`DATE_SUB(NOW(), INTERVAL 24 MONTH)`),
        // CROSS-LOOP SUPPRESSION. `cron/jobs/declinedWorkRecovery.ts` already
        // contacts customers about open estimates and claims each one by
        // stamping a `followUp*AttemptedAt` before it sends. Without this
        // filter, cross-sell would score on the same estimates and text the
        // same person about the same work in different words — and it could not
        // be caught downstream, because cross-sell's COOLDOWN_DAYS only sees
        // cross-sell's own sends and the recovery loop sends with
        // `skipPersist: true`. Excluding any estimate the recovery loop has
        // touched makes the double-text impossible by construction rather than
        // unlikely by cooldown. Recovery owns an estimate once it claims it.
        isNull(algEstimates.followUp3dAttemptedAt),
        isNull(algEstimates.followUp7dAttemptedAt),
        isNull(algEstimates.followUp14dAttemptedAt),
        isNull(algEstimates.followUp30dAttemptedAt),
        isNull(algEstimates.followUp45dAttemptedAt),
      ));

    // Phone -> customer, for estimates the sync left unlinked. AMBIGUITY
    // REFUSES: a phone matching more than one customer is dropped, never
    // attached to an arbitrary one — the same discipline the backfill script
    // applies, and the reason a household line cannot pull one person's
    // declined work onto another person's prediction.
    const phoneOwners: Record<string, Set<number>> = {};
    for (const c of await d.select({ id: customers.id, phone: customers.phone })
      .from(customers).where(sql`${customers.phone} IS NOT NULL AND ${customers.phone} <> ''`)) {
      const key = String(c.phone).replace(/\D/g, "").slice(-10);
      if (key.length < 10) continue;
      (phoneOwners[key] ??= new Set()).add(c.id);
    }

    // customerId -> category -> days since the FRESHEST open estimate.
    const custDeclined: Record<number, Record<string, number>> = {};
    let linkedByPhone = 0;
    for (const est of openDeclined) {
      let cid = est.customerId ?? null;
      if (cid === null) {
        const key = String(est.customerPhone ?? "").replace(/\D/g, "").slice(-10);
        const owners = key.length === 10 ? phoneOwners[key] : undefined;
        if (!owners || owners.size !== 1) continue; // unknown or ambiguous
        cid = [...owners][0];
        linkedByPhone++;
      }
      // Prefer the explicit category when the sync populated it; fall back to
      // the same categorizer the invoice side uses so both agree.
      const cats = est.serviceCategory
        ? [est.serviceCategory]
        : categorizeService(est.serviceDescription || "");
      const estDate = est.estimateDate ? new Date(est.estimateDate).getTime() : now;
      const daysAgo = Math.max(0, Math.floor((now - estDate) / 86_400_000));
      if (!custDeclined[cid]) custDeclined[cid] = {};
      for (const cat of cats) {
        const prev = custDeclined[cid][cat];
        if (prev === undefined || daysAgo < prev) custDeclined[cid][cat] = daysAgo;
      }
    }

    if (linkedByPhone > 0) {
      // Observability, not decoration: this number IS the health of signal β.
      // If it collapses to 0 while open estimates exist, the sync has started
      // writing phones the customers table cannot match and the signal is dying
      // quietly again.
      affinityLog.info("linked open estimates to a customer by phone key (sync leaves customer_id null)", { linkedByPhone });
    }

    const custNames = await d.select({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName })
      .from(customers).where(gte(customers.totalVisits, 2));
    const nameMap: Record<number, string> = {};
    for (const c of custNames) nameMap[c.id] = `${c.firstName || ""} ${c.lastName || ""}`.trim();

    const currentMonth = new Date().getMonth();
    const SERVICE_CATEGORIES = Object.keys(SEASONAL_DEMAND);

    const affinities: Array<{
      customerId: number;
      name: string;
      topServices: string[];
      predictedNext: string;
      confidence: number;
      reason: string;
      modelVersion: string;
    }> = [];

    for (const [cidStr, svcMap] of Object.entries(custServices)) {
      const cid = Number(cidStr);
      const sorted = Object.entries(svcMap).sort((a, b) => b[1] - a[1]);
      if (sorted.length === 0) continue;

      const topServices = sorted.slice(0, 3).map(s => s[0]);
      const totalInvoices = Object.values(svcMap).reduce((a, b) => a + b, 0);
      const invList = custInvoices[cid] ?? [];

      // Score each candidate service. The heuristic itself lives in
      // `affinityScoring.ts` — pure, no clock, no DB — so the recalibration is
      // testable and the old form stays comparable (see `legacyConfidence`).
      type Candidate = { service: string; score: number; confidence: number; reasonParts: string[] };
      const candidates: Candidate[] = [];
      const declinedByCategory = custDeclined[cid] ?? {};

      for (const service of SERVICE_CATEGORIES) {
        const daysSince = daysSinceCategory(invList, service);
        const daysSinceDeclined = declinedByCategory[service] ?? Number.POSITIVE_INFINITY;

        const scored = scoreServiceAffinity({
          daysSinceCategory: daysSince,
          seasonal: seasonalMultiplier(service, currentMonth),
          hasOpenDeclinedEstimate: Number.isFinite(daysSinceDeclined),
          daysSinceDeclined,
          observations: totalInvoices,
        });

        const { score, confidence } = scored;
        // Name the service in the recency reason, matching the previous copy.
        const reasonParts = scored.reasonParts.map((p) =>
          p.startsWith("last visit ") ? p.replace("last visit ", `last ${service} `) : p,
        );

        candidates.push({ service, score, confidence, reasonParts });
      }

      // Pick the highest-scoring candidate
      candidates.sort((a, b) => b.score - a.score);
      const winner = candidates[0];

      // Confidence comes straight from the scorer now. It used to be recomputed
      // here as `sampleSize × signalStrength` — a product of two sub-1 quality
      // measures, which is not a probability and capped production at 0.330
      // against a 0.50 gate (ROS-033). Evidence sufficiency is a precondition
      // inside the scorer, not a multiplier applied to everyone.
      const confidence = winner.confidence;

      const reason = winner.reasonParts.length > 0
        ? `Predicted: ${winner.service} · ${winner.reasonParts.join(" · ")}`
        : `Predicted: ${winner.service} (low confidence · sparse data)`;

      affinities.push({
        customerId: cid,
        name: nameMap[cid] || `Customer #${cid}`,
        topServices,
        predictedNext: winner.score > 0 ? winner.service : "general maintenance",
        confidence,
        reason,
        modelVersion: MODEL_VERSION,
      });
    }

    // Return top-50 by confidence (descending) · per design §1.3
    // "drop the `slice(0, 50)` cap at customer.ts:169 is arbitrary
    // and unsorted". v2 sorts by confidence first.
    return {
      affinities: affinities
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 50),
    };
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
      // BUG FIX (matches intelligenceEngines.ts): skip records with no
      // lastVisitDate. They're imported customers with missing visit
      // history, not churners. Prior code defaulted to 999 days and
      // gave them max churn risk.
      if (!c.lastVisitDate) continue;
      let risk = 0;
      const factors: string[] = [];
      const daysSince = Math.floor((Date.now() - new Date(c.lastVisitDate).getTime()) / 86400000);

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
