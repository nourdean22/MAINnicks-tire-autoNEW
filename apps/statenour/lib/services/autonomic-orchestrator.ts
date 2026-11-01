import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { buildCronCommandDeck } from "@/lib/services/system-pages";
import { runManifestCron } from "@/lib/services/cron-control";
import { recordCoachEvent } from "@/lib/services/coach-events";
import { beginAttempt, settleAttempt, canTransition, type AttemptDisposition, type AttemptState } from "@/lib/services/action-attempts";
import { cronPeriodH } from "@/lib/inngest/functions/cron-heartbeat";
import { CRON_STATUS, TERMINAL_OK_STATUSES } from "@/lib/inngest/cron-lifecycle";
import { HARD_FAILURE_STATUSES, isHardFailure } from "@/lib/services/cron-status";
import { daysAgo } from "@/lib/utils/datetime";
import { markOllamaQuotaExhausted } from "@/lib/ai/provider";
import { WorkItemStatus, TaskStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { EVENING_JOBS, MORNING_JOBS, WEEKLY_JOBS } from "@/lib/inngest/jobs";

const log = logger.withSurface("services/autonomic-orchestrator");

/** "/api/cron/x?slot=y" -> "/api/cron/x". The fan-out lists carry query strings. */
function routeOf(path: string): string {
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}

/**
 * Routes the healer must never fire, because the fan-out that RUNS the healer
 * is dispatching them in the same slot.
 *
 * 2026-10-03 · measured. cron-healer is an EVENING_JOBS child, so it executes
 * while every sibling is still in flight — and a sibling's CronJobLog row only
 * lands when it FINISHES. A brand-new sibling therefore always reads
 * "never_run" to the healer on its first night, and a sibling whose last run
 * failed always reads "failing". Either way the healer started a second copy
 * alongside the fan-out's own: `think` (added 10-02) logged two success rows on
 * 10-03, both started at 03:02:44 — prod log `trigger_healing {jobName:"think",
 * reason:"never_run"}` at 03:02:44.588. For a sibling there is nothing to
 * rescue: the fan-out is already running it, and runs it again tomorrow.
 */
const FANOUT_SIBLING_ROUTES: ReadonlySet<string> = new Set(
  [...EVENING_JOBS, ...WEEKLY_JOBS].map(routeOf),
);

/** Folded morning-slot children carry `schedule: null`; this fan-out runs them daily. */
const MORNING_ROUTES: ReadonlySet<string> = new Set(MORNING_JOBS.map(routeOf));

const HOUR_MS = 3_600_000;
const HEAL_TOOL = "cron.heal";

/**
 * How long a failed run stays healable: one cadence plus grace, the windows
 * cron-heartbeat judges silence by (26h daily-or-faster, 8d weekly). A job with
 * no schedule of its own in the morning fan-out is daily, as in
 * cron-heartbeat's expectedJobs. Null when the cadence is unknown.
 */
function healWindowMs(schedule: string | null | undefined, route: string): number | null {
  const periodH = cronPeriodH(schedule) ?? (MORNING_ROUTES.has(route) ? 24 : null);
  if (periodH === null) return null;
  return (periodH <= 24 ? 26 : 24 * 8) * HOUR_MS;
}

/**
 * Settle a heal's claim by what came back. An HTTP response or a throw is a
 * known outcome (runManifestCron throws only before it sends). Only no response
 * (status 0: timeout, network) is UNKNOWN, because the job may still be
 * running; resolveTimedOutHeals settles it on the healer's next run.
 */
/**
 * The re-fired run's own verdict. cronHandler keeps HTTP 200 for a route that
 * resolved with `ok: false` (cron-manager files the row red), so a 200 is not a
 * rescue: on 2026-11-01 "Rescued data-source-health · Status 200" posted for a
 * run that had just filed "1 of 7 probes failing". Null when the body carries
 * no failure claim or cannot be read (truncated at 2,000 chars, not JSON).
 */
function reportedFailureIn(body: string | undefined): string | null {
  if (!body) return null;
  try {
    const data = (JSON.parse(body) as { data?: unknown }).data;
    if (!data || typeof data !== "object" || (data as { ok?: unknown }).ok !== false) return null;
    const { reason, error } = data as { reason?: unknown; error?: unknown };
    return typeof reason === "string" ? reason : typeof error === "string" ? error : "handler returned ok:false";
  } catch {
    return null;
  }
}

/** Healer alerts are about one night's run; without an expiry they stayed on the Pulse for weeks. */
const HEAL_EVENT_TTL_MS = 25 * HOUR_MS;
/** A DOING task untouched this long is flagged once (see Phase 5). */
const STALL_FLAG_AFTER_MS = 72 * HOUR_MS;

async function settleHeal(attemptId: string | null, disposition: AttemptDisposition, reason: string): Promise<void> {
  if (!attemptId) return;
  await settleAttempt(attemptId, { disposition, reason }).catch((err: unknown) =>
    log.error("heal_claim_settle_failed", { attemptId, error: err instanceof Error ? err.message : String(err) }),
  );
}

/** A real run's row, in flight or ended; never `duplicate` (the deck's CRON_RUN_STATUSES). */
const RUN_STATUSES: string[] = [CRON_STATUS.started, ...TERMINAL_OK_STATUSES, ...HARD_FAILURE_STATUSES];

/**
 * A live heal settles within about a minute of its claim (triggerCronByPath aborts
 * at 55 s). An EXECUTING claim older than this lost its healer mid-flight (P-HEAL).
 */
const HEAL_EXECUTING_STALE_MS = 15 * 60_000;

/**
 * Heals claimed from this instant on send x-cron-trigger-id: heal:<attemptId>, and
 * the healed run's row carries it (cron_job_logs."triggerId"). Earlier claims were
 * fired without it and settle by the old name+time rule.
 * shortcut: must fall after the deploy that ships trigger ids (a claim after it with
 * no stamped row stays UNKNOWN); delete it and the legacy branch once no pre-cutoff
 * heal is open.
 */
const HEAL_TRIGGER_CUTOFF = new Date("2026-10-18T00:00:00Z");

/**
 * Settle a heal by compare-and-set on the state the resolver READ (claim-before-act):
 * a heal that settled itself in between keeps its own outcome. False = it moved, or
 * the transition is not legal in TRANSITIONS; either way, leave it.
 */
async function casHeal(id: string, from: AttemptState, to: AttemptState, reason: string, receiptId: string): Promise<boolean> {
  if (!canTransition(from, to)) return false;
  const res = await prisma.actionAttempt.updateMany({
    where: { id, state: from },
    data: { state: to, settledAt: new Date(), reason: reason.slice(0, 500), receiptId, ...(to === "FAILED" ? { holdUntil: null } : {}) },
  });
  return res.count === 1;
}

/**
 * triggerCronByPath aborts at 55 s and most cron routes run longer, so a heal
 * of a long job settles UNKNOWN while the job keeps running, and nothing else
 * ever resolves an UNKNOWN. The healed route opens its own cron_job_logs row on
 * entry (logCronRun), stamped with the heal's trigger id, so that row is the
 * heal's run: settle the claim by how that row ended. No row yet, or one
 * still `started`, stays as it is. An EXECUTING claim past HEAL_EXECUTING_STALE_MS
 * (its healer was killed before settling) is resolved the same way.
 */
async function resolveTimedOutHeals(): Promise<void> {
  const open = await prisma.actionAttempt.findMany({
    where: {
      tool: HEAL_TOOL,
      OR: [
        { state: "UNKNOWN" },
        { state: "EXECUTING", startedAt: { lt: new Date(Date.now() - HEAL_EXECUTING_STALE_MS) } },
      ],
    },
    select: { id: true, operationKey: true, startedAt: true, state: true },
    // Newest first: those are the ones still on the owner panel.
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  for (const attempt of open) {
    // The claim's key is cron-heal:<job>:<failed run ISO> (see beginAttempt below).
    const jobName = /^cron-heal:([^:]+):/.exec(attempt.operationKey)?.[1];
    if (!jobName) continue;
    // Match the row the heal's own request opened; a scheduled run of the same job
    // (no trigger id) or another heal's run must never settle this claim.
    const which =
      attempt.startedAt < HEAL_TRIGGER_CUTOFF
        ? { createdAt: { gte: attempt.startedAt } }
        : { triggerId: `heal:${attempt.id}` };
    const run = await prisma.cronJobLog.findFirst({
      where: { jobName, ...which, status: { in: RUN_STATUSES } },
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (!run || run.status === CRON_STATUS.started) continue;
    const reason = `healed run cron_job_logs ${run.id}: ${run.status} at ${run.createdAt.toISOString()}`;
    const from = attempt.state as AttemptState;
    if (TERMINAL_OK_STATUSES.includes(run.status)) {
      // EXECUTING cannot jump to VERIFIED (TRANSITIONS): record the success, then verify it.
      const ready = from === "EXECUTING" ? await casHeal(attempt.id, from, "SUCCEEDED_UNVERIFIED", reason, run.id) : true;
      if (ready) await casHeal(attempt.id, from === "EXECUTING" ? "SUCCEEDED_UNVERIFIED" : from, "VERIFIED", reason, run.id);
    } else if (isHardFailure(run.status)) {
      await casHeal(attempt.id, from, "FAILED", reason, run.id);
    }
  }
}

export interface AutonomicOrchestratorResult {
  healedCrons: string[];
  cronErrors: string[];
  ollamaQuotaTripped: boolean;
  rescuedWorkItems: string[];
  archivedTasksCount: number;
  stalledTasksFlagged: number;
}

export async function runAutonomicOrchestrator(): Promise<AutonomicOrchestratorResult> {
  log.info("start_orchestrator");

  const result: AutonomicOrchestratorResult = {
    healedCrons: [],
    cronErrors: [],
    ollamaQuotaTripped: false,
    rescuedWorkItems: [],
    archivedTasksCount: 0,
    stalledTasksFlagged: 0,
  };

  // ---------------------------------------------------------------------------
  // Phase 1: Cron Self-Healing
  // ---------------------------------------------------------------------------
  try {
    // Its own guard: a failed read leaves earlier heals UNKNOWN and heals anyway.
    await resolveTimedOutHeals().catch((err: unknown) =>
      log.error("heal_unknown_resolve_failed", { error: err instanceof Error ? err.message : String(err) }),
    );

    const deck = await buildCronCommandDeck();
    const MAX_HEAL_PER_RUN = 3;
    const now = Date.now();

    for (const row of deck.rows) {
      if (result.healedCrons.length >= MAX_HEAL_PER_RUN) {
        break;
      }

      // Skip retired, disabled, or self
      if (row.mode === "retired" || !row.enabled || row.name === "cron-healer") {
        continue;
      }

      // 2026-08-20 · NEVER re-trigger a fan-out parent. `cron-healer` runs
      // INSIDE the mega fan-out — lib/inngest/jobs.ts EVENING_JOBS contains
      // "/api/cron/cron-healer" — so "healing" mega / mega-evening re-enters
      // this very orchestrator. Mutual recursion with no base case: it ran
      // mega-evening 1,237 times between 03:04Z and 08:38Z (zero green) and
      // dragged every other cron to ~450 runs/hour with it. Re-running a
      // whole fan-out was never a targeted heal anyway — the unit worth
      // rescuing is the individual child, which the fan-out already retries.
      const targetPath = row.path ?? `/api/cron/${row.name}`;
      // Exact route (+ optional query) — a bare prefix would also skip a
      // future unrelated cron that merely starts with "mega".
      if (targetPath === "/api/cron/mega" || targetPath.startsWith("/api/cron/mega?")) {
        continue;
      }

      // 2026-10-03 · "dormant" = operator-parked, deliberately NOT scheduled
      // (config/crons.ts). A parked cron never runs, so after 14 days it always
      // looks "never_run" and the healer revived it: relationship-digest (dormant,
      // sends a Telegram) ran on 09-03, 09-18 and 10-03 — exactly every time its
      // last row aged out of the 14d window. Parking is the operator's call.
      if (row.mode === "dormant") {
        continue;
      }

      // A sibling in the healer's own fan-out is in flight right now — see
      // FANOUT_SIBLING_ROUTES. Healing it is a duplicate run, not a rescue.
      if (FANOUT_SIBLING_ROUTES.has(routeOf(targetPath))) {
        continue;
      }

      // Failing means the LAST run failed — not "failed once this fortnight".
      // `fail14d > 0` kept re-rescuing already-green jobs, which is why the
      // operator woke to a wall of "Rescued ingest-reviews ... Status: 200"
      // alerts; a 200 is proof it was never broken. `partial` is excluded on
      // purpose: a degraded fan-out is not a dead cron, and re-running it is
      // exactly the recursion guarded against above.
      // 2026-10-10 · and the failure must be RECENT. lastRunAt / lastStatus are
      // the job's real newest row (a per-job read with no time window), so a
      // weekly job whose last run failed weeks ago was re-fired every night.
      // Recent = inside one cadence of the job's schedule. A newest row that is
      // in flight (`started`) has a null lastStatus and is never a failure.
      const healWindow = row.lastStatus === "failed" ? healWindowMs(row.schedule, routeOf(targetPath)) : null;
      if (row.lastStatus === "failed" && healWindow === null) {
        log.warn("heal_skipped_unknown_cadence", { jobName: row.name, schedule: row.schedule });
      }
      const recentFailure =
        healWindow !== null && row.lastRunAt !== null && now - Date.parse(row.lastRunAt) <= healWindow
          ? { at: row.lastRunAt, windowMs: healWindow }
          : null;
      const isFailing = recentFailure !== null;
      // "Nothing recorded in the 14d window" is the never-run meaning, and the
      // 14d counters are that window.
      const runsInWindow =
        row.success14d + (row.partial14d ?? 0) + row.fail14d;
      const isNeverRun = runsInWindow === 0;

      if (isFailing || isNeverRun) {
        const reason = isFailing ? "failing" : "never_run";

        // An Inngest-native job has no HTTP route: runManifestCron throws 409
        // for it, and the throw path paged "NOT running" for a job Inngest runs.
        if (row.inngest && !row.path) {
          log.info("heal_skipped_no_http_path", { jobName: row.name, reason });
          continue;
        }

        // Claim the failed run BEFORE re-firing it (claim-before-act): a second
        // healer run (a fan-out retry, a manual run) must not fire it too, and a
        // heal that wrote no new row (a 404, a throw) must not repeat it tomorrow.
        // A claim store that cannot answer fires nothing: an unclaimed heal is
        // the double-fire this guards against.
        let attemptId: string | null = null;
        if (recentFailure) {
          try {
            const begun = await beginAttempt({
              operationKey: `cron-heal:${row.name}:${recentFailure.at}`,
              tool: HEAL_TOOL,
              argumentsHash: createHash("sha256").update(row.name).digest("hex"),
              effectClass: "write",
              windowMs: recentFailure.windowMs,
            });
            if (begun.kind === "duplicate") {
              log.info("heal_skipped_already_claimed", { jobName: row.name, failedRunAt: recentFailure.at, priorState: begun.state });
              continue;
            }
            attemptId = begun.attemptId;
            // FAILED is re-claimable, so a re-claim inside the window means this
            // failed run's one heal already came back a known failure.
            if (begun.attemptNo > 1) {
              await settleHeal(attemptId, "known_failure", "already healed once for this failed run; not fired again");
              log.info("heal_skipped_already_tried", { jobName: row.name, failedRunAt: recentFailure.at });
              continue;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.cronErrors.push(`${row.name}: heal claim unavailable, not fired: ${msg.slice(0, 200)}`);
            log.error("heal_claim_failed", { jobName: row.name, error: msg });
            continue;
          }
        }

        log.info("trigger_healing", { jobName: row.name, reason });

        try {
          // The trigger id lets resolveTimedOutHeals find this heal's own run row.
          const cronResult = await runManifestCron(row.name, attemptId ? `heal:${attemptId}` : undefined);
          const reported = cronResult.ok ? reportedFailureIn(cronResult.body) : null;
          await settleHeal(
            attemptId,
            cronResult.ok && !reported ? "success" : cronResult.status === 0 ? "unknown" : "known_failure",
            reported ? `heal ran (HTTP ${cronResult.status}) and the job reported failure: ${reported.slice(0, 200)}` : `heal returned HTTP ${cronResult.status}`,
          );
          // runManifestCron throws only BEFORE it sends (unknown, retired or
          // Inngest-only job: the catch below); once sent, a 404 or a dropped
          // connection resolves as {ok:false}.
          // Unconditionally pushing here filed "Cron Healer: Rescued X"
          // coach events for phantom heals, burning the whole
          // MAX_HEAL_PER_RUN budget on 404s before reaching a real cron.
          if (!cronResult.ok || reported) {
            log.warn("heal_attempt_failed", {
              jobName: row.name,
              status: cronResult.status,
              ...(reported ? { reported } : {}),
            });
            continue;
          }
          result.healedCrons.push(row.name);

          await recordCoachEvent({
            kind: "system-alert",
            subjectId: `cron-heal:${row.name}`,
            priority: isFailing ? "P0" : "P1",
            title: `Cron Healer: Rescued ${row.name}`,
            body: `Cron job "${row.name}" was ${reason} and was automatically healed. Status: ${cronResult.status}, duration: ${cronResult.durationMs}ms.`,
            surfaces: ["scoreboard", "home"],
            expiresAt: new Date(Date.now() + HEAL_EVENT_TTL_MS).toISOString(),
            extra: {
              jobName: row.name,
              reason,
              status: cronResult.status,
              durationMs: cronResult.durationMs,
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Only runManifestCron throws in this try (recordCoachEvent never does).
          await settleHeal(attemptId, "known_failure", `heal threw: ${msg.slice(0, 200)}`);
          result.cronErrors.push(`${row.name}: ${msg}`);
          log.error("healing_failed", { jobName: row.name, error: msg });
          // 2026-07-07 · alert-on-silence. A FAILED heal was console-only
          // while successes got coach events — so a dead cron whose rescue
          // kept failing was invisible until someone noticed the missing
          // CronJobLog rows. Best-effort: alerting must never break the
          // remaining heal loop.
          try {
            await recordCoachEvent({
              kind: "system-alert",
              subjectId: `cron-heal-failed:${row.name}`,
              priority: "P0",
              title: `Cron Healer FAILED: ${row.name}`,
              body: `Cron "${row.name}" was ${reason} and the automatic heal attempt threw: ${msg.slice(0, 200)}. Manual investigation needed — this job is currently not running.`,
              surfaces: ["scoreboard", "home"],
              expiresAt: new Date(Date.now() + HEAL_EVENT_TTL_MS).toISOString(),
              extra: { jobName: row.name, reason, error: msg.slice(0, 200) },
            });
            const { sendTelegram } = await import("@/lib/services/telegram");
            await sendTelegram(
              `🔴 <b>Cron healer FAILED</b> to rescue <b>${row.name}</b> (${reason})\n${msg.slice(0, 200)}\nThe job is currently NOT running — needs a look.`,
              undefined,
              "HTML",
            );
          } catch (alertErr) {
            log.error("heal_failure_alert_failed", {
              jobName: row.name,
              error: alertErr instanceof Error ? alertErr.message : String(alertErr),
            });
          }
        }
      }
    }
  } catch (err) {
    log.error("phase_1_cron_healing_failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // ---------------------------------------------------------------------------
  // Phase 2: REMOVED 2026-10-10 (audit 08-F10 / 05-M14)
  // ---------------------------------------------------------------------------
  // The "Database Health Engine" opened a direct pg connection every night,
  // VACUUMed any bloated or >50 MB table, and REINDEXed the 295 MB HNSW index
  // whenever average LLM trace latency passed 150 ms (unrelated to the index,
  // and under a name prod does not have). Unbounded compute on Neon is the risk
  // that already pushed the project read-only. Postgres autovacuum owns routine
  // vacuuming; an index rebuild is operator-run (scripts/reindex-vector-index.ts).

  // ---------------------------------------------------------------------------
  // Phase 3: Pipeline Self-Healing & Quota Circuit Breaker
  // ---------------------------------------------------------------------------
  try {
    const recentErrors = await prisma.agentTrace.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        errorClass: { not: null },
        provider: "ollama",
      },
      select: {
        provider: true,
        errorClass: true,
        errorMessage: true,
      },
      take: 50,
    });

    let ollamaErrorsCount = 0;

    for (const err of recentErrors) {
      const provider = err.provider;
      const msg = (err.errorMessage ?? "").toLowerCase();
      // Billing signals only. Timeouts/resets used to count here, so three slow
      // calls marked the single prod provider quota-exhausted: a slowdown
      // became a full outage for the cooldown window.
      const isQuotaSignal = /\b402\b|payment|insufficient|credit/.test(msg);
      // Instant trip: phrases, not substrings. The old /402|quota|limit/ fired
      // on "time limit exceeded" and on a duration like "4021ms".
      const isQuotaError = /\b402\b|quota|insufficient credit|rate[ -]?limit/.test(msg);

      if (provider === "ollama") {
        if (isQuotaError) {
          result.ollamaQuotaTripped = true;
        } else if (isQuotaSignal) {
          ollamaErrorsCount++;
        }
      }
    }

    if (ollamaErrorsCount >= 3) {
      result.ollamaQuotaTripped = true;
    }
    if (result.ollamaQuotaTripped) {
      log.warn("tripping_ollama_circuit_breaker");
      markOllamaQuotaExhausted();
    }

    // Rescues stalled WorkItems
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const stalledItems = await prisma.workItem.findMany({
      where: {
        OR: [
          { status: WorkItemStatus.CLAIMED, claimedAt: { lt: fifteenMinsAgo } },
          { status: WorkItemStatus.PENDING, createdAt: { lt: fifteenMinsAgo } },
        ],
      },
    });

    for (const item of stalledItems) {
      await prisma.workItem.update({
        where: { id: item.id },
        data: {
          status: WorkItemStatus.FAILED,
          errorCode: "STALLED",
          errorMessage: "WorkItem stuck in running/queued state for >15 minutes. Automatically marked failed by Autonomic Orchestrator.",
        },
      });
      result.rescuedWorkItems.push(item.id);

      await recordCoachEvent({
        kind: "system-alert",
        subjectId: `work-item-stalled:${item.id}`,
        priority: "P0",
        title: `WorkItem Stalled: ${item.type}`,
        body: `WorkItem "${item.id}" (type: ${item.type}) was stuck in ${item.status} status and was marked failed.`,
        surfaces: ["scoreboard", "home"],
      });
    }
  } catch (pipelineErr) {
    log.error("pipeline_self_healing_failed", { error: pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr) });
  }

  // ---------------------------------------------------------------------------
  // Phase 4: Task Janitor
  // ---------------------------------------------------------------------------
  // 2026-10-10 · table retention is NOT this file's job. config/retention.ts
  // names data-cleanup as the enforcer of every table this phase used to prune;
  // the copy here re-ran those deletes in the same nightly slot, dropped to a
  // 7-day window once four tables passed 40k rows, ran a keeper SQL that named
  // job_name / created_at (42703 -> no keepers -> unguarded delete), and filed
  // its own row as `cron:data_cleanup_completed`. One owner: data-cleanup.
  try {
    const taskResult = await prisma.task.updateMany({
      where: {
        status: TaskStatus.READY,
        updatedAt: { lt: daysAgo(30) },
      },
      data: { status: TaskStatus.ARCHIVED },
    });
    result.archivedTasksCount = taskResult.count;
  } catch (janitorErr) {
    log.error("task_janitor_failed", { error: janitorErr instanceof Error ? janitorErr.message : String(janitorErr) });
  }

  // ---------------------------------------------------------------------------
  // Phase 5: Stalled-task flag (propose only)
  // ---------------------------------------------------------------------------
  // 2026-11-01 · PROPOSE, never perform. This phase used to call a DOING task
  // untouched for 2 hours "stalled", AI-decompose it and flip it to WAITING. On
  // 10-31 it turned the operator's parked "Continue planning and then start crm
  // build" (DOING since 10-28) into 6 READY subtasks, two of which contradict the
  // Shop OS plan. Two hours in DOING is normal for a person's multi-day work, and
  // rewriting the operator's own list is not a heal. It now flags a task untouched
  // 3 days, once (the 72-96h window, one nightly run), and changes nothing.
  try {
    const now = Date.now();
    const stalledTasks = await prisma.task.findMany({
      where: {
        status: TaskStatus.DOING,
        updatedAt: { lt: new Date(now - STALL_FLAG_AFTER_MS), gte: new Date(now - STALL_FLAG_AFTER_MS - 24 * HOUR_MS) },
        parentTaskId: null,
        deletedAt: null,
      },
      select: { id: true, title: true, updatedAt: true },
      take: 3,
    });

    for (const task of stalledTasks) {
      await recordCoachEvent({
        kind: "system-alert",
        subjectId: `task-stall:${task.id}`,
        priority: "P2",
        title: `Untouched 3 days in Doing: "${task.title}"`,
        body: `Last change ${task.updatedAt.toISOString().slice(0, 10)}. Break it into a next step, or move it to Waiting if it is parked.`,
        deepLink: "/missions",
        surfaces: ["scoreboard", "home"],
        expiresAt: new Date(now + HEAL_EVENT_TTL_MS).toISOString(),
      });
      result.stalledTasksFlagged++;
    }
  } catch (stallErr) {
    log.error("task_stalling_healer_failed", { error: stallErr instanceof Error ? stallErr.message : String(stallErr) });
  }

  // ---------------------------------------------------------------------------
  // Log Unified P2 Execution Event
  // ---------------------------------------------------------------------------
  try {
    await recordCoachEvent({
      kind: "system-alert",
      subjectId: "autonomic-orchestrator",
      priority: "P2",
      title: "Autonomic Orchestrator Run Completed",
      body: `Phase 1: Healed ${result.healedCrons.length} crons. Phase 3: Ollama Quota tripped: ${result.ollamaQuotaTripped}. Rescued ${result.rescuedWorkItems.length} work items. Phase 4: Archived ${result.archivedTasksCount} stale tasks. Phase 5: Flagged ${result.stalledTasksFlagged} tasks untouched 3 days (no changes made).`,
      surfaces: ["scoreboard", "home"],
    });
  } catch (eventErr) {
    log.error("unified_event_logging_failed", { error: eventErr instanceof Error ? eventErr.message : String(eventErr) });
  }

  log.info("orchestrator_completed", { healed: result.healedCrons.length, stalledFlagged: result.stalledTasksFlagged });
  return result;
}
