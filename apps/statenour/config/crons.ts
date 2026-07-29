/**
 * Cron manifest — single source of truth for every scheduled job.
 *
 * statenour deploys on Railway (not Vercel) — there is no `vercel.json`.
 * Scheduled jobs run through the mega fan-out + the Inngest evening
 * job list (`lib/inngest/jobs.ts`). `pnpm check:crons` validates this
 * manifest against the filesystem (every entry has a route, no dark
 * routes) — it no longer generates a `vercel.json` crons block.
 *
 * Wave AE · 2026-05-28 · Sam-Altman audit cron prune · 107 → 35
 * (-67%). Deleted clusters: brain processing sprawl, embeddings sprawl,
 * summary duplicates, person-AI sprawl, hygiene over-engineering,
 * watcher sprawl, business concerns moved to nickstire. The kept-list
 * is: ingest · the daily/weekly composite jobs · canonical brain ·
 * relationship synthesis · core retention · the Action-Queue pair
 * (Wave AG). Each survivor produces operator-visible output.
 *
 * Philosophy:
 *   · `mode: "active"` — runs on its own `schedule`, visible on /system/crons
 *   · `mode: "folded"` — coded but intentionally NOT on a standalone
 *     schedule because it runs inside another cron (e.g. consolidate
 *     runs inside mega?slot=evening). Used by /system/crons to show
 *     ancestry.
 *   · `mode: "retired"` — route still exists but scheduled to be
 *     deleted. Warning surfaced.
 *   · `mode: "dormant"` — route + code exist and work, but it is
 *     intentionally NOT wired to fire (operator parked it). Distinct
 *     from "retired" (no deletion implied). Revive by adding it to
 *     lib/inngest/jobs.ts; the `schedule` field documents the intended
 *     cadence if revived. Added 2026-05-30 to stop the manifest claiming
 *     Wave-AE orphans were "active" when they never actually fired.
 *     `pnpm check:crons` [6/6] enforces: a cron can only be "active" if
 *     it is genuinely reachable from the fan-out.
 *
 * Schedule syntax is standard cron in UTC. Comments on each line
 * document the intent.
 */

export type CronMode = "active" | "folded" | "retired" | "dormant";
export type CronCategory =
  | "ingest"     // pull from external sources (Gmail, Calendar, Drive)
  | "brain"      // memory + learning + identity
  | "hygiene"    // retention, health checks, reaping
  | "signals"    // detect + surface anomalies
  | "review"     // recurring human-facing ritual (daily, weekly)
  | "compose"    // assembles aggregate reports (mega)
  | "device"     // device bridge
  | "alert"      // fires notifications
  | "action";    // Wave AG · Nick autonomous action queue (proposal + execute)

export interface CronDef {
  name: string;
  schedule: string | null;
  mode: CronMode;
  category: CronCategory;
  description: string;
  memory?: number;
  maxDuration?: number;
  foldedInto?: string;
  retireAfter?: string;
  path?: string;
  /** YYYY-MM-DD first-declared · drives silence-detector grace. */
  addedAt?: string;
  /**
   * Inngest-native scheduled function: fires via its OWN Inngest cron
   * trigger (lib/inngest/functions/*), NOT a Railway /api/cron route and
   * NOT the mega fan-out. `pnpm check:crons` skips the route-file check
   * for these and treats them as independently-reachable.
   */
  inngest?: boolean;
  /**
   * Fired by the WORKER's node-cron (apps/worker/src/scheduler.ts),
   * which HTTP-hits this app's /api/cron/<name> route. The third real
   * dispatch path — added 2026-07-28 when the inngest-liveness watcher
   * needed a scheduler that survives an Inngest outage. `check:crons`
   * treats worker-fired entries as reachable; keep the worker's job
   * list in sync manually (its file says the same).
   */
  worker?: boolean;
}

