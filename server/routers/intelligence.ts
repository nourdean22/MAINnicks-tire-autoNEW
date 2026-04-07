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
} from "../services/intelligenceEngines";

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
