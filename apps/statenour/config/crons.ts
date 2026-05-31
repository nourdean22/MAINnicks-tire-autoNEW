/**
 * Cron manifest — single source of truth for every scheduled job.
 *
 * statenour deploys on Railway (not Vercel) — there is no `vercel.json`.
 * Scheduled jobs run through the mega fan-out + the Inngest evening
 * job list (`src/inngest/jobs.ts`). `pnpm check:crons` validates this
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
 *     src/inngest/jobs.ts; the `schedule` field documents the intended
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
   * trigger (src/inngest/functions/*), NOT a Railway /api/cron route and
   * NOT the mega fan-out. `pnpm check:crons` skips the route-file check
   * for these and treats them as independently-reachable.
   */
  inngest?: boolean;
}

export const CRONS: CronDef[] = [
  // ── INNGEST-NATIVE ──────────────────────────────────────────────────
  // Fire via their own Inngest cron trigger (src/inngest/functions/*),
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
    description: "Out-of-band fan-out liveness watchdog — the canary added after the 2-day fan-out outage.",
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
    name: "goal-pruner",
    schedule: "0 12 * * *",
    mode: "active",
    category: "hygiene",
    inngest: true,
    description: "Prunes stale / abandoned goals — Inngest-native.",
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
    schedule: "0 2 * * *", // 2am UTC = 10pm ET evening slot
    mode: "active",
    category: "compose",
    description: "Evening composite — reflect + consolidate + weekly-digest eligibility",
    memory: 1024,
    maxDuration: 120,
  },

  // ── INGEST ──────────────────────────────────────────────────────────
  {
    name: "ingest-gmail",
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
    name: "embed-backfill",
    schedule: "0 3 * * 0",
    mode: "active",
    category: "brain",
    description: "Weekly embedding backfill for any new BrainMemory rows · Sun 3am UTC",
    memory: 1024,
    maxDuration: 300,
  },
  {
    name: "conversation-mission-link",
    schedule: "*/15 * * * *",
    mode: "active",
    category: "brain",
    description: "Every 15min · scans new chat messages for mission-relevance, writes ConversationMissionLink rows so Nick can answer 'what mission was this about?'",
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
    name: "predict",
    schedule: "0 12 * * *",
    mode: "active",
    category: "brain",
    description: "Daily noon UTC predict · forecasts week ahead based on patterns; writes Prediction rows.",
    memory: 1024,
    maxDuration: 120,
  },
  {
    name: "reflect-categories",
    schedule: "0 3 * * 0",
    mode: "dormant",
    category: "brain",
    description: "Weekly Sunday 3am · reflects on BrainMemory category distribution, surfaces deltas, writes operator-facing reflection rows.",
    memory: 512,
    maxDuration: 120,
  },
  {
    name: "intelligence",
    schedule: "0 */6 * * *",
    mode: "active",
    category: "brain",
    description: "Every 6h · cross-source intelligence synthesis · writes high-confidence signals into BrainMemory(intelligence).",
    memory: 1024,
    maxDuration: 180,
  },

  // ── HYGIENE ─────────────────────────────────────────────────────────
  {
    name: "task-resurface",
    schedule: "0 6 * * *",
    mode: "active",
    category: "hygiene",
    description: "6am UTC · snoozed tasks past their resurface date flip back to READY.",
    memory: 256,
    maxDuration: 30,
  },
  {
    name: "stale-tasks",
    schedule: "0 4 * * 1",
    mode: "active",
    category: "hygiene",
    description: "Weekly Mon 4am · flags tasks >30d untouched as stale for the next weekly review.",
    memory: 256,
    maxDuration: 60,
  },
  {
    name: "data-cleanup",
    schedule: "0 1 * * 0",
    mode: "active",
    category: "hygiene",
    description: "Weekly Sun 1am · trims old logs, orphan rows, soft-deleted records past TTL.",
    memory: 512,
    maxDuration: 300,
  },
  {
    name: "inbox-janitor",
    schedule: "0 5 * * *",
    mode: "active",
    category: "hygiene",
    description: "Daily 5am · sweeps CaptureInboxItem rows · auto-categorizes the cleanest ones · proposes mission for the rest.",
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

  // ── REVIEW ──────────────────────────────────────────────────────────
  {
    name: "weekly-review",
    schedule: "0 14 * * 0",
    mode: "active",
    category: "review",
    description: "Sunday 2pm UTC · writes the weekly review prompt + opens the wizard nudge.",
    memory: 512,
    maxDuration: 60,
  },
  {
    name: "weekly-digest",
    schedule: "0 13 * * 0",
    mode: "active",
    category: "review",
    description: "Sunday 1pm UTC · composite digest across missions + relationships + journal + brain · Telegram push.",
    memory: 1024,
    maxDuration: 120,
  },
  {
    name: "daily-report",
    schedule: "0 22 * * *",
    mode: "active",
    category: "review",
    description: "Daily 10pm UTC · operator-day summary · what shipped, what stalled, what compounded.",
    memory: 512,
    maxDuration: 60,
  },
  {
    name: "journal-checkin",
    schedule: "0 23 * * *",
    mode: "active",
    category: "review",
    description: "Daily 11pm UTC · Telegram prompt with the day's journal question · operator can SMS reply.",
    memory: 256,
    maxDuration: 30,
  },
  {
    name: "os-snapshot",
    schedule: "0 0 * * *",
    mode: "active",
    category: "review",
    description: "Daily midnight UTC · captures the day's DailyEmpireSnapshot row for trend analysis.",
    memory: 512,
    maxDuration: 60,
  },
  {
    name: "anticipate",
    schedule: "0 7 * * *",
    mode: "active",
    category: "review",
    description: "Daily 7am UTC · forward-look · what should the operator be ready for today (meetings · deadlines · pattern matches).",
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
    schedule: "0 12 * * *",
    mode: "dormant",
    category: "review",
    description: "Daily 12pm UTC · birthday + anniversary push · idempotent per personId+date.",
    memory: 256,
    maxDuration: 30,
    addedAt: "2026-05-27",
  },
  {
    name: "relationship-weekly-synthesis",
    schedule: "0 23 * * 0",
    mode: "dormant",
    category: "review",
    description: "Wave AB · Sunday 11pm UTC · 3-paragraph synthesis of week's relationship movement · idempotent per ISO week.",
    memory: 512,
    maxDuration: 60,
    addedAt: "2026-05-28",
  },
  {
    name: "kept-word-scan",
    schedule: "0 2 * * *",
    mode: "dormant",
    category: "brain",
    description: "Daily 2am UTC · scans last 24h chat for promises · upserts KEPT_WORD rows · drives ledger trust score.",
    memory: 512,
    maxDuration: 120,
    addedAt: "2026-05-27",
  },
  {
    name: "dossier-autodraft",
    schedule: "0 4 * * 1",
    mode: "dormant",
    category: "brain",
    description: "Monday 4am UTC · drafts dossier MD updates for PersonProfile rows with stale dossiers · operator confirms via action queue.",
    memory: 1024,
    maxDuration: 300,
    addedAt: "2026-05-27",
  },
  {
    name: "greene-law-tag-refresh",
    schedule: "0 5 * * 1",
    mode: "dormant",
    category: "brain",
    description: "Wave Z · Monday 5am UTC · refreshes per-person applicableLaws array from corpus · feeds /relationships GreeneLawSidebar.",
    memory: 512,
    maxDuration: 120,
    addedAt: "2026-05-27",
  },

  // ── SIGNALS / ALERTS ────────────────────────────────────────────────
  {
    name: "correlation-alarm",
    schedule: "0 18 * * *",
    mode: "active",
    category: "signals",
    description: "Daily 6pm UTC · cross-source correlation anomaly detector · writes to Coach Channel (P1).",
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
    name: "creation-spike-detect",
    schedule: "0 */4 * * *",
    mode: "active",
    category: "signals",
    description: "Every 4h · detects abnormal creation-rate spikes across BrainMemory + Task + Mission + Ledger · flag in /system/health.",
    memory: 256,
    maxDuration: 30,
  },
  {
    name: "cost-slo-check",
    schedule: "0 * * * *",
    mode: "active",
    category: "signals",
    description: "Hourly · AI cost SLO check · Coach Channel push (P0) when daily spend > budget cap.",
    memory: 256,
    maxDuration: 30,
  },
  {
    name: "error-telegram-push",
    schedule: "*/10 * * * *",
    mode: "active",
    category: "alert",
    description: "Every 10min · single push pipe for fatal errors · operator gets 1 message per cluster, not 100.",
    memory: 256,
    maxDuration: 30,
  },

  // ── ACTION (Wave AG · Nick Action Queue) ────────────────────────────
  // Wave AK · 2026-05-28 · 7am UTC prewarm of the relationships-picks
  // cache so the 8am proposer's outreach source has data. Audit caught
  // the silent-degrade · cache was lazy (only on /relationships visit)
  // so 8am cron at 3-4am ET ran with empty outreach slot every day.
  {
    name: "relationship-picks-prewarm",
    schedule: "0 7 * * *",
    mode: "dormant",
    category: "action",
    description: "Daily 7am UTC · pre-warms RELATIONSHIPS_PICKS_TODAY cache so the 8am nick-action-proposal has outreach data. Idempotent · returns cached value if already populated.",
    memory: 512,
    maxDuration: 60,
    addedAt: "2026-05-28",
  },
  {
    name: "nick-action-proposal",
    schedule: "0 8 * * *",
    mode: "dormant",
    category: "action",
    description: "Daily 8am UTC · Nick proposes 3-6 actions (SMS outreach · mission archive · task move · journal commit · AI spend confirm) · writes AutonomousAction rows + Telegram push w/ approve/reject syntax. Wave AK alerting · sends Telegram on failure.",
    memory: 1024,
    maxDuration: 300,
    addedAt: "2026-05-28",
  },
  {
    name: "nick-action-execute",
    schedule: "0 9 * * *",
    mode: "dormant",
    category: "action",
    description: "Daily 9am UTC · executes operator-approved AutonomousAction rows from the last 24h · logs results to ledger/journal/brain.",
    memory: 1024,
    maxDuration: 600,
    addedAt: "2026-05-28",
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
