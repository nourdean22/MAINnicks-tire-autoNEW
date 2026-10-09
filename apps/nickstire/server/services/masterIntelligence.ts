/**
 * Master Intelligence Report — Unified digest across all 50 engines
 *
 * Calls 25 key engines in parallel via Promise.allSettled, computes a
 * 0-100 business health score, and surfaces the #1 alert, opportunity,
 * and risk from the combined data.
 *
 * Used by: morning brief, autopilot digest, intelligence.masterReport endpoint
 */

import { createLogger } from "../lib/logger";
import { BUSINESS } from "@shared/business";

const log = createLogger("master-intelligence");

// ── Helpers ──────────────────────────────────────────────

/**
 * Q-23 phase 7 · an engine can fail without rejecting. predictChurn,
 * predictRepeatVisits, analyzeLeadResponseTime, analyzeNewCustomerVelocity and
 * (2026-10-09) analyzeChatFunnel, analyzeReviewSentiment, analyzeReferralNetwork
 * and forecastPortfolioLTV catch their own read error and resolve to an empty
 * shape marked `unavailable: true`. Read as data, that
 * empty shape scored as the best case ("0 high-risk customers": +8). It is a
 * failed engine: absent from the score and counted in `failures`.
 */
function readFailed<T>(result: PromiseSettledResult<T>): boolean {
  if (result.status !== "fulfilled") return false;
  const value = result.value as unknown;
  return typeof value === "object" && value !== null && (value as { unavailable?: unknown }).unavailable === true;
}

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" && !readFailed(result) ? result.value : null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Run promises in batches to avoid DB connection pool exhaustion */
async function batchedSettled<T>(fns: (() => Promise<T>)[], batchSize = 5): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  for (let i = 0; i < fns.length; i += batchSize) {
    const batch = fns.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn => fn()));
    results.push(...batchResults);
  }
  return results;
}

// ── Types ────────────────────────────────────────────────

/** Loose engine result — each engine returns a different shape */
type EngineResult = Record<string, unknown> | null;

/** Safe property access from engine results */
function num(obj: EngineResult, ...keys: string[]): number {
  if (!obj) return 0;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
  }
  return 0;
}

