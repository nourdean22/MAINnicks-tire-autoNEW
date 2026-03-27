/**
 * Router barrel — re-exports all feature routers.
 */
export { bookingRouter } from "./booking";
export { callbackRouter } from "./callback";
export { leadRouter } from "./lead";
export { chatRouter } from "./chat";
export { contentRouter, contentAdminRouter } from "./content";
export { adminDashboardRouter, analyticsRouter, followUpsRouter, weeklyReportRouter, callTrackingRouter, exportRouter } from "./admin";
export { weatherRouter, reviewsRouter, instagramRouter, searchRouter, diagnoseRouter, laborEstimateRouter } from "./public";
export {
  couponsRouter,
  garageRouter,
  referralsRouter,
  qaRouter,
  customerNotificationsRouter,
  pricingRouter,
  inspectionRouter,
  loyaltyRouter,
  smsRouter,
} from "./services";
export { reviewRequestsRouter } from "./reviewRequests";
export { remindersRouter } from "./reminders";
export { smsConversationsRouter } from "./smsConversations";
export { smsBotRouter } from "./smsBot";
export { reviewRepliesRouter } from "./reviewReplies";
export { shareCardsRouter } from "./shareCards";
export { galleryRouter } from "./gallery";
export { techniciansRouter } from "./technicians";
export { customersRouter } from "./customers";
export { winbackRouter } from "./winback";
export { shopdriverRouter } from "./shopdriver";
export { jobAssignmentsRouter, invoicesRouter, kpiRouter, portalRouter } from "./advanced";
export { gatewayTireRouter } from "./gatewayTire";
export { autoLaborRouter } from "./autoLabor";
export { campaignsRouter } from "./campaigns";
export { costEstimatorRouter } from "./costEstimator";
export { emergencyRouter } from "./emergency";
export { messengerBotRouter } from "./messengerBot";
export { financingRouter } from "./financing";

// ─── Phase 2 New Routers ─────────────────────────
export { estimatesRouter } from "./estimates";
export { serviceMatcherRouter } from "./serviceMatcher";
export { shopStatusRouter } from "./shopStatus";
export { segmentsRouter } from "./segments";
export { specialsRouter } from "./specials";
export { workOrdersRouter } from "./workOrders";
export { inventoryRouter } from "./inventoryRouter";
export { warrantiesRouter } from "./warrantiesRouter";
export { waitlistRouter } from "./waitlistRouter";
export { fleetRouter } from "./fleetRouter";
export { nourOsQuoteRouter } from "./nourOsQuote";
export { nourOsBridgeRouter } from "./nourOsBridge";
