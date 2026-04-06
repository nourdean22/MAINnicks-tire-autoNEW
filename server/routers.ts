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
  fleetRouter,
  inventoryRouter,
  nourOsQuoteRouter,
  segmentsRouter,
  serviceMatcherRouter,
  shopStatusRouter,
  specialsRouter,
  waitlistRouter,
  warrantiesRouter,
  pipelinesRouter,
  nickActionsRouter,
  paymentsRouter,
  featureFlagsRouter,
} from "./routers/index";

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
  search: searchRouter,
  diagnose: diagnoseRouter,
  laborEstimate: laborEstimateRouter,
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
  fleet: fleetRouter,
  inventory: inventoryRouter,
  segments: segmentsRouter,
  serviceMatcher: serviceMatcherRouter,
  shopStatus: shopStatusRouter,
  specials: specialsRouter,
  waitlist: waitlistRouter,
  warranties: warrantiesRouter,

  // NOUR OS Quote Bridge
  nourOsQuote: nourOsQuoteRouter,

  // Data Pipelines (GBP Reviews, GSC)
  pipelines: pipelinesRouter,

  // Nick AI Agent Actions (quotes, work orders, follow-ups, competitor intel)
  nickActions: nickActionsRouter,
  payments: paymentsRouter,

  // Feature Flags (admin toggle)
  featureFlags: featureFlagsRouter,
});

export type AppRouter = typeof appRouter;
