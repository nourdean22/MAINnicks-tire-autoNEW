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
