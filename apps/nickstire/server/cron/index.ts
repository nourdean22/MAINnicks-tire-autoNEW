/**
 * Cron Job Runner — the HTTP-trigger path and the cross-dyno lock helpers.
 *
 * 2026-08-25 · The first two lines used to read "Registers and executes
 * scheduled tasks / Uses setInterval (no external cron dependency needed)".
 * Both were false: `startAllJobs()` throws (see below) and there is no
 * setInterval in this file. The header outlived its mechanism by the length of
 * the decommission, and described a scheduler that no longer exists directly
 * above the paragraph explaining that it was removed. Found by a canary in
 * cronControlPlane.test.ts asserting the legacy registry schedules nothing —
 * it matched this sentence, which is the shape a stale comment takes when it is
 * the only thing left claiming a dead mechanism is live.
 *
 * Execution is owned by `startTieredScheduler()` in cron/scheduler.ts.
 * `runJobByName()` below still logs each run it performs to cron_log.
 */

import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";

import { BUSINESS } from "@shared/business";
const log = createLogger("cron");

/**
 * A job in the LEGACY registry.
 *
 * This registry no longer schedules anything — `startTieredScheduler()` in
 * cron/scheduler.ts owns execution. What survives here is the HTTP-trigger
 * path (`runJobByName`, used by `/api/bridge/run-job`) and the cross-dyno
 * lock helpers, both of which the scheduler imports.
 *
 * 2026-08-23 · `lastRun`, `running` and `intervalId` were DELETED. Each was
 * written only by `runJob()`, which had zero call sites once `startAllJobs()`
 * was decommissioned — so all three were permanently at their initial value
 * while three consumers read them as if they were live. Deleting the fields
 * with the execution path is the point: a decommission that leaves state
 * readable is silent, and silence reads as health. Run state now comes from
 * cron_log via cron/cron-status.ts, the only record of an actual run.
 *
 * `intervalMs` is retained ONLY as documentation of each job's intended
 * cadence. It schedules nothing; the owning tier's interval is the real
 * cadence and `getJobCadences()` is where to read it.
 */
interface CronJob {
  name: string;
  intervalMs: number;
  handler: () => Promise<{ recordsProcessed?: number; details?: string }>;
  enabled: boolean;
  /**
   * Wall-clock budget for a MANUAL run of this job, and the basis of its lock
   * TTL. Must match the same job's tier budget in scheduler.ts - the two
   * runners fire the same handler, and cronManualRunnerBudget.test.ts pins
   * them equal so they cannot drift.
   */
  timeoutMs?: number;
}

const registeredJobs = new Map<string, CronJob>();

/** Register a cron job */
export function registerJob(
  name: string,
  intervalMs: number,
  handler: () => Promise<{ recordsProcessed?: number; details?: string }>,
  enabled = true,
  timeoutMs?: number,
): void {
  registeredJobs.set(name, { name, intervalMs, handler, enabled, timeoutMs });
  // LEGACY REGISTRY ONLY. This line used to read "Cron job registered: X
  // (every Nmin, enabled)" and was read, on 2026-09-08, as proof that a job
  // was scheduled — it is not. `enabled` here is this function's own parameter
  // default; scheduling is owned entirely by the tiered scheduler, which
  // honours its own `enabled: false` (cron/scheduler.ts). A job can print
  // "enabled" here and never run. Say so in the line itself.
  log.info(`Cron job registered in LEGACY registry (manual-run lookup only, NOT scheduled here — tiers own scheduling): ${name} (every ${Math.round(intervalMs / 60000)}min, legacy flag=${enabled ? "enabled" : "disabled"})`);
}

/** Start all registered jobs */
export function startAllJobs(): void {
  throw new Error("startAllJobs() is decommissioned. Use startTieredScheduler() from cron/scheduler.ts instead.");
}

// `stopAllJobs()` was deleted 2026-08-23 alongside `runJob()`. It cleared
// `job.intervalId`, a field only `startAllJobs()` ever set, and it had no
// callers — shutdown goes through `stopTieredScheduler()` (_core/index.ts).

const MAX_JOB_DURATION_MS = 5 * 60 * 1000; // 5 min safety timeout

/**
 * Default wall-clock budget for one cron handler, and the accessor both runners
 * share.
 *
 * Lives here rather than in scheduler.ts because BOTH entry points need it —
 * the tiered runner and the HTTP/staged trigger in this file — and scheduler.ts
 * already imports from this module, so the dependency only points one way.
 */
