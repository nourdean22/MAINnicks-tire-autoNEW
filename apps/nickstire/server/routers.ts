import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  bookingRouter,
  callbackRouter,
  leadRouter,
  chatRouter,
  contentRouter,
  contentAdminRouter,
  adminDashboardRouter,
  adminSecurityRouter,
  weatherRouter,
  reviewsRouter,
  instagramRouter,
  diagnoseRouter,
  laborEstimateRouter,
  activityRouter,
  serviceReviewsRouter,
  couponsRouter,
  garageRouter,
  referralsRouter,
  qaRouter,
  customerNotificationsRouter,
  pricingRouter,
  inspectionRouter,
  loyaltyRouter,
  smsRouter,
  reviewRequestsRouter,
  remindersRouter,
  smsConversationsRouter,
  reviewRepliesRouter,
  localGrowthRouter,
  shareCardsRouter,
  lotRouter,
  customersRouter,
  winbackRouter,
  shopdriverRouter,
  invoicesRouter,
  portalRouter,
  gatewayTireRouter,
  fitmentRouter,
  gatewayOrderRouter,
  kafeneRouter,
  tireQuoteRouter,
  autoLaborRouter,
  campaignsRouter,
  callTrackingRouter,
  customerEventsRouter,
  aiReferralsRouter,
  marketAdminRouter,
  costEstimatorRouter,
  emergencyRouter,
  financingRouter,
  nourOsBridgeRouter,
  workOrdersRouter,
  dispatchRouter,
  controlCenterRouter,
  estimatesRouter,
  shopStatusRouter,
  specialsRouter,
  nickActionsRouter,
  paymentsRouter,
  featureFlagsRouter,
  intelligenceRouter,
  snapRouter,
  trafficFunnelRouter,
  seoToolsRouter,
  conversionRouter,
  experimentsRouter,
  smsPerformanceRouter,
  instagramAdminRouter,
  gbpRouter,
  smsOrchestratorRouter,
  socialPipelineRouter,
  metaAdsArchitectRouter,
} from "./routers/index";
import { voiceAgentRouter } from "./routers/voiceAgent";
import { vapiRouter } from "./routers/vapi";
import { revenueOpsRouter } from "./routers/revenueOps";
import { revenueAttributionRouter } from "./routers/revenueAttribution";
import { statenourMetricsRouter } from "./routers/statenourMetrics";
import { instagramStudioRouter } from "./routers/instagramStudio";
import { shopMediaRouter } from "./routers/shopMedia";
import { closedLoopRouter } from "./routers/closedLoop";
import { vehicleDataRouter } from "./routers/vehicleData";
import { membershipsRouter } from "./routers/memberships";
import { adStudioRouter } from "./routers/adStudio";
import { opportunityQueueRouter } from "./routers/opportunityQueue";
import { promisesRouter } from "./routers/promises";
import { proposalsRouter } from "./routers/proposals";
import { smsOpsRouter } from "./routers/smsOps";
import { technicianReferralsRouter } from "./routers/technicianReferrals";
import { candidatesRouter } from "./routers/candidates";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  weather: weatherRouter,
  reviews: reviewsRouter,
  instagram: instagramRouter,
  instagramAdmin: instagramAdminRouter,
  instagramStudio: instagramStudioRouter,
  shopMedia: shopMediaRouter,
  adStudio: adStudioRouter,
  diagnose: diagnoseRouter,
  laborEstimate: laborEstimateRouter,
  activity: activityRouter,
  serviceReviews: serviceReviewsRouter,
  voiceAgent: voiceAgentRouter,
  vapi: vapiRouter,
  revenueOps: revenueOpsRouter,
  revenueAttribution: revenueAttributionRouter,
  opportunityQueue: opportunityQueueRouter,
  promises: promisesRouter,
  proposals: proposalsRouter,
  smsOps: smsOpsRouter,
  statenourMetrics: statenourMetricsRouter,
  /** 2026-09-08 · Search Console + master report, moved here from StateNour /market. */
  market: marketAdminRouter,
  costEstimator: costEstimatorRouter,
  content: contentRouter,

  booking: bookingRouter,
  callback: callbackRouter,
  lead: leadRouter,
  chat: chatRouter,
  coupons: couponsRouter,
  garage: garageRouter,
  referrals: referralsRouter,
  technicianReferrals: technicianReferralsRouter,
  candidates: candidatesRouter,
  qa: qaRouter,
  pricing: pricingRouter,
  inspection: inspectionRouter,
  loyalty: loyaltyRouter,

  adminDashboard: adminDashboardRouter,
  adminSecurity: adminSecurityRouter,
  contentAdmin: contentAdminRouter,
  customerNotifications: customerNotificationsRouter,
  sms: smsRouter,
  reviewRequests: reviewRequestsRouter,
  reminders: remindersRouter,
  smsConversations: smsConversationsRouter,
  reviewReplies: reviewRepliesRouter,
  localGrowth: localGrowthRouter,
  gbp: gbpRouter,
  smsOrchestrator: smsOrchestratorRouter,
  shareCards: shareCardsRouter,
  lot: lotRouter,
  customers: customersRouter,
  winback: winbackRouter,
  shopdriver: shopdriverRouter,

  invoices: invoicesRouter,
  portal: portalRouter,

  callTracking: callTrackingRouter,
  customerEvents: customerEventsRouter,
  /** 2026-10-21 · staff log of AI-assistant referrals + 30-day counts (admin only). */
  aiReferrals: aiReferralsRouter,
  campaigns: campaignsRouter,
  gatewayTire: gatewayTireRouter,
  /** 2026-10-18 · public vehicle tire finder (D&K quicksearch via the Gateway Tire login). */
  fitment: fitmentRouter,
  /** 2026-10-18 · admin D&K supplier order for a paid tire order; writes need GATEWAY_ORDERING_ENABLED=true. */
  gatewayOrder: gatewayOrderRouter,
  /** 2026-10-18 · Kafene lease checkout (public) + activate/cancel (admin); off until KAFENE_* env is set. */
  kafene: kafeneRouter,
  /** 2026-10-18 · "Text me this quote" on the /tires top-pick cards (public; one customer text per quote). */
  tireQuote: tireQuoteRouter,
  autoLabor: autoLaborRouter,
  emergency: emergencyRouter,
  financing: financingRouter,
  nourOsBridge: nourOsBridgeRouter,
  workOrders: workOrdersRouter,
  dispatch: dispatchRouter,
  controlCenter: controlCenterRouter,
  estimates: estimatesRouter,
  shopStatus: shopStatusRouter,
  specials: specialsRouter,
  nickActions: nickActionsRouter,
  payments: paymentsRouter,
  featureFlags: featureFlagsRouter,
  memberships: membershipsRouter,
  intelligence: intelligenceRouter,
  snap: snapRouter,
  trafficFunnel: trafficFunnelRouter,
  conversion: conversionRouter,
  experiments: experimentsRouter,
  seoTools: seoToolsRouter,
  smsPerformance: smsPerformanceRouter,
  closedLoop: closedLoopRouter,
  socialPipeline: socialPipelineRouter,
  metaAdsArchitect: metaAdsArchitectRouter,
  // WP-23 · NHTSA read-only vehicle enrichment (VIN decode + recalls)
  vehicleData: vehicleDataRouter,
});

export type AppRouter = typeof appRouter;
