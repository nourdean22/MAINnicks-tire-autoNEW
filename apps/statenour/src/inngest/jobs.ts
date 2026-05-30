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
 * Post-fix: arrays live here · both consumers import them.
 *
 * Adding a new cron:
 *   1. Add it to the right array below with a 1-line annotation
 *   2. Verify it appears in BOTH legacy (/api/cron/mega) and Inngest
 *      (megaFanoutMorning/Evening) without any further edits
 *
 * Retiring a cron:
 *   1. Remove from the array below  ← this step was skipped in Wave AE
 *   2. Then the route file may be deleted
 *
 * 2026-05-30 CLEANUP · Wave AE (2026-05-28) DELETED ~51 cron route
 * files (107→35 prune) but never removed their references from these
 * arrays. The mega fan-out fetched each dead `/api/cron/<x>` → 404 →
 * dispatchChild threw → `Promise.all` rejected → the WHOLE fan-out run
 * failed, starving every surviving job that hadn't completed yet. Net
 * effect: only ~16 of ~50 crons fired for 2 days (morning fan-out was
 * nearly dead). Confirmed against CronJobLog + filesystem. These arrays
 * now contain ONLY routes that exist on disk. The fan-out was ALSO
 * hardened to Promise.allSettled so a future deleted route can never
 * again starve the rest. `pnpm check:crons` now ALSO validates jobs.ts ↔
 * filesystem (steps 5-6 of scripts/verify-crons.ts) — a dead ref here fails
 * the gate before it can ship.
 */

/**
 * Morning fan-out · 9:00 UTC (5am ET) daily.
 * Lighter set · prepares the operator's morning brief data + health
 * digests + the day's outbound surfaces.
 */
export const MORNING_JOBS: readonly string[] = [
  "/api/cron/stale-tasks",
  "/api/cron/journal-checkin?slot=morning",
  "/api/cron/embed-backfill",
  // 2026-05-29 · data-source canary · probes the nickstire bridge +
  // service feeders so /system/health can flag a dead bridge / $0 feeder.
  "/api/cron/data-source-health",
  "/api/cron/task-resurface",
  "/api/cron/ingest-drive",
  // 2026-05-30 · re-wired · Wave AE kept gmail + calendar as "active"
  // survivors in the manifest but never added them to this fan-out, so
  // email + calendar ingestion into the brain silently died (gmail dead
  // 7d, calendar 22d). Operator re-enabled. NOTE: ingest-gmail's manifest
  // cadence is every 30min (timely email nudges); via the morning fan-out
  // it runs 1×/day — give it a dedicated Inngest 30min trigger if
  // timeliness matters.
  "/api/cron/ingest-calendar",
  "/api/cron/ingest-gmail",
];

/**
 * Evening fan-out · 03:00 UTC (10pm ET previous day) daily.
 * Heavier set · post-day reflection + intelligence + maintenance.
 */
export const EVENING_JOBS: readonly string[] = [
  "/api/cron/predict",
  "/api/cron/consolidate",
  "/api/cron/daily-report",
  "/api/cron/data-cleanup",
  "/api/cron/journal-checkin?slot=evening",
  "/api/cron/intelligence",
  "/api/cron/brain-intelligence",
  "/api/cron/embed-backfill",
  "/api/cron/correlation-alarm",
  "/api/cron/creation-spike-detect",
  "/api/cron/conversation-mission-link",
  "/api/cron/cost-slo-check",
  "/api/cron/os-snapshot",
  "/api/cron/anticipate",
  // 2026-05-30 · mastery leveling engine · attributes the day's
  // unstructured signals (chat/captures/decisions) → stat XP. Idempotent;
  // first run backfills history, then only new signals each night.
  "/api/cron/mastery-xp",
];

/**
 * Weekly fan-out · appended to EVENING_JOBS when the run falls on
 * Sunday-ET (per `if (slot === 'evening' && isSundayET)` branch in
 * both legacy + Inngest dispatchers).
 */
export const WEEKLY_JOBS: readonly string[] = [
  "/api/cron/weekly-digest",
  "/api/cron/weekly-review",
  "/api/cron/inbox-janitor",
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