// EXPORTED, and it must stay exported. It was briefly made module-private on
// 2026-09-09 because a grep found zero importers -- but server/cronJobBudgets.test.ts,
// added by #2245 hours earlier on a branch that had not yet merged, imports it to pin
// the default and to assert that every provider-calling job's budget EXCEEDS it. That
// test is the whole guard on the ig-autopost timeout fix; without the export it read
// `undefined` and failed with "expected value must be number or bigint".
// The knip orphan gate still flags it, because tests are outside knip's project globs --
// it carries a baseline entry with that reason rather than losing the export again.
export const DEFAULT_JOB_TIMEOUT_MS = 4 * 60 * 1000;
export function jobTimeoutMs(job: { timeoutMs?: number }): number {
  return job.timeoutMs && job.timeoutMs > 0 ? job.timeoutMs : DEFAULT_JOB_TIMEOUT_MS;
}
// Lock TTL = 2× max job duration. If a dyno crashes without releasing,
// the next acquire-attempt waits this long before stealing the lock —
// long enough that a slow-but-alive job isn't preempted, short enough
// that a dead lock self-heals within ~10 minutes.
const LOCK_TTL_MS = MAX_JOB_DURATION_MS * 2;

// Dyno identity — stable for this process lifetime. Used as the
// `holder` column for debugging which Railway dyno owns each lock.
const DYNO_ID = `${process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local"}:${process.pid}`;

/**
 * wave-168 (review-pass): branded token + reason-tagged fallback + release-
 * by-LockResult. Two parallel review agents (silent-failure-hunter and
 * type-design-analyzer) converged on the same critique:
 *   - Untyped `string` tokens let release(wrongToken) compile silently
 *   - `fallback` variant with no reason can't be observed differently
 *     for "table missing during migration window" vs "DB hiccup"
 *   - TTL-expiry steal would be silent (zero-affected-row DELETE swallowed)
 * This rev addresses all three without growing the surface.
 */
type LockToken = string & { readonly __brand: "LockToken" };
export type LockResult =
  | { status: "acquired"; jobName: string; token: LockToken }
  | { status: "held-by-other" }
  | { status: "fallback"; reason: "db-null" | "table-missing" | "query-error"; error?: string };

// MySQL error code for "table doesn't exist" — used to distinguish the
// expected "migration not yet applied" case from real SQL bugs.
const ER_NO_SUCH_TABLE = 1146;

// One-shot health flag: once we hit table-missing we suppress the per-
// tick warn-spam so a single startup-time error remains visible to ops
// without the noise. Reset on process restart.
let _lockTableMissingLogged = false;

/**
 * Race-safe distributed lock acquire. Uses MySQL INSERT ... ON DUPLICATE
 * KEY UPDATE with a token-comparison check — atomic at row-level under
 * concurrent processes. If locked_until is in the past, the UPDATE branch
 * steals; otherwise the row is untouched.
 */
/**
 * Locks this process currently holds, so shutdown can hand them back.
 *
 * A deploy replaces the container mid-pulse and the dying process never
 * released its lock, so the job stayed blocked for the FULL TTL - which the
 * per-job budget work lengthened from 10 minutes to 28 for reel-pipeline.
 * Measured 2026-09-09: a holder took the lock at 12:41, the 12:49 deploy killed
 * it, and reel-pipeline was skipped on every pulse until 13:09. Six deploys
 * that day, so roughly an hour of dead pipeline nobody asked for.
 */
const heldLocks = new Map<string, LockToken>();

/**
 * Shutdown drain (Q-10). Every runner in this app — the tiered pass
 * (scheduler.ts runTier), the manual tier run (runTierJobByName) and the HTTP
 * trigger (runJobByName) — reports each handler it starts here, and checks
 * `isCronDraining()` immediately before starting one. On SIGTERM the server
 * calls `beginCronDrain()`, so no NEW handler starts, while the ones already
 * running are awaited up to the shutdown grace budget (_core/gracefulShutdown.ts)
 * instead of being killed by a fixed 10-second force-exit.
 *
 * The handler promise itself is tracked, not the timeout race around it: a job
 * past its budget is still doing work, and exiting under it is the thing this
 * guards against.
 */
let cronDraining = false;
let cronRunSeq = 0;
const inFlightRuns = new Map<number, { jobName: string; done: Promise<void> }>();

export function beginCronDrain(): void { cronDraining = true; }
export function isCronDraining(): boolean { return cronDraining; }

/** Register a started handler; returns the same promise so call sites stay unchanged. */
export function trackCronRun<T>(jobName: string, run: Promise<T>): Promise<T> {
  const id = ++cronRunSeq;
  const done = run.then(() => undefined, () => undefined).finally(() => { inFlightRuns.delete(id); });
  inFlightRuns.set(id, { jobName, done });
  return run;
}

/** Names of cron handlers still running, one entry per run. */
export function inFlightCronRuns(): string[] {
  return [...inFlightRuns.values()].map((r) => r.jobName);
}

/** Resolves once every tracked handler has settled (fulfilled or rejected). */
export async function whenCronRunsSettled(): Promise<void> {
  while (inFlightRuns.size) await Promise.all([...inFlightRuns.values()].map((r) => r.done));
}

