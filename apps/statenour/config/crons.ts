/**
 * Cron manifest — single source of truth for every scheduled job.
 *
 * statenour deploys on Railway (not Vercel) — there is no `vercel.json`.
 * Scheduled jobs run through the mega fan-out + the Inngest evening
 * job list (`src/inngest/jobs.ts`). `pnpm check:crons` validates this
 * manifest against the filesystem (every entry has a route, no dark
 * routes) — it no longer generates a `vercel.json` crons block.
 *
 * Philosophy:
 *   · `mode: "active"` — runs on its own `schedule`, visible on /system/crons
 *   · `mode: "folded"` — coded but intentionally NOT on a standalone
 *     schedule because it runs inside another cron (e.g. consolidate
 *     runs inside mega?slot=evening). Used by /system/crons to show
 *     ancestry.
 *   · `mode: "retired"` — route still exists but scheduled to be
 *     deleted. Warning surfaced.
 *
 * Schedule syntax is standard cron in UTC. Comments on each line
 * document the intent.
 */

export type CronMode = "active" | "folded" | "retired";
export type CronCategory =
  | "ingest"     // pull from external sources (Gmail, Calendar, Drive)
  | "brain"      // memory + learning + identity
  | "hygiene"    // retention, health checks, reaping
  | "signals"    // detect + surface anomalies
  | "review"     // recurring human-facing ritual (daily, weekly)
  | "compose"    // assembles aggregate reports (mega)
  | "device"     // device bridge
  | "alert";     // fires notifications

export interface CronDef {
  name: string;
  schedule: string | null;       // cron expression, null when folded/retired
  mode: CronMode;
  category: CronCategory;
  description: string;
  memory?: number;               // MB, defaults to 512
  maxDuration?: number;          // seconds, defaults to 60
  foldedInto?: string;           // when mode === "folded"
  retireAfter?: string;          // YYYY-MM-DD, when mode === "retired"
  path?: string;                 // override; defaults to `/api/cron/${name}`
  /**
   * YYYY-MM-DD when this cron was first declared. Drives the
   * silence-detector grace window: a never-fired cron is given grace
   * until 1.5x its cadence has elapsed since `addedAt`. New weekly
   * crons (e.g. decision-quality-drift, added 2026-04-29) shouldn't
   * be flagged silent on the first day they ship — they haven't
   * had their first scheduled fire yet. Backfill optional: crons
   * without `addedAt` fall back to oldest-log-row as the floor.
   */
  addedAt?: string;
}

