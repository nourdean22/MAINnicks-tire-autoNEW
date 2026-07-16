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
// Durable-fanout wave (audit 2026-07-15) · journal capture fan-out
// (enrich + embed + thread-join) as durable steps (event:
// journal/entry.captured) — was fire-and-forget inside the capture
// request, not guaranteed to run on serverless.
export { journalFanout } from "./journal-fanout";
// 2026-05-31 · revived feeder (was deleted in Wave AE; starved recallIndustryIntel).
export { industryPull } from "./industry-pull";
// 2026-06-03 · v-truth · event-driven proactivity (NICK_EVENT_TRIGGERS · fail-closed)
export { nickEventTriggers } from "./event-triggers";
// Gap 1: proactive-push cron runner
export { proactivePushCron } from "./proactive-push";

// Cockpit Upgrade durable workflows
export { diagnoseCronFailure } from "./diagnose-cron-failure";
export { auditTodaysLeads } from "./audit-todays-leads";

// Consolidated Stack workflows
export { crmFollowups } from "./crm-followups";

// Intelligence OS workflows
export { intelligenceDailyBrief, intelligenceWeeklyBrief } from "./intelligence-brief";

export { socialPublishQueue } from "./social-publish";

// Approval sweeper
export { approvalSweeper } from "./approval-sweeper";

// AG-34 · on-demand deep research with async delivery (event:
// research/on-demand · fired by the queueDeepResearch chat tool and
// the Telegram /research command)
export { researchOnDemand } from "./deep-research";


// AG-41 · execute Nick actions the moment /qa approves them (event:
// nick-action/approved) · the daily 9am cron stays as backstop
export { nickActionApproved } from "./nick-action-approved";

// AG-44 · weekly publish→performance rollup (Meta Graph insights →
// sourceMetadata.performance + BrainMemory content_winners → the
// ghostwriter's RECENT WINNERS block)
export { contentPerformanceWeekly } from "./content-performance";