export async function acquireCronLock(jobName: string, ttlMs: number = LOCK_TTL_MS): Promise<LockResult> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { status: "fallback", reason: "db-null" };

  const newToken = randomUUID() as LockToken;
  // `ttlMs` lets a long-budget job (TierJob.timeoutMs) hold its lock for 2x
  // its own budget instead of the 10-min default, so a zombie past a 14-min
  // race cannot be double-fired by the next pulse.
  const ttlSeconds = Math.ceil(Math.max(ttlMs, LOCK_TTL_MS) / 1000);

  try {
    // Atomic acquire-or-steal-if-expired in a single statement.
    await db.execute(sql`
      INSERT INTO cron_locks (name, lock_token, holder, locked_at, locked_until)
      VALUES (${jobName}, ${newToken}, ${DYNO_ID}, NOW(), DATE_ADD(NOW(), INTERVAL ${sql.raw(String(ttlSeconds))} SECOND))
      ON DUPLICATE KEY UPDATE
        lock_token = IF(locked_until < NOW(), VALUES(lock_token), lock_token),
        holder     = IF(locked_until < NOW(), VALUES(holder),     holder),
        locked_at  = IF(locked_until < NOW(), VALUES(locked_at),  locked_at),
        locked_until = IF(locked_until < NOW(), VALUES(locked_until), locked_until)
    `);

    // Verify whether WE own the lock now.
    const [rows] = await db.execute(sql`
      SELECT lock_token, holder FROM cron_locks WHERE name = ${jobName} LIMIT 1
    `);
    const arr = rows as Array<{ lock_token: string; holder: string }>;
    if (arr.length === 0) return { status: "held-by-other" };
    if (arr[0].lock_token !== newToken) return { status: "held-by-other" };
    // Remember it so shutdown can hand it back instead of leaving the job
    // blocked for a full TTL after a deploy replaces this container.
    heldLocks.set(jobName, newToken);
    return { status: "acquired", jobName, token: newToken };
  } catch (err) {
    // Differentiate "table missing" (expected during migration window —
    // proceed with in-memory lock) from "query error" (real bug — still
    // proceed because we don't want to stall all cron, but log loud at
    // error level once + tag distinctly so alerts can route correctly).
    const code = (err as { errno?: number; code?: string })?.errno;
    if (code === ER_NO_SUCH_TABLE) {
      if (!_lockTableMissingLogged) {
        log.warn("[cron] cron_locks table missing — running with in-memory locks only. Apply drizzle/0037_wave168_cron_locks.sql then restart to enable cross-dyno locking.", { errorId: "CRON_LOCK_TABLE_MISSING" });
        _lockTableMissingLogged = true;
      }
      return { status: "fallback", reason: "table-missing" };
    }
    log.error(`[cron] lock acquire query error for ${jobName}; falling back to in-memory only`, { errorId: "CRON_LOCK_ACQUIRE_QUERY_ERROR", jobName, error: err instanceof Error ? err.message : String(err) });
    return { status: "fallback", reason: "query-error", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Release a lock we own. Takes the full discriminated-union variant so
 * the type system prevents releasing without acquiring (both reviewers
 * called this out). The affected-row check turns the formerly-silent
 * "TTL expired and someone stole our lock while we ran past timeout"
 * into a loud signal — that exact scenario is the double-fire the
 * lock subsystem exists to prevent.
 */
/**
 * SHORTEN, don't delete, the locks this dying process holds.
 *
 * Deleting outright would be wrong in the one case that matters: a SIGTERM the
 * process survives. Shortening to a 90-second grace window keeps the
 * double-fire guard meaningful while cutting post-deploy dead time from a full
 * TTL to about a minute. Guarded on our own token, so a lock already stolen by
 * another dyno is left completely alone.
 *
 * Never throws: shutdown must not be blocked by a lock we could not tidy.
 */
export const SHUTDOWN_LOCK_GRACE_SECONDS = 90;

export async function relinquishHeldLocksForShutdown(): Promise<{ shortened: string[] }> {
  const out: { shortened: string[] } = { shortened: [] };
  if (!heldLocks.size) return out;
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return out;
    for (const [jobName, token] of heldLocks) {
      try {
        const [result] = await db.execute(sql`
          UPDATE cron_locks
             SET locked_until = DATE_ADD(NOW(), INTERVAL ${sql.raw(String(SHUTDOWN_LOCK_GRACE_SECONDS))} SECOND)
           WHERE name = ${jobName}
             AND lock_token = ${token}
             AND locked_until > DATE_ADD(NOW(), INTERVAL ${sql.raw(String(SHUTDOWN_LOCK_GRACE_SECONDS))} SECOND)
        `);
        if (((result as { affectedRows?: number })?.affectedRows ?? 0) > 0) out.shortened.push(jobName);
      } catch { /* one lock failing must not stop the rest */ }
    }
    if (out.shortened.length) {
      log.info("shutdown: shortened held cron locks so the next dyno can pick up", {
        jobs: out.shortened, graceSeconds: SHUTDOWN_LOCK_GRACE_SECONDS,
      });
    }
  } catch { /* shutdown is best-effort */ }
  return out;
}

export async function releaseCronLock(lock: Extract<LockResult, { status: "acquired" }>): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;
    heldLocks.delete(lock.jobName);
    const [result] = await db.execute(sql`DELETE FROM cron_locks WHERE name = ${lock.jobName} AND lock_token = ${lock.token}`);
    // mysql2 returns { affectedRows: N } on DELETE
    const affected = (result as { affectedRows?: number })?.affectedRows ?? 0;
    if (affected === 0) {
      log.error("[cron] Cron exceeded TTL — possible double-fire. Lock was stolen by another dyno before we released.", {
        errorId: "CRON_LOCK_TTL_EXCEEDED",
        jobName: lock.jobName,
        ourToken: lock.token,
      });
    }
  } catch (err) {
    log.error(`[cron] lock release failed for ${lock.jobName}`, { errorId: "CRON_LOCK_RELEASE_FAILED", jobName: lock.jobName, error: err instanceof Error ? err.message : String(err) });
  }
}

