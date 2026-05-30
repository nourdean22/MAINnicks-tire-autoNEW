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
export {
  journalConvergenceScan,
  journalThreadDormancy,
} from "./journal-convergence";
