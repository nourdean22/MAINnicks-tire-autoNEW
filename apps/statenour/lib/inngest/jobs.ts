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
  // 2026-07-22 · change-detection-lite external-change sensor (competitor
  // pricing / regulatory pages -> page_snapshots). Observe-only; daily is plenty.
  "/api/cron/change-detection",
  "/api/cron/journal-checkin?slot=morning",
  "/api/cron/embed-backfill",
  // 2026-05-29 · data-source canary · probes the nickstire bridge +
  // service feeders so /system/health can flag a dead bridge / $0 feeder.
  "/api/cron/data-source-health",
  // 2026-08-01 · Ollama Cloud model canary. That provider retires models
  // with no warning (two lost on this key) and a retired id 410s forever.
  // Probes what resolveProviderModel actually returns, so a stale env pin
  // is caught — the registry alone looked healthy for the six weeks the
  // vision lane was dead in prod.
  "/api/cron/ollama-model-liveness",
  "/api/cron/task-resurface",
  "/api/cron/ingest-drive",
  // 2026-05-30 · re-wired · Wave AE kept gmail + calendar as "active"
  // survivors in the manifest but never added them to this fan-out, so
  // email + calendar ingestion into the brain silently died (gmail dead
  // 7d, calendar 22d). Operator re-enabled. 2026-05-30 · operator DECIDED
  // 1×/day is enough ("i only need one a day on google") — do NOT add a
  // dedicated 30min trigger; the manifest's 30min cadence is aspirational,
  // not required. This closes the ingest-gmail-cadence flag.
  "/api/cron/ingest-calendar",
  "/api/cron/ingest-gmail",
  // 2026-08-03 · ingest-reviews joins the same daily slot. Its writer
  // (fetchAndStoreReviews) had NO caller at all, so BrainMemory
  // google_review rows were frozen at whatever last wrote them while
  // getReviewStats kept serving them to Nick as current.
  "/api/cron/ingest-reviews",
  // 2026-06-02 · operator-authorized activation of two parked daily
  // relationship/brain crons that had impls + route.ts but were never
  // wired to any trigger (manifest mode:"dormant"). Both are daily by
  // intent and idempotent-per-day, so the daily MORNING slot matches
  // their cadence exactly:
  //   · relationship-birthday (intended 0 12 * * *) — dedups per
  //     personId+ISO-date+kind via BrainMemory, so firing in the 9:00
  //     UTC morning slot instead of noon UTC changes nothing but the
  //     push hour (still same-day).
  //   · kept-word-scan (intended 0 2 * * *) — scans the last 24h chat
  //     and upserts per (personId, chatMessageId); a daily run is the
  //     correct cadence regardless of which daily slot it lands in.
  "/api/cron/relationship-birthday",
  "/api/cron/kept-word-scan",
  // 2026-06-02 · operator-authorized · the 2 Monday-only brain crons.
  // The fan-out has no native Monday gate, so each route SELF-GATES on
  // `getUTCDay() === 1` and no-ops the other 6 days (short-circuits
  // before any DB/AI). Net: their intended weekly-Monday cadence, via
  // the daily fan-out, WITHOUT the 7x AI spend that blind daily firing
  // would cause. Idempotency + per-week guards live in each route.
  "/api/cron/dossier-autodraft",
  "/api/cron/greene-law-tag-refresh",
  // 2026-06-02 · v-truth · Nick Action Queue (NICK_AUTONOMY-gated). The
  // proposer + executor HARD-SKIP when the flag is off, so these are
  // inert while the flag is off.
  //
  // ⚠⚠ 2026-09-17 - TWO CORRECTIONS, BOTH MEASURED. This comment described a
  // system that no longer matches production, on a path adjacent to customer
  // contact, which is the worst place for stale documentation to sit.
  //
  // 1. NOT INERT. NICK_AUTONOMY reads `true` in Railway production (checked
  //    2026-09-17). The operator opted in; "inert until the operator opts in"
  //    invited a reader to treat this trio as dead code. It is live.
  //
  // 2. "fan-out runs array order" IS NOT TRUE. The dispatcher is
  //    `Promise.allSettled(MORNING_JOBS.map(...))` in mega-fanout.ts - every
  //    child starts concurrently, and array position controls only the order
  //    dispatch is INITIATED, never the order work completes. Nothing here
  //    sequences prewarm -> proposal -> execute.
  //
  // ★ THE ORDERING IS REAL, BUT IT IS NOT ENFORCED HERE. What actually
  //   separates proposal from execute is the APPROVAL GATE: execute selects
  //   `approval = 'approved'` only, and approval is a human action that takes
  //   far longer than a fan-out slot. So execute structurally cannot act on
  //   the rows this same run proposed - they are still pending. The safety
  //   property holds; the mechanism named above was simply the wrong one, and
  //   adding sequencing machinery to re-create a guarantee the approval gate
  //   already provides would be complexity with no invariant behind it.
  //
  // ⚠ UNVERIFIED, left as a question rather than a claim: whether
  //   nick-action-proposal actually consumes relationship-picks-prewarm's
  //   output. If it does, concurrent dispatch means proposal can read a cold
  //   pick - a QUALITY degradation, not a safety one. Prove the data
  //   dependency before building anything to fix it.
  //
  // What each does: prewarm warms the outreach pick, proposal writes pending
  // rows + Telegrams a /qa list, execute runs only operator-APPROVED rows
  // (send_sms_outreach drafts, never sends).
  "/api/cron/relationship-picks-prewarm",
  "/api/cron/nick-action-proposal",
  "/api/cron/nick-action-execute",
];

