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

const log = createLogger("master-intelligence");

// ── Helpers ──────────────────────────────────────────────

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
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

export interface MasterIntelligenceReport {
  timestamp: string;
  revenue: { pacing: any; anomalies: any; cashFlow: any; margins: any; ticketTrend: any };
  customers: { churnRisk: any; riskScores: any; valueTrend: any; repeatPrediction: any; velocity: any; concentration: any };
  operations: { techEfficiency: any; turnaround: any; bayUtilization: any; capacity: any; partsCost: any };
  marketing: { channelROI: any; reviewVelocity: any; smsEngagement: any; leadResponse: any; contentPerformance: any };
  growth: { newCustomerVelocity: any; referralNetwork: any; portfolioLTV: any; marketShare: any; seasonalDemand: any };
  competitive: { competitorGap: any; chatFunnel: any; reviewSentiment: any };
  summary: {
    topAlert: string;
    topOpportunity: string;
    topRisk: string;
    score: number;
  };
}

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous engine results
  const r = results as PromiseSettledResult<any>[];
  const pacing        = settled(r[0]);
  const churnRisk     = settled(r[1]);
  const anomalies     = settled(r[2]);
  const cashFlow      = settled(r[3]);
  const margins       = settled(r[4]);
  const ticketTrend   = settled(r[5]);
  const riskScores    = settled(r[6]);
  const valueTrend    = settled(r[7]);
  const repeatPred    = settled(r[8]);
  const custVelocity  = settled(r[9]);
  const concentration = settled(r[10]);
  const techEff       = settled(r[11]);
  const turnaround    = settled(r[12]);
  const bayUtil       = settled(r[13]);
  const capacity      = settled(r[14]);
  const partsCost     = settled(r[15]);
  const channelROI    = settled(r[16]);
  const reviewVel     = settled(r[17]);
  const smsEng        = settled(r[18]);
  const leadResp      = settled(r[19]);
  const contentPerf   = settled(r[20]);
  const compGap       = settled(r[21]);
  const chatFunnel    = settled(r[22]);
  const reviewSent    = settled(r[23]);
  const seasonal      = settled(r[24]);
  const marketShare   = settled(r[25]);
  const referralNet   = settled(r[26]);
  const portfolioLTV  = settled(results[27]);

  // ── Compute Business Health Score (0-100) ──────────────
  // Weighted composite: revenue pacing (30%), churn (20%), reviews (15%), customer growth (15%), margins (20%)

  let score = 50; // baseline

  // Revenue pacing component (30 pts)
  if (pacing) {
    const monthTarget = 20_000;
    const dayOfMonth = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const expectedPace = (dayOfMonth / daysInMonth) * monthTarget;
    const monthSoFar = pacing.month?.soFar || 0;
    const pacePct = expectedPace > 0 ? monthSoFar / expectedPace : 1;
    // 100% pace = 30pts, 80% = 24pts, 120% = 36pts (capped at 30)
    score += clamp(Math.round(pacePct * 30) - 30, -15, 15);
  }

  // Churn risk component (20 pts) — fewer high-risk = better
  if (churnRisk) {
    const highRiskCount = churnRisk.highRisk?.length || 0;
    // 0 high-risk = +10, 5+ = -10
    score += clamp(10 - highRiskCount * 2, -10, 10);
  }

  // Review velocity component (15 pts)
  if (reviewVel) {
    const velocity = (reviewVel as any).weeklyRate || (reviewVel as any).monthlyRate || 0;
    // 4+ reviews/week = +7, 0 = -7
    score += clamp(Math.round(velocity * 1.75) - 7, -7, 7);
  }

  // Customer growth component (15 pts)
  if (custVelocity) {
    const monthlyNew = (custVelocity as any).thisMonth || (custVelocity as any).newThisMonth || 0;
    // 10+ new customers/month = +8, 0 = -5
    score += clamp(Math.round(monthlyNew * 0.8) - 5, -8, 8);
  }

  // Margin health component (20 pts)
  if (margins) {
    const avgMargin = (margins as any).averageMargin || (margins as any).overallMargin || 50;
    // 50%+ margin = +10, 30% = 0, <20% = -10
    score += clamp(Math.round((avgMargin - 30) * 0.5), -10, 10);
  }

  score = clamp(Math.round(score), 0, 100);

  // ── Determine Top Alert, Opportunity, Risk ─────────────

  const alertCandidates: Array<{ priority: number; text: string }> = [];
  const opportunityCandidates: Array<{ priority: number; text: string }> = [];
  const riskCandidates: Array<{ priority: number; text: string }> = [];

  // Revenue alerts
  if (pacing) {
    const monthTarget = 20_000;
    const dayOfMonth = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const expectedPace = (dayOfMonth / daysInMonth) * monthTarget;
    const monthSoFar = pacing.month?.soFar || 0;
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
    const highCount = churnRisk.highRisk?.length || 0;
    if (highCount > 0) {
      const topName = churnRisk.highRisk[0]?.name || "Unknown";
      riskCandidates.push({ priority: highCount * 10, text: `${highCount} high-value customers at churn risk — ${topName} most urgent (${churnRisk.highRisk[0]?.daysSinceVisit || "?"}d since last visit)` });
    }
  }

  // Anomalies
  if (anomalies) {
    const spikes = (anomalies as any).spikes || (anomalies as any).anomalies || [];
    if (Array.isArray(spikes) && spikes.length > 0) {
      alertCandidates.push({ priority: 30, text: `${spikes.length} revenue anomalies detected — investigate unusual patterns` });
    }
  }

  // Customer velocity opportunity
  if (custVelocity) {
    const monthlyNew = (custVelocity as any).thisMonth || (custVelocity as any).newThisMonth || 0;
    const lastMonth = (custVelocity as any).lastMonth || (custVelocity as any).newLastMonth || 0;
    if (monthlyNew > lastMonth && lastMonth > 0) {
      opportunityCandidates.push({ priority: 20, text: `New customer velocity up: ${monthlyNew} this month vs ${lastMonth} last month` });
    }
    if (monthlyNew < lastMonth * 0.7 && lastMonth > 3) {
      riskCandidates.push({ priority: 25, text: `New customer acquisition slowing: ${monthlyNew} vs ${lastMonth} last month` });
    }
  }

  // Review velocity
  if (reviewVel) {
    const rate = (reviewVel as any).weeklyRate || 0;
    if (rate === 0) {
      riskCandidates.push({ priority: 15, text: "Zero new reviews this week — reputation stalling" });
    }
    if (rate >= 5) {
      opportunityCandidates.push({ priority: 15, text: `Strong review velocity: ${rate} reviews this week — momentum building` });
    }
  }

  // Lead response time
  if (leadResp) {
    const avgMins = (leadResp as any).averageMinutes || (leadResp as any).avgResponseMinutes || 0;
    if (avgMins > 60) {
      alertCandidates.push({ priority: 40, text: `Lead response averaging ${Math.round(avgMins)} minutes — competitors respond in <15` });
    }
  }

  // Capacity
  if (capacity) {
    const util = (capacity as any).currentUtilization || (capacity as any).utilization || 0;
    if (util > 90) {
      alertCandidates.push({ priority: 35, text: `Bay capacity at ${util}% — consider extending hours or adding capacity` });
    }
    if (util < 40) {
      opportunityCandidates.push({ priority: 25, text: `Bay utilization only ${util}% — room to take more walk-ins or run a flash promo` });
    }
  }

  // Referral network
  if (referralNet) {
    const totalRefs = (referralNet as any).totalReferrals || (referralNet as any).count || 0;
    if (totalRefs > 5) {
      opportunityCandidates.push({ priority: 10, text: `Referral network active: ${totalRefs} referrals tracked — amplify with a bonus offer` });
    }
  }

  // Sort by priority and pick #1
  alertCandidates.sort((a, b) => b.priority - a.priority);
  opportunityCandidates.sort((a, b) => b.priority - a.priority);
  riskCandidates.sort((a, b) => b.priority - a.priority);

  const topAlert = alertCandidates[0]?.text || "No critical alerts — systems nominal";
  const topOpportunity = opportunityCandidates[0]?.text || "No standout opportunities detected this cycle";
  const topRisk = riskCandidates[0]?.text || "No elevated risks detected";

  // Log failures for debugging
  const failures = results.filter(r => r.status === "rejected");
  if (failures.length > 0) {
    log.warn(`Master report: ${failures.length}/${results.length} engines failed`, {
      errors: failures.map(f => (f as PromiseRejectedResult).reason?.message || String((f as PromiseRejectedResult).reason)).slice(0, 5),
    });
  }

  return {
    timestamp: new Date().toISOString(),
    revenue: { pacing, anomalies, cashFlow, margins, ticketTrend },
    customers: { churnRisk, riskScores, valueTrend, repeatPrediction: repeatPred, velocity: custVelocity, concentration },
    operations: { techEfficiency: techEff, turnaround, bayUtilization: bayUtil, capacity, partsCost },
    marketing: { channelROI, reviewVelocity: reviewVel, smsEngagement: smsEng, leadResponse: leadResp, contentPerformance: contentPerf },
    growth: { newCustomerVelocity: custVelocity, referralNetwork: referralNet, portfolioLTV, marketShare, seasonalDemand: seasonal },
    competitive: { competitorGap: compGap, chatFunnel, reviewSentiment: reviewSent },
    summary: { topAlert, topOpportunity, topRisk, score },
  };
}
