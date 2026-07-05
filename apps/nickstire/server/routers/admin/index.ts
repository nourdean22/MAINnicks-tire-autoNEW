/**
 * Admin routers — barrel.
 *
 * 2026-07-04 maintainability split: admin.ts was 1,976 lines holding 7
 * separately-exported routers (the separation of concerns existed
 * conceptually but not at the filesystem level — the merge-conflict
 * magnet flagged in the admin maintainability review). Each router now
 * lives in its own file; this barrel preserves the historical
 * `./admin` import path so routers/index.ts (the one consumer) and any
 * future import keeps working unchanged. Pure mechanical move — no
 * procedure was modified.
 */
export { adminDashboardRouter } from "./dashboard";
export { analyticsRouter } from "./analytics";
export { followUpsRouter } from "./followUps";
export { weeklyReportRouter } from "./weeklyReport";
export { callTrackingRouter } from "./callTracking";
export { customerEventsRouter } from "./customerEvents";
export { exportRouter } from "./export";
