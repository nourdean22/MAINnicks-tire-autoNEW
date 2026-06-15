/**
 * Inngest function registry · Wave-200 Phase 3 (2026-05-17)
 *
 * Every function exported here is mounted by the serve endpoint at
 * `/api/inngest`. Add new functions by exporting them here · the
 * serve endpoint picks them up automatically.
 *
 * See: src/inngest/client.ts · app/api/inngest/route.ts
 */

export { megaFanoutMorning, megaFanoutEvening } from "./mega-fanout";
// 2026-05-30 · out-of-band liveness watchdog for the fan-out (the canary
// that was missing when the fan-out went ~70% dead for 2 days).
export { cronHeartbeat } from "./cron-heartbeat";
export { operatorMorningBrief } from "./morning-brief";
export { customerPreferencesRecompute } from "./customer-preferences";
export { bulkSmsApproval } from "./bulk-sms-approval";
export { goalPruner } from "./goal-pruner";
export { goalDriftDetector } from "./goal-drift-detector";
export {
  journalConvergenceScan,
  journalThreadDormancy,
} from "./journal-convergence";
// 2026-05-31 · revived feeder (was deleted in Wave AE; starved recallIndustryIntel).
export { industryPull } from "./industry-pull";
// 2026-06-03 · v-truth · event-driven proactivity (NICK_EVENT_TRIGGERS · fail-closed)
export { nickEventTriggers } from "./event-triggers";
// Gap 1: proactive-push cron runner
export { proactivePushCron } from "./proactive-push";
