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
    try {
      const [hotLeads] = await d.execute(
        rawSql`SELECT id, name, phone, urgencyScore, source FROM leads WHERE status = 'new' AND urgencyScore >= 3 ORDER BY urgencyScore DESC, createdAt ASC LIMIT 10`
      );
      for (const l of hotLeads as any[]) {
        actions.push({
          type: "hot_lead",
          message: `Call ${l.name || "Unknown"} \u2014 hot lead (${l.urgencyScore}/5 urgency, ${l.source || "direct"})`,
          urgency: Math.min(5, l.urgencyScore + 1),
          actionUrl: "/admin?tab=leads",
          phone: l.phone || null,
        });
      }
    } catch {}

    // 2. Pending invoices > 7 days old
    try {
      const [pendingInvoices] = await d.execute(
        rawSql`SELECT id, customerName, customerPhone, totalAmount, invoiceDate FROM invoices WHERE paymentStatus = 'pending' AND invoiceDate < DATE_SUB(NOW(), INTERVAL 7 DAY) ORDER BY totalAmount DESC LIMIT 8`
      );
      for (const inv of pendingInvoices as any[]) {
        const amt = Math.round(Number(inv.totalAmount || 0) / 100);
        actions.push({
          type: "pending_invoice",
          message: `Follow up on $${amt.toLocaleString()} invoice for ${inv.customerName || "Unknown"}`,
          urgency: amt > 500 ? 4 : 3,
          actionUrl: "/admin?tab=invoices",
          phone: inv.customerPhone || null,
        });
      }
    } catch {}

    // 3. Callbacks unanswered > 2 hours
    try {
      const [callbacks] = await d.execute(
        rawSql`SELECT id, name, phone, context, createdAt FROM callback_requests WHERE status = 'new' AND createdAt < DATE_SUB(NOW(), INTERVAL 2 HOUR) ORDER BY createdAt ASC LIMIT 8`
      );
      for (const cb of callbacks as any[]) {
        const hoursAgo = Math.round((Date.now() - new Date(cb.createdAt).getTime()) / 3600000);
        actions.push({
          type: "callback",
          message: `Call back ${cb.name || "Unknown"} \u2014 waiting ${hoursAgo}h`,
          urgency: hoursAgo > 8 ? 5 : hoursAgo > 4 ? 4 : 3,
          actionUrl: "/admin?tab=callbacks",
          phone: cb.phone || null,
        });
      }
    } catch {}

    // 4. VIP customers going cold (3+ visits, 60+ days since last visit)
    try {
      const [vipCold] = await d.execute(
        rawSql`SELECT id, firstName, lastName, phone, totalVisits, lastVisitDate, DATEDIFF(NOW(), lastVisitDate) as daysSince FROM customers WHERE totalVisits >= 3 AND lastVisitDate < DATE_SUB(NOW(), INTERVAL 60 DAY) AND lastVisitDate IS NOT NULL ORDER BY totalVisits DESC, lastVisitDate ASC LIMIT 8`
      );
      for (const c of vipCold as any[]) {
        const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
        actions.push({
          type: "vip_winback",
          message: `Re-engage ${name} \u2014 VIP (${c.totalVisits} visits), ${c.daysSince}d since last visit`,
          urgency: c.daysSince > 180 ? 4 : 3,
          actionUrl: "/admin?tab=customers",
          phone: c.phone || null,
        });
      }
    } catch {}

    // Sort by urgency desc, take top 8
    actions.sort((a, b) => b.urgency - a.urgency);
    return { actions: actions.slice(0, 8) };
  }),

  // ── Shop Load (real-time) ──
  shopLoad: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { sql: rawSql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { activeWOs: 0, todayBookings: 0, estimatedWait: 0 };
    const [woRows] = await d.execute(rawSql`SELECT COUNT(*) as cnt FROM work_orders WHERE status IN ('in_progress', 'approved', 'waiting_parts', 'quality_check')`);
    const [bkRows] = await d.execute(rawSql`SELECT COUNT(*) as cnt FROM bookings WHERE createdAt >= CURDATE() AND status IN ('new', 'confirmed')`);
    const activeWOs = Number((woRows as any)?.[0]?.cnt || 0);
    const todayBookings = Number((bkRows as any)?.[0]?.cnt || 0);
    return { activeWOs, todayBookings, estimatedWait: activeWOs === 0 ? 0 : Math.min(180, activeWOs * 45) };
  }),
});
