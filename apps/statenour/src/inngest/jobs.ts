/**
 * Mega-cron child job lists · single source of truth
 * (Wave-200 Phase 7+ follow-up · 2026-05-17)
 *
 * Pre-fix: MORNING_JOBS / EVENING_JOBS / WEEKLY_JOBS arrays were
 * DUPLICATED across `apps/statenour/app/api/cron/mega/route.ts`
 * (legacy fan-out) and `apps/statenour/src/inngest/functions/mega-fanout.ts`
 * (Inngest re-implementation). A new cron added in one place silently
 * dropped from the other · drift was inevitable during the cutover
 * window.
 *
 * Post-fix: arrays live here · both consumers import them. The
 * `mode` field on each entry lets future surfaces (cron health
 * dashboard · diagnostics) reason about which slot a given cron
 * runs in.
 *
 * Adding a new cron:
 *   1. Add it to the right array below with a 1-line annotation
 *   2. Verify it appears in BOTH legacy (/api/cron/mega) and Inngest
 *      (megaFanoutMorning/Evening) without any further edits
 *
 * Retiring a cron:
 *   1. Remove from the array below
 *   2. Leave the route file in place until the next sweep · the
 *      retirement is "no longer fired" not "deleted from disk"
 */

/**
 * Morning fan-out · 9:00 UTC (5am ET) daily.
 * Lighter set · prepares the operator's morning brief data + health
 * digests + the day's outbound surfaces.
 */
export const MORNING_JOBS: readonly string[] = [
  "/api/cron/learn",
  "/api/cron/stale-tasks",
  "/api/cron/brain-cycle",
  "/api/cron/journal-checkin?slot=morning",
  "/api/cron/embed-backfill",
  "/api/cron/health-digest",
  "/api/cron/cost-regression",
  "/api/cron/schema-drift-watch",
  "/api/cron/knowledge-sync",
  "/api/cron/prediction-streaks",
  "/api/cron/canary-chat",
  "/api/cron/morning-brief",
  "/api/cron/revenue-decision",
  "/api/cron/decision-replay",
  "/api/cron/persona-drift",
  "/api/cron/orphan-task-nudge",
  "/api/cron/task-resurface",
  "/api/cron/refresh-identity",
  "/api/cron/auto-linker",
  "/api/cron/backlog-triage",
  "/api/cron/ingest-drive",
  "/api/cron/token-age-watch",
];

/**
 * Evening fan-out · 03:00 UTC (10pm ET previous day) daily.
 * Heavier set · post-day reflection + intelligence + maintenance.
 */
export const EVENING_JOBS: readonly string[] = [
  "/api/cron/reflect",
  "/api/cron/predict",
  "/api/cron/think",
  "/api/cron/consolidate",
  "/api/cron/drift-check",
  "/api/cron/daily-report",
  "/api/cron/data-cleanup",
  "/api/cron/journal-checkin?slot=evening",
  "/api/cron/intelligence",
  "/api/cron/brain-intelligence",
  "/api/cron/embed-backfill",
  "/api/cron/chat-message-backfill",
  "/api/cron/image-rot-scan",
  "/api/cron/semantic-dedup",
  "/api/cron/pgvector-backfill",
  "/api/cron/auto-calibrate",
  "/api/cron/correlation-alarm",
  "/api/cron/mastery-decay",
  "/api/cron/pattern-cluster",
  "/api/cron/storage-quota-watch",
  "/api/cron/audit-retention",
  "/api/cron/creation-spike-detect",
  "/api/cron/update-spike-detect",
  "/api/cron/brain-bus-probe",
  "/api/cron/stale-conversation-archive",
  "/api/cron/conversation-mission-link",
  "/api/cron/embed-cleanup",
  "/api/cron/brain-bus-consume",
  "/api/cron/agent-eval",
  "/api/cron/extract-knowledge",
  "/api/cron/brain-feedback-loop",
  "/api/cron/eval-regression",
  "/api/cron/cost-slo-check",
  "/api/cron/vapi-latency-sync",
  "/api/cron/os-snapshot",
  "/api/cron/anticipate",
  "/api/cron/monthly-location-rank",
  "/api/cron/semantic-link",
  // Phase X (2026-05-18 PM) · auto-corpus-builder for the AGENT_V1
  // → AGENT_V2 prompt-builder migration · samples N fresh prompts ·
  // replays each through V1 + V2 builders · judges + persists ·
  // closes the last Phase 0 checkbox so canary can unblock.
  "/api/cron/judge-eval-shadow",
];

/**
 * Weekly fan-out · appended to EVENING_JOBS when the run falls on
 * Sunday-ET (per `if (slot === 'evening' && isSundayET)` branch in
 * both legacy + Inngest dispatchers).
 */
export const WEEKLY_JOBS: readonly string[] = [
  "/api/cron/weekly-digest",
  "/api/cron/weekly-review",
  "/api/cron/memory-bloat-watch",
  "/api/cron/voice-clone-train",
  "/api/cron/inbox-janitor",
  "/api/cron/preference-tune",
  "/api/cron/pricing-advisor",
  "/api/cron/extract-skills",
  "/api/cron/pin-hygiene",
];

/**
 * All jobs across all slots · used by diagnostics + tests.
 */
export const ALL_MEGA_JOBS: readonly string[] = [
  ...MORNING_JOBS,
  ...EVENING_JOBS,
  ...WEEKLY_JOBS,
];

/**
 * Counts surfaced via /api/health (Wave-200 Phase 7+ follow-up).
 */
export const MEGA_JOB_COUNTS = {
  morning: MORNING_JOBS.length,
  evening: EVENING_JOBS.length,
  weekly: WEEKLY_JOBS.length,
  total: ALL_MEGA_JOBS.length,
} as const;
