/**
 * Intelligence Router — exposes all 5 engines + 6 data analyzers to admin dashboard
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  forecastRevenue,
  generateCrossSellRecommendations,
  scoreLeads,
  trackCampaignAttribution,
  predictCustomerLTV,
  analyzeChatDemand,
  analyzeCallAttribution,
  analyzeFleet,
  analyzeGeography,
  analyzeBottlenecks,
  analyzeDeclinedWork,
  analyzeUnmatchedAlgEstimates,
  generateFullIntelligenceReport,
  forecastSeasonalDemand,
  analyzeGeographicRevenue,
  analyzeServiceBundles,
  predictChurn,
} from "../services/intelligenceEngines";
import { generateMasterIntelligenceReport } from "../services/masterIntelligence";
import {
  predictRepeatVisits,
  analyzeCustomerValueTrend,
  buildServiceAffinityMap,
  analyzeFirstVisitConversion,
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
  predictNoShows,
  analyzePeakDemandWindows,
  forecastCashFlow,
  estimateMarketShare,
  analyzeProfitMargins,
  analyzePaymentTrends,
  analyzeTicketTrend,
  analyzeRevenueConcentration,
  analyzeChatFunnel,
  analyzeReviewSentiment,
  analyzeWebsiteJourneys,
  analyzeCallPatterns,
  analyzeNewCustomerVelocity,
  analyzeReferralNetwork,
  forecastPortfolioLTV,
} from "../services/advancedEngines";

import { createLogger } from "../lib/logger";
import { safeCount, safeRowQuery } from "../lib/sql-safe";

const log = createLogger("routers:intelligence");
export const intelligenceRouter = router({
  // ── Core Engines ──

  /** #1 Revenue Forecasting — today/week/month projections vs $20K target */
  forecast: adminProcedure.query(async () => {
    return forecastRevenue();
  }),

  /** #2 Service Cross-Sell — "customers who got X also needed Y" */
  crossSell: adminProcedure.query(async () => {
    return generateCrossSellRecommendations();
  }),

  /** #3 Dynamic Lead Scoring — re-score all open leads */
  scoreLeads: adminProcedure.mutation(async () => {
    const scored = await scoreLeads();
    return { count: scored.length, topLeads: scored.slice(0, 10) };
  }),

  /** #4 Campaign Attribution — SMS/review → booking tracking */
  attribution: adminProcedure.query(async () => {
    return trackCampaignAttribution();
  }),

  /** #5 Customer LTV Prediction */
  ltv: adminProcedure.query(async () => {
    return predictCustomerLTV();
  }),

  // ── Data Analyzers ──

  chatDemand: adminProcedure.query(async () => analyzeChatDemand()),
  callAttribution: adminProcedure.query(async () => analyzeCallAttribution()),
  fleet: adminProcedure.query(async () => analyzeFleet()),
  geography: adminProcedure.query(async () => analyzeGeography()),
  bottlenecks: adminProcedure.query(async () => analyzeBottlenecks()),
  declinedWork: adminProcedure.query(async () => analyzeDeclinedWork()),
  /**
   * Walk-away ALG estimates — whole quotes that never converted to invoice.
   * Different signal than declinedWork (which is per-line items inside an
   * accepted invoice). This surfaces customers who walked away entirely.
   * Returns 0s gracefully when alg_estimates is empty.
   */
  walkAwayEstimates: adminProcedure.query(async () => analyzeUnmatchedAlgEstimates()),

  // ── New Intelligence Engines ──

  /** #6 Seasonal Demand Forecasting — which services peak this month */
  seasonalDemand: adminProcedure.query(async () => {
    return forecastSeasonalDemand();
  }),

  /** #7 Geographic Revenue Intelligence — revenue by zip code */
  geoRevenue: adminProcedure.query(async () => {
    return analyzeGeographicRevenue();
  }),

  /** #8 Service Bundling Intelligence — frequently paired services */
  serviceBundles: adminProcedure.query(async () => {
    return analyzeServiceBundles();
  }),

  /** #9 Churn Prediction — identify at-risk customers before they leave */
  churnPrediction: adminProcedure.query(async () => {
    return predictChurn();
  }),

  // ── Full Report ──
  fullReport: adminProcedure.query(async () => {
    return generateFullIntelligenceReport();
  }),

  // ── Busy Hours Heat Map (own data, not Google) ──
  busyHours: adminProcedure.query(async () => {
    const { analyzeCustomers } = await import("../services/customerIntelligence");
    const data = await analyzeCustomers();
    return {
      peakHours: data.peakHours,
      dayOfWeekPattern: data.dayOfWeekPattern,
      bestDropOffTimes: ["8:00 AM - 10:00 AM (best for same-day)", "Early afternoon (ready by next morning)"],
    };
  }),

  // ── Advanced Intelligence Engines (19-34) ──

  /** #19 Repeat Visit Predictor */
  repeatVisit: adminProcedure.query(async () => predictRepeatVisits()),

  /** #20 Customer Value Trend */
  valueTrend: adminProcedure.query(async () => analyzeCustomerValueTrend()),

  /** #21 Service Affinity Map */
  serviceAffinity: adminProcedure.query(async () => buildServiceAffinityMap()),

  /** #22 First Visit Conversion */
  firstVisitConversion: adminProcedure.query(async () => analyzeFirstVisitConversion()),

  /** #23 Customer Risk Score */
  riskScores: adminProcedure.query(async () => computeCustomerRiskScores()),

  /** #24 Tech Efficiency */
  techEfficiency: adminProcedure.query(async () => analyzeTechEfficiency()),

  /** #25 Bay Utilization */
  bayUtilization: adminProcedure.query(async () => analyzeBayUtilization()),

  /** #26 Turnaround Time */
  turnaroundTime: adminProcedure.query(async () => analyzeTurnaroundTime()),

  /** #27 Parts Cost Optimizer */
  partsCost: adminProcedure.query(async () => analyzePartsCostRatio()),

  /** #28 Capacity Forecaster */
  capacityForecast: adminProcedure.query(async () => forecastCapacity()),

  /** #29 Channel ROI */
  channelROI: adminProcedure.query(async () => analyzeChannelROI()),

  /** #30 Review Velocity */
  reviewVelocity: adminProcedure.query(async () => analyzeReviewVelocity()),

  /** #31 SMS Engagement */
  smsEngagement: adminProcedure.query(async () => analyzeSmsEngagement()),

  /** #32 Lead Response Time */
  leadResponseTime: adminProcedure.query(async () => analyzeLeadResponseTime()),

  /** #33 Content Performance */
  contentPerformance: adminProcedure.query(async () => analyzeContentPerformance()),

  /** #34 Competitor Gap Analysis */
  competitorGap: adminProcedure.query(async () => analyzeCompetitorGap()),

  // ── Advanced Intelligence Engines (35-50) ──

  /** #35 Revenue Anomaly Detector */
  revenueAnomaly: adminProcedure.query(async () => detectRevenueAnomalies()),

  /** #36 No-Show Predictor */
  noShowPredictor: adminProcedure.query(async () => predictNoShows()),

  /** #37 Peak Demand Windows */
  peakDemand: adminProcedure.query(async () => analyzePeakDemandWindows()),

  /** #38 Cash Flow Forecast */
  cashFlow: adminProcedure.query(async () => forecastCashFlow()),

  /** #39 Market Share Estimator */
  marketShare: adminProcedure.query(async () => estimateMarketShare()),

  /** #40 Profit Margin Analysis */
  profitMargins: adminProcedure.query(async () => analyzeProfitMargins()),

  /** #41 Payment Method Trends */
  paymentTrends: adminProcedure.query(async () => analyzePaymentTrends()),

  /** #42 Average Ticket Trend */
  ticketTrend: adminProcedure.query(async () => analyzeTicketTrend()),

  /** #43 Revenue Concentration */
  revenueConcentration: adminProcedure.query(async () => analyzeRevenueConcentration()),

  /** #44 Chat Conversion Funnel */
  chatFunnel: adminProcedure.query(async () => analyzeChatFunnel()),

  /** #45 Review Sentiment Breakdown */
  reviewSentiment: adminProcedure.query(async () => analyzeReviewSentiment()),

  /** #46 Website Journey Analysis */
  websiteJourneys: adminProcedure.query(async () => analyzeWebsiteJourneys()),

  /** #47 Call Pattern Analysis */
  callPatterns: adminProcedure.query(async () => analyzeCallPatterns()),

  /** #48 New Customer Velocity */
  customerVelocity: adminProcedure.query(async () => analyzeNewCustomerVelocity()),

  /** #49 Referral Network Map */
  referralNetwork: adminProcedure.query(async () => analyzeReferralNetwork()),

  /** #50 Lifetime Value Forecast */
  portfolioLTV: adminProcedure.query(async () => forecastPortfolioLTV()),

  /** Master Intelligence Report — unified digest across all 50 engines */
  masterReport: adminProcedure.query(async () => {
    return generateMasterIntelligenceReport();
  }),

  // ── Safety & Risk Monitor ──
  /** Full safety check — financial, reputation, operational, data, compliance */
  safetyCheck: adminProcedure.query(async () => {
    const { runFullSafetyCheck } = await import("../services/safetyMonitor");
    return runFullSafetyCheck();
  }),

  // ── Next Best Actions — prioritized operator queue ──
  nextBestActions: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { sql: rawSql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { actions: [] };

    type Action = {
      type: "hot_lead" | "pending_invoice" | "callback" | "vip_winback";
      message: string;
      urgency: number;
      actionUrl: string;
      phone: string | null;
    };

    const actions: Action[] = [];

    // 1. Hot leads — new leads with urgency >= 3
    type HotLead = { id: number; name: string | null; phone: string | null; urgencyScore: number; source: string | null };
    const hotLeads = await safeRowQuery<HotLead>(d,
      rawSql`SELECT id, name, phone, urgencyScore, source FROM leads WHERE status = 'new' AND urgencyScore >= 3 ORDER BY urgencyScore DESC, createdAt ASC LIMIT 10`
    );
    for (const l of hotLeads) {
      actions.push({
        type: "hot_lead",
        message: `Call ${l.name || "Unknown"} \u2014 hot lead (${l.urgencyScore}/5 urgency, ${l.source || "direct"})`,
        urgency: Math.min(5, l.urgencyScore + 1),
        actionUrl: "/admin?tab=leads",
        phone: l.phone || null,
      });
    }

    // 2. Pending invoices > 7 days old
    // Wave-97 fix: filter out HTML-scraped Estimate# rows that leaked
    // into the invoices table — those are NOT pending invoices, they
    // are declined estimates and live in alg_estimates.
    type PendingInvoice = { id: number; customerName: string | null; customerPhone: string | null; totalAmount: number; invoiceDate: string | Date };
    const pendingInvoices = await safeRowQuery<PendingInvoice>(d,
      rawSql`SELECT id, customerName, customerPhone, totalAmount, invoiceDate FROM invoices WHERE paymentStatus = 'pending' AND invoiceNumber NOT LIKE 'Estimate#%' AND invoiceDate < DATE_SUB(NOW(), INTERVAL 7 DAY) ORDER BY totalAmount DESC LIMIT 8`
    );
    for (const inv of pendingInvoices) {
      const amt = Math.round(Number(inv.totalAmount || 0) / 100);
      actions.push({
        type: "pending_invoice",
        message: `Follow up on $${amt.toLocaleString()} invoice for ${inv.customerName || "Unknown"}`,
        urgency: amt > 500 ? 4 : 3,
        // wave-110 — was "invoices" (no such tab/alias → blank screen).
        // Canonical home for invoice work is the Revenue & Shop page.
        actionUrl: "/admin?tab=revenue",
        phone: inv.customerPhone || null,
      });
    }

    // 3. Callbacks unanswered > 2 hours
    type Callback = { id: number; name: string | null; phone: string | null; context: string | null; createdAt: string | Date };
    const callbacks = await safeRowQuery<Callback>(d,
      rawSql`SELECT id, name, phone, context, createdAt FROM callback_requests WHERE status = 'new' AND createdAt < DATE_SUB(NOW(), INTERVAL 2 HOUR) ORDER BY createdAt ASC LIMIT 8`
    );
    for (const cb of callbacks) {
      const hoursAgo = Math.round((Date.now() - new Date(cb.createdAt).getTime()) / 3600000);
      actions.push({
        type: "callback",
        message: `Call back ${cb.name || "Unknown"} \u2014 waiting ${hoursAgo}h`,
        urgency: hoursAgo > 8 ? 5 : hoursAgo > 4 ? 4 : 3,
        actionUrl: "/admin?tab=callbacks",
        phone: cb.phone || null,
      });
    }

    // 4. VIP customers going cold (3+ visits, 60+ days since last visit)
    type VipCustomer = { id: number; firstName: string | null; lastName: string | null; phone: string | null; totalVisits: number; lastVisitDate: string | Date | null; daysSince: number };
    const vipCold = await safeRowQuery<VipCustomer>(d,
      rawSql`SELECT id, firstName, lastName, phone, totalVisits, lastVisitDate, DATEDIFF(NOW(), lastVisitDate) as daysSince FROM customers WHERE totalVisits >= 3 AND lastVisitDate < DATE_SUB(NOW(), INTERVAL 60 DAY) AND lastVisitDate IS NOT NULL ORDER BY totalVisits DESC, lastVisitDate ASC LIMIT 8`
    );
    for (const c of vipCold) {
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
      actions.push({
        type: "vip_winback",
        message: `Re-engage ${name} \u2014 VIP (${c.totalVisits} visits), ${c.daysSince}d since last visit`,
        urgency: c.daysSince > 180 ? 4 : 3,
        actionUrl: "/admin?tab=customers",
        phone: c.phone || null,
      });
    }

    // Sort by urgency desc, take top 8
    actions.sort((a, b) => b.urgency - a.urgency);
    return { actions: actions.slice(0, 8) };
  }),

  // ── Shop Load (real-time) ──
  //
  // "Cars in Shop" = work orders that are ACTUALLY being worked on right
  // now. Two filters protect against phantom counts:
  //
  //  1. Status: only `in_progress`, `waiting_parts`, `quality_check` count.
  //     `approved` was previously included but it's a QUOTE-stage status —
  //     a quote can sit in `approved` for weeks without the car ever being
  //     in the shop. Including it produced phantoms (e.g. WO-2026-105165
  //     was "approved" for 18 days with no vehicle info, never started).
  //
  //  2. Freshness: ignore anything whose updated_at is older than 7 days.
  //     A WO that hasn't been touched in a week is dead, not active.
  //     If a job genuinely takes a week+, the tech updates it.
  shopLoad: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { sql: rawSql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { activeWOs: 0, todayBookings: 0, estimatedWait: 0 };
    const activeWOs = await safeCount(d, rawSql`
      SELECT COUNT(*) as cnt FROM work_orders
      WHERE status IN ('in_progress', 'waiting_parts', 'quality_check')
        AND COALESCE(updated_at, created_at) >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    const todayBookings = await safeCount(d,
      rawSql`SELECT COUNT(*) as cnt FROM bookings WHERE createdAt >= CURDATE() AND status IN ('new', 'confirmed')`
    );
    return { activeWOs, todayBookings, estimatedWait: activeWOs === 0 ? 0 : Math.min(180, activeWOs * 45) };
  }),

  // ── Autonicks brain proxy ──
  // Closes admin audit §10. The intelligence tabs (NourOsBrainCard,
  // WeatherImpactCard) used to do raw cross-origin fetch() to
  // statenour-os.vercel.app from the browser. Three problems:
  //   1. CORS surface — admin browser talks directly to autonicks
  //   2. No retries, no timeout, no observability when it fails
  //   3. Bypasses the standard tRPC error envelope used everywhere else
  //
  // These two procedures proxy the same data through the nickstire
  // backend. The browser only ever talks to its own origin.
  autonicksBrainStatus: adminProcedure.query(async () => {
    try {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch("https://statenour-os.vercel.app/api/brain/status", { signal: ctrl.signal });
      clearTimeout(timeoutId);
      if (!r.ok) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- statenour brain endpoint returns dynamic JSON; consumers in OverviewTab destructure varied keys (memories / automationRules / etc)
      const data: any = await r.json();
      return data?.data ?? data;
    } catch (err) {
      log.warn(`autonicksBrainStatus failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }),
  autonicksWeather: adminProcedure.query(async () => {
    try {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch("https://statenour-os.vercel.app/api/weather", { signal: ctrl.signal });
      clearTimeout(timeoutId);
      if (!r.ok) return null;
      return await r.json();
    } catch (err) {
      log.warn(`autonicksWeather failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }),
});