// `runJob()` was DELETED 2026-08-23.
//
// It was the caller-less half of the decommission: `startAllJobs()` threw, so
// nothing invoked runJob(), so the `lastRun` / `running` fields it wrote stayed
// at their initial values forever while three surfaces reported them as live
// cron health. Deleting the function is what allows those fields to be deleted
// too - see the CronJob doc comment above.
//
// The surviving execution paths are runTier() in cron/scheduler.ts (the real
// scheduler) and runJobByName() below (the /api/bridge/run-job HTTP trigger).
// Both already carry the same cross-dyno lock contract runJob() had.

async function logCronRun(jobName: string, status: string, durationMs: number, recordsProcessed?: number, details?: string): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { cronLog } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return;

    await db.insert(cronLog).values({
      id: randomUUID(),
      jobName,
      status,
      durationMs,
      recordsProcessed: recordsProcessed || 0,
      details: details || null,
      // wave-181.59 · errorMessage column existed in schema but was never
      // written — observer.ts reads it to surface failure details in
      // Telegram alerts. Without this, every alert said "no error message
      // logged" even for real failures. Truncate to 500 to fit any
      // schema-defined length cap on the column.
      errorMessage: status === "failed" ? (details ?? "").slice(0, 500) || null : null,
      startedAt: new Date(Date.now() - durationMs),
      completedAt: new Date(),
    });
  } catch (err) {
    // Don't let log failures crash cron — but record the error
    log.error("[Cron] Log persistence failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * REGISTRY MEMBERSHIP ONLY — never run state.
 *
 * Renamed from `getJobStatuses()` 2026-08-23. The old name and its `lastRun` /
 * `intervalMin` fields promised cron health this registry has not been able to
 * report since `startAllJobs()` was decommissioned: `lastRun` was structurally
 * always null and `intervalMs` is documentation, not a schedule.
 *
 * The rename is load-bearing. Dropping the fields makes the compiler point at
 * every consumer that believed them, which is how the admin and bridge
 * `/cron-status` surfaces were found still reporting a dead registry.
 *
 * For "did this job run, and when", call `getCronStatus()` in
 * cron/cron-status.ts. For "what cadence does it keep", call
 * `getJobCadences()` in cron/scheduler.ts. This function answers exactly one
 * question: which names does the HTTP-trigger registry know about.
 */
export function getRegisteredJobNames(): Array<{ name: string; enabled: boolean }> {
  // Ensure jobs are registered (the tiered scheduler starts instead of startAllJobs)
  if (registeredJobs.size === 0) {
    registerAllJobs();
  }
  return Array.from(registeredJobs.values()).map(j => ({ name: j.name, enabled: j.enabled }));
}

// `resetJobRunningFlag()` was deleted 2026-08-23. Its predicate (`job.running`)
// could only be true if `runJob()` had set it, and runJob() had no callers — so
// it returned false on 100% of calls and the "AUTO-FIX: reset X running flag"
// branch in selfHealing.ts was unreachable. The scheduler's real mutex is
// `tier.running` (cron/scheduler.ts) plus the cron_locks row; neither was ever
// reachable from here.

/** Run a single job by name (used by Railway cron worker HTTP trigger) */
export async function runJobByName(jobName: string): Promise<{ status: string; recordsProcessed?: number; details?: string }> {
  registerAllJobs();
  const job = registeredJobs.get(jobName);
  if (!job) {
    return { status: "not_found", details: `Job "${jobName}" not found. Available: ${[...registeredJobs.keys()].join(", ")}` };
  }

  // wave-fix-2026-05-25 (audit #281 · Wave A regression catch) · this
  // entry point was bypassing the cron lock that Wave A added to
  // runTier + runTierJobByName. The Railway cron worker HTTP trigger
  // calls THIS function · without the lock, an external HTTP trigger
  // could race against a tiered-scheduler tick of the same job and
  // double-fire. Same lock contract as runJob() above · skip on
  // held-by-other, proceed on acquired/fallback, release in finally
  // if acquired.
  // TTL AND TIMEOUT MUST MATCH THE TIERED RUNNER, OR THIS PATH IS THE HOLE.
  //
  // runTier races every handler against its own budget and takes a lock whose
  // TTL is twice that budget (scheduler.ts). This path — the /api/bridge/run-job
  // and staged-cron trigger — did neither: it took the DEFAULT 10-minute lock
  // and awaited the handler forever. reel-pipeline's measured run is ~11 min and
  // its declared budget is 14, so a manually fired run outlived its own lock and
  // the next 15-minute pulse could steal it and run the same job concurrently —
  // two workers generating and paying for the same reel. `tier.running` does not
  // cover this path.
  const budgetMs = jobTimeoutMs(job);
  const lockResult = await acquireCronLock(job.name, budgetMs * 2);
  if (lockResult.status === "held-by-other") {
    return { status: "skipped", details: "cross-dyno lock held by another process (Railway worker HTTP trigger)" };
  }
  if (isCronDraining()) {
    if (lockResult.status === "acquired") await releaseCronLock(lockResult);
    return { status: "skipped", details: "server shutting down — no new job starts" };
  }

  const startedAt = Date.now();
  let timedOut = false;
  let jobTimer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      trackCronRun(job.name, job.handler()),
      new Promise<never>((_, reject) => {
        jobTimer = setTimeout(() => { timedOut = true; reject(new Error("timeout")); }, budgetMs);
      }),
    ]);
    const durationMs = Date.now() - startedAt;
    logCronRun(job.name, "completed", durationMs, result.recordsProcessed, result.details).catch((e) => { log.warn("[cron/index] fire-and-forget failed:", e); });
    return { status: "completed", recordsProcessed: result.recordsProcessed, details: result.details };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    logCronRun(job.name, "failed", durationMs, 0, error).catch((e) => { log.warn("[cron/index] fire-and-forget failed:", e); });
    return { status: "failed", details: error };
  } finally {
    if (jobTimer) clearTimeout(jobTimer);
    // Same contract as the tiered runner: on TIMEOUT the handler is still
    // running, so releasing the lock here would let the next tick double-fire
    // it. Hold it and let the TTL clean up.
    if (lockResult.status === "acquired" && !timedOut) {
      await releaseCronLock(lockResult);
    } else if (lockResult.status === "acquired" && timedOut) {
      log.warn(`[cron/index] ${job.name} timed out — holding lock until TTL to prevent concurrent re-fire`, { errorId: "CRON_TIMEOUT_LOCK_HELD" });
    }
  }
}

