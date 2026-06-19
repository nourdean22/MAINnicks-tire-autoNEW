import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

// Feature routers
import {
  bookingRouter,
  callbackRouter,
  leadRouter,
  chatRouter,
  contentRouter,
  contentAdminRouter,
  adminDashboardRouter,
  analyticsRouter,
  followUpsRouter,
  weeklyReportRouter,
  weatherRouter,
  reviewsRouter,
  instagramRouter,
  searchRouter,
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
  smsBotRouter,
  reviewRepliesRouter,
  localGrowthRouter,
  shareCardsRouter,
  galleryRouter,
  techniciansRouter,
  customersRouter,
  winbackRouter,
  shopdriverRouter,
  jobAssignmentsRouter,
  invoicesRouter,
  kpiRouter,
  portalRouter,
  gatewayTireRouter,
  autoLaborRouter,
  campaignsRouter,
  callTrackingRouter,
  customerEventsRouter,
  exportRouter,
  costEstimatorRouter,
  emergencyRouter,
  messengerBotRouter,
  financingRouter,
  nourOsBridgeRouter,
  workOrdersRouter,
  dispatchRouter,
  controlCenterRouter,
  estimatesRouter,
  nourOsQuoteRouter,
  segmentsRouter,
  serviceMatcherRouter,
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
  smsPerformanceRouter,
  instagramAdminRouter,
} from "./routers/index";
import { voiceAgentRouter } from "./routers/voiceAgent";
import { vapiRouter } from "./routers/vapi";
import { closedLoopRouter } from "./routers/closedLoop";
import { membershipsRouter } from "./routers/memberships";
import { adStudioRouter } from "./routers/adStudio";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Public data
  weather: weatherRouter,
  reviews: reviewsRouter,
  instagram: instagramRouter,
  // Admin Instagram console — connection, feed, analytics, comment
  // moderation, AI co-pilot. Owner-gated wrapper over existing IG services.
  instagramAdmin: instagramAdminRouter,
  // Self-serve graphic-design IG ad generator (copy + server render + post/schedule)
  adStudio: adStudioRouter,
  search: searchRouter,
  diagnose: diagnoseRouter,
  laborEstimate: laborEstimateRouter,
  activity: activityRouter,
  serviceReviews: serviceReviewsRouter,
  // 2026-05-05 — Vapi voice receptionist tool endpoints + admin
  voiceAgent: voiceAgentRouter,
  vapi: vapiRouter,
  costEstimator: costEstimatorRouter,
  content: contentRouter,

  // Customer-facing features
  booking: bookingRouter,
  callback: callbackRouter,
  lead: leadRouter,
  chat: chatRouter,
  coupons: couponsRouter,
  garage: garageRouter,
  referrals: referralsRouter,
  qa: qaRouter,
  pricing: pricingRouter,
  inspection: inspectionRouter,
  loyalty: loyaltyRouter,

  // Admin features
  adminDashboard: adminDashboardRouter,
  contentAdmin: contentAdminRouter,
  analytics: analyticsRouter,
  customerNotifications: customerNotificationsRouter,
  followUps: followUpsRouter,
  weeklyReport: weeklyReportRouter,
  sms: smsRouter,
  reviewRequests: reviewRequestsRouter,
  reminders: remindersRouter,
  smsConversations: smsConversationsRouter,
  smsBot: smsBotRouter,
  reviewReplies: reviewRepliesRouter,
  localGrowth: localGrowthRouter,
  shareCards: shareCardsRouter,
  gallery: galleryRouter,
  technicians: techniciansRouter,
  customers: customersRouter,
  winback: winbackRouter,
  shopdriver: shopdriverRouter,

  // Advanced features
  jobAssignments: jobAssignmentsRouter,
  invoices: invoicesRouter,
  kpi: kpiRouter,
  portal: portalRouter,

  // Attribution & Export
  callTracking: callTrackingRouter,
  customerEvents: customerEventsRouter,
  export: exportRouter,

  // SMS Campaigns
  campaigns: campaignsRouter,

  // Business Integrations
  gatewayTire: gatewayTireRouter,
  autoLabor: autoLaborRouter,

  // Phase 5 Features
  emergency: emergencyRouter,
  messengerBot: messengerBotRouter,

  // Financing
  financing: financingRouter,

  // NOUR OS Bridge
  nourOsBridge: nourOsBridgeRouter,

  // Work Orders
  workOrders: workOrdersRouter,

  // Dispatch + QC + Customer Messaging
  dispatch: dispatchRouter,

  // Operations & Inventory
  controlCenter: controlCenterRouter,
  estimates: estimatesRouter,
  segments: segmentsRouter,
  serviceMatcher: serviceMatcherRouter,
  shopStatus: shopStatusRouter,
  specials: specialsRouter,

  // NOUR OS Quote Bridge
  nourOsQuote: nourOsQuoteRouter,



  // Nick AI Agent Actions (quotes, work orders, follow-ups, competitor intel)
  nickActions: nickActionsRouter,
  payments: paymentsRouter,

  // Feature Flags (admin toggle)
  featureFlags: featureFlagsRouter,

  // Nonstop Nick membership — public signup + admin counter-lookup
  memberships: membershipsRouter,

  // Intelligence Engines (forecast, cross-sell, lead scoring, attribution, LTV, data analyzers)
  intelligence: intelligenceRouter,



  // Snap Finance lease-to-own applications (submit + list + summary).
  snap: snapRouter,

  // Traffic → Revenue funnel diagnostic. Single-screen overview of every
  // stage from Google impressions to paid invoices, with conversion math
  // + leak alerts. See server/routers/trafficFunnel.ts.
  trafficFunnel: trafficFunnelRouter,

  // Public-facing live data for the conversion-architecture components
  // (LiveVisitorCounter, FomoTicker, UrgencyWidget, etc.). Pulls real
  // session/booking/invoice data with aggressive caching. Per the
  // conversion-overhaul spec, NEVER fakes numbers — components decide
  // whether to render based on whether real data is persuasive.
  conversion: conversionRouter,

  // SEO tooling — sitemap submission to Google Search Console.
  // Wraps scripts/gsc-submit-sitemap.ts as tRPC mutations so admin
  // can trigger from the UI without SSH-ing into Railway.
  seoTools: seoToolsRouter,

  // wave-181.51 — SMS Performance read-out (reply + conversion attribution
  // per outbound send, rolled up per tier). Powers the /admin Outreach Hub
  // → Performance tab. See server/routers/smsPerformance.ts.
  smsPerformance: smsPerformanceRouter,

  // wave-181.x · Today page Phase 4 · surface daily wave-metric
  // measurements ("did the work we shipped move the needle"). Reads
  // wave_metrics table populated by the closedLoopMeasure daily cron.
  // See server/routers/closedLoop.ts.
  closedLoop: closedLoopRouter,
});

export type AppRouter = typeof appRouter;