export const CRONS: CronDef[] = [
  // ── COMPOSE ─────────────────────────────────────────────────────────
  {
    name: "mega",
    path: "/api/cron/mega?slot=morning",
    schedule: "0 9 * * *",         // 9am UTC = 5am ET (morning slot)
    mode: "active",
    category: "compose",
    description: "Morning composite — pulse + briefing + daily-report + predict",
    memory: 1024,
    maxDuration: 120,
  },
  {
    name: "mega-evening",
    path: "/api/cron/mega?slot=evening",
    schedule: "0 2 * * *",         // 2am UTC = 10pm ET previous day (evening slot)
    mode: "active",
    category: "compose",
    description: "Evening composite — reflect + consolidate + weekly-digest eligibility",
    memory: 1024,
    maxDuration: 120,
  },

  // ── INGEST ──────────────────────────────────────────────────────────
  {
    name: "ingest-gmail",
    // 2026-05-27 · greedy multi-account redesign · was twice-daily
    // (8am + 8pm UTC) · now every 30min during waking hours (8-22
    // UTC = 4am-6pm ET ≈ operator's day · sleeps 22-08 UTC).
    // Per-cron cost cap holds because the classifier is gpt-4o-mini
    // and the per-account caps keep payloads bounded (max 20 inbound
    // + 30 outgoing per run · ~$0.0006 each).
    schedule: "0,30 8-22 * * *",
    mode: "active",
    category: "ingest",
    description: "Multi-account Gmail pull + AI classify + Telegram nudge on high-urgency needs-reply — every 30min 8-22 UTC",
    memory: 1024,
    maxDuration: 300,
  },
  {
    name: "ingest-calendar",
    schedule: "15 8 * * *",
    mode: "active",
    category: "ingest",
    description: "Calendar pull — 8:15am",
    memory: 512,
    maxDuration: 120,
  },
  {
    name: "ingest-drive",
    schedule: "30 2 * * 0,3",
    mode: "active",
    category: "ingest",
    description: "Drive pull — Sun + Wed 2:30am",
    memory: 1024,
    maxDuration: 300,
  },
  {
    name: "knowledge-sync",
    schedule: null,
    mode: "folded",
    category: "ingest",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning. Drive/Notion/etc. don't change every 6h — daily morning re-sync is the right cadence.",
  },

  // ── BRAIN ───────────────────────────────────────────────────────────
  {
    name: "brain-intelligence",
    // v10.0.529.104 · Wave 48 · folded into mega-evening. Was firing
    // at both 30 2 * * * (standalone) AND inside mega-evening at
    // 0 2 * * * → duplicate LLM calls + DB writes every night within
    // 30 minutes. Verified present in mega CRON_JOBS.evening array.
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "brain",
    description: "Brain intelligence engine pass (nightly) · runs via mega-evening",
    memory: 512,
    maxDuration: 120,
  },
  {
    name: "brain-cycle",
    // May 02 · staggered off 0 */3 to avoid stacking with think + watcher
    // which all fired on the hour mark. Trio is now 0/15/45 across :00.
    schedule: "15 */3 * * *",
    mode: "active",
    category: "brain",
    description: "Continuous brain maintenance — decay + memory-manager",
    memory: 512,
    maxDuration: 60,
  },
  {
    name: "embed-backfill",
    schedule: "30 * * * *",
    mode: "active",
    category: "brain",
    description: "Vector embedding backfill — top-of-hour",
  },
  {
    name: "distill-sessions",
    schedule: "30 */3 * * *",
    mode: "active",
    category: "brain",
    description: "Fold idle chat sessions into distilled summaries",
  },
  {
    name: "extract-skills",
    schedule: "0 3 * * 0",
    mode: "active",
    category: "brain",
    description: "Weekly skill harvest from DONE tasks",
  },
  {
    name: "refresh-identity",
    schedule: "30 4 * * *",
    mode: "active",
    category: "brain",
    description: "Roll Nour's 8-axis self-model forward (history:YYYY-MM-DD row)",
  },
  {
    name: "auto-calibrate",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Belief recalibration is nightly housekeeping — runs as part of the evening brain-hygiene block.",
  },
  {
    name: "auto-linker",
    schedule: "0 4 * * *",
    mode: "active",
    category: "brain",
    description: "Link brain memories by relation + embedding proximity",
  },
  {
    name: "conversation-mission-link",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description: "Auto-link archived chat conversations to missions by embedding similarity",
    maxDuration: 120,
    addedAt: "2026-05-04",
  },
  {
    name: "consolidate",
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "brain",
    description: "Memory consolidation (sleep model) — runs inside evening mega slot",
  },
  {
    name: "embed-cleanup",
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "brain",
    description: "v10.0.192 · drop orphan vector_embeddings rows where the source brain_memory/chat_message/etc was soft-deleted or archived. Initial backfill cleared 5655 of 8158 rows (69%); cron prevents re-accumulation.",
  },
  // v10.0.529.79 · Wave 23 · #3 · mastery decay (-0.05/day on inactive axes)
  // Folded into mega-evening · runs at ~10pm ET. Pairs with the
  // auto-learn bump path: bump happens intra-day · decay happens at
  // close. Together they make MasteryScore an honest curve instead of
  // a monotonically-rising lie.
  {
    name: "mastery-decay",
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "brain",
    description:
      "v10.0.529.79 · -0.05 mastery decay per day for axes that received no qualifying DONE work today. Idempotent (skips when auto-learn already wrote today's row). Use-it-or-lose-it model.",
    addedAt: "2026-05-15",
  },
  // v10.0.529.79 · Wave 23 · #2 · weekly pattern clustering
  // Clusters last-7d task_insight rows by metadata.axis · persists as
  // BrainMemory(task_pattern) for the /brain PatternCard.
  {
    name: "pattern-cluster",
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "brain",
    description:
      "v10.0.529.79 · cluster last-7d BrainMemory(task_insight) by metadata.axis. When 3+ insights share an axis, emit task_pattern row for /brain PatternCard. Idempotent (upsert by axis key).",
    addedAt: "2026-05-15",
  },
  // v10.0.529.80 · Wave 24 · #3 · orphan-task-nudge
  // Detects DONE tasks that fired NO auto-learn engine. When 3+ in
  // 24h, upserts a BrainMemory(orphan_tasks_nudge) for /brain to
  // surface "want to tag these?". Folded into mega-morning so the
  // nudge lands with the daily-brief.
  {
    name: "orphan-task-nudge",
    schedule: null,
    mode: "folded",
    foldedInto: "mega",
    category: "brain",
    description:
      "v10.0.529.80 · detects DONE tasks in last 24h that fired ZERO auto-learn engine (no domain, no goal, no learning verb, no tutorial prefix). 3+ orphans = nudge upserted to BrainMemory for /brain surfacing.",
    addedAt: "2026-05-15",
  },
  // v10.0.529.82 · Wave 26 · B1 · task-resurface · closes the snooze
  // broken-promise bug. Flips WAITING → READY for tasks whose
  // snoozedUntil <= now. Folded into mega-morning so snoozed tasks
  // resurface before the operator opens /tasks.
  {
    name: "task-resurface",
    schedule: null,
    mode: "folded",
    foldedInto: "mega",
    category: "review",
    description:
      "v10.0.529.82 · Wave 26 · B1 · flips status WAITING → READY for tasks whose snoozedUntil <= now. Closes the snooze broken-promise bug (UI shipped snooze affordance but tasks never came back). Idempotent: snoozedUntil clear is the lock.",
    addedAt: "2026-05-15",
  },
  // 2026-05-23 OVERDRIVE · subtask-usage-audit · 30-day check-in
  // self-fires on/after 2026-06-22 (migration applied 2026-05-23 PM).
  // Computes parentTaskId usage % and writes the result as a
  // nudge_pin_hygiene row · idempotent · upserts so subsequent runs
  // show fresh stats. Folded into mega-morning · runs daily but
  // gated by an inline date check so pre-window runs are no-ops.
  {
    name: "subtask-usage-audit",
    schedule: null,
    mode: "folded",
    foldedInto: "mega",
    category: "review",
    description:
      "2026-05-23 OVERDRIVE · 30-day check-in on parent_task_id wave (task #22 · ADR-0017 amended A1 gate). On/after 2026-06-22 computes total tasks + tasks-with-parent + usage % and upserts a BrainMemory(nudge_pin_hygiene, subtask_usage_audit_30d) row. Below 5% usage = ADR amendment A1 gate fires = candidate for revert. Idempotent · daily · pre-window runs are date-gated no-ops.",
    addedAt: "2026-05-23",
  },
  {
    name: "learn",
    schedule: null,
    mode: "folded",
    foldedInto: "weekly-review",
    category: "brain",
    description: "Weekly learning pass — same cadence as weekly-review, runs inside it",
  },
  {
    name: "predict",
    // Wave 48 · folded into mega-evening · was double-firing daily
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "brain",
    description: "Bet-desk predictions · runs via mega-evening",
  },
  {
    name: "think",
    // Wave 48 · folded into mega-evening · standalone was firing 8x/day
    // with 4 LLM-backed engines = up to 32 LLM calls/day from one cron.
    // mega-evening runs it once nightly. Cap restoration deferred to a
    // followup wave that verifies which engines actually use LLM calls.
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "brain",
    description: "Contradictions + identity evolution + causal chains + env scan",
    maxDuration: 60,
  },
  {
    name: "reflect",
    // Wave 48 · folded into mega-evening
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "brain",
    description: "Daily reflection engine · runs via mega-evening",
    maxDuration: 60,
  },
  {
    name: "reflect-categories",
    // CoALA per-category synthesis · weekly Sunday 03:00 UTC (Saturday
    // 23:00 ET) so it lands before Sunday-morning weekly-review surfaces
    // the new insights. Scoped to high-signal raw-observation categories
    // (decision_log · pattern · belief · lesson · learning_journal ·
    // task_insight · task_pattern). Each category has its own ≥5-row
    // floor + 24h cooldown inside reflectOnCategory · the cron is a
    // simple iterator. Distinct from `reflect` which writes to the
    // Reflection table; this one writes BrainMemory rows that show up
    // in standard recall.
    schedule: "0 3 * * 0",
    mode: "active",
    category: "brain",
    description: "Per-category CoALA reflection synthesis · weekly Sunday 03:00 UTC",
    maxDuration: 300,
  },
  {
    name: "intelligence",
    schedule: null,
    mode: "folded",
    foldedInto: "brain-intelligence",
    category: "brain",
    description: "Legacy alias — folded into brain-intelligence",
  },

  // ── SIGNALS ─────────────────────────────────────────────────────────
  {
    name: "drift-check",
    // Wave 48 · folded into mega-evening
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "signals",
    description: "Daily drift detection · runs via mega-evening",
  },
  {
    name: "watcher",
    // May 02 · staggered off 0 */3 to round out the every-3hr trio.
    // Final layout: think :00 / brain-cycle :15 / watcher :45.
    schedule: "45 */3 * * *",
    mode: "active",
    category: "signals",
    description: "Anomaly scan every 3h",
  },

  // ── HYGIENE ─────────────────────────────────────────────────────────
  {
    name: "pin-hygiene",
    schedule: "0 6 * * 0",
    mode: "active",
    category: "hygiene",
    description: "Sunday stale-pin review",
  },
  {
    name: "backlog-triage",
    schedule: "0 7 * * *",
    mode: "active",
    category: "hygiene",
    description: "Morning task backlog scrub",
  },
  {
    name: "stale-tasks",
    // Wave 48 · folded into mega-morning
    schedule: null,
    mode: "folded",
    foldedInto: "mega",
    category: "hygiene",
    description: "Flag stale tasks daily · runs via mega-morning",
  },
  {
    name: "data-cleanup",
    // Wave 48 · folded into mega-evening · standalone Sunday 3am
    // overlapped with mega-evening Sunday 2am · two mass-delete passes
    // 60 minutes apart. Now once-per-week via mega-evening Sunday.
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "hygiene",
    description: "Retention policy enforcement · runs via mega-evening · weekly",
    maxDuration: 120,
  },
  {
    name: "data-source-health",
    schedule: "0 */6 * * *",       // v10.0.58 · Wave B — 4 ticks per day (00:00, 06:00, 12:00, 18:00 UTC)
    mode: "active",
    category: "hygiene",
    description: "Probe each high-leverage data feeder. Persists per-probe results to BrainMemory category=data_source_probe so /system/diagnostics can render an empty-streak counter — the canary that catches the next ghost-feeder before it lives in production for months.",
  },
  {
    name: "inbox-janitor",
    schedule: null,                // v10.0.155 · folded into mega-evening Sunday slot · weekly hygiene fits the existing weekly run-set without burning a cron budget slot
    mode: "folded",
    category: "hygiene",
    foldedInto: "mega",
    description: "Soft-archive system Inbox missions ('Inbox - business' etc.) that have been empty + cold for 30+ days. Closes the loop on the v10.0.154 active-projects cap fix — stops auto-created inboxes from accumulating forever. Runs inside mega-evening's Sunday slot.",
    memory: 256,
    maxDuration: 60,
    addedAt: "2026-05-03",
  },

  // ── REVIEW ──────────────────────────────────────────────────────────
  {
    name: "weekly-review",
    // Wave 48 · folded into mega-evening weekly batch · standalone
    // 02:00 Sun overlapped exactly with mega-evening Sunday fan-out
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "review",
    description: "Week-in-review note · runs via mega-evening Sunday batch",
  },
  {
    name: "weekly-digest",
    // Wave 48 · folded into mega-evening weekly batch
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "review",
    description: "Weekly digest email · runs via mega-evening Sunday batch",
  },
  {
    name: "weekly-review-nudge",
    // 2026-05-27 · operator-driven · Sunday 22:00 UTC = 6pm ET (during
    // DST · 5pm EST winter). Lifts the Tim Challies "Do More Better"
    // ritual into the operator's actual Sunday phone. The cron does
    // ONE thing: send a Telegram with the open-warnings count + a
    // prompt to open bdnick.info/tasks and tap the headline button
    // to walk the 5-step ReviewWizard. Idempotent per ISO week.
    schedule: "0 22 * * 0",
    mode: "active",
    category: "review",
    description: "Sunday 6pm ET Telegram nudge to open the ReviewWizard",
    maxDuration: 30,
  },
  // ── 2026-05-27 · Power Atlas Phase 1 · Sunday relationship digest ──
  // Greene-voiced weekly digest of cooling/overdue contacts + upcoming
  // birthdays. Sunday 22:00 UTC = 6pm ET (DST) / 5pm EST. Idempotent per
  // ISO week via BrainMemory(category=relationship_digest_sent). One of
  // the only TWO crons that fires sendTelegram from the Power Atlas
  // surface (sibling: relationship-birthday). All other Power Atlas
  // workers compute silently into the DB · operator reads the result
  // on /relationships, not the phone.
  {
    name: "relationship-digest",
    schedule: "0 22 * * 0",
    mode: "active",
    category: "review",
    description:
      "Power Atlas · Sunday Greene-voiced relationship digest · cooling + birthdays-this-week · idempotent per ISO week",
    maxDuration: 60,
    addedAt: "2026-05-27",
  },
  // ── 2026-05-27 · Power Atlas Phase 1 · daily birthday + anniversary ──
  // Daily 12:00 UTC = 8am ET (DST) / 7am EST push for any PersonProfile
  // whose birthday or anniversary MM-DD matches today. One Telegram per
  // match. Idempotent per (personId, ISO date, kind) with 365d TTL.
  {
    name: "relationship-birthday",
    schedule: "0 12 * * *",
    mode: "active",
    category: "review",
    description:
      "Power Atlas · daily birthday + anniversary push · idempotent per personId+date",
    maxDuration: 30,
    addedAt: "2026-05-27",
  },
  // ── 2026-05-27 · Power Atlas Phase 2 · kept-word tracker (silent) ──
  // Daily 02:00 UTC = 9pm ET (prev night). Scans last 24h chat for
  // promises made TO the operator BY named persons. Upserts one row
  // per (personId, chatMessageId) so re-runs are idempotent. Silent ·
  // operator reads the kept-ratio on /relationships, not the phone.
  {
    name: "kept-word-scan",
    schedule: "0 2 * * *",
    mode: "active",
    category: "brain",
    description:
      "Power Atlas · scan last-24h chat for promises made TO operator BY known persons · drives trust-score-from-kept-word",
    maxDuration: 120,
    addedAt: "2026-05-27",
  },
  // ── 2026-05-27 · Power Atlas Phase 2 · behavioral X-ray refresh ──
  // Weekly Monday 05:00 UTC. Re-runs the behavioral X-ray on profiles
  // with new ledger activity since last refresh. Caps 5 profiles/run.
  // Silent · writes to PersonProfile.behavioralFingerprint Json column.
  {
    name: "behavioral-xray-refresh",
    schedule: "0 5 * * 1",
    mode: "active",
    category: "brain",
    description:
      "Power Atlas · weekly behavioral X-ray refresh · ≤5 profiles/run · gpt-4o-mini",
    maxDuration: 300,
    addedAt: "2026-05-27",
  },
  // ── 2026-05-27 · Power Atlas Phase 2 · psychographic ladder refresh ──
  // Weekly Monday 06:00 UTC (1h after behavioral X-ray). Same cap +
  // gating logic. Silent · writes to PersonProfile.psychographicLadder.
  {
    name: "psychographic-ladder-refresh",
    schedule: "0 6 * * 1",
    mode: "active",
    category: "brain",
    description:
      "Power Atlas · weekly psychographic ladder refresh · ≤5 profiles/run · identity/needs/fears/status/values",
    maxDuration: 300,
    addedAt: "2026-05-27",
  },
  // ── 2026-05-27 · Power Atlas Phase 2 · dossier auto-drafter ──
  // Weekly Monday 04:00 UTC = 11pm ET Sunday. Drafts updated dossierMd
  // from chat mentions + ledger + alpha moments + behavioral
  // fingerprint. Operator approves Monday morning. Silent.
  {
    name: "dossier-autodraft",
    schedule: "0 4 * * 1",
    mode: "active",
    category: "brain",
    description:
      "Power Atlas · weekly dossier auto-drafter · ≤5 profiles/run · operator approves on Monday morning",
    maxDuration: 300,
    addedAt: "2026-05-27",
  },
  // ── 2026-05-27 · Power Atlas Phase 3 · reciprocity gradient ──
  // Weekly Sunday 03:00 UTC = 10pm ET Saturday. Walks every active person
  // profile, computes the 90d operator-vs-them initiation %, writes the
  // snapshot to PersonProfile.metadata.reciprocity. Extended in Task 3.4
  // to ALSO auto-compute powerBalance with manual-lock respect (operator
  // slider value is sticky · cron skips locked profiles).
  // Silent · no Telegram.
  {
    name: "reciprocity-tracker-update",
    schedule: "0 3 * * 0",
    mode: "active",
    category: "brain",
    description:
      "Power Atlas · weekly reciprocity-gradient compute · 90d window · stored in PersonProfile.metadata.reciprocity · extended in Phase 3 Task 3.4 to also auto-compute powerBalance (manual-lock respected)",
    maxDuration: 120,
    addedAt: "2026-05-27",
  },
  // ── 2026-05-27 · Power Atlas Phase 3 · tone-shift detection ──
  // Daily 01:00 UTC = 8pm ET (prev night). Scores trailing-3 vs trailing-
  // 30 chat-mention sentiment per person, persists snapshot into
  // PersonProfile.metadata.toneShift. 24h re-compute floor · caps 10
  // profiles per run (gpt-4o-mini fast tier · ~2 calls/profile).
  // Silent · operator reads the alert on /relationships.
  {
    name: "tone-shift-detect",
    schedule: "0 1 * * *",
    mode: "active",
    category: "brain",
    description:
      "Power Atlas · daily tone-shift detection · trailing-3 vs trailing-30 sentiment delta · ≤10 profiles/run",
    maxDuration: 300,
    addedAt: "2026-05-27",
  },
  {
    name: "operating-rhythm",
    schedule: "0 12,16,21 * * *",
    mode: "active",
    category: "review",
    description: "Thrice-daily rhythm check (noon, 4pm, 9pm UTC)",
  },
  {
    // v10.0.529.106 · Wave 66 · proactive Telegram pushes ·
    // anticipated-questions + nick_current_concerns + energy-aware
    // evening nudge. Single endpoint dispatches based on current ET
    // hour · idempotent per slot per day via BrainMemory marker.
    // 12 UTC = 8am ET (morning) · 18 UTC = 2pm ET (afternoon) · 1
    // UTC = 9pm ET (evening). Each slot also fires +/-1h grace via
    // hour-routing inside the dispatcher.
    name: "proactive-push",
    schedule: "0 12,18,1 * * *",
    mode: "active",
    category: "signals",
    description: "Wave 66 · morning/afternoon/evening Telegram pushes from anticipated-questions + open threads + body state",
    addedAt: "2026-05-16",
  },
  {
    // v10.0.529.106 · Wave 68 · calendar pre-meeting cards. Fires
    // every 15 min during waking hours (11 UTC = 7am ET through 0
    // UTC = 8pm ET). The route filters to events with start ∈
    // [now+25min, now+35min] so each event gets exactly ONE push
    // regardless of cron drift. Idempotent per eventId · BrainMemory
    // proactive_push_sent marker w/ 24h TTL.
    name: "calendar-premeeting",
    schedule: "*/15 11-23,0 * * *",
    mode: "active",
    category: "signals",
    description: "Wave 68 · 30-min pre-meeting Telegram cards with attendee profile + trust + relationship context",
    addedAt: "2026-05-16",
  },
  {
    // v10.0.529.106 · Wave 69 · weekly wealth brief Sunday 9am ET ·
    // composes latest FinancialSnapshot + 7d delta + one matched
    // Munger/Buffett/Naval wisdom for the dominant signal. Per-week
    // dedup via BrainMemory marker.
    name: "wealth-brief",
    schedule: "0 13 * * 0",
    mode: "active",
    category: "review",
    description: "Wave 69 · Sunday wealth brief · net worth + debt + business revenue + one applied wisdom",
    addedAt: "2026-05-16",
  },
  {
    name: "daily-report",
    // Wave 48 · folded into mega-evening
    schedule: null,
    mode: "folded",
    foldedInto: "mega-evening",
    category: "review",
    description: "Morning recap · runs via mega-evening",
  },
  {
    name: "journal-checkin",
    // Wave 48 · folded into mega · was firing 3x/day (standalone at 0 1 *
    // + mega-morning ?slot=morning + mega-evening ?slot=evening) ·
    // now just 2x/day via the mega slots
    schedule: null,
    mode: "folded",
    foldedInto: "mega",
    category: "review",
    description: "Proactive journal-ask · runs via mega slots",
  },

  // v10.0.529.56 · 4 retired manifest entries removed entirely with
  // their route files (device-command-reap · device-sync · device-health
  // · status). The retireAfter date on status had long passed (2026-05-01)
  // and the device subsystem retirement was finalized in v529.6. Manifest
  // gate test stays green because every remaining entry has a matching
  // route file. Re-enabling any of these requires checking out the prior
  // commit OR re-creating the route + manifest entry from scratch.

  // Apr 26 · `trigger` cron retired — registry was empty (post-Apr 18
  // ghost-cron sweep) and zero internal callers. Removed in commit
  // 33e7dff alongside the dead-weight sweep. Manifest entry deleted
  // here so the drift guard stays green.

  // ── v11.1 · meta-intelligence crons (folded in manifest 2026-04-23) ─
  // Routes existed since earlier session but were never registered.
  // Adding them makes the dark-code detector happy + gives them
  // proper memory budgets.
  // ── v10.0.524.6 · 4 retired crons deleted (deletion window
  //     reached 2026-05-15 · also frees 4 cron slots so the v524
  //     morning-brief + eval-regression can take active schedules)
  //     · correlation-scan · decision-drift · blindspot-surface
  //     · notification-sender
  {
    name: "prediction-streaks",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning. Per-category accuracy streaks already daily; runs in the morning signals block alongside health-digest.",
  },
  // ── v8.7.1 hotfix: folded into mega-morning (Vercel Pro 40-cron cap)
  // These previously had standalone schedules but were daily/once
  // per cycle anyway — folding into the mega fanout keeps the same
  // cadence at 1/40th the schedule footprint.
  {
    name: "health-digest",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega",
    description:
      "Nightly system-health digest. FOLDED into mega-morning (8am UTC matches its prior schedule). Same fan-out HTTP semantics as the standalone cron — no behavior change.",
  },
  {
    name: "chat-message-backfill",
    schedule: null,
    mode: "folded",
    category: "hygiene",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Backfill is finite and self-terminating — calling once daily inside mega-evening drains it just as fast as the prior every-6h schedule.",
  },
  {
    name: "cost-regression",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning. The 7d-vs-7d delta math doesn't need 24h freshness — daily morning roll-up is the right cadence.",
  },
  {
    name: "image-rot-scan",
    schedule: null,
    mode: "folded",
    category: "hygiene",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Cheap walk over recent audit rows; runs as part of the nightly hygiene block.",
  },
  {
    name: "industry-pull",
    schedule: "0 10 * * *",        // 10am UTC = 5am Cleveland
    mode: "active",
    category: "ingest",
    description:
      "Pull 14 automotive RSS feeds (recalls, EV news, tire industry, Cleveland local, AAA). Dedupes + writes BrainMemory category=industry_intel.",
    memory: 1024,
    maxDuration: 120,
  },
  {
    name: "ingest-fireflies",
    schedule: "30 13,1 * * *",     // 1:30pm + 1:30am UTC
    mode: "active",
    category: "ingest",
    description:
      "Pull last 7d of Fireflies meeting transcripts, extract key moments + commitments, persist as BrainMemory category=meeting_transcript for chat recall.",
    memory: 1024,
    maxDuration: 120,
  },
  {
    name: "memory-bloat-watch",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening Sunday weekly block. Counts brain_memory rows by category, alerts on bloat. Weekly cadence preserved via Sunday-only inclusion.",
  },
  {
    name: "provider-ping",
    schedule: "0 * * * *",         // hourly (was every 15min — same coverage, less noise)
    mode: "active",
    category: "signals",
    description:
      "Synthetic uptime check on every configured AI provider (Venice, Ollama, OpenAI, Anthropic). v8.7.2 cadence change: every 15min → hourly. Same uptime coverage at 4× less noise; outage detection latency goes 15→60min which is fine for non-paging health.",
    memory: 256,
    maxDuration: 60,
  },
  {
    name: "semantic-dedup",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Cheap (~50ms) vector-similarity dedup runs as part of the nightly brain-hygiene block.",
  },

  // ── v8.1 · voice-clone training ──────────────────────────────────
  {
    name: "voice-clone-train",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening Sunday weekly block. Voice fingerprint mining was already weekly — same Sunday cadence preserved.",
  },

  // ── v8.2 · F2 correlation alarm clock ────────────────────────────
  {
    name: "correlation-alarm",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Correlations don't shift in 6h — daily snapshot + diff is the right cadence. Same alert dedup logic preserved.",
  },

  // ── v8.2 · F3 decision-quality drift detector ───────────────────
  {
    name: "decision-quality-drift",
    schedule: "0 11 * * 0",        // Sundays 11:00 UTC = 7am Cleveland
    mode: "active",
    category: "signals",
    description:
      "Weekly rolling-GPA on graded MasteryDecisions. Alerts when this week's GPA drops 15%+ vs prior 4-week baseline. Idempotent per week-ending-date. Surfaces in /brain/continuity + Sunday weekly-review.",
    memory: 512,
    maxDuration: 60,
    addedAt: "2026-04-29",  // v8.2 ship date — first scheduled fire 2026-05-03
  },

  // ── v8.2 · F5 blind-spot auto-pinner ─────────────────────────────
  {
    name: "blindspot-pinner",
    schedule: "0 */4 * * *",       // every 4h
    mode: "active",
    category: "brain",
    description:
      "Auto-promotes critical/high BlindSpot findings into pinned_user BrainMemory rows so they sit at the top of every Nick system prompt + the HQ pinned panel. Soft-deletes auto-pins whose underlying spot dropped off the high/critical list — restorable from /brain/pinned.",
    memory: 512,
    maxDuration: 60,
  },

  // ── v8.5 · F2 alert → Telegram bridge ────────────────────────────
  {
    name: "alert-telegram-push",
    schedule: "*/15 * * * *",      // every 15min
    mode: "active",
    category: "alert",
    description:
      "Pushes un-pushed correlation_alert + decision_quality_drift + schema_drift_alert BrainMemory rows to Telegram. Idempotent via per-alert marker rows in BrainMemory category=alert_pushed — won't re-fire on cron retries.",
    memory: 512,
    maxDuration: 60,
  },

  // ── v10.0.88 · fatal-error → Telegram bridge ────────────────────
  {
    name: "error-telegram-push",
    // 2026-05-27 · operator volume cleanup · was */5 (288 fires/day).
    // Real-world experience: stack-fingerprint dedup misses async
    // stack variants, so a single error cluster could burst-ping.
    // Bumping to */15 (96 fires/day) widens the dedup window and
    // matches alert-telegram-push cadence. Lookback window is 15min
    // either way — no lost coverage since the bridge query is
    // "errors since last_pushed" anchored, not "errors in last 15min".
    schedule: "*/15 * * * *",
    mode: "active",
    category: "alert",
    description:
      "Pushes recent fatal/error rows from error_logs to Telegram, deduped by stack-fingerprint (sha1 of message-prefix-160 + path). 15min lookback window. Idempotent via marker rows in BrainMemory category=error_pushed. 2026-05-27 · cadence loosened 5min → 15min for noise reduction.",
    memory: 512,
    maxDuration: 60,
    addedAt: "2026-05-02",
  },

  // ── v10.0.346 · synthetic chat canary (Cat 8 · operational silence) ──
  // FOLDED into mega-morning to stay under the Vercel Pro 40-cron cap
  // (38 soft cap · we were at 38 before adding this). Daily run is
  // sufficient · catches drift before the operator opens chat in the
  // morning. Cost ~$0.10/year vs hourly ~$2/year.
  {
    name: "canary-chat",
    schedule: null,
    mode: "folded",
    category: "alert",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning. Synthetic canary that exercises the chat lane end-to-end · fires CANARY_PROMPT through the production model + sanitizer + critic stack. Writes brainMemory category=glitch_capture on failure. Per docs/glitch-taxonomy.md Cat 8 · catches silent provider degradation before the operator opens chat each morning.",
    addedAt: "2026-05-06",
  },

  // ── v10.0.370 · agent-evaluation harness (folded into mega-evening) ──
  {
    name: "agent-eval",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening (daily). Runs the QUALITY_PROMPTS gold registry against the production model + sanitizer + critic stack. Detects regressions vs yesterday (prompts that passed before, fail now). Writes brainMemory category=eval_run with summary + full results. Per docs/glitch-taxonomy.md Cat 7 · daily corpus eval complementing per-message judge (v10.0.366) and morning canary (v10.0.346).",
    addedAt: "2026-05-06",
  },

  // ── v10.0.371 · domain knowledge extraction (folded into mega-evening) ──
  {
    name: "extract-knowledge",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening (daily). Extracts factual claims (subject/property/value) from yesterday's assistant messages. Adversarial verification pass adjusts confidence and surfaces caveats. Stores high-confidence facts as brainMemory category=domain_knowledge (semantic-kind in CoALA). Different layer from wisdom-distiller (which extracts principles, procedural-kind).",
    addedAt: "2026-05-06",
  },

  // ── v10.0.411 · brain feedback loop (folded into mega-evening) ──
  {
    name: "brain-feedback-loop",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening (daily). Closes the eval feedback loop: (1) runImproveAgent(7) clusters last-7-days LLM-as-judge axis failures into improvement_hypothesis brain memories with concrete proposed rule changes; (2) runWisdomEvolution() scans the wisdom corpus for stale (60d+ cold + conf<0.5), redundant (cosine ≥0.92 + shared topics), and low-trust (active but conf<0.5) candidates · persists evolution_summary memory · operator confirms each move via /brain/wisdom?evolution=1. Refreshes the InsightsPanel surface every morning.",
    addedAt: "2026-05-07",
  },

  // ── v10.0.526 · Arc B Feature 1 · weekly preference self-tune ──
  {
    name: "preference-tune",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening Sunday weekly block. Reads last 7d of chat_feedback audit events, scores each referenced assistant reply on 8 style axes (density · creativity · skepticism · directness · humor · jargon · structure · urgency), averages the per-feedback deltas, and applies a weighted decay update (rate 0.1) to the operator's preference vector stored in OperatorPreference.voiceToneBoundaries.preferenceVector. The vector is appended to every chat system prompt via buildSystemPromptAddendum (lib/brain/preference-inference.ts). No new tables.",
    addedAt: "2026-05-12",
  },

  // ── v10.0.89 · token-age daily watchdog (folded into mega-morning) ──
  {
    name: "token-age-watch",
    schedule: null,
    mode: "folded",
    category: "alert",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning (daily). Watchdog over /api/system/token-ages. Pushes Telegram alert for each token in rotate-soon (<14d) / expired / missing state. Idempotent per-token-per-day via BrainMemory category=token_age_pushed.",
    addedAt: "2026-05-02",
  },

  // ── v10.0.89 · brain-bus exhaustion watchdog ────────────────────
  {
    name: "bus-exhaustion-watch",
    schedule: "*/30 * * * *",      // every 30min
    mode: "active",
    category: "alert",
    description:
      "Watches brain_bus_events backlog. Fires Telegram on pending>1000 (runaway), dead>50 (failure pile), or any consumer stuck >5min. Idempotent per-condition-per-day via BrainMemory category=bus_exhaustion_pushed.",
    memory: 512,
    maxDuration: 60,
    addedAt: "2026-05-02",
  },

  // ── v10.0.89 · semantic-link nightly (folded into mega-evening) ──
  {
    name: "semantic-link",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. Builds embedding-based edges between brain memories — KNN cosine query per high-confidence row, top-3 neighbors persisted as BrainMemory category=semantic_edge. Composes with rule-driven auto-linker without overlap.",
    addedAt: "2026-05-02",
  },

  // ── v10.0.91 · cost-anomaly hourly z-score (folded into mega-evening) ──
  {
    name: "cost-anomaly",
    schedule: null,
    mode: "folded",
    category: "alert",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. Z-score on today's AI cost vs trailing 7-day baseline. |z|>2 → BrainMemory category=cost_anomaly_alert (alert-telegram-push picks up next sweep). Catches runaway spending overnight.",
    addedAt: "2026-05-02",
  },

  // ── v10.0.91 · predictions-grader (folded into mega-evening) ─────
  {
    name: "predictions-grader",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. Auto-grades past-due MasteryDecision predictions by KNN-searching for evidence in subsequent brain memories + matching pattern keywords (achieved/missed/exceeded/fell short). Closes Ghost Nour 0/0/null calibration.",
    addedAt: "2026-05-02",
  },

  // ── v10.0.92 · self-critique nightly (folded into mega-evening) ──
  {
    name: "self-critique",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. Heuristic 4-axis critic over last 100 assistant chat messages of the last 7d. Bottom 10% by composite score get persisted as BrainMemory category=reply_to_improve for review on /chat sidebar.",
    addedAt: "2026-05-02",
  },

  // ── v8.6 · schema-drift watch (folded into mega) ───────────────
  {
    name: "schema-drift-watch",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning. Sentinel runs once daily; findings write a BrainMemory schema_drift_alert that the Telegram bridge picks up. Daily cadence is plenty for schema drift — it changes manually + on deploy.",
  },

  // ── v8.7 · pgvector backfill (folded into mega) ─────────────────
  {
    name: "pgvector-backfill",
    schedule: null,
    mode: "folded",
    category: "hygiene",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Self-terminating finite migration — runs each evening until drained, then becomes a free no-op. Bails early when pgvector extension off.",
    memory: 512,
    maxDuration: 60,
  },

  // ── v8.8 · storage-quota watcher (folded — daily check) ─────────
  {
    name: "storage-quota-watch",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Daily probe of pg_relation_size for tracked tables (vector_embeddings, brain_memories, chat_messages, entity_audits, audit_events). Alerts via BrainMemory storage_quota_alert at 60/80/95% of per-table soft caps. Idempotent per table+day+tier.",
    memory: 512,
    maxDuration: 60,
  },

  // ── v8.9 · entity-audit retention TTL (folded) ──────────────────
  {
    name: "audit-retention",
    schedule: null,
    mode: "folded",
    category: "hygiene",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Daily TTL on entity_audits: hard-deletes rows >90d (HOT_WINDOW); also prunes 'created' rows >30d (cheap because creates are reconstructable from downstream updates). Without this, every mutation accumulates → unbounded storage.",
    memory: 512,
    maxDuration: 60,
  },

  // ── v8.10 · mass-creation spike detector (folded) ───────────────
  {
    name: "creation-spike-detect",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Watches entity_audits for unusually high create-rates per entity-type (5× the 7d median, abs floor 20). Catches chat-interceptor loops, runaway imports, bot activity. Idempotent per (entityType, hour).",
    memory: 512,
    maxDuration: 60,
  },

  // ── v8.11 · mass-update spike detector (folded) ────────────────
  {
    name: "update-spike-detect",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Sibling of creation-spike-detect — watches entity_audits for unusually high UPDATE-rates per entity-type (5× the 7d median, abs floor 50; higher floor than creates because updates churn faster). Catches useEffect storms, migration re-touch bugs, fuzzers on public write surfaces.",
    memory: 512,
    maxDuration: 60,
  },

  // ── v8.11 · brain-bus health probe (folded) ────────────────────
  {
    name: "brain-bus-probe",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Round-trips a probe envelope through the v8.4 brain-bus (LISTEN/NOTIFY) to verify the pipeline is alive. Catches Neon-side LISTEN regressions and missing pg peer-dep. Writes brain_bus_alert on failure.",
    memory: 256,
    maxDuration: 30,
  },

  // ── v8.23 · brain-bus consumer activator (folded) ──────────────
  {
    name: "brain-bus-consume",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Runs the v8.10 entity-audit consumer subscribe() for ~50s, accumulating real-time mutation counts and flushing into BrainMemory category='bus_consumer_counter'. Validates LISTEN/NOTIFY end-to-end with real audit traffic and keeps derived counters fresh.",
    memory: 512,
    maxDuration: 60,
  },

  // ── v10 B.2 · durable brain-bus polling backfill ───────────────
  {
    name: "brain-bus-backfill",
    schedule: "*/2 * * * *",
    mode: "active",
    category: "brain",
    description:
      "v10 Track B.2 · polls BrainBusEvent for pending rows + reclaims stuck-processing rows. Closes the at-most-once gap on LISTEN/NOTIFY: if the consumer is offline when NOTIFY fires, this catches the missed event on the next 2min tick. Backoff schedule (1m/5m/30m/2h/6h) with dead-letter after 5 failed attempts.",
    memory: 256,
    maxDuration: 60,
  },

  // ── v8.11 · stale-conversation auto-archive (folded) ───────────
  {
    name: "stale-conversation-archive",
    schedule: null,
    mode: "folded",
    category: "hygiene",
    foldedInto: "mega",
    description:
      "FOLDED into mega-evening. Sets archivedAt on ChatConversation rows idle >60d, not starred, with at least one message. Batch-capped at 200/run. Hides from default sidebar but preserves content for semantic search.",
    memory: 512,
    maxDuration: 60,
  },

  // ── v10.0.524.6 · morning-brief · FOLDED into mega-morning
  // The 4 retired-mode crons (correlation-scan/decision-drift/
  // blindspot-surface/notification-sender) didn't free schedule
  // slots (they were schedule:null). The cap is hard at 40, current
  // at 38 · adding 2 actives overflows. Fold-pattern preserves the
  // route, runs once daily inside mega.
  {
    name: "morning-brief",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning. Composes 7am-ish operator brief (drift state + top task + open task count + aging commitments + calendar conflicts) and pushes via Telegram. Idempotent · one BrainMemory(category='morning_brief') row per date. Timing follows mega-morning (~5am ET) which is still ahead of operator's day.",
    maxDuration: 60,
    addedAt: "2026-05-12",
  },

  // ── 2026-05-24 · Wave X.f · daily-strategy · FOLDED into mega-morning
  // Writes today's `DailyStrategy` row · the cockpit at
  // `/api/command/data` reads from this table but no writer existed.
  {
    name: "daily-strategy",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning. Runs the 15 strategic-trigger behavioral checks and writes a `DailyStrategy` row keyed by today's ET date. Deterministic briefing — no AI call, the triggers ARE the signal. Idempotent · upserts on the unique `strategyDate` constraint. Pre-fix the cockpit tile at /api/command/data line 87 always rendered null because no cron wrote the row.",
    maxDuration: 60,
    addedAt: "2026-05-24",
  },

  // ── v10.0.524.6 · eval-regression · FOLDED into mega-evening
  {
    name: "eval-regression",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. Nightly eval regression suite. Runs the 35-question golden set against the chat pipeline, scores against expected criteria, writes BrainMemory(category='eval_result'), Telegram-alerts when passRate<80%.",
    maxDuration: 300,
    addedAt: "2026-05-12",
  },

  // ── v10.0.526 · Arc A · F2 · cost-slo-check · FOLDED into mega-evening
  // Burn-rate sentinel over AiGeneration. Linear 24h forecast (burn ·
  // 24 / hours-elapsed-ET) compared against DAILY_AI_BUDGET_CENTS · 1.2.
  // Idempotent · one BrainMemory(category='cost_alert') per ET-day · cron
  // retries don't re-page. No new schema · reads AiGeneration only.
  {
    name: "cost-slo-check",
    schedule: null,
    mode: "folded",
    category: "alert",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. v10.0.526 Arc A F2 burn-rate sentinel. Reads AiGeneration · linear 24h forecast · alerts Telegram when forecast > daily-budget · 1.2. Idempotent per ET-day via BrainMemory(category='cost_alert').",
    maxDuration: 60,
    addedAt: "2026-05-12",
  },

  // ── v10.0.526 · Arc A · F3 · vapi-latency-sync · FOLDED into mega-evening
  // Pulls last 24h of VAPI calls via the same REST pattern as
  // /api/system/vapi-calls (no duplicated client). Derives end-to-end
  // latency per call · writes VoiceLatencyEvent rows (deduped by
  // callId+stage). Alerts Telegram when p50 breach streak ≥ 3
  // consecutive call-days · idempotent per UTC date via
  // BrainMemory(category='voice_latency_alert').
  {
    name: "vapi-latency-sync",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. v10.0.526 Arc A F3 voice-latency sync. Pulls last 24h of VAPI calls · derives end-to-end latency · writes VoiceLatencyEvent. Telegram-alerts when p50 breach streak ≥ 3 call-days (idempotent per UTC date via BrainMemory voice_latency_alert).",
    maxDuration: 120,
    addedAt: "2026-05-12",
  },

  // ── v10.0.526 · Arc A · F5 · os-snapshot · FOLDED into mega-evening
  // Daily snapshot of OS-level metrics (route/cron/tool counts · LOC by
  // domain · test count · monster files · `: any` usage · console calls)
  // to SystemMetric rows (`metric_name="os_snapshot.*"` discriminator ·
  // no new table). Week-over-week drift detection alerts Telegram when
  // any metric regresses ≥15% vs the 7d-prior baseline. Idempotent per
  // day via BrainMemory(category="os_drift_alert").
  {
    name: "os-snapshot",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. v10.0.526 Arc A F5 codebase drift detector. Snapshots route/cron/tool/LOC/test/monster-file/`any`/console counts to SystemMetric. Compares vs 7-day baseline; alerts Telegram on warn/critical regressions. Idempotent per day via BrainMemory(category='os_drift_alert').",
    maxDuration: 120,
    addedAt: "2026-05-12",
  },

  // ── v10.0.526 · Arc C · F3 · pricing-advisor · FOLDED into mega-evening
  //     (Sunday-only weekly block · routed inside the fan-out).
  // Reads 30d ALG win-rate per service category from the nickstire
  // bridge (estimates-conversion?scope=alg · NO new pipeline). Flags
  // outliers ≥20pp below fleet median, fetches competitor pricing via
  // multiSourceSearch (24h BrainMemory cache to spare Tavily/Exa
  // quota), drafts 3 operator-approval-required price experiments
  // per outlier via aiChat citing Munger inversion / Buffett pricing
  // wisdoms by name. Writes BrainMemory(category="pricing_advisory",
  // key="weekly_YYYY-MM-DD"). Telegram-alerts ONLY when outliers
  // found · zero-outlier weeks stay quiet so alerts don't get muted.
  // ADVISORY ONLY · NEVER mutates shop pricing.
  {
    name: "pricing-advisor",
    schedule: null,
    mode: "folded",
    category: "signals",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening Sunday weekly block. v10.0.526 Arc C F3 pricing-strategy advisor. Pulls 30d ALG win-rate per service category from nickstire bridge, flags outliers ≥20pp below fleet median, fetches competitor pricing via multiSourceSearch (24h cache), drafts 3 operator-approval-required price experiments per outlier citing Munger/Buffett wisdoms. Writes BrainMemory(category='pricing_advisory', key='weekly_YYYY-MM-DD'). Telegram only when outliers found. NEVER mutates shop pricing.",
    maxDuration: 180,
    addedAt: "2026-05-12",
  },

  // ── v10.0.526 · Arc B · F6 · anticipate · FOLDED into mega-evening
  // Daily anticipated-question feed. Reads last 7d of chat + decisions +
  // commitments + open tasks → drafts the 3 questions operator most
  // likely asks tomorrow → precomputes answers via in-process chat
  // pipeline call (10s per-question timeout) → stores in BrainMemory
  // (category="anticipated_question", key="anticipated_YYYY-MM-DD").
  // Recursion-guarded via x-anticipate-precompute: 1 request header.
  // Match-at-ask-time injection in chat route at cosine ≥ 0.85.
  // Morning brief includes "Tomorrow you'll probably ask:" slice.
  {
    name: "anticipate",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. v10.0.526 Arc B F6 Anticipated-Question Feed. Drafts 3 likely-tomorrow questions from last 7d signals · precomputes answers (10s per-question cap) · stores BrainMemory(anticipated_question). Cosine ≥ 0.85 match at chat-time injects cached take into system prompt without short-circuiting fresh generation. Idempotent per ET-day · 6h-skip guard.",
    maxDuration: 60,
    addedAt: "2026-05-12",
  },

  // ── v10.0.526 · Arc C · F1 · revenue-decision · FOLDED into mega-morning
  // Daily revenue-decision channel. Read-only over nickstire bridge +
  // ceo_business_context AuditEvent → wisdom recall (Munger inversion ·
  // Bezos one-way-door · Naval leverage) → AI drafts 1-3 concrete moves →
  // Telegram approval message. Operator replies /approve_N to
  // /api/telegram/revenue-decision-callback. NO new schema · all state
  // lives in BrainMemory(category='revenue_move', key='move_<date>_<n>').
  // Idempotent · move_<date>_1 sentinel checked before drafting. Bridge-
  // down behavior: logs and exits cleanly · no Telegram noise (spec).
  // STATENOUR↔NICKSTIRE BOUNDARY: NEVER writes to nickstire DB.
  {
    name: "revenue-decision",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning. v10.0.526 Arc C F1 Revenue-Decision Channel. Read-only stitches the latest ceo_business_context AuditEvent + the live bridge snapshot, recalls Munger/Bezos/Naval wisdoms from BrainMemory(category='wisdom'), drafts 1-3 concrete operator moves citing wisdom keys, pushes Telegram approval message. Idempotent per ET-day via BrainMemory(category='revenue_move', key='move_<date>_1') sentinel. Bridge-down → logs and exits cleanly. NEVER writes to nickstire.",
    maxDuration: 60,
    addedAt: "2026-05-12",
  },

  // ── v10.0.528 · Arc B · F3 · decision-replay · FOLDED into mega-morning
  // Daily replay coach. Picks up to 5 MasteryDecisions whose age ≥ 30d and
  // aren't yet reviewed · gathers 30d outcome signals (task completions,
  // drift alerts, topical brain memories, commitment status delta) ·
  // matches ONE wisdom from BrainMemory(category="wisdom") with
  // Munger/Naval/Buffett/Greene persona bias (similarity floor 0.3 · falls
  // back to a generic "what did this teach you" frame when below) ·
  // upserts the prompt into BrainMemory(category="decision_replay_due").
  // The morning-brief Personal slice reads + marks consumed in the same
  // pass · idempotent per decision. NO new tables · uses DecisionReplay
  // (already in schema · holds the reviewed/outcome/lesson record after
  // the operator responds).
  {
    name: "decision-replay",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning. v10.0.528 Arc B F3 Decision-Replay Coach. Picks 5 due MasteryDecisions (≥30d), gathers outcome signals (tasks/drift/commitments/topical memory), matches ONE wisdom citation (sim ≥0.3, Munger/Naval/Buffett/Greene boost), upserts BrainMemory(decision_replay_due) for the morning-brief consumer. NO new tables · reuses DecisionReplay model. Idempotent per decision via idempotencyKey='decision_<id>_30d'.",
    maxDuration: 60,
    addedAt: "2026-05-12",
  },

  // ── v10.0.529.32 · Arc B · F4 · persona-drift · FOLDED into mega-morning
  // Daily Ghost Nick detection scan. Reads the operator's 8-axis identity
  // snapshot, renders it to text, embeds (cached per snapshot.updatedAt),
  // fans out over the last 28h of assistant chat replies (cap 60) with
  // their precomputed embeddings, flags any with cosine similarity < 0.6
  // (drift > 0.4 per the Arc B vision). Drift events upsert into
  // BrainMemory(category="persona_drift", key=sha1(messageId)) so re-runs
  // are idempotent. Surface via SituationCard's "persona_drift" candidate
  // source. Detection-only · regeneration deliberately Phase 2.
  {
    name: "persona-drift",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega",
    description:
      "FOLDED into mega-morning. v10.0.529.32 Arc B F4 Ghost Nick persona-drift detector. Embeds the operator's 8-axis identity_snapshot, scans the last 28h of assistant chat replies, flags similarity <0.6 (drift >0.4) as BrainMemory(persona_drift) for surfacing via the SituationCard meta-aggregator. NO regeneration in Phase 1 · detection-only.",
    maxDuration: 60,
    addedAt: "2026-05-13",
  },

  // ── v10.0.526 · Arc C · F7 · monthly-location-rank · FOLDED into mega-evening
  // Pure-function ranker over data/location-candidates.json. Gates on
  // 1st-of-ET-month inside the handler; no-ops every other day so the
  // mega-evening fan-out stays cheap. NO automatic external data
  // ingestion · operator owns the JSON file. Persists top-20 to
  // BrainMemory(category="location_ranking", key="monthly_YYYY-MM").
  // File-missing is a structured no-op (warn-log + clean exit) so the
  // cron stays green while the operator hasn't pre-populated yet.
  {
    name: "monthly-location-rank",
    schedule: null,
    mode: "folded",
    category: "compose",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening (1st-of-ET-month gate inside the handler). v10.0.526 Arc C F7 second-location feasibility ranker. Reads data/location-candidates.json, scores via lib/services/location-feasibility, persists top-20 to BrainMemory(category='location_ranking', key='monthly_YYYY-MM'). NO automatic data ingestion · operator pre-populates the file. Missing file = structured no-op with hint.",
    maxDuration: 60,
    addedAt: "2026-05-12",
  },

  // ── FOLDED · Railway/Inngest evening fan-out ───────────────────────
  // Run via the EVENING_JOBS list in src/inngest/jobs.ts, not a
  // standalone schedule. Registered here so config/crons.ts stays the
  // complete cron catalog (verify-crons.ts step 2 · dark-code check).
  {
    name: "judge-eval-shadow",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. Phase X auto-corpus-builder for the AGENT_V1 to AGENT_V2 prompt-builder migration · samples fresh prompts, replays each through both builders, judges + persists the comparison.",
    addedAt: "2026-05-18",
  },
  {
    name: "suggestion-outcome-rollup",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening. Closes the suggestion-loop end-to-end · pairs each 'acted' action signal with downstream Task completions within 24h and writes a neutral outcome row back to brain_memory.",
    addedAt: "2026-05-19",
  },
];

/** Names of crons that SHOULD exist as routes (for verifier). */
export function expectedCronRouteNames(): Set<string> {
  const names = new Set<string>();
  for (const c of CRONS) {
    // Skip mega-evening (same route as mega).
    if (c.name === "mega-evening") continue;
    names.add(c.name);
  }
  return names;
}