/** Register all cron jobs — called from startAllJobs or server startup */
let _jobsRegistered = false;
export function registerAllJobs(): void {
  if (_jobsRegistered) return;
  _jobsRegistered = true;

  // Appointment reminders (every 5 min — sms-scheduler handles timing)
  registerJob("sms-scheduler", 5 * 60 * 1000, async () => {
    const { processAppointmentReminders24h } = await import("./jobs/appointmentReminders");
    return processAppointmentReminders24h();
  });

  // wave-166: resume stuck SMS campaigns (every 5 min). If Railway restarts
  // a dyno mid-campaign, processCampaignSends() dies and the campaign sits
  // in status='active' with unsent pending rows. This recovers them so
  // real customers never get permanently skipped.
  // REACHABILITY FOR THE STAGED HIGGSFIELD LANE (2026-08-29).
  // Both jobs live in the TIERS, not here, and POST /api/admin/run-staged-cron
  // resolves through runJobByName (this registry) - not runTierJobByName. So a
  // tier-only job listed in MANUAL_TRIGGER_STAGED would be unreachable by the
  // one sanctioned manual path, and "staged" would mean decommissioned. That is
  // the exact defect review caught on PR #1830, and cronControlPlane.test.ts
  // fails if it recurs. Registering does NOT schedule anything: startAllJobs()
  // throws (see below), so this registry only ever provides lookup by name.
  registerJob("reel-pipeline", 15 * 60 * 1000, async () => {
    // UNLOCKED on purpose: runJobByName already holds this job's cron lock.
    // Calling runTierJobByName here would re-acquire it, get "held-by-other",
    // and report a completion for a run that never happened (PR #1996 review).
    const { runTierJobHandlerUnlocked } = await import("./scheduler");
    return runTierJobHandlerUnlocked("reel-pipeline");
    // timeoutMs 14 min below: identical to this job's tier budget. A manual run
    // measured ~11 min, so under the 4-min default it outlived its own 10-min
    // lock and the next pulse could steal it and generate the same reel twice.
  }, true, 14 * 60 * 1000);

  registerJob("higgsfield-session-keepalive", 15 * 60 * 1000, async () => {
    // UNLOCKED on purpose: runJobByName already holds this job's cron lock.
    // Calling runTierJobByName here would re-acquire it, get "held-by-other",
    // and report a completion for a run that never happened (PR #1996 review).
    const { runTierJobHandlerUnlocked } = await import("./scheduler");
    return runTierJobHandlerUnlocked("higgsfield-session-keepalive");
  });

  registerJob("camera-health-alert-selftest", 5 * 60 * 1000, async () => {
    // Unscheduled lookup only. /api/admin/run-staged-cron owns the cross-dyno lock
    // and cron_log receipt; the tier copy is held behind enabled:false forever.
    const { runTierJobHandlerUnlocked } = await import("./scheduler");
    return runTierJobHandlerUnlocked("camera-health-alert-selftest");
  });

  registerJob("campaign-resume", 5 * 60 * 1000, async () => {
    const { resumeStuckCampaigns } = await import("../routers/campaigns");
    return resumeStuckCampaigns();
  });

  // Review requests (every 30 min)
  registerJob("review-requests", 30 * 60 * 1000, async () => {
    const { processReviewRequests } = await import("./jobs/reviewRequests");
    return processReviewRequests();
  });

  // Daily report (every 12 hours — actual timing handled by business hours check)
  registerJob("daily-report", 12 * 60 * 60 * 1000, async () => {
    const { generateDailyReport } = await import("./jobs/dailyReport");
    return generateDailyReport();
  });

  // SMS self-learning digest (weekly) — was orphaned. Counts approved training
  // examples + aggregates the operator-edit taxonomy, and RECOMMENDS a fine-tune
  // / prompt update as a `pending` sms_learning_recommendations row. It never
  // auto-triggers a fine-tune — the operator reviews and runs it. (NCSOS)
  registerJob("sms-learning-digest", 7 * 24 * 60 * 60 * 1000, async () => {
    const { processSmsLearningDigest } = await import("../services/smsLearningEngine");
    // 2026-08-25 · return the digest's REAL result. This used to discard it
    // and return a hardcoded `recordsProcessed: 1` — harmless while nothing
    // called this handler, but /api/admin/run-staged-cron now runs the staged
    // digest through THIS path and logs the result to cron_log. A constant 1
    // would stamp the observed first run "processed 1" whether it crossed the
    // threshold or the database was unreachable — a lying receipt on the one
    // run whose receipt is the point. The function already returns
    // { recordsProcessed, details }; pass it through, like the tier handler.
    return processSmsLearningDigest();
  });

  // Cleanup (every 6 hours)
  registerJob("cleanup", 6 * 60 * 60 * 1000, async () => {
    const { cleanupOldData } = await import("./jobs/cleanup");
    return cleanupOldData();
  });

  // Customer segmentation (every 24 hours)
  registerJob("customer-segmentation", 24 * 60 * 60 * 1000, async () => {
    const { processCustomerSegmentation } = await import("./jobs/customerSegmentation");
    return processCustomerSegmentation();
  });

  // Retention sequences (every 24 hours).
  // wave-181.78 (week-audit · agent finding) · D7 + D14 tiers were
  // added to the tiered scheduler in wave-181.58 but never to this
  // registerAllJobs() function — meaning `/api/admin/cron/run` couldn't
  // trigger them manually. Now wired alongside their D30/D90/D180/D365
  // siblings. (The reporting half of that note is stale: registry membership
  // is no longer what the cron-status surfaces report — see
  // getRegisteredJobNames() above.)
  // wave-181.84 · AgentPhone Confirmation Bot · runs daily at the
  // tier interval · cron itself short-circuits when AGENTPHONE_* env
  // vars + FEATURE_CONFIRMATION_CALLS=1 aren't all set (gate check
  // inside the cron · no harm if env is half-configured).
  registerJob("confirmation-calls", 24 * 60 * 60 * 1000, async () => {
    const { runConfirmationCalls } = await import("./jobs/confirmationCalls");
    return runConfirmationCalls();
  });

  // wave-181.85 · AgentPhone Voice Recovery escalation · runs daily ·
  // gated by FEATURE_VOICE_RECOVERY + AGENTPHONE_RECOVERY_AGENT_ID. For
  // declined estimates that already received D7 + D30 SMS but didn't
  // convert · voice call as escalation channel.
  registerJob("voice-recovery", 24 * 60 * 60 * 1000, async () => {
    const { runVoiceRecovery } = await import("./jobs/voiceRecovery");
    return runVoiceRecovery();
  });

  // wave-143 · Follow-up cadence (the flywheel) · daily · gated by
  // FEATURE_FOLLOWUP_CADENCE=1 (OFF by default · dry-run via
  // FOLLOWUP_CADENCE_DRY_RUN=1). Places 7/30/60-day trust calls after a
  // completed job — at-most-once per touch, hard daily cap, opt-out + hours.
  registerJob("followup-cadence", 24 * 60 * 60 * 1000, async () => {
    const { runFollowupCadence } = await import("./jobs/followupCadence");
    return runFollowupCadence();
  });

  registerJob("retention-7day", 24 * 60 * 60 * 1000, async () => {
    const { processRetention7Day } = await import("./jobs/retentionSequences");
    return processRetention7Day();
  });

  registerJob("retention-14day", 24 * 60 * 60 * 1000, async () => {
    const { processRetention14Day } = await import("./jobs/retentionSequences");
    return processRetention14Day();
  });

  registerJob("retention-90day", 24 * 60 * 60 * 1000, async () => {
    const { processRetention90Day } = await import("./jobs/retentionSequences");
    return processRetention90Day();
  });

  registerJob("retention-180day", 24 * 60 * 60 * 1000, async () => {
    const { processRetention180Day } = await import("./jobs/retentionSequences");
    return processRetention180Day();
  });

  registerJob("retention-365day", 24 * 60 * 60 * 1000, async () => {
    const { processRetention365Day } = await import("./jobs/retentionSequences");
    return processRetention365Day();
  });

  // Warranty expiration alerts (every 24 hours)
  registerJob("warranty-alerts", 24 * 60 * 60 * 1000, async () => {
    const { processWarrantyAlerts } = await import("./jobs/warrantyAlerts");
    return processWarrantyAlerts();
  });

  // Dashboard Google Sheets sync (every 15 min)
  registerJob("dashboard-sync", 15 * 60 * 1000, async () => {
    const { processDashboardSync } = await import("./jobs/dashboardSync");
    return processDashboardSync();
  });

  // Abandoned form recovery (every 30 min)
  registerJob("abandoned-forms", 30 * 60 * 1000, async () => {
    const { processAbandonedForms } = await import("../services/abandonedForms");
    return processAbandonedForms();
  });

  // Stale lead follow-up (every 2 hours during business hours)
  registerJob("stale-lead-followup", 2 * 60 * 60 * 1000, async () => {
    const { processStaleLeadFollowUp } = await import("./jobs/staleLeadFollowup");
    return processStaleLeadFollowUp();
  });

  // Statenour brain sync (every 4 hours — push business metrics to NOUR OS)
  registerJob("statenour-sync", 4 * 60 * 60 * 1000, async () => {
    const { syncToStatenour } = await import("./jobs/statenourSync");
    return syncToStatenour();
  });

  // ═══ INTELLIGENCE SYSTEMS ═══

  // Vendor health probes (every 15 min)
  registerJob("vendor-health", 15 * 60 * 1000, async () => {
    const { getVendorHealthReport } = await import("../services/vendorHealth");
    const report = await getVendorHealthReport();
    const unhealthy = report.results.filter((s: any) => s.status === "down").length;
    return { recordsProcessed: report.results.length, details: `${unhealthy} unhealthy` };
  });

  // Nick AI Morning Brief (every 12 hours — hits ~7:30 AM ET + evening)
  registerJob("nick-morning-brief", 12 * 60 * 60 * 1000, async () => {
    const { sendMorningBrief } = await import("./jobs/morningBrief");
    return sendMorningBrief();
  });

  // Declined work recovery (every 24 hours)
  registerJob("declined-work-recovery", 24 * 60 * 60 * 1000, async () => {
    const { getDeclinedWorkLedger } = await import("../services/declinedWorkRecovery");
    const ledger = await getDeclinedWorkLedger(20);
    return { recordsProcessed: ledger.length, details: `${ledger.length} declined items checked` };
  });

  // Review monitor (every 6 hours — checks for new Google reviews)
  registerJob("review-monitor", 6 * 60 * 60 * 1000, async () => {
    const { processReviewMonitor } = await import("./jobs/reviewMonitor");
    return processReviewMonitor();
  }, !!process.env.GOOGLE_PLACES_API_KEY); // Auto-enable when API key is set

  // Competitor monitor (every 24 hours — runs weekly check internally)
  registerJob("competitor-monitor", 24 * 60 * 60 * 1000, async () => {
    const { fetchCompetitorSnapshot } = await import("../services/competitorMonitor");
    const data = await fetchCompetitorSnapshot();
    return { recordsProcessed: data.length, details: `${data.length} competitors checked` };
  }, false); // Disabled until GOOGLE_PLACES_API_KEY is set

  // Staff performance rollup (every 24 hours)
  // AG-20 · persist=true writes qc_pass_rate/comeback_rate/total_jobs
  // back to the technician rows — recommendTech scoring read these
  // columns but this rollup computed the numbers and discarded them.
  registerJob("staff-performance", 24 * 60 * 60 * 1000, async () => {
    const { getTeamPerformance } = await import("../services/staffPerformance");
    const perf = await getTeamPerformance(true);
    return { recordsProcessed: perf.techs?.length || 0, details: "Performance rollup complete (persisted)" };
  });

  // ═══ HERCULES EXPANSION ═══

  // Weather intelligence (every 12 hours)
  registerJob("weather-intel", 12 * 60 * 60 * 1000, async () => {
    const { checkWeatherTriggers } = await import("../services/weatherIntelligence");
    const result = await checkWeatherTriggers();
    return { recordsProcessed: result.triggered.length, details: result.details };
  });

  // Fleet scoring (every 24 hours)
  registerJob("fleet-scoring", 24 * 60 * 60 * 1000, async () => {
    const { identifyFleetProspects } = await import("../services/fleetScoring");
    return identifyFleetProspects();
  });

  // Self-healing watchdog (every 5 min)
  registerJob("self-healing", 5 * 60 * 1000, async () => {
    const { runSelfHealingChecks } = await import("../services/selfHealing");
    return runSelfHealingChecks();
  });

  // Nick AI Proactive Intelligence (every 2 hours during business hours)
  registerJob("nick-intelligence", 2 * 60 * 60 * 1000, async () => {
    const hour = parseInt(new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }), 10);
    // Only run during business-ish hours (7 AM - 9 PM ET)
    if (hour < 7 || hour > 21) return { recordsProcessed: 0, details: "Outside business hours" };
    const { runProactiveCheck } = await import("../services/nickIntelligence");
    return runProactiveCheck();
  });

  // Daily IG reel auto-poster — hourly tick, posts one pre-made reel in the 9am
  // ET window (one per day, reels 5-30). Laptop-independent: runs on the Railway
  // server. Gated by REEL_AUTOPOST_ENABLED (this job) AND REEL_PUBLISH_ENABLED
  // (the publishToSocial reel kill-switch); both default OFF. State + same-day
  // idempotency live in shop_settings — no migration.
  registerJob("daily-reel-post", 60 * 60 * 1000, async () => {
    const { runDailyReelPost } = await import("./jobs/dailyReelPost");
    return runDailyReelPost();
  }, process.env.REEL_AUTOPOST_ENABLED === "true");

  // Social content inventory publisher (every 5 min)
  registerJob("social-inventory-publisher", 5 * 60 * 1000, async () => {
    const { runSocialInventoryPublisher } = await import("./jobs/socialInventoryPublisher");
    return runSocialInventoryPublisher();
  }, process.env.SOCIAL_INVENTORY_PUBLISH_ENABLED === "true");

  // Content reserve replenishment (every 2 hours)
  registerJob("content-reserve-replenish", 2 * 60 * 60 * 1000, async () => {
    const { runContentReserveReplenish } = await import("./jobs/contentReserveReplenish");
    return runContentReserveReplenish();
  }, process.env.CONTENT_REPLENISH_ENABLED === "true");

  log.info("All cron jobs registered");
}