/**
 * Evening fan-out · 03:00 UTC (10pm ET previous day) daily.
 * Heavier set · post-day reflection + intelligence + maintenance.
 */
export const EVENING_JOBS: readonly string[] = [
  "/api/cron/predict",
  "/api/cron/consolidate",
  // 2026-09-10 · the missing PRODUCER for the Revenue-Decision Channel.
  // lib/services/revenue-decision-channel.ts was a complete engine with
  // three live consumers and nothing writing the rows they read: the
  // getPendingRevenueMoves chat tool returned empty forever and the
  // Telegram approval callback could never fire. Costs one model call
  // and one Telegram to the operator per day; idempotent per ET date, so
  // a duplicate fan-out skips rather than paying twice.
  "/api/cron/revenue-decision",
  // 2026-07-22 · closed-loop Experiment resolver — resolves DUE experiments
  // (accepted opportunities past their horizon) + nudges source authScore. Daily is plenty.
  "/api/cron/experiment-measure",
  "/api/cron/data-cleanup",
  // 2026-07-25 · durable-outbox drain — replays post-turn work orphaned
  // by a mid-turn crash (rare; rows past the grace window, ≤5 attempts
  // since WP-8 dead-lettering, 2026-07-29).
  "/api/cron/outbox-drain",
  // 2026-07-29 · Wave-8 · operator-decided loss-aversion decay: stats
  // idle past 7 days bleed XP via negative event rows (reversible,
  // idempotent per stat per day).
  "/api/cron/xp-decay",
  "/api/cron/subtask-usage-audit",
  "/api/cron/cron-healer",
  "/api/cron/journal-checkin?slot=evening",
  "/api/cron/intelligence",
  "/api/cron/brain-intelligence",
  "/api/cron/calibration-generator",
  "/api/cron/embed-backfill",
  "/api/cron/correlation-alarm",
  "/api/cron/creation-spike-detect",
  "/api/cron/conversation-mission-link",
  "/api/cron/cost-slo-check",
  "/api/cron/os-snapshot",
  "/api/cron/anticipate",
  // 2026-07-11 · resurrected. Deleted in the Wave-AE prune (2026-05-28)
  // and never re-wired — the 8-axis identity snapshot froze at the last
  // manual refresh, and the pulse ticker/nudges served week-old axes
  // ("social battery 20") as current. Nightly roll matches the axes'
  // 14-30d data windows.
  "/api/cron/refresh-identity",
  // 2026-08-06 · resurrected, same story as refresh-identity above. Deleted in
  // the Wave-AE prune (2026-05-28) and never re-wired, which killed the whole
  // session-distill lane: `chat_summary` stopped at 34 rows, and
  // `nick_current_concerns` was never written AT ALL (0 rows in prod) because
  // its only writer sits downstream of distillConversation. Two live readers
  // were left waiting on it — the /chat "concerns" context block (which fired
  // 0 times in 1,128 measured turns) and fireAfternoonPush, which degrades to
  // silence rather than erroring, so nothing surfaced the gap.
  // Was every-30-min via vercel.json; nightly is ample at this conversation
  // volume since every eligibility rule is "since last distill".
  "/api/cron/distill-sessions",
  // 2026-08-19 · memory-loop wave · the conversation compiler's
  // tail-catcher (staleness-based recompile + merge-ground revival).
  "/api/cron/conversation-compile",
  // 2026-05-30 · mastery leveling engine · attributes the day's
  // unstructured signals (chat/captures/decisions) → stat XP. Idempotent;
  // first run backfills history, then only new signals each night.
  "/api/cron/mastery-xp",
  // 2026-08-13 · BDN-202 · drafts tool-description rewrites from failure
  // telemetry (≤3 tools/run, fast lane, idempotent per description
  // fingerprint). Drafts only — a human applies them in code.
  "/api/cron/tool-description-rewrite",
  // 2026-08-19 · Brain truth pass · resurrected, same severed-joint story
  // as refresh-identity and distill-sessions above: runSemanticLinker
  // shipped 2026-05-02 and never got a caller — semantic_edges froze at
  // 114 rows on 2026-05-28 (measured in prod), so the brain graph's
  // memory-to-memory "related" edges have been fossils ever since.
  // Idempotent, bounded (batch 25 · top-3 neighbors · pgvector KNN).
  "/api/cron/semantic-link",
  // 2026-06-02 · v-truth · Nick autonomy resurrection (NICK_AUTONOMY-gated).
  // Re-plugs runAutonomousActions (~22 proactive rules) which lost its cron
  // route in the Wave-AE prune. The route HARD-SKIPS when NICK_AUTONOMY is
  // off, so it's inert until the operator flips the env flag on Railway.
  // The engine is now FAIL-CLOSED (autonomous-engine.ts): every rule defers
  // to /system/actions unless an explicit `auto` policy exists — nothing
  // auto-sends. One evening pass matches the rules' ET-hour/24h-cooldown gates.
  "/api/cron/autonomous-engine",
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
  // 2026-08-19 · outcome-loop follow-up · the corpus odometer — the
  // automated reader of outcomeUseful (counts correction-shaped labels,
  // upserts the rolling eval_run row, flags the 200-correction trigger).
  "/api/cron/outcome-harvest",
  // 2026-06-02 · operator-authorized activation of a parked Sunday-night
  // relationship synthesis cron (impl + route.ts existed, but it was
  // never wired → manifest mode:"dormant"). Its intended schedule is
  // 0 23 * * 0 (Sunday) — which maps EXACTLY to this WEEKLY_JOBS append,
  // since the evening fan-out appends WEEKLY_JOBS only on Sunday-ET. It
  // is idempotent per ISO week (already-written week skips silently), so
  // the slot shift (Sunday 23:00 UTC → Sunday-ET evening fan-out at
  // 03:00 UTC) is harmless — still the same ISO week.
  "/api/cron/relationship-weekly-synthesis",
  // 2026-06-03 · v-truth · weekly brain-category reflection (Sunday 3am ->
  // Sunday-ET weekly fan-out). Hosts the NICK_REFLECTION_TREES higher-order
  // synthesis (which self-gates on the flag); the category reflections it
  // also writes are an operator-facing built feature that was dormant.
  "/api/cron/reflect-categories",
  // 2026-07-09 · AG-19 · weekly pricing advisory. composeAdvisory() (win-rate
  // outliers → competitor prices → drafted experiments) had zero callers
  // since it shipped; its chat tool / API / coach-banner read surfaces
  // returned empty forever. Idempotent per run-date (BrainMemory upsert).
  "/api/cron/pricing-advisory",
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
