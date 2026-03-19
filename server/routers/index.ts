/**
 * Router barrel — re-exports all feature routers.
 */
export { bookingRouter } from "./booking";
export { callbackRouter } from "./callback";
export { leadRouter } from "./lead";
export { chatRouter } from "./chat";
export { contentRouter, contentAdminRouter } from "./content";
export { adminDashboardRouter, analyticsRouter, followUpsRouter, weeklyReportRouter } from "./admin";
export { weatherRouter, reviewsRouter, instagramRouter, searchRouter, diagnoseRouter } from "./public";
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