/**
 * Release the cron locks a PREVIOUS container left behind (2026-10-10).
 *
 * Two manual prompt-evolution runs died the same day when a deploy replaced
 * the container mid-run: the start command ran node under pnpm, pnpm took the
 * SIGTERM and exited, node never drained, and the job's lock stayed held for
 * its full TTL (100 minutes), refusing the next start. The start command now
 * execs node directly so the drain runs; this sweep is the belt for the
 * braces: a hard kill, an OOM or a crash can still strand a lock.
 *
 * Holder is `<RAILWAY_REPLICA_ID>:<pid>` (DYNO_ID). With one replica, any
 * holder whose replica id is not ours belongs to a container that no longer
 * exists once the deployment overlap has passed. So: STALE_HOLDER_SWEEP_DELAY_MS
 * after boot (longer than Railway's overlap + draining windows), delete every
 * live lock whose holder is another replica. Local runs (no replica id) never
 * sweep. A DB error logs and does nothing; the TTL still expires the lock.
 */
export const STALE_HOLDER_SWEEP_DELAY_MS = 120_000;

export async function releaseLocksOfDeadHolders(deps: {
  replicaId?: string | undefined;
  db?: Awaited<ReturnType<typeof import("../db").getDb>>;
} = {}): Promise<{ released: Array<{ name: string; holder: string }> }> {
  const replicaId = deps.replicaId ?? process.env.RAILWAY_REPLICA_ID;
  const out: { released: Array<{ name: string; holder: string }> } = { released: [] };
  if (!replicaId) return out;
  try {
    const db = deps.db ?? (await (await import("../db")).getDb());
    if (!db) return out;
    const { sql } = await import("drizzle-orm");
    const prefix = `${replicaId}:`;
    const [rows] = await db.execute(sql`
      SELECT name, holder FROM cron_locks
       WHERE locked_until > NOW()
         AND holder NOT LIKE ${`${prefix}%`}
    `);
    const stale = rows as unknown as Array<{ name: string; holder: string }>;
    for (const row of stale) {
      await db.execute(sql`DELETE FROM cron_locks WHERE name = ${row.name} AND holder = ${row.holder}`);
      out.released.push({ name: row.name, holder: row.holder });
    }
    if (out.released.length) {
      log.warn("[cron/locks] released locks left by a previous container", { released: out.released, replicaId });
    }
  } catch (e) {
    log.warn("[cron/locks] stale-holder sweep failed; the TTLs still apply", { error: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

/** Arms the sweep once per process; the timer never keeps the process alive. */
let staleSweepArmed = false;
export function scheduleStaleHolderSweep(delayMs: number = STALE_HOLDER_SWEEP_DELAY_MS): void {
  if (staleSweepArmed) return;
  staleSweepArmed = true;
  const t = setTimeout(() => { void releaseLocksOfDeadHolders(); }, delayMs);
  if (typeof t === "object" && t && "unref" in t) (t as { unref: () => void }).unref();
}