function arr(obj: EngineResult, ...keys: string[]): unknown[] {
  if (!obj) return [];
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

export interface MasterIntelligenceReport {
  timestamp: string;
  revenue: { pacing: EngineResult; anomalies: EngineResult; cashFlow: EngineResult; margins: EngineResult; ticketTrend: EngineResult };
  customers: { churnRisk: EngineResult; riskScores: EngineResult; valueTrend: EngineResult; repeatPrediction: EngineResult; velocity: EngineResult; concentration: EngineResult };
  operations: { techEfficiency: EngineResult; turnaround: EngineResult; bayUtilization: EngineResult; capacity: EngineResult; partsCost: EngineResult };
  marketing: { channelROI: EngineResult; reviewVelocity: EngineResult; smsEngagement: EngineResult; leadResponse: EngineResult; contentPerformance: EngineResult };
  growth: { newCustomerVelocity: EngineResult; referralNetwork: EngineResult; portfolioLTV: EngineResult; marketShare: EngineResult; seasonalDemand: EngineResult };
  competitive: { competitorGap: EngineResult; chatFunnel: EngineResult; reviewSentiment: EngineResult };
  summary: {
    topAlert: string;
    topOpportunity: string;
    topRisk: string;
    score: number;
    /**
     * FALSE when >= 1/3 of the engines failed. The score starts at a baseline of
     * 50 and each block is `if (engine)`, so a dead engine is absent from the
     * score rather than penalised — a total outage still returns 50. A score
     * averaged over silence is UNKNOWN, not average, and the UI must say so
     * instead of printing a reassuring number.
     */
    scoreReliable: boolean;
    enginesFailed: number;
    enginesTotal: number;
    /** Per-component breakdown so the dashboard can show WHY the score is what it is. */
    scoreBreakdown: ScoreComponent[];
    failures: string[];
  };
}

/** A single contributor to the Health Score. */
export interface ScoreComponent {
  /** Display label for the component (e.g. "Revenue pacing", "Bay utilization"). */
  label: string;
  /** Points contributed (signed; can be negative or positive). */
  points: number;
  /** Maximum possible magnitude for this component (e.g. 12 means range is ±12). */
  maxPoints: number;
  /** Human-readable explanation of why it scored this way. */
  reason: string;
  /** Whether the engine had data; helps the UI distinguish "0 because neutral" from "skipped". */
  hasData: boolean;
}

/**
 * One label per engine, in the order generateMasterIntelligenceReport runs
 * them. Used to name a read-failed engine, which has no error message of its own.
 */
const MASTER_ENGINE_LABELS = [
  "revenue forecast", "churn prediction", "revenue anomalies", "cash flow forecast",
  "profit margins", "ticket trend", "customer risk scores", "customer value trend",
  "repeat visit prediction", "new customer velocity", "revenue concentration",
  "tech efficiency", "turnaround time", "bay utilization", "capacity forecast",
  "parts cost ratio", "channel ROI", "review velocity", "SMS engagement",
  "lead response time", "content performance", "competitor gap", "chat funnel",
  "review sentiment", "seasonal demand", "market share", "referral network",
  "portfolio LTV",
] as const;

// ── Main Function ────────────────────────────────────────

export async function generateMasterIntelligenceReport(): Promise<MasterIntelligenceReport> {
  const {
    forecastRevenue,
    predictChurn,
    forecastSeasonalDemand,
  } = await import("./intelligenceEngines");

  const {
    predictRepeatVisits,
    analyzeCustomerValueTrend,
    computeCustomerRiskScores,
    analyzeTechEfficiency,
    analyzeBayUtilization,
    analyzeTurnaroundTime,
    analyzePartsCostRatio,
    forecastCapacity,
    analyzeChannelROI,
    analyzeReviewVelocity,
    analyzeSmsEngagement,
    analyzeLeadResponseTime,
    analyzeContentPerformance,
    analyzeCompetitorGap,
    detectRevenueAnomalies,
    forecastCashFlow,
    estimateMarketShare,
    analyzeProfitMargins,
    analyzeTicketTrend,
    analyzeRevenueConcentration,
    analyzeChatFunnel,
    analyzeReviewSentiment,
    analyzeNewCustomerVelocity,
    analyzeReferralNetwork,
    forecastPortfolioLTV,
  } = await import("./advancedEngines");

  // ── Fire engines in batches of 5 to avoid DB connection pool exhaustion ──
  const results = await batchedSettled<unknown>([
    /* 0  */ () => forecastRevenue(),
    /* 1  */ () => predictChurn(),
    /* 2  */ () => detectRevenueAnomalies(),
    /* 3  */ () => forecastCashFlow(),
    /* 4  */ () => analyzeProfitMargins(),
    /* 5  */ () => analyzeTicketTrend(),
    /* 6  */ () => computeCustomerRiskScores(),
    /* 7  */ () => analyzeCustomerValueTrend(),
    /* 8  */ () => predictRepeatVisits(),
    /* 9  */ () => analyzeNewCustomerVelocity(),
    /* 10 */ () => analyzeRevenueConcentration(),
    /* 11 */ () => analyzeTechEfficiency(),
    /* 12 */ () => analyzeTurnaroundTime(),
    /* 13 */ () => analyzeBayUtilization(),
    /* 14 */ () => forecastCapacity(),
    /* 15 */ () => analyzePartsCostRatio(),
    /* 16 */ () => analyzeChannelROI(),
    /* 17 */ () => analyzeReviewVelocity(),
    /* 18 */ () => analyzeSmsEngagement(),
    /* 19 */ () => analyzeLeadResponseTime(),
    /* 20 */ () => analyzeContentPerformance(),
    /* 21 */ () => analyzeCompetitorGap(),
    /* 22 */ () => analyzeChatFunnel(),
    /* 23 */ () => analyzeReviewSentiment(),
    /* 24 */ () => forecastSeasonalDemand(),
    /* 25 */ () => estimateMarketShare(),
    /* 26 */ () => analyzeReferralNetwork(),
    /* 27 */ () => forecastPortfolioLTV(),
  ]);

  const r = results;
  const pacing        = settled(r[0]) as EngineResult;
  const churnRisk     = settled(r[1]) as EngineResult;
  const anomalies     = settled(r[2]) as EngineResult;
  const cashFlow      = settled(r[3]) as EngineResult;
  const margins       = settled(r[4]) as EngineResult;
  const ticketTrend   = settled(r[5]) as EngineResult;
  const riskScores    = settled(r[6]) as EngineResult;
  const valueTrend    = settled(r[7]) as EngineResult;
  const repeatPred    = settled(r[8]) as EngineResult;
  const custVelocity  = settled(r[9]) as EngineResult;
  const concentration = settled(r[10]) as EngineResult;
  const techEff       = settled(r[11]) as EngineResult;
  const turnaround    = settled(r[12]) as EngineResult;
  const bayUtil       = settled(r[13]) as EngineResult;
  const capacity      = settled(r[14]) as EngineResult;
  const partsCost     = settled(r[15]) as EngineResult;
  const channelROI    = settled(r[16]) as EngineResult;
  const reviewVel     = settled(r[17]) as EngineResult;
  const smsEng        = settled(r[18]) as EngineResult;
  const leadResp      = settled(r[19]) as EngineResult;
  const contentPerf   = settled(r[20]) as EngineResult;
  const compGap       = settled(r[21]) as EngineResult;
  const chatFunnel    = settled(r[22]) as EngineResult;
  const reviewSent    = settled(r[23]) as EngineResult;
  const seasonal      = settled(r[24]) as EngineResult;
  const marketShare   = settled(r[25]) as EngineResult;
  const referralNet   = settled(r[26]) as EngineResult;
  const portfolioLTV  = settled(r[27]) as EngineResult;

  // ── Compute Business Health Score (0-100) ──────────────
  //
  // Weighted composite of MANY business signals. Each component contributes
  // a small ± weight; the sum (clamped to 0-100) is the score. Adding more
  // components increases sophistication without changing the simple
  // single-number contract that dashboards consume.
  //
  // Total maximum upside: +50 / Total maximum downside: -50
  // Realistic range: 30-95 for an actively running shop.

  let score = 50; // baseline
  const scoreBreakdown: ScoreComponent[] = [
    { label: "Baseline", points: 50, maxPoints: 50, reason: "Starting point — every shop begins here", hasData: true },
  ];

  // Helper to record a component contribution.
  const record = (label: string, points: number, maxPoints: number, reason: string, hasData = true) => {
    score += points;
    scoreBreakdown.push({ label, points: Math.round(points * 10) / 10, maxPoints, reason, hasData });
  };

  // ═══ CORE COMPONENTS (original 5, weights tuned down to fit new ones) ═══

  // 1. Revenue pacing (±12) — vs DYNAMIC trailing-average target.
  if (pacing) {
    const monthObj = pacing.month as Record<string, unknown> | undefined;
    const monthSoFar = typeof monthObj?.soFar === "number" ? monthObj.soFar : 0;
    const dayOfMonth = new Date().getDate();
    const trailingDaily = num(pacing, "trailing90DayAvgDaily") || (monthSoFar / Math.max(1, dayOfMonth));
    const expectedPace = trailingDaily * dayOfMonth * 1.1;
    const pacePct = expectedPace > 0 ? monthSoFar / expectedPace : 1;
    const pts = clamp(Math.round(pacePct * 24) - 24, -12, 12);
    record("Revenue pacing", pts, 12, `MTD $${Math.round(monthSoFar).toLocaleString()} vs $${Math.round(expectedPace).toLocaleString()} expected (${Math.round(pacePct * 100)}% of pace, 10% growth target)`);
  }

  // 2. Churn risk (±8)
  if (churnRisk) {
    const highRiskCount = arr(churnRisk, "highRisk").length;
    const pts = clamp(8 - highRiskCount * 2, -8, 8);
    record("Churn risk", pts, 8, `${highRiskCount} high-risk customers detected`);
  }

  // 3. Review velocity (±10)
  if (reviewVel) {
    const velocity = num(reviewVel, "velocity");
    const pts = velocity > 5 ? 10 : velocity > 0 ? 7 : velocity > -10 ? 3 : -5;
    record("Review velocity", pts, 10, `${velocity > 0 ? "+" : ""}${velocity}% month-over-month`);
  }

  // 4. Customer growth (±6)
  if (custVelocity) {
    const monthlyNew = num(custVelocity, "thisMonth", "newThisMonth");
    const pts = clamp(Math.round(monthlyNew * 0.6) - 4, -6, 6);
    record("Customer growth", pts, 6, `${monthlyNew} new customers this month`);
  }

  // 5. Margin health (±8)
  //
  // 2026-08-25 · the `|| 50` that stood here was the single most consequential
  // line in this file. num() returns 0 for a missing or non-numeric key, so an
  // unknown margin became 50, and clamp(round((50-30)*0.4), -8, 8) awards the
  // FULL +8 - the maximum score for this component - while printing
  // "50% average margin" as though it were measured. Unknown rendered as
  // best-possible, on the operator's morning brief.
  //
  // analyzeProfitMargins now returns `overallMargin: null` with a `basis` of
  // "insufficient-coverage" or "unavailable" rather than a number it cannot
  // stand behind. A component we cannot measure scores ZERO and is flagged
  // hasData:false - it neither rewards nor punishes the shop for a data gap.
  // Measured at the time of the change: real coverage 25.2%, so this branch is
  // the live one, and the honest margin on the covered basis is 7% (which
  // would score -8), not the 76% the old code reported (which scored +8).
  if (margins) {
    const avgMargin = margins.overallMargin;
    if (typeof avgMargin === "number") {
      const pts = clamp(Math.round((avgMargin - 30) * 0.4), -8, 8);
      const covered = num(margins, "costDetailCount");
      const total = num(margins, "invoiceCount");
      record("Margin health", pts, 8, `${avgMargin}% average margin (target 30%+) — on the ${covered}/${total} invoices carrying cost detail`);
    } else {
      const basis = typeof margins.basis === "string" ? margins.basis : "unavailable";
      const reason = basis === "unavailable"
        ? "margin unavailable — the revenue query failed"
        : `margin unavailable — insufficient cost-detail coverage (${num(margins, "coveragePct")}%)`;
      record("Margin health", 0, 8, reason, false);
    }
  }

  // ═══ NEW: ADVANCED SIGNALS (8 more components) ═══

  // 6. Revenue anomalies (±4)
  if (anomalies) {
    const list = arr(anomalies, "anomalies");
    const dips = list.filter((a: any) => a?.type === "dip").length;
    const spikes = list.filter((a: any) => a?.type === "spike").length;
    const pts = clamp(spikes * 0.5 - dips * 1.5, -4, 2);
    record("Revenue anomalies", pts, 4, `${dips} dip${dips !== 1 ? "s" : ""}, ${spikes} spike${spikes !== 1 ? "s" : ""} detected (last 90d)`);
  }

  // 7. Cash flow direction (±5)
  //
  // BUG FIX: `num(pacing, "month", "soFar")` doesn't reach nested fields —
  // num() does a top-level `obj[k]` lookup, so it would check pacing.month
  // (object, fails typeof) and pacing.soFar (undefined). Result was always
  // 0, falling back to `|| 1`, which made the AR-drag check fire for ANY
  // outstanding balance >= $0.15. Switched to a proper nested read.
  if (cashFlow) {
    // Same defect class as the pacing read above: next7days / next30days are OBJECTS
    // ({ expectedRevenue, pendingCollections, projectedCash } — engines/revenue.ts), so
    // num(cashFlow, "next7days", "projectedCash") returned 0 and this factor never fired.
    const projected = (key: string): number => {
      const v = (cashFlow as Record<string, unknown>)[key] as { projectedCash?: unknown } | undefined;
      return typeof v?.projectedCash === "number" ? v.projectedCash : 0;
    };
    const next7 = projected("next7days");
    const next30 = projected("next30days");
    const outstandingAR = num(cashFlow, "outstandingAR");
    const pacingMonthObj = (pacing as any)?.month as Record<string, unknown> | undefined;
    const monthSoFar = typeof pacingMonthObj?.soFar === "number" ? pacingMonthObj.soFar : 0;
    let pts = 0;
    let reason = "";
    if (next7 > 0 && next30 > 0) {
      const ratio = next30 / next7;
      pts = clamp(Math.round((ratio - 4) * 1.5), -3, 3);
      reason = `Projecting $${Math.round(next30).toLocaleString()} (30d) vs $${Math.round(next7).toLocaleString()} (7d) — ratio ${ratio.toFixed(1)}x`;
    }
    // Only check AR drag against revenue once we have non-zero MTD revenue
    // (otherwise dividing by 0 / 1 produces a false penalty).
    if (monthSoFar > 0 && outstandingAR / monthSoFar > 0.15) {
      pts -= 2;
      reason += ` · AR drag: $${Math.round(outstandingAR).toLocaleString()} outstanding (>15% of MTD)`;
    }
    record("Cash flow direction", pts, 5, reason || "Cash flow analyzed");
  }

  // 8. Bay utilization (±5)
  if (bayUtil) {
    // analyzeBayUtilization returns `avgOccupancyRate`. Neither of the two
    // names read here has ever existed on it, and num() answers 0 for a key
    // it cannot find — so this component reported "no data" forever.
    const utilization = num(bayUtil, "avgOccupancyRate");
    let pts = 0;
    let reason = "";
    let hasData = true;
    if (utilization === 0) {
      reason = "Bay tracking not wired (skipped — no penalty)";
      hasData = false;
    } else if (utilization >= 50 && utilization <= 80) { pts = 5; reason = `${utilization}% — healthy range`; }
    else if (utilization >= 30 && utilization < 50) { pts = 1; reason = `${utilization}% — slightly underused`; }
    else if (utilization > 80 && utilization <= 95) { pts = 2; reason = `${utilization}% — busy but coping`; }
    else { pts = -3; reason = `${utilization}% — far from healthy 50-80% range`; }
    record("Bay utilization", pts, 5, reason, hasData);
  }

  // 9. Lead response time (±4)
  if (leadResp) {
    // analyzeLeadResponseTime returns `avgMinutes`.
    const avgMin = num(leadResp, "avgMinutes");
    let pts = 0;
    let reason = "";
    let hasData = true;
    if (avgMin === 0) { reason = "No recent leads sampled (skipped)"; hasData = false; }
    else if (avgMin < 5) { pts = 4; reason = `Avg ${avgMin.toFixed(1)} min — excellent`; }
    else if (avgMin < 15) { pts = 2; reason = `Avg ${avgMin.toFixed(1)} min — good`; }
    else if (avgMin < 60) { pts = 0; reason = `Avg ${avgMin.toFixed(1)} min — acceptable`; }
    else if (avgMin < 240) { pts = -2; reason = `Avg ${avgMin.toFixed(1)} min — slow`; }
    else { pts = -4; reason = `Avg ${avgMin.toFixed(1)} min — way too slow (industry: <5 min = 100x conversion)`; }
    record("Lead response time", pts, 4, reason, hasData);
  }

  // 10. Average ticket trend (±4)
  if (ticketTrend) {
    const pctChange = num(ticketTrend, "percentChange");
    const pts = clamp(Math.round(pctChange * 0.2), -4, 4);
    record("Avg ticket trend", pts, 4, `${pctChange > 0 ? "+" : ""}${pctChange}% change in average invoice`);
  }

  // 11. Revenue concentration (±3) — `concentrationRatio` is the percentage
  //    (e.g. 45 means top 10% drive 45% of revenue). `top10PercentRevenue`
  //    is the dollar amount, NOT a percentage — using it here would produce
  //    nonsense like "196487%" in the breakdown.
  if (concentration) {
    const top10Pct = num(concentration, "concentrationRatio");
    let pts = 0;
    if (top10Pct > 70) pts = -3;
    else if (top10Pct > 60) pts = -1;
    else if (top10Pct >= 30 && top10Pct <= 50) pts = 2;
    record("Revenue concentration", pts, 3, `Top 10% of customers drive ${top10Pct}% of revenue (healthy: 30-50%)`);
  }

  // 12. Chat funnel conversion (±3). analyzeChatFunnel returns the funnel's counts over
  // 90 days ({ opened, engaged, sharedInfo, convertedToLead, booked }). This read
  // conversionRate / chatToBookingRate / totalSessions, keys it has never had, so it
  // recorded "0% chat→booking conversion (0 sessions)" on every run (found 2026-10-09).
  if (chatFunnel) {
    const totalSessions = num(chatFunnel, "opened");
    const booked = num(chatFunnel, "booked");
    const conversionPct = totalSessions > 0 ? Math.round((booked / totalSessions) * 100) : 0;
    let pts = 0;
    if (totalSessions > 0) {
      if (conversionPct > 30) pts = 3;
      else if (conversionPct > 15) pts = 1;
      else if (conversionPct < 5 && totalSessions > 5) pts = -2;
    }
    record(
      "Chat funnel",
      pts, 3,
      totalSessions > 0
        ? `${conversionPct}% chat→booking conversion (${booked} booked of ${totalSessions} sessions, 90 days)`
        : "No chat sessions in 90 days (skipped)",
      totalSessions > 0,
    );
  }

  // 13. Customer value trend (±3)
  if (valueTrend) {
    // analyzeCustomerValueTrend returns growing[] and shrinking[], each entry
    // `{ name, trend, lastTicket, avgTicket }` — there is no portfolio-level
    // scalar, and neither "trendPct" nor "growthPct" has ever existed on it.
    // num() answers 0 for a key it cannot find, so this component contributed
    // exactly 0 on every run while reporting "+0% per-customer spend trend"
    // like a measurement.
    //
    // The portfolio number is the MEAN of the per-customer trends the engine
    // did compute. Averaging the union (not growing-minus-shrinking counts)
    // keeps it a spend trend rather than a headcount difference.
    const trends = [...arr(valueTrend, "growing"), ...arr(valueTrend, "shrinking")]
      .map((c) => Number((c as { trend?: unknown })?.trend))
      .filter((t) => Number.isFinite(t));
    const trend = trends.length ? Math.round(trends.reduce((s, t) => s + t, 0) / trends.length) : 0;
    const pts = clamp(Math.round(trend * 0.15), -3, 3);
    record(
      "Customer value trend",
      pts, 3,
      trends.length
        ? `${trend > 0 ? "+" : ""}${trend}% average per-customer spend trend across ${trends.length} customers`
        : "No per-customer trends available (skipped)",
      trends.length > 0,
    );
  }

  score = clamp(Math.round(score), 0, 100);

  // ── Determine Top Alert, Opportunity, Risk ─────────────

  const alertCandidates: Array<{ priority: number; text: string }> = [];
  const opportunityCandidates: Array<{ priority: number; text: string }> = [];
  const riskCandidates: Array<{ priority: number; text: string }> = [];

  // Revenue alerts
  if (pacing) {
    const monthTarget = BUSINESS.revenueTarget.monthly;
    const dayOfMonth = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const expectedPace = (dayOfMonth / daysInMonth) * monthTarget;
    const mObj = pacing.month as Record<string, unknown> | undefined;
    const monthSoFar = typeof mObj?.soFar === "number" ? mObj.soFar : 0;
    const pacePct = expectedPace > 0 ? Math.round((monthSoFar / expectedPace) * 100) : 100;
    if (pacePct < 80) {
      alertCandidates.push({ priority: 100 - pacePct, text: `Revenue at ${pacePct}% of pace — $${Math.round(monthSoFar)} of $${Math.round(expectedPace)} expected by day ${dayOfMonth}` });
    }
    if (pacePct > 120) {
      opportunityCandidates.push({ priority: pacePct - 100, text: `Revenue ${pacePct}% ahead of pace — on track for $${Math.round(monthSoFar * (daysInMonth / dayOfMonth))} this month` });
    }
  }

  // Churn risk
  if (churnRisk) {
    const highRiskArr = arr(churnRisk, "highRisk") as Array<Record<string, unknown>>;
    const highCount = highRiskArr.length;
    if (highCount > 0) {
      const topName = String(highRiskArr[0]?.name || "Unknown");
      riskCandidates.push({ priority: highCount * 10, text: `${highCount} high-value customers at churn risk — ${topName} most urgent (${highRiskArr[0]?.daysSinceVisit || "?"}d since last visit)` });
    }
  }

  // Anomalies
  if (anomalies) {
    const spikes = arr(anomalies, "spikes", "anomalies");
    if (Array.isArray(spikes) && spikes.length > 0) {
      alertCandidates.push({ priority: 30, text: `${spikes.length} revenue anomalies detected — investigate unusual patterns` });
    }
  }

  // Customer velocity opportunity
  if (custVelocity) {
    const monthlyNew = num(custVelocity, "thisMonth", "newThisMonth");
    const lastMonth = num(custVelocity, "lastMonth", "newLastMonth");
    if (monthlyNew > lastMonth && lastMonth > 0) {
      opportunityCandidates.push({ priority: 20, text: `New customer velocity up: ${monthlyNew} this month vs ${lastMonth} last month` });
    }
    if (monthlyNew < lastMonth * 0.7 && lastMonth > 3) {
      riskCandidates.push({ priority: 25, text: `New customer acquisition slowing: ${monthlyNew} vs ${lastMonth} last month` });
    }
  }

  // Review velocity
  if (reviewVel) {
    /**
     * `weeklyRate` has never existed on analyzeReviewVelocity — it returns
     * thisMonth / lastMonth / velocity / trend / projectedAnnual, all MONTHLY.
     * num() answered 0 every run, which made `rate === 0` permanently true and
     * `rate >= 5` permanently unreachable. So the report pushed
     *   "Zero new reviews this week — reputation stalling"
     * as a risk on EVERY run regardless of how many reviews came in, and could
     * never surface the good-news counterpart. Exactly the shape of the
     * capacity block removed above, one component over.
     *
     * Reported monthly because monthly is what the engine measures. Dividing
     * by 4.3 to keep the old wording would invent a weekly precision that was
     * never computed.
     */
    const monthlyReviews = num(reviewVel, "thisMonth");
    if (monthlyReviews === 0) {
      riskCandidates.push({ priority: 15, text: "Zero new reviews this month — reputation stalling" });
    }
    if (monthlyReviews >= 10) {
      opportunityCandidates.push({ priority: 15, text: `Strong review velocity: ${monthlyReviews} reviews this month — momentum building` });
    }
  }

  // Lead response time
  if (leadResp) {
    // Same engine, a THIRD spelling. This alert could never fire.
    const avgMins = num(leadResp, "avgMinutes");
    if (avgMins > 60) {
      alertCandidates.push({ priority: 40, text: `Lead response averaging ${Math.round(avgMins)} minutes — competitors respond in <15` });
    }
  }

  // Capacity — REMOVED, deliberately. Do not reinstate without real bay data.
  //
  // This block read `num(capacity, "currentUtilization", "utilization")`, but
  // forecastCapacity() (services/engines/operations.ts:215) returns only
  // `{ tomorrow, nextWeek }`. Neither key exists, so num() fell through its key
  // loop and returned 0 on EVERY run. That made `util > 90` dead code and
  // `util < 40` always true, pushing a priority-25 candidate
  //   "Bay utilization only 0% — room to take more walk-ins or run a flash promo"
  // into every report. The only competing candidate that can outrank 25 is the
  // revenue-pace one, and only above 125% of pace — so in the ordinary case
  // this fabricated sentence WAS `summary.topOpportunity`, rendered verbatim to
  // the operator as the single most important thing to do today.
  //
  // There is no honest figure to compute here: this deployment has 0 bays,
  // 0 technicians and 1 work order. An absent measurement was being rendered as
  // a measured 0%, which is the defect class this whole arc removed.
  //
  // If bay capture ever lands, gate any replacement on a NON-ZERO denominator
  // (work_orders with an assigned bay in the window) rather than treating a
  // missing reading as 0.

  // Referral network
  if (referralNet) {
    // analyzeReferralNetwork counts referrals as `networkSize`; "totalReferrals" / "count"
    // never existed on it, so this opportunity could not fire (found 2026-10-09).
    const totalRefs = num(referralNet, "networkSize");
    if (totalRefs > 5) {
      opportunityCandidates.push({ priority: 10, text: `Referral network active: ${totalRefs} referrals tracked — amplify with a bonus offer` });
    }
  }

  // Sort by priority and pick #1
  alertCandidates.sort((a, b) => b.priority - a.priority);
  opportunityCandidates.sort((a, b) => b.priority - a.priority);
  riskCandidates.sort((a, b) => b.priority - a.priority);

  const failures: string[] = [];
  const failureLog: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const reason = (r as PromiseRejectedResult).reason;
      failures.push(reason?.message || "Unknown error");
      failureLog.push(reason?.message || String(reason));
    } else if (readFailed(r)) {
      const line = `${MASTER_ENGINE_LABELS[i] ?? `engine ${i}`}: its read failed (it returned an empty result marked unavailable)`;
      failures.push(line);
      failureLog.push(line);
    }
  });
  if (failures.length > 0) {
    log.warn(`Master report: ${failures.length}/${results.length} engines failed`, {
      errors: failureLog.slice(0, 5),
    });
  }

  /**
   * 2026-09-07 · a silent intelligence outage used to render as good news.
   *
   * `settled()` maps a REJECTED engine to `null`, and every scoring block is
   * `if (engine) { ... }`. So a dead engine is not penalised — it is simply
   * ABSENT from the score, which starts at a baseline of 50. With no engine
   * returning anything there are also no alert candidates, so `topAlert` fell
   * through to "No critical alerts — systems nominal".
   *
   * A total outage therefore reported: health 50/100, "systems nominal", no
   * risks, no opportunities. The failure list existed but reached the UI only
   * as a count on a COLLAPSED accordion label.
   *
   * A score computed from a third of its inputs is not a low score, it is an
   * unknown one — the same distinction the admin home already draws for its
   * slices. So the outage now outranks every alert candidate and the score
   * carries a reliability flag instead of quietly averaging over silence.
   */
  const engineFailureRate = results.length > 0 ? failures.length / results.length : 0;
  const scoreReliable = engineFailureRate < 0.34;
  const outageAlert =
    failures.length > 0
      ? `${failures.length} of ${results.length} intelligence engines FAILED — the figures below are incomplete${
          scoreReliable ? "" : ", and the health score is UNKNOWN, not average"
        }.`
      : null;

  // An outage is not one alert among many; it invalidates the others.
  const topAlert =
    (!scoreReliable && outageAlert) ||
    alertCandidates[0]?.text ||
    outageAlert ||
    "No critical alerts — systems nominal";
  const topOpportunity =
    opportunityCandidates[0]?.text ||
    (scoreReliable ? "No standout opportunities detected this cycle" : "Not assessed — engines failed");
  const topRisk =
    riskCandidates[0]?.text ||
    (scoreReliable ? "No elevated risks detected" : "Not assessed — engines failed");

  return {
    timestamp: new Date().toISOString(),
    revenue: { pacing, anomalies, cashFlow, margins, ticketTrend },
    customers: { churnRisk, riskScores, valueTrend, repeatPrediction: repeatPred, velocity: custVelocity, concentration },
    operations: { techEfficiency: techEff, turnaround, bayUtilization: bayUtil, capacity, partsCost },
    marketing: { channelROI, reviewVelocity: reviewVel, smsEngagement: smsEng, leadResponse: leadResp, contentPerformance: contentPerf },
    growth: { newCustomerVelocity: custVelocity, referralNetwork: referralNet, portfolioLTV, marketShare, seasonalDemand: seasonal },
    competitive: { competitorGap: compGap, chatFunnel, reviewSentiment: reviewSent },
    summary: {
      topAlert,
      topOpportunity,
      topRisk,
      score,
      /** False when >= 1/3 of engines failed: the score averaged over silence. */
      scoreReliable,
      enginesFailed: failures.length,
      enginesTotal: results.length,
      scoreBreakdown,
      failures,
    },
  };
}