export const CRONS: CronDef[] = [
  // ── INNGEST-NATIVE ──────────────────────────────────────────────────
  // Fire via their own Inngest cron trigger (lib/inngest/functions/*),
  // NOT a Railway /api/cron route and NOT the mega fan-out. Registered
  // 2026-05-30: they were firing live but invisible to this manifest,
  // /system/crons, and `pnpm check:crons`. `inngest: true` tells the
  // verifier to skip the route-file check + treat them as reachable.
  {
    name: "cron-heartbeat",
    schedule: "0 12 * * *",
    mode: "active",
    category: "hygiene",
    inngest: true,
    description: "Out-of-band fan-out liveness watchdog — the canary added after the 2-day fan-out outage. Writes a self-row per run (proof Inngest invokes scheduled functions at all) since the 2026-07-28 drift incident.",
  },
  {
    name: "inngest-liveness",
    schedule: "0 13 * * *",
    mode: "active",
    category: "hygiene",
    worker: true,
    addedAt: "2026-07-28",
    description:
      "Who watches the watcher: fired by the WORKER's node-cron (not Inngest, not the mega) an hour after cron-heartbeat's slot. Reads the heartbeat self-row age; stale/absent → P0 Telegram with the re-sync runbook. Exists because the 2026-07-28 function-set drift killed the watchdog together with everything it watched.",
  },
  {
    name: "operator-morning-brief",
    schedule: "0 10 * * *",
    mode: "active",
    category: "review",
    inngest: true,
    description: "Operator morning brief — Inngest-native.",
  },
  {
    name: "proactive-push-cron",
    schedule: "0 * * * *",
    mode: "active",
    category: "alert",
    inngest: true,
    description: "Proactive Telegram pushes & governance nudges — Inngest-native.",
  },
  {
    name: "goal-pruner",
    schedule: "0 12 * * *",
    mode: "active",
    category: "hygiene",
    inngest: true,
    description: "Prunes stale / abandoned goals — Inngest-native.",
  },
  {
    name: "goal-drift-detector",
    schedule: "30 12 * * *",
    mode: "active",
    category: "brain",
    inngest: true,
    description: "Proactive goal-drift detector (momentum decay + deadline risk) — Inngest-native.",
  },
  {
    name: "journal-convergence-scan",
    schedule: "0 22 * * *",
    mode: "active",
    category: "brain",
    inngest: true,
    description: "Scans journal threads for convergence / patterns — Inngest-native.",
  },
  {
    name: "journal-thread-dormancy",
    schedule: "0 23 * * *",
    mode: "active",
    category: "hygiene",
    inngest: true,
    description: "Flags dormant journal threads — Inngest-native.",
  },
  {
    name: "industry-pull",
    schedule: "0 8 * * *",
    mode: "active",
    category: "brain",
    inngest: true,
    description: "Industry-intel RSS feeder → BrainMemory(industry_intel) for recallIndustryIntel (system prompt + /intel + plan-day). Revived 2026-05-31 (was deleted in Wave AE).",
  },
  {
    name: "intelligence-daily-brief",
    schedule: "15 10 * * *",
    mode: "active",
    category: "review",
    inngest: true,
    description: "Daily Ingestion, claim verification, opportunity scoring & Executive Briefing — Inngest-native. Staggered +15min off operator-morning-brief (0 10) to avoid double high-priority push + AI-provider contention.",
  },
  {
    name: "intelligence-weekly-brief",
    schedule: "0 11 * * 0",
    mode: "active",
    category: "review",
    inngest: true,
    description: "Weekly Ingestion & Strategic Briefing — Inngest-native.",
  },
  {
    name: "customer-preferences-recompute",
    schedule: "0 11 * * *",
    mode: "active",
    category: "brain",
    inngest: true,
    description: "Recomputes customer preferences profile based on recent activity — Inngest-native.",
  },
  {
    name: "diagnose-cron-failure",
    schedule: "0 */4 * * *",
    mode: "active",
    category: "hygiene",
    inngest: true,
    description: "Diagnoses cron jobs that fail or stall and alerts operator — Inngest-native.",
  },
  {
    name: "crm-weekly-followups",
    schedule: "0 9 * * 1",
    mode: "active",
    category: "signals",
    inngest: true,
    description: "CRM weekly follow-ups proposer — Inngest-native.",
  },
  {
    name: "content-performance-weekly",
    schedule: "0 12 * * 1",
    mode: "active",
    category: "review",
    inngest: true,
    description: "Analyzes weekly performance of social media content — Inngest-native.",
  },
  {
    name: "approval-sweeper",
    schedule: "*/5 * * * *",
    mode: "active",
    category: "hygiene",
    inngest: true,
    description: "Cleans up expired or stalled approval requests — Inngest-native.",
  },
  {
    name: "audit-todays-leads",
    schedule: "0 8 * * *",
    mode: "active",
    category: "signals",
    inngest: true,
    description: "Audits today's leads from Nick's Tire & Auto bridge — Inngest-native.",
  },

  // ── COMPOSE ─────────────────────────────────────────────────────────

  {
    name: "mega",
    path: "/api/cron/mega?slot=morning",
    schedule: "0 9 * * *", // 9am UTC = 5am ET morning slot
    mode: "active",
    category: "compose",
    description: "Morning composite — pulse + briefing + daily-report + predict",
    memory: 1024,
    maxDuration: 120,
  },
  {
    name: "mega-evening",
    path: "/api/cron/mega?slot=evening",
    // 2026-07-09 · sweep · the manifest claimed "0 2 * * *" but the actual
    // Inngest trigger (lib/inngest/functions/mega-fanout.ts) fires 0 3 * * *.
    schedule: "0 3 * * *", // 03:00 UTC = 10/11pm ET evening slot
    mode: "active",
    category: "compose",
    description: "Evening composite — reflect + consolidate + weekly-digest eligibility",
    memory: 1024,
    maxDuration: 120,
  },

  // ── INGEST ──────────────────────────────────────────────────────────
  {
    // AG-41 · 2026-07-09 · cadence honesty. This entry claimed
    // "every 30min 8-22 UTC" but the route has fired 1×/day via the
    // mega-morning fan-out since Wave AE — and on 2026-05-30 the
    // operator explicitly decided "i only need one a day on google"
    // (see lib/inngest/jobs.ts MORNING_JOBS comment). The manifest now
    // tells the truth instead of advertising a cadence nobody wired.
    name: "ingest-gmail",
    schedule: "0 9 * * *",
    mode: "active",
    category: "ingest",
    description: "Multi-account Gmail pull + AI classify + Telegram nudge on high-urgency needs-reply — 1×/day via mega-morning fan-out (operator decision 2026-05-30: one/day is enough)",
    memory: 1024,
    maxDuration: 300,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE standalone "15 8 * * *" retired;
    // fires 1×/day via the mega-morning fan-out (9:00 UTC).
    name: "ingest-calendar",
    schedule: "0 9 * * *",
    mode: "active",
    category: "ingest",
    description: "Calendar pull — 1×/day via mega-morning fan-out",
    memory: 512,
    maxDuration: 120,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "Sun + Wed 2:30am" retired; the
    // route sits in MORNING_JOBS with no day gate, so it fires DAILY via
    // the mega-morning fan-out. Harmless: memories key on Drive file ID,
    // re-runs reinforce rather than duplicate.
    name: "ingest-drive",
    schedule: "0 9 * * *",
    mode: "active",
    category: "ingest",
    description: "Drive pull — daily via mega-morning fan-out (idempotent per file ID)",
    memory: 1024,
    maxDuration: 300,
  },

  // ── BRAIN ───────────────────────────────────────────────────────────
  {
    name: "brain-intelligence",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description: "FOLDED into mega-evening · scans recent BrainMemory for cross-source patterns and writes synthesis rows.",
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "weekly Sun 3am" retired; the route
    // is in BOTH MORNING_JOBS and EVENING_JOBS, so it fires 2×/day via the
    // mega fan-outs. Scan is bounded (2026-06 cron-reliability fix), so the
    // higher cadence stays cheap.
    name: "embed-backfill",
    schedule: "0 3,9 * * *",
    mode: "active",
    category: "brain",
    description: "Embedding backfill for any new BrainMemory rows · 2×/day via mega-morning + mega-evening fan-outs",
    memory: 1024,
    maxDuration: 300,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "*/15" retired; fires 1×/day via
    // the mega-evening fan-out (03:00 UTC).
    name: "conversation-mission-link",
    schedule: "0 3 * * *",
    mode: "active",
    category: "brain",
    description: "Nightly via mega-evening fan-out · scans new chat messages for mission-relevance, writes ConversationMissionLink rows so Nick can answer 'what mission was this about?'",
    memory: 512,
    maxDuration: 60,
  },
  {
    name: "consolidate",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description: "FOLDED into mega-evening · roll-up of fresh BrainMemory into consolidated_belief rows.",
  },
  {
    name: "mastery-xp",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description: "FOLDED into mega-evening · mastery leveling engine · AI-attributes the day's chat/captures/decisions → stat XP (lib/mastery). Idempotent per sourceKey; first run backfills history, then only new signals nightly.",
    addedAt: "2026-05-30",
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "0 12" retired; fires 1×/day via
    // the mega-evening fan-out (03:00 UTC).
    name: "predict",
    schedule: "0 3 * * *",
    mode: "active",
    category: "brain",
    description: "Nightly via mega-evening fan-out · forecasts week ahead based on patterns; writes Prediction rows.",
    memory: 1024,
    maxDuration: 120,
  },
  {
    name: "calibration-generator",
    schedule: "0 3 * * *", // matches the mega-evening slot it actually rides
    mode: "active",
    category: "brain",
    description: "Daily evening pass via mega-evening fan-out · scans completed tasks/predictions and proposes outcomes for manual calibration.",
    memory: 512,
    maxDuration: 120,
    addedAt: "2026-06-11",
  },
  {
    name: "reflect-categories",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description: "FOLDED into the Sunday-ET weekly fan-out · reflects on BrainMemory category distribution + hosts NICK_REFLECTION_TREES higher-order synthesis. Writes operator-facing reflection rows + (gated) reflection-of-reflections insights.",
    memory: 512,
    maxDuration: 120,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "every 6h" retired; fires 1×/day
    // via the mega-evening fan-out (03:00 UTC).
    name: "intelligence",
    schedule: "0 3 * * *",
    mode: "active",
    category: "brain",
    description: "Nightly via mega-evening fan-out · cross-source intelligence synthesis · writes high-confidence signals into BrainMemory(intelligence).",
    memory: 1024,
    maxDuration: 180,
  },

  // ── HYGIENE ─────────────────────────────────────────────────────────
  {
    // 2026-07-09 · sweep · pre-Wave-AE "0 6" retired; fires 1×/day via
    // the mega-morning fan-out (9:00 UTC).
    name: "task-resurface",
    schedule: "0 9 * * *",
    mode: "active",
    category: "hygiene",
    description: "Daily via mega-morning fan-out · snoozed tasks past their resurface date flip back to READY.",
    memory: 256,
    maxDuration: 30,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "weekly Mon 4am" retired; the route
    // sits in MORNING_JOBS with NO Monday self-gate (unlike dossier-autodraft
    // / greene-law-tag-refresh), so it actually fires DAILY via the
    // mega-morning fan-out. Flagging >30d-untouched tasks is a cheap
    // re-runnable query, so the daily cadence is harmless.
    name: "stale-tasks",
    schedule: "0 9 * * *",
    mode: "active",
    category: "hygiene",
    description: "Daily via mega-morning fan-out · flags tasks >30d untouched as stale for the next weekly review.",
    memory: 256,
    maxDuration: 60,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "weekly Sun 1am" retired; the route
    // sits in EVENING_JOBS with no day gate, so it actually fires NIGHTLY
    // via the mega-evening fan-out. TTL-based trimming is idempotent.
    name: "data-cleanup",
    schedule: "0 3 * * *",
    mode: "active",
    category: "hygiene",
    description: "Nightly via mega-evening fan-out · trims old logs, orphan rows, soft-deleted records past TTL.",
    memory: 512,
    maxDuration: 300,
  },
  {
    // 2026-07-25 · durable-outbox drain (audit P1). 2026-07-28 blueprint:
    // nightly-only meant a crashed turn's receipts waited up to 24h — now
    // ALSO fired every 15 min by the worker's node-cron. Claim is atomic
    // first-claimant-wins, so both dispatch paths coexist safely.
    name: "outbox-drain",
    schedule: "*/15 * * * *",
    mode: "active",
    category: "hygiene",
    worker: true,
    description: "Every 15 min via worker node-cron (+ nightly mega-evening backstop) · replays orphaned post-turn chat work from post_turn_outbox.",
    memory: 512,
    maxDuration: 300,
  },
  {
    // 2026-07-28 · blueprint audit finding #1 — the Wave-AE prune deleted
    // the brain-bus-backfill ROUTE but left all nine producers publishing.
    // pollAndProcess had zero callers from 2026-05-28 onward; prod showed
    // 393 pending events (task.completed 184 · brain_dump.finalized 161 ·
    // cron.failure 23 · score.logged 20). Durable rows = replayable, so
    // this drain recovers the whole backlog. Same revive precedent as
    // refresh-identity (2026-07-11).
    name: "brain-bus-drain",
    schedule: "*/15 * * * *",
    mode: "active",
    category: "brain",
    worker: true,
    addedAt: "2026-07-28",
    description: "Every 15 min via worker node-cron · drains durable BrainBusEvent queue through the handler registry (task/goal/journal/drift/cron-failure → BrainMemory).",
    memory: 512,
    maxDuration: 120,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "daily 5am" retired; the route is in
    // WEEKLY_JOBS, which the evening fan-out appends only on Sunday-ET —
    // i.e. the Monday 03:00 UTC run (= Sunday 10/11pm ET). Weekly matches
    // the route's own doc ("Schedule: weekly (Sundays)").
    name: "inbox-janitor",
    schedule: "0 3 * * 1",
    mode: "active",
    category: "hygiene",
    description: "Weekly (Sunday-ET) via mega-evening weekly fan-out · sweeps CaptureInboxItem rows · auto-categorizes the cleanest ones · proposes mission for the rest.",
    memory: 512,
    maxDuration: 60,
  },
  {
    name: "data-source-health",
    schedule: null,
    mode: "folded",
    category: "hygiene",
    foldedInto: "mega",
    description:
      "FOLDED into mega (morning) · the data-source canary · probes the nickstire bridge + service feeders and writes data_source_probe rows the /system/health operational rollup reads to flag a dead bridge / $0-revenue feeder. Pipeline+reader existed since v10.0.58 but the cron was never wired — it ran zero times, which is why the revenue-$0 regression went uncaught.",
    addedAt: "2026-05-29",
  },
  {
    name: "subtask-usage-audit",
    schedule: "0 3 * * *", // matches the mega-evening slot it actually rides
    mode: "active",
    category: "hygiene",
    description: "Daily audit via mega-evening fan-out of subtask feature usage per ADR-0017 A1 gate; self-fires on/after 2026-06-22 to clean up files if unused.",
    memory: 256,
    maxDuration: 60,
    addedAt: "2026-06-11",
  },
  {
    name: "cron-healer",
    schedule: null,
    mode: "folded",
    category: "hygiene",
    foldedInto: "mega-evening",
    description: "FOLDED into mega-evening · Self-healing background agent that checks for failing or never-run crons and triggers API-level runbook resets.",
    addedAt: "2026-06-13",
  },

  // ── REVIEW ──────────────────────────────────────────────────────────
  {
    // 2026-07-09 · sweep · pre-Wave-AE "Sun 2pm" retired; the route is in
    // WEEKLY_JOBS → fires on the Sunday-ET evening fan-out run, which is
    // Monday 03:00 UTC (= Sunday 10/11pm ET).
    name: "weekly-review",
    schedule: "0 3 * * 1",
    mode: "active",
    category: "review",
    description: "Weekly (Sunday-ET) via mega-evening weekly fan-out · writes the weekly review prompt + opens the wizard nudge.",
    memory: 512,
    maxDuration: 60,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "Sun 1pm" retired; the route is in
    // WEEKLY_JOBS → fires on the Sunday-ET evening fan-out run, which is
    // Monday 03:00 UTC (= Sunday 10/11pm ET).
    name: "weekly-digest",
    schedule: "0 3 * * 1",
    mode: "active",
    category: "review",
    description: "Weekly (Sunday-ET) via mega-evening weekly fan-out · composite digest across missions + relationships + journal + brain · Telegram push.",
    memory: 1024,
    maxDuration: 120,
  },
  {
    name: "pricing-advisory",
    schedule: "0 3 * * 1",
    // 2026-07-09 · AG-19 · fires via the WEEKLY_JOBS Sunday-ET evening
    // fan-out (same slot-shift precedent as relationship-weekly-synthesis);
    // idempotent per run-date via BrainMemory upsert. Sweep: schedule now
    // states the actual slot (Mon 03:00 UTC = Sunday 10/11pm ET) instead
    // of the intended-standalone "0 23 * * 0".
    mode: "active",
    category: "review",
    description: "Weekly (Sunday-ET) pricing advisory via mega-evening weekly fan-out · ALG win-rate outliers vs fleet median → competitor prices → drafted experiments · coach-event banner + chat tool read it.",
    memory: 512,
    maxDuration: 120,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "0 23" retired; fires 2×/day via
    // BOTH fan-outs — ?slot=morning in MORNING_JOBS (9:00 UTC) and
    // ?slot=evening in EVENING_JOBS (03:00 UTC).
    name: "journal-checkin",
    schedule: "0 3,9 * * *",
    mode: "active",
    category: "review",
    description: "2×/day via mega-morning (slot=morning) + mega-evening (slot=evening) fan-outs · Telegram prompt with the day's journal question · operator can SMS reply.",
    memory: 256,
    maxDuration: 30,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "0 0" retired; fires 1×/day via
    // the mega-evening fan-out (03:00 UTC).
    name: "os-snapshot",
    schedule: "0 3 * * *",
    mode: "active",
    category: "review",
    description: "Nightly via mega-evening fan-out · captures the day's DailyEmpireSnapshot row for trend analysis.",
    memory: 512,
    maxDuration: 60,
  },
  {
    // 2026-07-11 · resurrected. Deleted in the Wave-AE prune and never
    // re-wired — computeIdentitySnapshot had ZERO scheduled callers, so the
    // 8-axis self-model froze at the last manual refresh and every consumer
    // (pulse ticker nudges, chat context, drift engines) served stale axes.
    name: "refresh-identity",
    schedule: null,
    mode: "folded",
    category: "brain",
    foldedInto: "mega-evening",
    description: "FOLDED into mega-evening · rolls the 8-axis identity snapshot (BrainMemory identity_snapshot/current + daily history row) so nudges + pulse read fresh axes.",
    memory: 512,
    maxDuration: 120,
  },
  {
    name: "xp-decay",
    schedule: null,
    mode: "folded",
    category: "review",
    foldedInto: "mega-evening",
    description:
      "FOLDED into mega-evening · Wave-8 (2026-07-29, operator-decided): loss-aversion decay — stats idle past the 7-day grace bleed XP via NEGATIVE mastery_xp_event rows (reversible event-sourcing, idempotent per stat per day via decay:<stat>:<date> keys). Wires the decayXp math that sat tested-but-unwired since 2026-06-01.",
    memory: 512,
    maxDuration: 60,
  },
  {
    name: "anticipate",
    schedule: null,
    mode: "folded",
    category: "review",
    foldedInto: "mega-evening",
    description: "FOLDED into mega-evening (~10-11pm ET) · drafts + precomputes tomorrow's 3 anticipated questions · keyed to the BUILD day, so readers fall back to yesterday's key next morning. (Manifest previously claimed a standalone 'Daily 7am UTC' schedule that nothing executed — corrected 2026-06-10.)",
    memory: 512,
    maxDuration: 60,
  },

  // ── RELATIONSHIPS (Power Atlas) ─────────────────────────────────────
  {
    name: "relationship-digest",
    schedule: "0 22 * * 0",
    mode: "dormant",
    category: "review",
    description: "Sunday 10pm UTC · Greene-voiced weekly relationship digest · cooling + birthdays-this-week · idempotent per ISO week.",
    memory: 512,
    maxDuration: 60,
    addedAt: "2026-05-27",
  },
  {
    name: "relationship-birthday",
    schedule: "0 9 * * *",
    // 2026-06-02 · operator-authorized · wired into MORNING_JOBS (mega
    // fan-out, 9:00 UTC daily). Daily cadence + idempotent per
    // personId+date+kind, so the slot shift from noon UTC to 9:00 UTC is
    // harmless (same-day push). 2026-07-09 sweep: schedule string now
    // states the actual slot instead of the pre-wiring "0 12".
    mode: "active",
    category: "review",
    description: "Daily via mega-morning fan-out · birthday + anniversary push · idempotent per personId+date.",
    memory: 256,
    maxDuration: 30,
    addedAt: "2026-05-27",
  },
  {
    name: "relationship-weekly-synthesis",
    schedule: "0 3 * * 1",
    // 2026-06-02 · operator-authorized · wired into WEEKLY_JOBS, which the
    // evening fan-out appends only on Sunday-ET — an EXACT match for this
    // cron's intended Sunday (0 23 * * 0) cadence. Idempotent per ISO
    // week, so the Sunday-23:00-UTC → Sunday-ET-evening-fan-out slot shift
    // is harmless (same ISO week). 2026-07-09 sweep: schedule string now
    // states the actual slot (Mon 03:00 UTC = Sunday 10/11pm ET).
    mode: "active",
    category: "review",
    description: "Wave AB · weekly (Sunday-ET) via mega-evening weekly fan-out · 3-paragraph synthesis of week's relationship movement · idempotent per ISO week.",
    memory: 512,
    maxDuration: 60,
    addedAt: "2026-05-28",
  },
  {
    name: "kept-word-scan",
    schedule: "0 9 * * *",
    // 2026-06-02 · operator-authorized · wired into MORNING_JOBS (mega
    // fan-out, 9:00 UTC daily). Daily cadence + per-(personId,
    // chatMessageId) upsert over the last 24h of chat, so firing in the
    // morning slot instead of 2:00 UTC is the correct daily cadence.
    // 2026-07-09 sweep: schedule string now states the actual slot.
    mode: "active",
    category: "brain",
    description: "Daily via mega-morning fan-out · scans last 24h chat for promises · upserts KEPT_WORD rows · drives ledger trust score.",
    memory: 512,
    maxDuration: 120,
    addedAt: "2026-05-27",
  },
  {
    name: "dossier-autodraft",
    schedule: "0 9 * * 1",
    // 2026-06-02 · WIRED + ACTIVE (operator-authorized). The mega fan-out
    // has no Monday day-gate, so the ROUTE self-gates on getUTCDay()===1
    // (Monday UTC) and no-ops the other 6 days -- weekly-Monday cadence
    // through the daily MORNING_JOBS fan-out without the 7x AI spend that
    // blind daily firing would cause. (Alt was an Inngest-native 0 4 * * 1
    // trigger; the route-local self-gate is the simpler, lower-risk fix.)
    // 2026-07-09 sweep: schedule string now states the effective slot —
    // Monday 9:00 UTC (mega-morning run that passes the self-gate).
    mode: "active",
    category: "brain",
    description: "Monday via mega-morning fan-out (route self-gates to Monday UTC) · drafts dossier MD updates for PersonProfile rows with stale dossiers · operator confirms via action queue.",
    memory: 1024,
    maxDuration: 300,
    addedAt: "2026-05-27",
  },
  {
    name: "greene-law-tag-refresh",
    schedule: "0 9 * * 1",
    // 2026-06-02 · WIRED + ACTIVE (operator-authorized). Same self-gate
    // pattern as dossier-autodraft: the route checks getUTCDay()===1
    // (Monday UTC) and no-ops the other 6 days, so it gets its weekly
    // cadence through the daily MORNING_JOBS fan-out without 7x AI spend.
    // 2026-07-09 sweep: schedule string now states the effective slot —
    // Monday 9:00 UTC (mega-morning run that passes the self-gate).
    mode: "active",
    category: "brain",
    description: "Wave Z · Monday via mega-morning fan-out (route self-gates to Monday UTC) · refreshes per-person applicableLaws array from corpus · feeds /relationships GreeneLawSidebar.",
    memory: 512,
    maxDuration: 120,
    addedAt: "2026-05-27",
  },

  // ── SIGNALS / ALERTS ────────────────────────────────────────────────
  {
    // 2026-07-09 · sweep · pre-Wave-AE "0 18" retired; fires 1×/day via
    // the mega-evening fan-out (03:00 UTC).
    name: "correlation-alarm",
    schedule: "0 3 * * *",
    mode: "active",
    category: "signals",
    description: "Nightly via mega-evening fan-out · cross-source correlation anomaly detector · writes to Coach Channel (P1).",
    memory: 512,
    maxDuration: 60,
  },
  {
    name: "decision-quality-drift",
    schedule: "0 16 * * 1",
    mode: "dormant",
    category: "signals",
    description: "Monday 4pm UTC · weekly decision-quality scan · Coach Channel (P0).",
    memory: 512,
    maxDuration: 60,
    addedAt: "2026-04-29",
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "every 4h" retired; fires 1×/day
    // via the mega-evening fan-out (03:00 UTC).
    name: "creation-spike-detect",
    schedule: "0 3 * * *",
    mode: "active",
    category: "signals",
    description: "Nightly via mega-evening fan-out · detects abnormal creation-rate spikes across BrainMemory + Task + Mission + Ledger · flag in /system/health.",
    memory: 256,
    maxDuration: 30,
  },
  {
    // 2026-07-09 · sweep · pre-Wave-AE "hourly" retired; fires 1×/day via
    // the mega-evening fan-out (03:00 UTC). NOTE: this means budget-cap
    // breaches are detected nightly, not hourly — if hourly detection is
    // wanted again, that's a jobs.ts / Inngest-trigger decision, not a
    // manifest edit.
    name: "cost-slo-check",
    schedule: "0 3 * * *",
    mode: "active",
    category: "signals",
    description: "Nightly via mega-evening fan-out · AI cost SLO check · Coach Channel push (P0) when daily spend > budget cap.",
    memory: 256,
    maxDuration: 30,
  },
  // proactive-push removed (duplicate of proactive-push-cron)


  // ── ACTION (Wave AG · Nick Action Queue) ────────────────────────────
  // Wave AK · 2026-05-28 · 7am UTC prewarm of the relationships-picks
  // cache so the 8am proposer's outreach source has data. Audit caught
  // the silent-degrade · cache was lazy (only on /relationships visit)
  // so 8am cron at 3-4am ET ran with empty outreach slot every day.
  {
    name: "relationship-picks-prewarm",
    schedule: null,
    mode: "folded",
    category: "action",
    foldedInto: "mega-morning",
    description: "Daily 7am UTC · pre-warms RELATIONSHIPS_PICKS_TODAY cache so the 8am nick-action-proposal has outreach data. Idempotent · returns cached value if already populated.",
    memory: 512,
    maxDuration: 60,
    addedAt: "2026-05-28",
  },
  {
    name: "nick-action-proposal",
    schedule: null,
    mode: "folded",
    category: "action",
    foldedInto: "mega-morning",
    description: "Daily 8am UTC · Nick proposes 3-6 actions (SMS outreach · mission archive · task move · journal commit · AI spend confirm) · writes AutonomousAction rows + Telegram push w/ approve/reject syntax. Wave AK alerting · sends Telegram on failure.",
    memory: 1024,
    maxDuration: 300,
    addedAt: "2026-05-28",
  },
  {
    name: "nick-action-execute",
    schedule: null,
    mode: "folded",
    category: "action",
    foldedInto: "mega-morning",
    description: "Daily 9am UTC · executes operator-approved AutonomousAction rows from the last 24h · logs results to ledger/journal/brain.",
    memory: 1024,
    maxDuration: 600,
    addedAt: "2026-05-28",
  },
  {
    name: "autonomous-engine",
    schedule: null,
    mode: "folded",
    category: "action",
    foldedInto: "mega-evening",
    description: "FOLDED into mega-evening · NICK_AUTONOMY-gated proactive engine (~22 rules: revenue-pace, urgent-leads, drift escalation, commitment enforcement, morning brief, expired-quote follow-up). Hard-skips when the flag is off. FAIL-CLOSED: every rule defers to /system/approvals unless an explicit `auto` AutomationPolicy exists — nothing auto-sends.",
  },
  {
    name: "neglect-penalty",
    schedule: "0 */4 * * *", // Runs every 4 hours
    mode: "dormant",
    category: "hygiene",
    inngest: true,
    description: "Systemic decay enforcer. Deducts XP from neglected missions that idle for >48h and fires a Telegram alert.",
  },
  {
    name: "change-detection",
    schedule: "0 13 * * *", // daily ~9am ET — fires via the MORNING_JOBS fan-out
    mode: "active",
    category: "review",
    maxDuration: 120,
    path: "/api/cron/change-detection",
    addedAt: "2026-07-22",
    description: "change-detection-lite external-change sensor — Firecrawl scrape + content-hash of watched competitor/regulatory pages into page_snapshots. Observe-only, no autonomous action.",
  },
  {
    name: "experiment-measure",
    schedule: "0 3 * * *", // daily ~10pm ET — fires via the EVENING_JOBS fan-out
    mode: "active",
    category: "review",
    maxDuration: 120,
    path: "/api/cron/experiment-measure",
    addedAt: "2026-07-22",
    description: "Closed-loop Experiment resolver — resolves DUE experiments (accepted opportunities past their horizon), scores whether each hypothesis held up, and feeds a bounded, reversible nudge into the attributed source's authScore. Observe + learn only, no autonomous action.",
  },
];

/** Names of crons that SHOULD exist as routes (for verifier). */
export function expectedCronRouteNames(): Set<string> {
  const names = new Set<string>();
  for (const c of CRONS) {
    // Skip mega-evening (same route as mega) + Inngest-native crons (no route).
    if (c.name === "mega-evening" || c.inngest) continue;
    names.add(c.name);
  }
  return names;
}
