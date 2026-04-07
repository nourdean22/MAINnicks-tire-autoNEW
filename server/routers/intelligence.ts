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

  // ── Full Report ──
  fullReport: adminProcedure.query(async () => {
    return generateFullIntelligenceReport();
  }),
});
