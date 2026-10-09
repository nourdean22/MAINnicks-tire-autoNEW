/**
 * Tiered Job Scheduler — Consolidates 24 cron jobs into 4 tiers.
 *
 * Instead of 24 separate setInterval timers, we run 4 master tiers
 * that batch related jobs together. This reduces timer overhead,
 * prevents DB connection stampedes, and makes the system easier
 * to monitor.
 *
 * TIER 1 (5 min):  Heartbeat — critical monitoring + SMS
 * TIER 2 (15 min): Pulse — dashboard sync, vendor health, form recovery
 * TIER 3 (2 hr):   Hourly — lead follow-up, intelligence, reviews
 * TIER 4 (daily, 09:30 ET): Daily — segmentation, retention, reports, cleanup
 * TIER 5 (07:00 + 19:00 ET): Briefings — morning brief, daily report
 *   (tiers 4-5 run on the ET wall clock, claimed per slot per day — wallClockTiers.ts)
 *
 * Each tier runs its jobs SEQUENTIALLY within the tier to avoid
 * DB connection stampedes. Jobs still have individual timeout + skip
 * protection from the existing runJob() infrastructure.
 */

import { createLogger } from "../lib/logger";
import { BUSINESS } from "@shared/business";
import { DECLINED_RECOVERY_WINDOW_DAYS } from "@shared/const";
import { acquireCronLock, releaseCronLock, jobTimeoutMs, beginCronDrain, isCronDraining, trackCronRun } from "./index";
import { claimStartupPass, describeDueCheck, describeStartup, firstTickDelayMs, readLastRunAgeMs, startupAllowanceMs, type StartupClaim } from "./tierStartup";
import { createWallClockRunner, isWallClockTier, startWallClockLoop } from "./wallClockTiers";

const log = createLogger("scheduler");

/**
 * Should the reel-pipeline tier job re-throw AFTER its stages have run, so
 * this pulse's cron_log row logs status:"failed" with a real errorMessage
 * (what runCronFailureObserver reads) instead of "completed"?
 *
 * 2026-08-20 · Higgsfield stock-fallback remediation, Phase 2 "fail the cron
 * loudly" requirement. processNextReelJob's preflight (server/services/
 * reelPipeline.ts) returns processed:false WITH an error string ONLY when it
 * proved the Higgsfield session is dead before claiming a job — every OTHER
 * processed:false path (flag off, DB down, empty queue, lost claim race)
 * carries no error string and is ordinary idle, must stay silent. That
 * combination (processed:false AND a truthy error) is therefore unambiguous.
 *
 * Pure and exported so this is unit-testable without mocking the DB/import
 * chain the full handler needs — same reasoning as
 * terminalPaidFailureIsNeedsRegen in services/reelPipeline.ts.
 */
export function reelPipelineCronShouldFailLoudly(gen: { processed: boolean; error?: string }): boolean {
  return !gen.processed && Boolean(gen.error);
}

export interface TieredJob {
  name: string;
  handler: () => Promise<{ recordsProcessed?: number; details?: string }>;
  /** Only run during business hours (7 AM - 9 PM ET) */
  businessHoursOnly?: boolean;
  /**
   * Run AT MOST ONCE per shop day, claimed per JOB rather than per tier.
   *
   * Why this exists (ROS-081): `businessHoursOnly` on its own starved four
   * jobs for months. See `claimOncePerShopDay()` for the full mechanism —
   * the short version is that a tier's stamp answers "did the tier fire?",
   * which is not the same question as "did this job run?".
   *
   * A job carrying this flag MUST live in a tier whose interval is short
   * enough to land inside business hours regardless of boot phase;
   * `cron-cadence.test.ts` pins that invariant.
   */
  oncePerShopDay?: boolean;
  /** Only run if this env var is set (array = at least ONE must be set,
   *  matching handlers that accept alternative keys — review-monitor and
   *  competitor-monitor accept PLACES or MAPS but were gated on PLACES
   *  only, so a MAPS-only environment silently starved review ingestion) */
  requiresEnv?: string | string[];
  /**
   * Like `requiresEnv`, but for BOOLEAN kill switches: the var must equal
   * the exact string "true", matching how the service layer gates itself.
   *
   * Why this exists (2026-07-31): `requiresEnv` is a truthiness check, but
   * reelPipeline gates on `REEL_GENERATION_ENABLED === "true"` exactly
   * (reelPipeline.ts:312/537/673). Set the var to `1` / `yes` / `TRUE` and
   * the two disagreed — the scheduler happily ran the cron every pulse while
   * every stage returned `{processed:false}`. No error, no skip row, no
   * signal anywhere: a cron that looks perfectly healthy and does nothing.
   *
   * Use `requiresEnv` for credentials/identity (VAPI_API_KEY, META_IG_USER_ID
   * — presence is the real requirement). Use `requiresFlag` for on/off
   * switches whose consumer compares against "true".
   */
  requiresFlag?: string | string[];
  /**
   * Jobs that must have COMPLETED SUCCESSFULLY earlier in this same tier pass.
   * A throw, timeout, lock/env/flag skip, shutdown break, or disabled dependency
   * never satisfies this gate. Use this for customer-action jobs whose safety
   * depends on a preceding local reconciliation.
   */
  requiresSuccessfulJobs?: string[];
  /** Skip if disabled */
  enabled?: boolean;
  /**
   * Per-job wall-clock budget for the timeout race below. Default 4 min —
   * sized for SMS/sync jobs. A job that legitimately runs longer (the reel
   * pipeline renders 5 clips at ~90s each, ~11 min measured 2026-09-08) MUST
   * set this, or every pulse is logged `failed: timeout` while the handler
   * keeps running as a zombie, the observer alerts on a healthy job, and the
   * lock is held to its TTL for nothing. The cross-dyno lock TTL is derived
   * from this value (2x) so the double-fire guard stays coherent. Keep it
   * under the tier interval.
   */
  timeoutMs?: number;
}

// jobTimeoutMs lives in cron/index.ts so the tiered runner here and the
// HTTP/staged trigger there cannot drift apart on the budget or the lock TTL
// derived from it — they did, and the HTTP path took a 10-minute lock for a
// 14-minute job.

export interface Tier {
  name: string;
  intervalMs: number;
  jobs: TieredJob[];
  running: boolean;
  lastRun: Date | null;
  handle?: ReturnType<typeof setInterval>;
  /** A not-due-at-boot tier's claimed check at the moment it falls due (tierStartup.firstTickDelayMs). */
  dueCheck?: ReturnType<typeof setTimeout>;
}

const tiers: Tier[] = [];

function isBusinessHours(): boolean {
  const etHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }),
    10,
  );
  // v1.7 audit fix · was `<= 21` which lets businessHoursOnly SMS jobs
  // fire 9:00-9:59 PM ET. Customer-facing reminder/cross-sell SMS at
  // 9:30 PM is bad. Now caps at < 21 (= 8:59 PM hard stop). Aligns
  // with retentionSequences.ts:77 which already uses < 18.
  return etHour >= 7 && etHour < 21;
}

/**
 * Run all jobs in a tier sequentially (not in parallel).
 * Sequential prevents DB connection stampedes on small servers.
 */
// v1.7 audit follow-up · track consecutive skip counts per tier so
// we can fire a Telegram alert when a tier degrades silently.
//
// wave-181.83 (db-optimizer audit fix) · the prior in-memory Map was
// cleared on every pod restart. Under a CHRONIC overrun (the worst
// case · the one we most want to alert on), the underlying slow job
// keeps the tier running long enough that the scheduler skips · pod
// restarts mid-overrun · counter resets · alert never fires. Now
// backed by cron_tier_skip_state (migration 0047) · the counter
// survives restarts AND aggregates across multi-pod Railway.

async function bumpSkipCount(tierName: string): Promise<number> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return 1; // DB unavailable · fail-open with conservative count
    // LAST_INSERT_ID trick · atomic UPSERT + read in one round-trip
    const [result] = await d.execute(sql`
      INSERT INTO cron_tier_skip_state (tier_name, consecutive_skips, last_skip_at, updated_at)
      VALUES (${tierName}, LAST_INSERT_ID(1), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        consecutive_skips = LAST_INSERT_ID(consecutive_skips + 1),
        last_skip_at = NOW(),
        updated_at = NOW()
    `);
    const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object" ? result[0] : result) as { insertId?: number };
    return raw.insertId ?? 1;
  } catch {
    return 1;
  }
}

async function resetSkipCount(tierName: string): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return;
    await d.execute(sql`
      INSERT INTO cron_tier_skip_state (tier_name, consecutive_skips, last_run_at, updated_at)
      VALUES (${tierName}, 0, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        consecutive_skips = 0,
        last_run_at = NOW(),
        updated_at = NOW()
    `);
  } catch {
    // fail-silent · cron continues
  }
}

async function shouldRunWallClockJob(jobName: string, targetHourEt: number): Promise<boolean> {
  const etHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10
  );
  if (etHour !== targetHourEt) return false;

  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return false;

    const kvKey = `wallclock:${jobName}`;
    const [result] = await d.execute(sql`
      SELECT last_run_at FROM cron_tier_skip_state WHERE tier_name = ${kvKey}
    `);
    const raw = Array.isArray(result) && result[0] ? result[0] : null;
    const lastRun = raw && raw.last_run_at ? new Date(raw.last_run_at) : new Date(0);

    // If it ran in the last 12 hours, don't run it again today.
    if (Date.now() - lastRun.getTime() < 12 * 60 * 60 * 1000) {
      return false;
    }

    await d.execute(sql`
      INSERT INTO cron_tier_skip_state (tier_name, consecutive_skips, last_run_at, updated_at)
      VALUES (${kvKey}, 0, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        last_run_at = NOW(),
        updated_at = NOW()
    `);
    return true;
  } catch (err) {
    return false;
  }
}

/** First ET hour of the shop day — the lower bound of `isBusinessHours()`. */
const SHOP_DAY_START_HOUR_ET = 7;

/**
 * Epoch ms of 07:00 ET on the shop day that `now` falls in.
 *
 * Reads the REAL ET wall clock via Intl rather than doing fixed-offset
 * arithmetic, so it stays correct across the DST boundary — a `-05:00`
 * constant would silently shift the whole gate by an hour every spring.
 *
 * Callers are gated by `isBusinessHours()`, so the returned instant is
 * always in the past.
 */
export function shopDayStartMs(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS.timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  // Some ICU builds render midnight as hour "24" under hour12:false.
  const etHour = part("hour") % 24;
  // The formatted parts stop at seconds, so the fractional millisecond has to
  // come back from `now` — otherwise the boundary inherits it and lands at
  // 07:00:00.xxx instead of 07:00:00.000. That matters because
  // `cron_tier_skip_state.last_run_at` is a NON-FRACTIONAL TIMESTAMP: a claim
  // written by NOW() at 07:00:00.xxx is stored as 07:00:00.000, which would
  // then compare as EARLIER than the boundary and let a oncePerShopDay job
  // run a second time. Two of the four jobs on this path send customer SMS.
  // Every real UTC offset is a whole number of minutes, so the millisecond
  // component is zone-independent and can be read straight off `now`.
  const msSinceEtMidnight =
    ((etHour * 60 + part("minute")) * 60 + part("second")) * 1000 + now.getMilliseconds();
  return now.getTime() - (msSinceEtMidnight - SHOP_DAY_START_HOUR_ET * 3600_000);
}

/**
 * Has this job already run during the CURRENT shop day?
 *
 * Pure, so the calendar logic is testable without a database. A null
 * `lastRun` means the job has no recorded run at all — not "ran long ago".
 */
export function hasRunThisShopDay(lastRun: Date | null, now: Date = new Date()): boolean {
  if (!lastRun) return false;
  return lastRun.getTime() >= shopDayStartMs(now);
}

/**
 * Claim this job's single slot for the current shop day. `true` = you own
 * the slot and must run; `false` = do not run.
 *
 * WHY THIS EXISTS — ROS-081, prod cron_log 2026-07-29:
 * `opportunity-queue-refresh ran 1 times in 7 days, expected about 7`.
 *
 * The daily tier is a 24h `setInterval` whose PHASE is set by process
 * start. A pod that booted at 03:00 ET therefore fired that tier at
 * 03:00 ET every day — outside 07:00-20:59, so `runTier()` skipped every
 * `businessHoursOnly` job in it, every day, indefinitely. Worse, the
 * 03:00 pass still called `resetSkipCount("daily")` BEFORE the job loop,
 * so it also told the boot guard "daily already ran today" and suppressed
 * the next startup fire. Four jobs were affected, two of them customer
 * SMS rails (`referral-loop-closer`, `vip-auto-recognition`).
 *
 * The fix has two halves and BOTH are load-bearing:
 *   1. the job moves to a tier that fires many times a day, so it gets
 *      more than one chance to land inside business hours; and
 *   2. this per-JOB claim replaces the tier-level stamp, so "the tier
 *      fired" can never again be read as "the job ran" (the ROS-078
 *      class: a completion status is not an output).
 *
 * Half 1 alone would let a job fire several times a day. Half 2 alone
 * cannot help a tier that never fires inside business hours at all.
 *
 * CONCURRENCY: callers MUST hold `acquireCronLock(job.name)`. Two pods
 * that both read "not yet run today" would both claim and both fire —
 * that is the v1.7 duplicate-SMS regression this repo already paid for.
 * The lock makes the read-then-write below safe; it is not safe alone.
 *
 * Fails CLOSED. A job that cannot prove it has not already run today does
 * not run: these send customer SMS, and a duplicate text costs more than
 * a missed day.
 */
async function claimOncePerShopDay(jobName: string): Promise<boolean> {
  if (!isBusinessHours()) return false;
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return false;

    const kvKey = `dailyonce:${jobName}`;
    const [rows] = await d.execute(sql`
      SELECT last_run_at FROM cron_tier_skip_state WHERE tier_name = ${kvKey}
    `);
    const raw = Array.isArray(rows) && rows[0] ? (rows[0] as { last_run_at: Date | string | null }) : null;
    const lastRun = raw?.last_run_at ? new Date(raw.last_run_at) : null;
    if (hasRunThisShopDay(lastRun)) return false;

    await d.execute(sql`
      INSERT INTO cron_tier_skip_state (tier_name, consecutive_skips, last_run_at, updated_at)
      VALUES (${kvKey}, 0, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        last_run_at = NOW(),
        updated_at = NOW()
    `);
    return true;
  } catch (err) {
    // Fail closed and say so — a silent false here looks identical to
    // "already ran today", which is the exact ambiguity ROS-081 was.
    log.warn(`oncePerShopDay claim failed for ${jobName} — not running`, {
      error: err instanceof Error ? err.message : String(err),
      errorId: "CRON_DAILY_CLAIM_FAILED",
    });
    return false;
  }
}

export async function runTier(tier: Tier): Promise<void> {
  // Q-10 · a pass that fires after SIGTERM (a staggered boot timer, the
  // wall-clock loop) must not start at all — not even its skip-state writes.
  if (isCronDraining()) return;
  if (tier.running) {
    const skips = await bumpSkipCount(tier.name);
    log.info(`Tier ${tier.name} still running, skipping`, { consecutiveSkips: skips });
    // Alert at 2 consecutive skips on hourly+ tiers — that means the
    // tier has been overrunning its interval for 2 firings in a row.
    // Heartbeat tier skips are normal under load and not alert-worthy.
    if (skips >= 2 && tier.intervalMs >= 30 * 60 * 1000) {
      try {
        const { sendTelegram } = await import("../services/telegram");
        await sendTelegram(
          `⚠ CRON tier "${tier.name}" skipped ${skips}x in a row. ` +
            `Interval ${Math.round(tier.intervalMs / 60000)}min, jobs ${tier.jobs.length}. ` +
            `One job is hanging near its timeout — check /system/cron-diagnostics.`,
        );
      } catch {
        // best-effort; don't break the scheduler if Telegram is down
      }
    }
    return;
  }
  await resetSkipCount(tier.name);

  tier.running = true;
  const start = Date.now();
  let completed = 0;
  let skipped = 0;
  const successfulJobs = new Set<string>();

  for (const job of tier.jobs) {
    // Q-10 · SIGTERM landed mid-pass: the job in flight finishes (the
    // shutdown drain waits for it), but the rest of the pass never starts.
    if (isCronDraining()) break;

    // Skip disabled jobs
    if (job.enabled === false) { skipped++; continue; }

    // Skip business-hours-only jobs outside hours
    if (job.businessHoursOnly && !isBusinessHours()) { skipped++; continue; }

    // Skip jobs that need a missing env var
    // wave-181.28 · log env-skips to cron_log so the daily watcher can
    // detect prolonged silent failures and fire a Telegram alert. The
    // skip is logged once per scheduler-tier-pass to avoid spamming the
    // log table (a 5-minute heartbeat tier × 7 days × dozens of jobs
    // would write ~12,096 skip rows otherwise).
    const requiredEnvs = job.requiresEnv ? (Array.isArray(job.requiresEnv) ? job.requiresEnv : [job.requiresEnv]) : [];
    if (requiredEnvs.length && !requiredEnvs.some((k) => process.env[k])) {
      skipped++;
      logTierJob(job.name, "skipped", 0, 0, `requiresEnv:${requiredEnvs.join("|")} (no env var set)`).catch((e) => { log.warn("[cron/scheduler] fire-and-forget failed:", e); });
      continue;
    }

    // Boolean kill switches — must be exactly "true", same as the service
    // layer. A var set to a truthy-but-wrong value ("1", "yes", "TRUE", or
    // "true " with a stray space) used to pass this gate and then no-op
    // silently inside every stage. Now it skips LOUDLY, and the reason
    // names the observed value so the typo is legible from cron_log alone.
    const requiredFlags = job.requiresFlag ? (Array.isArray(job.requiresFlag) ? job.requiresFlag : [job.requiresFlag]) : [];
    const flagSkip = requiredFlags.map((k) => unarmedFlagReason(k, process.env[k])).find((r) => r !== null);
    if (flagSkip) {
      skipped++;
      logTierJob(job.name, "skipped", 0, 0, flagSkip).catch((e) => { log.warn("[cron/scheduler] fire-and-forget failed:", e); });
      continue;
    }

    // Q-37 review hardening: ordering alone is not a dependency. runTier()
    // deliberately continues after a job throws or times out, so a customer
    // action must explicitly require the reconciliation that makes it safe.
    const missingSuccessfulJobs = (job.requiresSuccessfulJobs ?? []).filter((name) => !successfulJobs.has(name));
    if (missingSuccessfulJobs.length > 0) {
      skipped++;
      logTierJob(
        job.name,
        "skipped",
        0,
        0,
        `requiresSuccessfulJobs:${missingSuccessfulJobs.join("|")} (dependency did not complete successfully this pass)`,
      ).catch((e) => { log.warn("[cron/scheduler] fire-and-forget failed:", e); });
      continue;
    }

    let jobTimer: ReturnType<typeof setTimeout> | undefined;
    const jobStart = Date.now();

    // wave-fix-2026-05-25 (audit #87) · cross-dyno lock per job. Without
    // this the tiered scheduler double-fires every job during deploy
    // churn — old dyno keeps ticking while the new dyno starts ticking,
    // each fires the same job once. The legacy runJob() in cron/index.ts
    // already does this; we hadn't mirrored the discipline here. Three
    // outcomes:
    //   acquired      → run job, release in finally
    //   held-by-other → another dyno owns it · skip this tick + log
    //   fallback      → cron_locks unavailable · proceed under in-memory
    //                   `tier.running` mutex only (no double-release)
    const lockResult = await acquireCronLock(job.name, jobTimeoutMs(job) * 2);
    if (lockResult.status === "held-by-other") {
      skipped++;
      logTierJob(job.name, "skipped", 0, 0, "cross-dyno lock held by another process").catch((e) => { log.warn("[cron/scheduler] fire-and-forget failed:", e); });
      continue;
    }

    // Q-10 · re-check after the lock await, and BEFORE the once-per-day claim
    // below: a claim consumed and then skipped for shutdown would lose the
    // job for the whole shop day. Hand the lock straight back.
    if (isCronDraining()) {
      if (lockResult.status === "acquired") await releaseCronLock(lockResult);
      break;
    }

    // ROS-081 · at-most-once-per-shop-day jobs claim their slot per JOB.
    // This MUST sit inside the cross-dyno lock above: two pods that each
    // read "not yet run today" would both claim and both fire, which is
    // the v1.7 duplicate-SMS class. Deliberately NOT written to cron_log —
    // these jobs are re-offered several times a day by design, and logging
    // each pass would bury the real run under ~6 skip rows a day per job
    // (the same log-volume reasoning as the requiresEnv skip above).
    if (job.oncePerShopDay && !(await claimOncePerShopDay(job.name))) {
      skipped++;
      if (lockResult.status === "acquired") await releaseCronLock(lockResult);
      continue;
    }

    // forensic-audit HIGH · Promise.race does NOT cancel the losing promise,
    // so on timeout job.handler() keeps running as a zombie. If we then
    // released the lock in `finally`, the next tick (or another dyno) could
    // acquire it and run the SAME job concurrently — double-sending customer
    // SMS/calls. Track the timeout and DON'T release the lock in that case;
    // let it expire via its TTL, which keeps the zombie's slot reserved.
    let timedOut = false;
    try {
      const result = await Promise.race([
        trackCronRun(job.name, job.handler()),
        new Promise<never>((_, reject) => {
          jobTimer = setTimeout(() => { timedOut = true; reject(new Error("timeout")); }, jobTimeoutMs(job));
        }),
      ]) as { recordsProcessed?: number; details?: string };
      completed++;
      successfulJobs.add(job.name);
      const dur = Date.now() - jobStart;
      if (dur > 5000) {
        log.info(`[${tier.name}] ${job.name}: ${dur}ms`);
      }
      // Log to cron_log table for audit trail
      logTierJob(job.name, "completed", dur, result?.recordsProcessed, result?.details).catch((e) => { log.warn("[cron/scheduler] fire-and-forget failed:", e); });
    } catch (err) {
      const dur = Date.now() - jobStart;
      log.error(`[${tier.name}] ${job.name} failed:`, { error: err instanceof Error ? err.message : String(err) });
      // Same text in BOTH columns, deliberately: `details` is what the admin
      // cron table renders, `errorMessage` is what the failure observer reads.
      logTierJob(job.name, "failed", dur, 0, err instanceof Error ? err.message : String(err), err instanceof Error ? (err.stack || err.message) : String(err)).catch((e) => { log.warn("[cron/scheduler] fire-and-forget failed:", e); });
    } finally {
      if (jobTimer) clearTimeout(jobTimer);
      // Release the DB lock only if we actually acquired it AND the job did
      // not time out. On timeout the handler is still running — releasing
      // here would let the next tick double-fire it; the lock's TTL cleans up.
      if (lockResult.status === "acquired" && !timedOut) {
        await releaseCronLock(lockResult);
      } else if (lockResult.status === "acquired" && timedOut) {
        log.warn(`[${tier.name}] ${job.name} timed out — holding lock until TTL to prevent concurrent re-fire`, { errorId: "CRON_TIMEOUT_LOCK_HELD" });
      }
    }
  }

  tier.running = false;
  tier.lastRun = new Date();
  const totalMs = Date.now() - start;
  if (completed > 0) {
    log.info(`Tier ${tier.name}: ${completed} completed, ${skipped} skipped (${totalMs}ms)`);
  }
}

/** Log tier job execution to cron_log table */
/**
 * `errorMessage` is a REAL column on cron_log and nothing has ever written it.
 * The failure path stuffed the reason into `details` instead, so every row read
 * `error_message: null` — and runCronFailureObserver, which reads exactly that
 * column, sent every alert with the text "no error message logged".
 *
 * That matters more now: the pipeline handlers rethrow rather than swallowing,
 * so real failures reach this function, and an alert without a reason is barely
 * better than no alert.
 */
async function logTierJob(jobName: string, status: string, durationMs: number, recordsProcessed?: number, details?: string, errorMessage?: string): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { cronLog } = await import("../../drizzle/schema");
    const { randomUUID } = await import("crypto");
    const db = await getDb();
    if (!db) return;
    await db.insert(cronLog).values({
      id: randomUUID(),
      jobName,
      status,
      durationMs,
      recordsProcessed: recordsProcessed || 0,
      details: details?.slice(0, 2000) || null,
      errorMessage: errorMessage?.slice(0, 2000) || null,
      startedAt: new Date(Date.now() - durationMs),
      completedAt: new Date(),
    });
  } catch (e) { log.warn("[cron/scheduler] operation failed:", e); }
}

/**
 * Register all tiers and start the consolidated scheduler.
 */
/**
 * Boolean-flag gate rule, extracted so it is unit-testable without booting
 * the scheduler. Returns null when the flag is armed, else the cron_log skip
 * reason (which names the observed value — a `1`/`yes`/`TRUE` typo used to
 * produce a cron that ran every pulse and silently did nothing).
 */
export function unarmedFlagReason(key: string, raw: string | undefined): string | null {
  if (raw === "true") return null;
  const why =
    raw === undefined || raw === ""
      ? "not set"
      : `set to ${JSON.stringify(raw.length > 12 ? `${raw.slice(0, 12)}…` : raw)} — must be exactly "true"`;
  return `requiresFlag:${key} (${why})`;
}

/**
 * Build the tier table WITHOUT starting any timer.
 *
 * 2026-09-01 (audit, artifact 2 §2.1): `tiers` was populated only inside
 * startTieredScheduler(), so every read-only consumer — getJobCadences(),
 * the cron-status surface, the CRON-INVENTORY generator, tests — saw an
 * EMPTY table until the scheduler had actually started. Building is now a
 * pure, idempotent step (ensureTiersBuilt) that any reader can call.
 */
function buildTiers(): void {
  // ═══ TIER 1: HEARTBEAT (every 5 min) ═══
  // Critical monitoring + SMS processing
  tiers.push({
    name: "heartbeat",
    intervalMs: 5 * 60 * 1000,
    jobs: [
      {
        name: "self-healing",
        handler: async () => {
          const { runSelfHealingChecks } = await import("../services/selfHealing");
          return runSelfHealingChecks();
        },
      },
      {
        // Camera truth is operational infrastructure: a quiet lot must not hide a dead
        // producer, and a PTZ bridge can be auth-healthy while control/media are broken.
        // This job reads the role-aware camera_runtime lattice every heartbeat pass and
        // uses durable cron_alerts_fired claims before owner notifications.
        name: "camera-health-alerts",
        handler: async () => {
          const { runCameraHealthAlerts } = await import("../services/cameraHealthAlerts");
          return runCameraHealthAlerts();
        },
      },
      {
        // Real provider delivery test, held OFF the scheduler permanently. It does not
        // alter camera_runtime or synthesize a camera outage; it only exercises the same
        // email/webhook -> Telegram fallback used by real camera-health pages.
        name: "camera-health-alert-selftest",
        enabled: false,
        handler: async () => {
          const { runCameraHealthAlertSelfTest } = await import("../services/cameraHealthAlerts");
          return runCameraHealthAlertSelfTest();
        },
      },
      {
        // 2026-08-23 · WIRED. This job existed only in registerAllJobs()
        // (cron/index.ts) and in no tier, so it had never run: production
        // cron_log held ZERO rows for `campaign-resume` while control jobs in
        // the same table showed 2,344 / 799 / 38 runs.
        //
        // It is the recovery net for a campaign whose dyno dies mid-blast —
        // routers/campaigns.ts names it in five separate comments ("leave rows
        // 'pending' and let resumeStuckCampaigns (5-min cron) pick the...").
        // Without it, `sms_campaign_sends` rows stay 'pending' forever and
        // those customers are permanently skipped.
        //
        // Measured blast radius at wiring time: ZERO. 0 pending rows; 2
        // campaigns, both 'completed', none stranded 'active', newest 55 days
        // old. The net has never been needed yet — it simply was not there.
        // Wired now so it exists before the first campaign that needs it, not
        // after. 5 min is the cadence the 90-second staleness heuristic in
        // resumeStuckCampaigns was written against.
        //
        // ─── SMS SIDE EFFECT · why this is not agent-initiated outreach ───
        //
        // This job CAN send real SMS: for a campaign still 'active' with rows
        // left 'pending', it calls processCampaignSends(). Root AGENTS.md bars
        // customer-facing sends on agent initiative, so the distinction matters
        // and is recorded here rather than left for the next reader to re-derive.
        //
        // Every recipient it texts is a row the OPERATOR created by launching
        // the campaign. This job originates no audience, picks no message and
        // adds no recipient — it finishes a blast the operator started and a
        // dyno restart interrupted. `sms_campaigns.status` is
        // ("draft" | "active" | "completed") with NO paused state, so 'active'
        // means unambiguously "should be sending"; there is no operator intent
        // this could misread as a pause.
        //
        // The behaviour change to know about: before this, a campaign stranded
        // 'active' stayed stranded forever. Now it resumes within ~5 minutes.
        // That is the fix, and it is also the only way this job is observable
        // from the outside. Note SMS_KILL_SWITCH does NOT gate it — that switch
        // is Twilio-only and the shop gateway path stays live (socialPipeline.ts).
        //
        // ─── 2026-08-25 · STAGED BEHIND THE MANUAL TRIGGER ───────────────
        //
        // `enabled: false` stops the SCHEDULER ONLY. It is not a decommission:
        // the tier loop is the single automatic path (`startAllJobs()` throws —
        // cron/index.ts:55 — so the legacy registry schedules nothing), and
        // neither manual runner consults this flag. `runTierJobByName`
        // (scheduler.ts) and `runJobByName` (cron/index.ts) both look the job
        // up and call its handler directly. Fire it via
        // POST /api/admin/run-staged-cron.
        //
        // NOT via /api/bridge/run-job: the staging commit first documented that
        // path, and it is a locked door — BRIDGE_RUN_JOB_ALLOWLIST
        // (_core/bridge-routes.ts) deliberately excludes SMS-capable jobs and
        // contains neither staged name. Found by review on PR #1830; the
        // admin endpoint exists because widening the bridge allowlist to an
        // SMS-capable job would weaken a 2026-07-05 audit control.
        //
        // WHY, and it is the SMS: this job can call processCampaignSends() for
        // a campaign still 'active' with rows left 'pending'. SMS_KILL_SWITCH
        // does NOT gate it — that switch is Twilio-only and the shop gateway
        // path stays live. A job that reaches customers gets an observed first
        // run, not an unattended one.
        //
        // Measured before staging (prod cron_log + tables, 2026-08-25):
        // 558 runs 2026-08-23 16:11Z → 2026-08-25 14:19Z, every one
        // status='completed' with records_processed=0 and no error. Newest
        // sms_campaign_sends.sentAt is 2026-07-08, 46 days BEFORE it was
        // wired; 0 rows sent on/after 2026-08-23; 0 rows 'pending'. So it has
        // never had anything to do and has sent nothing. Staging costs nothing
        // today and buys an observed first real run.
        //
        // TO PROMOTE TO AUTOMATIC: delete the `enabled: false` line, and delete
        // this job's entry from MANUAL_TRIGGER_STAGED in
        // cron/registry-tier-map.ts — the canary fails until both move together.
        name: "campaign-resume",
        enabled: false,
        handler: async () => {
          const { resumeStuckCampaigns } = await import("../routers/campaigns");
          return resumeStuckCampaigns();
        },
      },
      {
        name: "alg-mirror-health", // CRITICAL: detect stale ALG data fast
        businessHoursOnly: true,
        handler: async () => {
          // SHOP-PROTECT: only probe ALG when admin session is active.
          // Probes kick the shop's browser login out of ShopDriver/ALG.
          const { runIfAdminActive } = await import("../lib/adminActivity");
          const result = await runIfAdminActive(
            async () => {
              const { checkMirrorHealth } = await import("../services/shopDriverMirror");
              return checkMirrorHealth();
            },
            { jobName: "alg-mirror-health" },
          );
          if ("skipped" in result) return { details: result.reason };
          return result;
        },
      },
      {
        name: "data-accuracy-check",
        handler: async () => {
          // Verify data consistency every 5 minutes
          const issues: string[] = [];
          try {
            const { getDb } = await import("../db");
            const { sql } = await import("drizzle-orm");
            const d = await getDb();
            if (!d) return { details: "No DB" };

            // Invoices missing a customer phone.
            //
            // The lifetime total is NOT the right alarm. Measured 2026-08-01 against
            // the whole backlog of 175: 20 were recoverable from a customers row, and
            // a further 19 from alg_estimates, leaving 136. Those 136 have no phone in
            // ANY of the 30 tables carrying both a name and a phone column — walk-ins
            // whose number the shop never took, plus names that exist but belong to
            // different people (22 Williamses, no Terrence) and 5 junk names.
            // Nothing to fix, so a `> 0` alarm on the total could never clear; it sat
            // red permanently and everyone learned to scroll past this panel.
            //
            // What IS actionable is a RECENT invoice arriving without a phone: that
            // means the ALG import or the name-match phone backfill in
            // shopDriverMirror.ts is broken right now. Alert on that; report the
            // historical residue as context only.
            const [recentMissing] = await d.execute(sql`SELECT COUNT(*) as cnt FROM invoices WHERE (customerPhone IS NULL OR customerPhone = '') AND invoiceDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)`);
            const recentMissingCount = Number((recentMissing as Record<string, unknown>[])?.[0]?.cnt || (recentMissing as Record<string, unknown>)?.cnt || 0);
            if (recentMissingCount > 0) issues.push(`${recentMissingCount} invoices missing customer phone in the last 7d (import may be broken)`);

            // Check for stale leads (new status > 7 days old)
            const [staleLeads] = await d.execute(sql`SELECT COUNT(*) as cnt FROM leads WHERE status = 'new' AND createdAt < DATE_SUB(NOW(), INTERVAL 7 DAY)`);
            const staleCount = (staleLeads as Record<string, unknown>[])?.[0]?.cnt || (staleLeads as Record<string, unknown>)?.cnt || 0;
            if (Number(staleCount) > 3) issues.push(`${staleCount} stale leads (>7d untouched)`);

            // Check for callbacks stuck in "new" > 24h
            const [staleCallbacks] = await d.execute(sql`SELECT COUNT(*) as cnt FROM callback_requests WHERE status = 'new' AND createdAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
            const cbCount = (staleCallbacks as Record<string, unknown>[])?.[0]?.cnt || (staleCallbacks as Record<string, unknown>)?.cnt || 0;
            if (Number(cbCount) > 0) issues.push(`${cbCount} callbacks unanswered >24h`);

            // Q-26 · data contracts. Freshness is sourced from a REAL mirror
            // receipt, never inferred from whether today's row count is zero.
            // Volume compares only the same shop weekday across prior weeks.
            const {
              assessFreshness,
              assessWeekdayVolume,
              contractByKey,
            } = await import("../../shared/businessDataContracts");
            const { BUSINESS } = await import("../../shared/business");
            const now = new Date();
            const today = now.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
            const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
            const openWeekdays = Object.entries(BUSINESS.hours.structured as Record<string, string>)
              .filter(([, hours]) => Boolean(hours))
              .map(([day]) => ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(day.toLowerCase()))
              .filter((day) => day >= 0);

            const { getLastSuccessfulSync } = await import("../services/shopDriverMirror");
            const invoiceFreshness = assessFreshness({
              contract: contractByKey("shopdriver_invoices"),
              dataAsOf: getLastSuccessfulSync(),
              now,
              timeZone: BUSINESS.timezone,
              openWeekdays,
            });
            if (invoiceFreshness.state === "warn" || invoiceFreshness.state === "error") {
              issues.push(`invoice mirror freshness ${invoiceFreshness.state}: ${invoiceFreshness.reason}`);
            }

            type DailyCountRow = { day: string | Date; cnt: string | number };
            const rowsFrom = (result: unknown): DailyCountRow[] =>
              Array.isArray(result) ? (result as DailyCountRow[]) : [];
            const dailySeries = (rows: DailyCountRow[]) => {
              const normalized = rows
                .map((row) => {
                  const day = row.day instanceof Date
                    ? row.day.toISOString().slice(0, 10)
                    : String(row.day).slice(0, 10);
                  return { day, count: Number(row.cnt) || 0 };
                })
                .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day));
              const current = normalized.find((row) => row.day === today)?.count ?? 0;
              const history = normalized
                .filter((row) => row.day !== today && new Date(`${row.day}T12:00:00Z`).getUTCDay() === todayDow)
                .map((row) => row.count);
              return { current, history };
            };

            // invoiceDate is the stored shop-local day (2026-10-09): converting it from UTC
            // moved every date-only ticket onto the day before, so today's count read near zero.
            const [invoiceDailyRaw] = await d.execute(sql`
              SELECT DATE(invoiceDate) AS day, COUNT(*) AS cnt
              FROM invoices
              WHERE source = 'shopdriver' AND invoiceDate >= DATE_SUB(NOW(), INTERVAL 70 DAY)
              GROUP BY day
              ORDER BY day DESC
            `);
            const [leadDailyRaw] = await d.execute(sql`
              SELECT DATE(CONVERT_TZ(createdAt, '+00:00', 'America/New_York')) AS day, COUNT(*) AS cnt
              FROM leads
              WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 70 DAY)
              GROUP BY day
              ORDER BY day DESC
            `);
            const [callbackDailyRaw] = await d.execute(sql`
              SELECT DATE(CONVERT_TZ(createdAt, '+00:00', 'America/New_York')) AS day, COUNT(*) AS cnt
              FROM callback_requests
              WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 70 DAY)
              GROUP BY day
              ORDER BY day DESC
            `);

            const invoiceSeries = dailySeries(rowsFrom(invoiceDailyRaw));
            const leadSeries = dailySeries(rowsFrom(leadDailyRaw));
            const callbackSeries = dailySeries(rowsFrom(callbackDailyRaw));
            // If the mirror clock is ERROR/UNMEASURED, today's invoice count may
            // simply be incomplete. Refuse to manufacture a volume anomaly.
            const invoiceVolume =
              invoiceFreshness.state === "fresh" || invoiceFreshness.state === "warn"
                ? assessWeekdayVolume({
                    contract: contractByKey("shopdriver_invoices"),
                    current: invoiceSeries.current,
                    sameWeekdayHistory: invoiceSeries.history,
                  })
                : {
                    state: "unmeasured" as const,
                    current: invoiceSeries.current,
                    expectedMean: null,
                    standardDeviation: null,
                    zScore: null,
                    historyPoints: invoiceSeries.history.length,
                    reason: `suppressed because mirror freshness is ${invoiceFreshness.state}`,
                  };
            const leadVolume = assessWeekdayVolume({
              contract: contractByKey("leads"),
              current: leadSeries.current,
              sameWeekdayHistory: leadSeries.history,
            });
            const callbackVolume = assessWeekdayVolume({
              contract: contractByKey("callbacks"),
              current: callbackSeries.current,
              sameWeekdayHistory: callbackSeries.history,
            });
            const volumes = [
              ["invoices", invoiceVolume],
              ["leads", leadVolume],
              ["callbacks", callbackVolume],
            ] as const;
            for (const [label, verdict] of volumes) {
              if (verdict.state === "warn" || verdict.state === "error") {
                issues.push(`${label} weekday volume ${verdict.state}: ${verdict.reason}; current=${verdict.current}, expected≈${verdict.expectedMean?.toFixed(1) ?? "?"}`);
              }
            }
            const contractDetails = [
              `invoiceFreshness=${invoiceFreshness.state}(${invoiceFreshness.shopDaysOld ?? "?"} shop-day-old)`,
              ...volumes.map(([label, verdict]) =>
                `${label}Volume=${verdict.state}(n=${verdict.current ?? "?"},history=${verdict.historyPoints},z=${verdict.zScore?.toFixed(2) ?? "?"})`
              ),
            ].join(" | ");

            if (issues.length > 0) {
              // Log internally only — no external notifications
              const { createLogger } = await import("../lib/logger");
              const accuracyLog = createLogger("cron:data-accuracy");
              accuracyLog.warn("Data accuracy issues found", { issues });
              const { remember } = await import("../services/nickMemory");
              await remember({ type: "lesson", content: `Data accuracy: ${issues.join(". ")}`, identity: "data_accuracy", source: "accuracy_check", confidence: 0.8 });
            }

            return {
              recordsProcessed: issues.length,
              // A zero now says WHAT was checked. "All data clean" with no
              // denominator was indistinguishable from a checker that did no work.
              details: issues.length === 0
                ? `All declared checks clean · ${contractDetails}`
                : `${issues.join("; ")} · ${contractDetails}`,
            };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
    ],
    running: false,
    lastRun: null,
  });

  // ═══ TIER 2: PULSE (every 15 min) ═══
  // Optimized order: health first → data refresh → customer-facing actions last
  tiers.push({
    name: "pulse",
    intervalMs: 15 * 60 * 1000,
    jobs: [
      {
        name: "vendor-health", // First: know if systems are up before syncing
        handler: async () => {
          const { getVendorHealthReport } = await import("../services/vendorHealth");
          const report = await getVendorHealthReport();
          const unhealthy = report.results.filter((s) => s.status === "down").length;
          return { recordsProcessed: report.results.length, details: `${unhealthy} unhealthy` };
        },
      },
      {
        /**
         * Approval-queue orphan sweep. An approval runs its executor inside one
         * request, so a row still sitting in `executing` minutes later means the
         * process died mid-flight. It CANNOT be auto-retried — the executor's
         * insert may have landed before the terminal write — so this parks it as
         * `execution_ambiguous` ("may already exist") and tells the operator,
         * exactly as the IG publish path parks an unanswered media_publish.
         *
         * Cheap by construction: one indexed status+time read per pulse that
         * returns nothing on every healthy tick.
         */
        name: "proposal-orphan-sweep",
        handler: async () => {
          const { sweepStaleExecuting, EXECUTING_STALE_MINUTES } = await import("../services/proposals");
          const { parked } = await sweepStaleExecuting();
          if (parked.length > 0) {
            const { alertSystem } = await import("../services/telegram");
            await Promise.resolve(
              alertSystem(
                `${parked.length} approval proposal(s) abandoned mid-execution`,
                `Stale >${EXECUTING_STALE_MINUTES}m and parked as AMBIGUOUS — the action may or may not have completed. ` +
                  `Check the real callback/booking records, then resolve each in /admin → Approvals.`,
              ),
            ).catch(() => { /* alerting must not fail the sweep it reports on */ });
          }
          return {
            recordsProcessed: parked.length,
            details: parked.length === 0 ? "no orphans" : `parked ${parked.length} as ambiguous`,
          };
        },
      },
      {
        // Higgsfield SESSION KEEPALIVE. The CLI's access token expires ~90 min
        // and, once expired, refuses to auto-refresh ("Session expired — run
        // hf auth login"). Prod only made authenticated Higgsfield calls when
        // GENERATING reels, so any >90-min gap between renders killed the
        // session and stranded the next job (observed live 2026-07-17, twice).
        // A credit-FREE `hf account status` every pulse (15 min << 90 min)
        // forces the CLI to refresh+rotate the token; the existing persist
        // hook writes the rotated pair back to app_secret_kv. Runs BEFORE the
        // reel-pipeline job below, so a render always sees a fresh token. Skips
        // (no CLI spawn) when no creds are configured. A failed refresh is
        // LOUD — the operator needs to re-login only when the refresh token
        // itself is revoked, not on ordinary inactivity.
        // ─── 2026-08-29 · STAGED BEHIND THE MANUAL TRIGGER ───────────────
        //
        // NOT STAGED FOR BEING FLAKY. Read this before promoting it back.
        //
        // Higgsfield runs TWO SEPARATE LEDGERS with separate billing, verified
        // on the operator's own signed-in account 2026-08-29:
        //   · consumer / Ultra  - 1,934.62 credits, paid subscription, active.
        //     This is what the CLI session lane spends, and `hf account status`
        //     reads exactly this balance.
        //   · Higgsfield Cloud API (Authorization: Key ID:SECRET) - ZERO
        //     credits, no payment method saved, no purchase history, 0 API
        //     calls lifetime. cloud.higgsfield.ai is a distinct paid product;
        //     the Ultra subscription does NOT fund it. Two API keys already
        //     exist on the account with 0 lifetime calls - someone walked this
        //     road before and stopped at this same wall.
        //
        // So the CLI session lane is not a legacy fallback, it is THE ONLY LANE
        // FUNDED BY THE SUBSCRIPTION HE ALREADY PAYS FOR - and it requires a
        // human browser device-login (`higgsfield auth login`) that no cron can
        // perform. Generation therefore becomes a HUMAN-TRIGGERED BATCH: the
        // operator authenticates, fires this job manually, and a block of the
        // paid credits is spent inside that window.
        //
        // `enabled: false` stops the SCHEDULER ONLY - same semantics as the
        // 2026-08-25 staging above. Fire via POST /api/admin/run-staged-cron.
        //
        // Promotion requires the ledger fact to change, not the flakiness to
        // improve. Deleting this flag while the session lane still needs a
        // browser click re-creates a cron that dies silently between logins.
        // Remove this flag and the MANUAL_TRIGGER_STAGED entry TOGETHER;
        // cronControlPlane.test.ts fails if they disagree.
        //
        // ─── 2026-09-08 · PROMOTED. The staging premise did not survive prod ──
        //
        // The ledger fact above is unchanged: the CLI lane is still the only
        // funded lane and still needs a human device-login. What changed is the
        // reading of what this job is FOR. It does not log in; it keeps an
        // already-valid session alive by forcing the ~90-minute refresh so the
        // rotated pair is persisted from INSIDE this process. Staging it on
        // 2026-08-29 removed that; on 2026-08-30 the next renders failed with
        // "Higgsfield CLI exited with code 2 ... Session expired", and for nine
        // days no reel was generated. reel-pipeline runs the CLI lane unattended
        // — its `requiresEnv: HIGGSFIELD_API_KEY_ID` was removed in #2170 — so
        // "nothing for it to keep alive" was false the whole time.
        //
        // "Dies silently between logins" is already handled one screen down:
        // an invalid session THROWS, status='failed' is recorded, and
        // cron-failure-observer alerts on two consecutive failures. It is loud
        // now. The 296-failures-in-72h noise the staging cites was a dead
        // session left unfixed, not a broken job; the fix for that is the
        // alert, not silence. higgsfieldKeepalivePromoted.test.ts pins both
        // the promotion and the loud-failure shape.
        name: "higgsfield-session-keepalive",
        handler: async () => {
          const { getHiggsfieldCredentialsJson, getHiggsfieldAccountHealth, isHiggsfieldVendorOutage, HIGGSFIELD_VENDOR_UNAVAILABLE } = await import("../services/higgsfieldStudio");
          if (!(await getHiggsfieldCredentialsJson())) return { recordsProcessed: 0, details: "no higgsfield creds — skip" };
          const health = await getHiggsfieldAccountHealth();
          if (!health.credsValid) {
            // 2026-10-03: an HTTP 503 from Higgsfield was reported as "refresh
            // token revoked; re-login required" and the reel batch was
            // cancelled. An outage proves nothing about the session, so it is
            // named as an outage. Still THROWN: a long outage should alert too.
            const outage = isHiggsfieldVendorOutage(health.raw);
            if (outage) {
              log.warn("Higgsfield unreachable during keepalive — session NOT proven dead; next pulse retries", { raw: health.raw.slice(0, 200) });
            } else {
              log.error("Higgsfield session keepalive FAILED — refresh token likely revoked; re-login required", { raw: health.raw.slice(0, 200) });
            }
            // Drop the in-process credential cache so the NEXT pulse re-reads
            // app_secret_kv. `getHiggsfieldCredentialsJson` latches
            // `credentialsLoadAttempted` on first read and never consults the DB
            // again, so a process holding a DEAD blob keeps presenting it
            // forever even after a good one is stored. The admin paste path
            // (instagramAdmin.updateMetaConfig) already clears this — but only in
            // the process that served the request, so with more than one replica
            // the others would need a redeploy to notice. Clearing here makes
            // recovery land within 15 minutes whichever process took the paste.
            //
            // Deliberately AFTER the log and BEFORE the throw: the throw is what
            // records status='failed' and reaches the observer, and that path is
            // not being altered.
            const { clearRuntimeHiggsfieldCache } = await import("../services/higgsfieldStudio");
            clearRuntimeHiggsfieldCache();
            // THROW, do not return. A returned failure is recorded as
            // status='completed', and cron/observer.ts:109 counts a run as
            // failing only when status === 'failed'. That gap cost 4 days of
            // reel production: 526 consecutive keepalive FAILURES between
            // 2026-07-26 and 07-31 were all logged 'completed', so the
            // failure observer — which exists to Telegram the operator on 2+
            // consecutive failures — never saw one. Throwing routes this into
            // the catch that logs status='failed', so the alert fires in ~30
            // minutes instead of never.
            throw new Error(
              outage
                ? `Higgsfield keepalive inconclusive — ${HIGGSFIELD_VENDOR_UNAVAILABLE}, session not proven dead. ${health.raw.slice(0, 160)}`
                : `Higgsfield keepalive FAILED — re-login required (refresh token revoked). ${health.raw.slice(0, 160)}`,
            );
          }
          return { recordsProcessed: 1, details: `session refreshed${health.balanceCredits != null ? `, ${health.balanceCredits} credits` : ""}` };
        },
      },
      {
        // 2026-05-05 audit follow-up: cron failure observer.
        // Reads cron_log, alerts owner via Telegram (channel='critical')
        // on any job with 2+ consecutive failures in the last 24h.
        // Suppresses duplicate alerts for 6h to avoid spam.
        name: "cron-failure-observer",
        handler: async () => {
          const { runCronFailureObserver } = await import("./observer");
          return runCronFailureObserver();
        },
      },
      // 2026-05-05 — REPLACED shopdriver-daily-ticket-pull and
      // shopdriver-full-mirror with a SINGLE overnight probe at 3 AM ET.
      // Moved from daily tier to pulse tier to ensure it can hit its exact wall-clock window.
      {
        name: "alg-overnight-probe",
        handler: async () => {
          try {
            // Run exactly once during the 3 AM ET window.
            const shouldRun = await shouldRunWallClockJob("alg-overnight-probe", 3);
            if (!shouldRun) {
              return { recordsProcessed: 0, details: "skipped (waiting for 3 AM ET window, or already ran)" };
            }

            const { requestAlgProbe } = await import("../services/algProbeBudget");
            const result = await requestAlgProbe("overnight");
            return {
              recordsProcessed: result.recordsProcessed,
              details: `overnight probe → ${result.outcome} (${result.recordsProcessed} records, ${result.durationMs}ms)`,
            };
          } catch (e: unknown) {
            // Thrown, not returned: a returned `details` string was logged as
            // "completed", so a failed probe never reached cron_log as failed.
            throw new Error(`overnight probe failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
      },
      // 2026-07-28 — same-day sales visibility. The 3 AM overnight probe
      // means "Sales today" on /admin reads $0 all day and yesterday's
      // numbers land a day late (found when operator asked why daily sales
      // disappeared: admin_login probes fired exactly ONCE in 7 days
      // because the PWA session persists — no fresh logins, no daytime
      // sync). This 8 PM ET probe runs AFTER close (Mon–Sat 6 PM, Sun
      // 4 PM), so it cannot kick the shop counter's ShopDriver session —
      // the 2026-05-05 shop-protect directive stands. Net: today's sales
      // appear on the admin the same evening.
      {
        name: "alg-evening-probe",
        handler: async () => {
          try {
            const shouldRun = await shouldRunWallClockJob("alg-evening-probe", 20);
            if (!shouldRun) {
              return { recordsProcessed: 0, details: "skipped (waiting for 8 PM ET window, or already ran)" };
            }

            const { requestAlgProbe } = await import("../services/algProbeBudget");
            const result = await requestAlgProbe("evening");
            return {
              recordsProcessed: result.recordsProcessed,
              details: `evening probe → ${result.outcome} (${result.recordsProcessed} records, ${result.durationMs}ms)`,
            };
          } catch (e: unknown) {
            // Thrown, not returned — same reason as alg-overnight-probe above.
            throw new Error(`evening probe failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
      },
      {
        // wave-109: ping the F25e shop SMS gateway. Telegram alert if
        // last-seen > 30 min — without this we'd only learn it's offline
        // when a customer-facing send fails, which is too late.
        name: "sms-gateway-health",
        handler: async () => {
          const { runSmsGatewayHealthMonitor } = await import("./jobs/smsGatewayHealthMonitor");
          return runSmsGatewayHealthMonitor();
        },
      },
      {
        name: "dashboard-sync",
        handler: async () => {
          const { processDashboardSync } = await import("./jobs/dashboardSync");
          return processDashboardSync();
        },
      },
      {
        name: "cloud-camera-snapshots",
        handler: async () => {
          const { pullCloudCameraSnapshots } = await import("../services/cameraProxy");
          return pullCloudCameraSnapshots();
        },
      },
      // 2026-05-05 — REMOVED pulse-tier shopdriver-mirror + estimate-mirror.
      // The 5-minute admin-active probe was kicking Moe out of the shop's
      // ShopDriver login during normal admin browsing. Replaced with the
      // demand-driven probe budget (server/services/algProbeBudget.ts):
      //   1. admin_login    — Nour just logged into /admin
      //   2. chat_query     — Nick chat asks for fresh data
      //   3. manual_refresh — admin clicks "Refresh from ALG" button
      //   4. overnight      — single 3 AM ET probe (shop closed)
      // Net effect: probes drop from ~12/hour to ~3-5/day under normal use.
      // See: server/services/algProbeBudget.ts
      {
        name: "abandoned-forms",
        businessHoursOnly: true, // No customer outreach at 3am
        handler: async () => {
          const { processAbandonedForms } = await import("../services/abandonedForms");
          return processAbandonedForms();
        },
      },
      {
        name: "sms-scheduler", // Moved from heartbeat (5min was overkill)
        businessHoursOnly: true,
        handler: async () => {
          const { processAppointmentReminders24h } = await import("./jobs/appointmentReminders");
          return processAppointmentReminders24h();
        },
      },
      {
        // 2026-09-22 · an orchestration persisted `queued · outside_hours_queued`
        // never learned that the delayed queue sent its text (308 rows read
        // queued forever, 243 of them sent — docs/operations/QUEUE-CENSUS-
        // 2026-09-22.md). Bookkeeping only: reads sms_messages, stamps the
        // orchestration, never sends. Rows older than 7 days are the operator's
        // back-stamp script. 2026-10-02: the same pass closes stale human-review
        // drafts (366 open, oldest 2026-06-24) — cancelled/expired, never sent.
        name: "orchestration-status-reconcile",
        handler: async () => {
          const { reconcileQueuedOrchestrations, reconcileStaleHumanReviewDrafts } = await import("./jobs/orchestrationStatusReconcile");
          const queued = await reconcileQueuedOrchestrations();
          const drafts = await reconcileStaleHumanReviewDrafts();
          return { recordsProcessed: queued.recordsProcessed + drafts.recordsProcessed, details: `${queued.details} | ${drafts.details}` };
        },
      },
      {
        name: "wo-overdue-check", // Detect work orders past promised time
        businessHoursOnly: true,
        handler: async () => {
          const { detectOverdueWorkOrders } = await import("../services/workOrderAutomation");
          return detectOverdueWorkOrders();
        },
      },
      {
        // #1074 gave a needs-review reply a durable 30-min SLA, but `dueAt` had one
        // consumer — an admin query — so nothing ever told the operator. A 180-day
        // prod read found 74% of customer turns unanswered within 2h. 15-min tier
        // because a 30-min SLA needs checking well inside its own window; a daily
        // brief is the wrong clock. businessHoursOnly: an obligation that accrues
        // overnight surfaces when the shop opens, not at 3am.
        // Alerts the OPERATOR only — this path cannot message a customer.
        name: "overdue-reply-alert",
        businessHoursOnly: true,
        handler: async () => {
          const { alertOverdueObligations } = await import("../services/humanPendingAlerts");
          const r = await alertOverdueObligations();
          return {
            recordsProcessed: r.alerted,
            details:
              r.overdue === 0
                ? "none overdue"
                : `${r.overdue} overdue · ${r.alerted} alerted · delivered=${r.delivered}`,
          };
        },
      },
      {
        // ADR-0020 phase 1 (Q-22): index every open callback, owed text and
        // emergency request in customer_promises, and close each row on its
        // source's outcome. Shadow: no alert, no inbox item, no customer send;
        // a no-op until obligation_mirror_enabled is ON. Same 15-min tier as the
        // 30-min reply SLA it indexes; the report carries per-kind parity.
        name: "obligation-mirror",
        businessHoursOnly: true,
        handler: async () => {
          const { runObligationMirror } = await import("../services/obligationMirror");
          return runObligationMirror();
        },
      },
      {
        name: "gateway-order-status-poll", // Detect stale/stuck tire orders
        businessHoursOnly: true,
        handler: async () => {
          const { pollGatewayOrderStatuses } = await import("../services/dataPipelines");
          return pollGatewayOrderStatuses();
        },
      },
      {
        name: "revenue-pulse", // Live revenue pacing — alert on big jobs or falling behind
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { forecastRevenue } = await import("../services/intelligenceEngines");
            const forecast = await forecastRevenue();
            const todayRevenue = forecast.today?.soFar || 0;
            const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            const dailyTarget = BUSINESS.revenueTarget.monthly / daysInMonth;

            // Alert if a single big job came in (>$1000)
            if (todayRevenue > 1000 && todayRevenue > dailyTarget * 2) {
              const { sendTelegram } = await import("../services/telegram");
              await sendTelegram(`💰 Big day building: $${Math.round(todayRevenue)} so far today (${Math.round((todayRevenue/dailyTarget)*100)}% of daily target)`);
            }
            return { recordsProcessed: 1, details: `Today: $${Math.round(todayRevenue)}` };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
      {
        name: "statenour-live-sync", // Push fresh data to NOUR OS dashboard every 15min
        handler: async () => {
          const { syncToStatenour } = await import("./jobs/statenourSync");
          return syncToStatenour();
        },
      },
      {
        // IG + FB autonomous poster. The pulse tier fires every 15 min;
        // runIgAutopostCron self-gates to the 8:07 / 13:07 / 20:07 ET slot
        // windows (off-:00) and dedupes one post per slot per day, so the
        // 15-min cadence costs nothing outside those windows. requiresEnv
        // skips it entirely until Meta is configured. SAFETY: posts only
        // when IG_AUTOPOST_DRYRUN === "false"; default behavior is a
        // Telegram preview (dryrun), never a live post.
        name: "ig-autopost",
        requiresEnv: "META_IG_USER_ID",
        // 10 MINUTES, not the 4-minute default.
        //
        // Measured 2026-09-09: this lane failed 20 of 703 runs over seven days,
        // every one of them recorded as "timeout" - 3 on 2026-09-09 alone, and
        // at least one on six of the last eight days. It is the only lane in
        // the estate still failing on a schedule.
        //
        // The cause is the budget, not the work. Inside a slot window this job
        // GENERATES an image and then uploads it to Meta - two network round
        // trips against third-party services, either of which can be slow - and
        // it was inheriting DEFAULT_JOB_TIMEOUT_MS, which is sized for the
        // database-only jobs that make up most of the estate.
        //
        // 10 minutes sits under the tier's own 15-minute cadence, so a slow run
        // still finishes before the next pulse is due and the lock hand-back
        // stays inside one interval. Same reasoning as the reel pipeline's
        // 14-minute budget below, one tier down in cost.
        timeoutMs: 10 * 60 * 1000,
        handler: async () => {
          const { runIgAutopostCron } = await import("../services/igAutopost");
          return runIgAutopostCron();
        },
      },
      {
        // Publish-later queue: fires owner-scheduled posts at their due time
        // (deferred execution of an explicit owner action, not autonomous AI
        // posting). No-op until migration 0071 (scheduled_posts) is applied.
        name: "scheduled-posts",
        requiresEnv: "META_IG_USER_ID",
        handler: async () => {
          const { runScheduledPosts } = await import("../services/scheduledPosts");
          return runScheduledPosts();
        },
      },
      {
        // Faceless Reel pipeline · processes ONE queued reel_jobs row per pulse
        // (gen clips per storyboard beat -> re-host to public storage ->
        // assets_ready). Minutes-long gen runs here as a BACKGROUND job, never
        // a synchronous request (which dies on Railway's gateway timeout).
        // requiresEnv gates it OFF by default — zero Higgsfield credit spend
        // until the operator sets REEL_GENERATION_ENABLED. Each pulse advances
        // the pipeline by one unit per stage: generate clips for one queued job
        // (gen -> assets_ready), then assemble one assets_ready job into a
        // finished MP4 (assembling -> assembled). The gated publish is a later
        // stage.
        // ─── 2026-08-29 · STAGED BEHIND THE MANUAL TRIGGER ───────────────
        //
        // NOT STAGED FOR BEING FLAKY. Read this before promoting it back.
        //
        // Higgsfield runs TWO SEPARATE LEDGERS with separate billing, verified
        // on the operator's own signed-in account 2026-08-29:
        //   · consumer / Ultra  - 1,934.62 credits, paid subscription, active.
        //     This is what the CLI session lane spends, and `hf account status`
        //     reads exactly this balance.
        //   · Higgsfield Cloud API (Authorization: Key ID:SECRET) - ZERO
        //     credits, no payment method saved, no purchase history, 0 API
        //     calls lifetime. cloud.higgsfield.ai is a distinct paid product;
        //     the Ultra subscription does NOT fund it. Two API keys already
        //     exist on the account with 0 lifetime calls - someone walked this
        //     road before and stopped at this same wall.
        //
        // So the CLI session lane is not a legacy fallback, it is THE ONLY LANE
        // FUNDED BY THE SUBSCRIPTION HE ALREADY PAYS FOR - and it requires a
        // human browser device-login (`higgsfield auth login`) that no cron can
        // perform. Generation therefore becomes a HUMAN-TRIGGERED BATCH: the
        // operator authenticates, fires this job manually, and a block of the
        // paid credits is spent inside that window.
        //
        // PROMOTED 2026-09-07, and the promotion is CONDITIONAL BY CONSTRUCTION
        // rather than by anyone's attention.
        //
        // The staging above was correct and its reasoning is unchanged: the CLI
        // session lane needs a browser login no cron can perform, and it is
        // dead again right now (probed 2026-09-07: HIGGSFIELD_CREDENTIALS_JSON
        // is SET in prod and returns `credsValid:false — Session expired`). The
        // MCP is not an escape hatch either — re-verified upstream the same day,
        // ten days after the UPSTREAMS REJECT row: the hosted server is
        // OAuth-only ("no API keys live in your config"), the self-hosted
        // variant authenticates by Clerk BROWSER SESSION token, and Higgsfield's
        // own headless guidance points non-conversational pipelines at the
        // CLI/API tokens instead. The reopen trigger has NOT fired.
        //
        // What changed is WHO decides. `enabled: false` meant a human had to
        // notice the ledger fact had changed and ship a deploy to act on it —
        // and the previous promote note asked for exactly that vigilance.
        // Vigilance is what failed here for eleven days. So the flag is now the
        // CREDENTIAL ITSELF: the handler asks the provider modules whether the
        // ACTIVE lane is credentialed and skips generation with a legible
        // cron_log reason when it is not. The moment that lane is funded and
        // configured the job generates, with no second deploy and no session.
        //
        // NO requiresEnv HERE, DELIBERATELY. Review P2 on #2170: an env-name
        // list cannot express what these providers actually accept. Veo takes
        // GEMINI_API_KEY *or* GOOGLE_AI_API_KEY *or* GOOGLE_GENAI_API_KEY *or* a
        // GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY pair (veoStudio.ts:55-58), and
        // Higgsfield's API resolver also reads DB-backed app_secret_kv rows that
        // no env list can name at all. A subset list false-NEGATIVES: it would
        // hold this cron dormant while a provider was genuinely credentialed,
        // which is the same silent-stall this promotion exists to end, wearing
        // the opposite sign.
        //
        // The credential gate lives in the handler instead, where it calls the
        // REAL resolvers via reelProviderCredentialsPresent() on the ACTIVE
        // provider. One definition of "credentialed", owned by the module that
        // knows — not a second copy in a scheduler flag that drifts from it.
        //
        // HIGGSFIELD_CREDENTIALS_JSON must never become that gate. It is the
        // browser-session credential, it is SET in production right now, and it
        // probes `credsValid:false — Session expired`. A presence-only check on
        // it would gate OPEN on a dead credential — the failure this staging
        // existed to prevent (296 failed runs in 72h, half of ~50 Telegram
        // alerts in three days). The handler's resolver check is about whether
        // the lane WORKS, not whether a variable is set; that difference is the
        // whole point.
        //
        // `higgsfield-session-keepalive` STAYS STAGED and is now decoupled: it
        // rotates the CLI session token, and this job no longer runs on the CLI
        // lane unattended, so there is nothing for it to keep alive. Its
        // "promote together with reel-pipeline, never before it" note referred
        // to the CLI pairing and no longer applies in that direction.
        name: "reel-pipeline",
        // Explicit, not omitted. `enabled` only disables on === false, so this
        // is a behavioural no-op — it is here as the receipt of the promotion
        // from `enabled: false`, which is what the staging above described.
        enabled: true,
        // requiresFlag (not requiresEnv): the stages compare against the
        // exact string "true", so the gate must too — otherwise the cron
        // runs and silently no-ops. See the requiresFlag docstring.
        requiresFlag: "REEL_GENERATION_ENABLED",
        // Measured 2026-09-08 on prod: one gen job = 5 Higgsfield clips at
        // ~90 s each = ~11 min. Under the 4-min default every pulse logged
        // `failed: timeout`, cron-failure-observer paged on a healthy pipeline,
        // and the lock was held to TTL. 14 min < the 15-min pulse interval.
        timeoutMs: 14 * 60 * 1000,
        handler: async () => {
          const { processNextReelJob, processNextAssemblyJob, recoverStuckReelJobs,
                  resumeTimedOutReelJobs,
                  selectReelVideoProvider, reelProviderCredentialsPresent } = await import(
            "../services/reelPipeline"
          );
          // Settle each stage independently: a pre-try DB rejection in the gen
          // stage must not skip assembly this pulse (the job simply retries on the
          // next pulse).
          type StageResult = { processed: boolean; jobId?: number; status?: string; error?: string };
          const settle = (p: Promise<StageResult>): Promise<StageResult> =>
            p.catch((e) => ({ processed: true, status: "error", error: e instanceof Error ? e.message : String(e) }));
          // First: requeue any orphaned in-flight jobs (hung CLI / process restart
          // mid-stage) so a stuck row can't silently wedge the pipeline forever.
          const recovered = await recoverStuckReelJobs()
            .then((r) => r.recovered)
            .catch(() => 0);
          // Then: put back any job a provider TIMEOUT left dead. Distinct from
          // the recovery above (which frees rows a crashed worker still holds):
          // these are terminal needs_regen rows holding paid clips that nothing
          // ever retried, so each timeout used to cost a schedule slot until a
          // human noticed. Bounded, guarded and refusing anything that is not
          // plainly resumable - see resumeTimedOutReelJobs. Never throws the
          // pulse: a failure here leaves the rows exactly as dead as before.
          const resumed = await resumeTimedOutReelJobs()
            .then((r) => r.resumed.length)
            .catch((e) => { log.warn("reel-pipeline: timed-out-job resume failed", { err: e instanceof Error ? e.message : String(e) }); return 0; });
          // Then: resolve any publish whose outcome is UNKNOWN, before this
          // pulse considers publishing anything else. An ambiguous dispatch is
          // parked terminally by dailyReelPost (Instagram has no idempotency
          // key, so a blind retry double-posts); this is the only thing that
          // un-parks it, and it does so through the same reconciler and writer
          // the operator button uses. Judgement cases stay parked.
          const reconciled = await import("../services/publishReconcileLane")
            .then((m) => m.reconcileAmbiguousPublishes())
            .then((r) => r.resolvedPublished.length + r.resolvedNotPublished.length)
            .catch((e) => { log.warn("reel-pipeline: publish reconcile lane failed", { err: e instanceof Error ? e.message : String(e) }); return 0; });
          // And release reservations no worker will ever settle — they consume
          // the day's generation budget until something returns them.
          const sweptReservations = await import("../services/generationLedger")
            .then((m) => m.sweepStaleReservations())
            .then((r) => r.released.length)
            .catch((e) => { log.warn("reel-pipeline: reservation sweep failed", { err: e instanceof Error ? e.message : String(e) }); return 0; });
          // ASSEMBLY RUNS BEFORE GENERATION, up to three jobs per pulse. Assembly
          // is ~1 min of ffmpeg over clips that already exist; generation is
          // ~11 min of paid rendering. When gen ran first, every finished-clip
          // job waited a full gen behind it (three assets_ready jobs sat with
          // attempts=0 across two pulses on 2026-09-08). Finished work ships
          // first; the loop stops at the first "nothing to assemble".
          const ASSEMBLY_PER_PULSE = 3;
          const asms: StageResult[] = [];
          for (let i = 0; i < ASSEMBLY_PER_PULSE; i++) {
            const a = await settle(processNextAssemblyJob());
            if (!a.processed) break;
            asms.push(a);
          }
          // GENERATION IS GUARDED BY THE *ACTIVE* PROVIDER, not by requiresEnv.
          //
          // Self-audit catch before merge, 2026-09-07. The requiresEnv gate on
          // this job asks only "is SOME non-interactive lane credentialed", and
          // GEMINI_API_KEY is set in production, so it OPENS. But
          // selectReelVideoProvider returns an explicit REEL_VIDEO_PROVIDER pin
          // UNCONDITIONALLY, before any credential check ("the pin still wins -
          // that is its job"), and prod pins `higgsfield`, whose session
          // credential probes credsValid:false. Promoting on requiresEnv alone
          // would therefore have generated into a DEAD provider every 15
          // minutes - the exact failure this job was staged to prevent, and the
          // one that produced 296 failed runs in 72h. A gate on the union of
          // possible lanes is not a gate on the lane that will be used.
          //
          // ASSEMBLY IS DELIBERATELY LEFT UNGUARDED below. It downloads
          // already-rendered clips, generates the voiceover and runs ffmpeg; it
          // never calls a video provider. Gating it here would strand every job
          // whose clips already exist - which is the path an externally
          // rendered clip takes to become a finished reel.
          const activeProvider = await selectReelVideoProvider();
          const generationReady = await reelProviderCredentialsPresent(activeProvider);
          const gen = generationReady
            ? await settle(processNextReelJob())
            : { processed: false, status: `generation skipped: REEL_VIDEO_PROVIDER=${activeProvider} has no credentials present` };
          if (!generationReady) {
            log.warn("reel-pipeline: generation stage skipped, assembly still running", {
              provider: activeProvider,
              hint: "point REEL_VIDEO_PROVIDER at a credentialed lane, or load that provider's credentials",
            });
          }
          const { processNextRepairJob } = await import("../services/selectiveRepair");
          const rep = await settle(processNextRepairJob());
          const details = [
            recovered ? `recovered ${recovered}` : null,
            resumed ? `resumed ${resumed} timed-out` : null,
            reconciled ? `reconciled ${reconciled} ambiguous publish(es)` : null,
            sweptReservations ? `released ${sweptReservations} stale reservation(s)` : null,
            ...asms.map((a) => `assemble ${a.jobId ?? "?"}: ${a.status}`),
            gen.processed ? `gen ${gen.jobId ?? "?"}: ${gen.status}` : null,
            rep.processed ? `repair ${rep.jobId ?? "?"}: ${rep.status}` : null,
          ].filter(Boolean).join("; ");
          const result = {
            recordsProcessed: recovered + resumed + reconciled + sweptReservations + (gen.processed ? 1 : 0) + asms.length + (rep.processed ? 1 : 0),
            details: details || "no reel jobs to process",
          };
          // Assembly/repair have already run above — this re-throws AFTER them,
          // not instead of them, so this pulse's other stages still complete.
          // See reelPipelineCronShouldFailLoudly's doc comment for why.
          if (reelPipelineCronShouldFailLoudly(gen)) {
            throw new Error(gen.error);
          }
          return result;
        },
      },
      {
        name: "daily-reel-post",
        requiresFlag: "REEL_AUTOPOST_ENABLED", // consumer compares === "true"
        handler: async () => {
          const { runDailyReelPost } = await import("./jobs/dailyReelPost");
          return runDailyReelPost();
        },
      },
      {
        // Comment-velocity responder (Phase 3.2): drafts + (when armed) posts
        // claim-safe replies to comments on recently posted reels — first-hour
        // comment velocity is a Meta reach lever. Double-gated: requiresEnv keeps
        // it OFF by default, and even when on it dry-runs (logs only) unless
        // REEL_COMMENT_RESPONDER_LIVE=true. A claim-blocked draft is never posted.
        name: "reel-comment-responder",
        requiresEnv: "REEL_COMMENT_RESPONDER_ENABLED",
        handler: async () => {
          const { runReelCommentResponder } = await import("../services/commentResponder");
          return runReelCommentResponder();
        },
      },
      {
        name: "social-inventory-publisher",
        requiresFlag: "SOCIAL_INVENTORY_PUBLISH_ENABLED", // consumer compares === "true"
        handler: async () => {
          const { runSocialInventoryPublisher } = await import("./jobs/socialInventoryPublisher");
          return runSocialInventoryPublisher();
        },
      },
    ],
    running: false,
    lastRun: null,
  });

  // ═══ TIER 3: HOURLY (every 2 hr) ═══
  // Intelligence, follow-ups, syncs
  tiers.push({
    name: "hourly",
    intervalMs: 2 * 60 * 60 * 1000,
    // Optimized order: data quality → brain sync → intelligence → actions → outreach
    jobs: [
      {
        // forensic-audit HIGH · MOVED from the daily tier. Confirmation calls
        // self-gate to a 15:00–17:59 ET window, but the daily tier fires once
        // per 24h phased by boot time, so that window was almost never hit and
        // the feature was effectively dead (logged "completed · Outside
        // window"). The hourly (2h) tier always has a tick inside any 3h
        // window; the job's at-most-once claim + 24h dedup make repeated
        // ticks safe. Self-gates on VAPI env + FEATURE_CONFIRMATION_CALLS
        // (OFF by default). Still registered in registerAllJobs for HTTP.
        name: "confirmation-calls",
        handler: async () => {
          const { runConfirmationCalls } = await import("./jobs/confirmationCalls");
          return runConfirmationCalls();
        },
      },
      {
        // wave-181.85 · AgentPhone Voice Recovery escalation · same timer-dead
        // bug as confirmation-calls, same fix — MOVED to the hourly tier. Self-gates
        // on FEATURE_VOICE_RECOVERY (OFF by default) + AGENTPHONE_RECOVERY_AGENT_ID /
        // VAPI env + at-most-once claims. Left in registerAllJobs for HTTP-trigger path.
        name: "voice-recovery",
        handler: async () => {
          const { runVoiceRecovery } = await import("./jobs/voiceRecovery");
          return runVoiceRecovery();
        },
      },
      {
        name: "feedback-cycle", // FIRST: decay memories, check anomalies, pacing — feeds into intelligence quality
        handler: async () => {
          const { runFeedbackCycle } = await import("../services/feedbackLoop");
          return runFeedbackCycle();
        },
      },
      {
        name: "pull-from-statenour-brain", // SECOND: get fresh brain data before intelligence runs
        handler: async () => {
          const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-web-production.up.railway.app";
          const syncKey = process.env.STATENOUR_SYNC_KEY || "";
          if (!syncKey) return { details: "No sync key" };
          try {
            const res = await fetch(`${statenourUrl}/api/sync/nour-os`, {
              headers: { "x-sync-key": syncKey },
              signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) return { details: `HTTP ${res.status}` };
            const data = await res.json();
            const brain = data?.data || data;
            const { remember } = await import("../services/nickMemory");
            // Empty text and statements about Nick's own memory store are not
            // remembered: "[statenour] Nick AI has 30 learned memories" was
            // re-pulled every pass into 4,904 uses (2026-09-22).
            const { pulledMemoryText } = await import("../services/memoryWriterGuards");
            let imported = 0;

            // Pull insights (brain analysis, reflections, predictions)
            for (const insight of (brain.recentInsights || []).slice(0, 5)) {
              const content = pulledMemoryText("[statenour]", insight.title || insight.content);
              if (!content) continue;
              await remember({ type: "insight", content, source: "statenour_pull", confidence: 0.8 });
              imported++;
            }

            // Pull patterns (behavioral, business, personal)
            for (const pattern of (brain.patterns || []).slice(0, 3)) {
              await remember({ type: "pattern", content: `[statenour-pattern] ${pattern.name || ""}: ${pattern.description || ""}`.slice(0, 500), source: "statenour_patterns", confidence: 0.75 });
              imported++;
            }

            // Pull predictions (what statenour brain thinks will happen)
            for (const pred of (brain.predictions || []).slice(0, 2)) {
              await remember({ type: "insight", content: `[statenour-prediction] ${pred.title || pred.prediction || ""} — confidence: ${pred.confidence || "?"}`.slice(0, 500), source: "statenour_predictions", confidence: 0.7 });
              imported++;
            }

            // Pull contradictions (things the brain flagged as inconsistent)
            for (const contra of (brain.contradictions || []).slice(0, 2)) {
              await remember({ type: "lesson", content: `[statenour-contradiction] ${contra.description || contra.message || ""}`.slice(0, 500), source: "statenour_contradictions", confidence: 0.85 });
              imported++;
            }

            // Pull open loops (unresolved items Nour should address)
            for (const loop of (brain.openLoops || []).slice(0, 3)) {
              await remember({ type: "insight", content: `[statenour-open-loop] ${loop.title || loop.text || ""} — status: ${loop.status || "open"}`.slice(0, 500), source: "statenour_loops", confidence: 0.6 });
              imported++;
            }

            // Pull commitments (things Nour committed to)
            for (const commit of (brain.commitments || []).slice(0, 2)) {
              const content = pulledMemoryText("[statenour-commitment]", commit.text || commit.title, ` — deadline: ${commit.deadline || "none"}, status: ${commit.status || "active"}`);
              if (!content) continue;
              await remember({ type: "preference", content, source: "statenour_commitments", confidence: 0.9 });
              imported++;
            }

            // Handle drift alerts — urgent ones trigger immediate Telegram
            const driftAlerts = (brain.driftAlerts || brain.alerts || []).filter((a: Record<string, unknown>) => a.severity === "critical" || a.urgent);
            if (driftAlerts.length > 0) {
              try {
                const { sendUrgentBrief } = await import("./jobs/morningBrief");
                await sendUrgentBrief("NOUR OS Drift Alert", driftAlerts.map((a: Record<string, unknown>) => a.message || a.title || String(a)).join("\n"));
              } catch (e) { log.warn("[cron/scheduler] operation failed:", e); }
            }

            // Non-urgent alerts still stored as memories
            for (const alert of (brain.driftAlerts || []).filter((a: Record<string, unknown>) => !a.urgent).slice(0, 3)) {
              await remember({ type: "lesson", content: `[statenour-alert] ${alert.message || alert.ruleName || ""}`.slice(0, 500), source: "statenour_alerts", confidence: 0.7 });
              imported++;
            }

            return { recordsProcessed: imported, details: `${imported} items pulled (insights+patterns+predictions+loops+alerts), ${driftAlerts.length} urgent` };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
      {
        name: "memory-sync-to-statenour", // THIRD: push our memories out
        handler: async () => {
          const { syncMemoriesToStatenour } = await import("../services/nickMemory");
          const count = await syncMemoriesToStatenour();
          return { recordsProcessed: count, details: `${count} memories synced to statenour` };
        },
      },
      {
        name: "nick-intelligence", // FOURTH: analyze with fresh data
        businessHoursOnly: true,
        handler: async () => {
          const { runProactiveCheck } = await import("../services/nickIntelligence");
          return runProactiveCheck();
        },
      },
      {
        name: "nick-auto-actions", // FIFTH: act on intelligence
        businessHoursOnly: true,
        handler: async () => {
          const { runAutoActions } = await import("../services/nickIntelligence");
          return runAutoActions();
        },
      },
      // ─── REMOVED 2026-05-08 (wave-100): auto-labor-guide-sync ───
      // Per operator directive: ALL ALG-touching crons consolidated to
      // login-triggered + manual-trigger paths only. The mirror probe
      // fires on admin login (server/_core/oauth.ts) + on operator's
      // "Sync Data" button click. The hourly cron was redundant + would
      // kick the shop counter's session every time operator was on admin
      // during business hours. Deleted intentionally.
      //
      // Side note: the function it called (shopDriverSync.pullRecentTickets)
      // also has a broken auth URL — silent fail. shopDriverMirror.runFullMirror
      // is the working path, fired via algProbeBudget.requestAlgProbe.
      {
        name: "customer-segment-refresh",
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { processCustomerSegmentation } = await import("./jobs/customerSegmentation");
            return processCustomerSegmentation();
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
      // Wave-100 update (2026-05-08): customer-metrics-refresh moved OFF
      // the cron tier per operator directive — it now fires from the
      // OAuth login callback instead. Reason: cron probes were triggering
      // background ALG sessions that kicked the shop counter's live
      // login. Login-triggered keeps refresh to user moments only.
      // See server/_core/oauth.ts line ~131 for the trigger.
      {
        name: "intelligence-engines-live", // Cross-sell, LTV, lead scoring, attribution — runs BEFORE autopilot so it has fresh data
        businessHoursOnly: true,
        handler: async () => {
          // wave-181.65 (bug-hunter deeper pass) · the four .catch handlers
          // below previously swallowed errors silently — DB outages or
          // bad data would return defaults with no log line, making the
          // cron write status='completed' with "Scored 0 leads" even
          // during real failures. Now: log each failure with errorId so
          // the operator can see it in Railway logs without losing the
          // best-effort aggregation behavior (cron still completes).
          const { scoreLeads, predictCustomerLTV, trackCampaignAttribution, analyzeDeclinedWork } = await import("../services/intelligenceEngines");
          // Generic `unknown` fallback type lets each promise keep its
          // own narrow result type while sharing one error-logging helper.
          // We only consume `leads` below; the others are intentionally
          // fired for side-effects (DB writes inside each engine).
          const safe = (name: string, p: Promise<unknown>): Promise<unknown> =>
            p.catch((err: unknown) => {
              log.warn(`[cron:intelligence-engines-live] ${name} failed — continuing with partial results`, {
                errorId: `INTEL_ENGINE_${name.toUpperCase()}_THREW`,
                error: err instanceof Error ? err.message : String(err),
              });
              return null;
            });
          const [leads] = await Promise.all([
            safe("scoreLeads", scoreLeads()),
            safe("predictCustomerLTV", predictCustomerLTV()),
            safe("trackCampaignAttribution", trackCampaignAttribution()),
            safe("analyzeDeclinedWork", analyzeDeclinedWork()),
          ]);
          const leadCount = Array.isArray(leads) ? leads.length : 0;
          return { recordsProcessed: leadCount, details: `Scored ${leadCount} leads, LTV+attribution+declined updated` };
        },
      },
      {
        name: "intelligence-autopilot", // Autonomous intelligence — alerts, scoring, pacing (runs after engines-live)
        businessHoursOnly: true,
        handler: async () => {
          const { runIntelligenceAutopilot } = await import("./jobs/intelligenceAutopilot");
          return runIntelligenceAutopilot();
        },
      },
      {
        name: "stale-lead-followup", // outreach after intelligence is fresh
        businessHoursOnly: true,
        handler: async () => {
          const { processStaleLeadFollowUp } = await import("./jobs/staleLeadFollowup");
          return processStaleLeadFollowUp();
        },
      },
      {
        name: "missed-call-recovery", // Wave F · follow up unconverted VAPI callers (flag-gated, SHADOW until MISSED_CALL_RECOVERY_SEND=1)
        businessHoursOnly: true,
        handler: async () => {
          const { processMissedCallRecovery } = await import("./jobs/missedCallRecovery");
          return processMissedCallRecovery();
        },
      },
      {
        name: "review-requests", // Moved from pulse (15min was too aggressive)
        businessHoursOnly: true,
        handler: async () => {
          const { processReviewRequests } = await import("./jobs/reviewRequests");
          return processReviewRequests();
        },
      },
      {
        name: "review-reminder-drafts", // Q-39 · day-13 reminder DRAFTS for the review queue; never sends (flag-gated, off by default)
        businessHoursOnly: true,
        handler: async () => {
          const { processReviewReminderDrafts } = await import("./jobs/reviewReminderDrafts");
          return processReviewReminderDrafts();
        },
      },
      {
        name: "promise-risk-check", // NEW: detect work orders about to miss promised time
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { getPromiseRiskSummary } = await import("../services/promiseRisk");
            const risk = await getPromiseRiskSummary();
            const atRiskJobs = (risk.jobs || []).filter((r) => r.risk === "at_risk" || r.risk === "likely_late" || r.risk === "overdue");
            if (atRiskJobs.length > 0) {
              const { sendTelegram } = await import("../services/telegram");
              await sendTelegram(
                `⏰ PROMISE RISK: ${atRiskJobs.length} work orders at risk!\n\n` +
                atRiskJobs.slice(0, 3).map((r) => `WO#${r.orderNumber || r.workOrderId}: ${r.customerName || "?"} — ${r.risk}`).join("\n")
              );
            }
            return { recordsProcessed: atRiskJobs.length, details: `${atRiskJobs.length} at-risk WOs` };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
      {
        name: "stale-estimate-alert",
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { getDb } = await import("../db");
            const { sql: rawSql } = await import("drizzle-orm");
            const d = await getDb();
            if (!d) return { details: "No DB" };
            const [rows] = await d.execute(rawSql`
              SELECT customerName, totalAmount, invoiceDate, DATEDIFF(NOW(), invoiceDate) as daysOld
              FROM invoices WHERE paymentStatus = 'pending'
              AND invoiceDate < DATE_SUB(NOW(), INTERVAL 3 DAY)
              ORDER BY totalAmount DESC LIMIT 5
            `);
            const stale = rows as Record<string, unknown>[];
            if (stale.length > 0) {
              const { sendTelegram } = await import("../services/telegram");
              const totalPotential = stale.reduce((s: number, e) => s + Number(e.totalAmount || 0), 0);
              await sendTelegram(
                `💰 STALE ESTIMATES — ${stale.length} pending 3+ days ($${Math.round(totalPotential/100)})\n\n` +
                stale.map((e) => `${e.customerName} — $${Math.round(Number(e.totalAmount)/100)} (${e.daysOld}d old)`).join("\n") +
                `\n\nFollow up NOW — every day = lost conversion probability.`
              );
            }
            return { recordsProcessed: stale.length, details: `${stale.length} stale estimates alerted` };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
      {
        name: "predictive-escalation",
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { sendEscalationAlerts } = await import("../services/nickIntelligence");
            const result = await sendEscalationAlerts();
            return { recordsProcessed: result.sent, details: `${result.sent} escalation alerts sent` };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
      {
        name: "sync-visit-dates", // Update customer lastVisitDate from invoices + WOs
        handler: async () => {
          const { syncVisitDatesFromInvoices } = await import("../services/dataPipelines");
          return syncVisitDatesFromInvoices();
        },
      },
      {
        name: "enrich-customer-data", // Merge totalSpent, visitCount, vehicle from all sources
        handler: async () => {
          const { enrichCustomerData } = await import("../services/dataPipelines");
          return enrichCustomerData();
        },
      },
      {
        name: "drip-step-processor", // Process multi-step drip campaigns (Gap 2 fix)
        businessHoursOnly: true,
        handler: async () => {
          const { processDripSteps } = await import("../services/dripProcessor");
          return processDripSteps();
        },
      },
      {
        name: "winback-auto-process", // Auto-send pending winback messages (Gap 4 fix)
        businessHoursOnly: true,
        handler: async () => {
          const { processWinbackPending } = await import("../services/winbackProcessor");
          return processWinbackPending();
        },
      },
      {
        name: "campaign-auto-retry", // Auto-send review+referral campaign (was manual button)
        businessHoursOnly: true,
        handler: async () => {
          const { autoCampaignRetry } = await import("../services/workOrderAutomation");
          return autoCampaignRetry();
        },
      },
      {
        name: "reminder-queue", // Process due maintenance reminder SMS
        businessHoursOnly: true,
        handler: async () => {
          const { processReminders } = await import("./jobs/crudAutomation");
          return processReminders();
        },
      },
      {
        name: "callback-escalation", // Re-alert on callbacks stuck >4h
        businessHoursOnly: true,
        handler: async () => {
          const { escalateStaleCallbacks } = await import("./jobs/crudAutomation");
          return escalateStaleCallbacks();
        },
      },
      {
        name: "data-analyzers-live", // Chat demand, call attribution, fleet, geography — every 2h
        businessHoursOnly: true,
        handler: async () => {
          const { analyzeChatDemand, analyzeCallAttribution, analyzeFleet, analyzeGeography } = await import("../services/intelligenceEngines");
          const results = await Promise.all([
            analyzeChatDemand().catch((e) => { log.warn("[cron/scheduler] optional operation failed:", e); return null; }),
            analyzeCallAttribution().catch((e) => { log.warn("[cron/scheduler] optional operation failed:", e); return null; }),
            analyzeFleet().catch((e) => { log.warn("[cron/scheduler] optional operation failed:", e); return null; }),
            analyzeGeography().catch((e) => { log.warn("[cron/scheduler] optional operation failed:", e); return null; }),
          ]);
          return { recordsProcessed: results.filter(Boolean).length, details: `4 data analyzers refreshed` };
        },
      },
      // statenour-sync moved to pulse tier (15min) for live dashboard — no longer needed here
      {
        name: "safety-check",
        handler: async () => {
          const { runSafetyCheckJob } = await import("../services/safetyMonitor");
          return runSafetyCheckJob();
        },
      },
      {
        name: "post-invoice-followup", // 7-day thank you + review + referral SMS (was standalone setInterval)
        businessHoursOnly: true,
        handler: async () => {
          const { processPostInvoiceFollowUps } = await import("../postInvoiceFollowUp");
          const result = await processPostInvoiceFollowUps();
          return { recordsProcessed: result.processed, details: `${result.sent} sent, ${result.failed} failed` };
        },
      },
      // wave-fix-2026-05-25 (audit #98 + #99) · SA v2 compute and
      // cross-sell-outreach moved from daily tier (24h) to hourly tier
      // (2h). Original intent per code comment was 4×/day (every 6h);
      // daily-tier placement made the SA v2 launch effectively broken
      // (predictions stale by up to 24h, cross-sell sending on stale
      // data). 2h tier gives 12 fresh computes per day · cross-sell
      // reads always-fresh predictions. ORDER MATTERS — compute MUST
      // run before cross-sell in the same tier so cross-sell sees the
      // predictions from THIS tick, not the previous tick.
      {
        // SA v2 per-customer prediction compute · 12×/day in hourly tier.
        // Writes to service_affinity_predictions with 50/50 A/B arm split.
        // Flag · service_affinity_v2_compute (was activated 2026-05-24).
        name: "service-affinity-compute",
        handler: async () => {
          const { processServiceAffinityCompute } = await import("./jobs/serviceAffinityCompute");
          return processServiceAffinityCompute();
        },
      },
      // RETIRED 2026-08-04 · cross-sell-outreach (ROS-033, operator decision).
      // The loop ran 12x/day reporting `completed` while structurally unable
      // to send: MAX(confidence) ever recorded is 0.330 against the >= 0.50
      // eligibility gate (29,300 predictions, 4 customers >= 0.5; the only
      // sends ever were a 3-day May burst of 575). The operator chose
      // "accept dormant and stop calling it live" over recalibration.
      // jobs/crossSellOutreach.ts, its sms_cross_sell_outreach flag, and all
      // prediction data remain intact; service-affinity-compute above STAYS
      // (closedLoop lift resolution + nick intelligence read its table).
      // Re-enable = re-add the tier entry here, AFTER a model recalibration.
      {
        // wave-146 · THE FLYWHEEL · 7/30/60-day trust-call cadence after a
        // completed job. It was only registered via the legacy registerJob()
        // path in cron/index.ts, which NEVER schedules under the tiered
        // scheduler (startAllJobs no-ops when tiered is active) — so it had
        // never fired in production. Wiring it into the hourly tier here is
        // what actually makes it run. Safety is enforced inside the job:
        // FEATURE_FOLLOWUP_CADENCE gate (off by default · also the requiresEnv
        // below), FOLLOWUP_CADENCE_DRY_RUN preview, hard daily cap,
        // at-most-once per (booking,touch), SMS opt-out, and a 9-18 ET window.
        // businessHoursOnly + daily-cap make the 2h tick safe (paced, not bursty).
        name: "followup-cadence",
        businessHoursOnly: true,
        requiresEnv: "FEATURE_FOLLOWUP_CADENCE",
        handler: async () => {
          const { runFollowupCadence } = await import("./jobs/followupCadence");
          return runFollowupCadence();
        },
      },
      {
        name: "content-reserve-replenish",
        requiresFlag: "CONTENT_REPLENISH_ENABLED", // consumer compares === "true"
        handler: async () => {
          const { runContentReserveReplenish } = await import("./jobs/contentReserveReplenish");
          return runContentReserveReplenish();
        },
      },

      // ═══ ONCE-PER-SHOP-DAY (ROS-081) ═══
      // These four are logically daily, but they CANNOT live in the daily
      // tier: it is a 24h interval phased by process start, so a pod that
      // booted outside 07:00-20:59 ET skipped every businessHoursOnly job
      // in it, every day. Prod cron_log 2026-07-29:
      //   opportunity-queue-refresh ran 1 times in 7 days, expected about 7.
      //
      // Here the 2h tier offers each of them ~7 chances inside business
      // hours, and `oncePerShopDay` claims the first one and declines the
      // rest — so the cadence is exactly once a day, proven per JOB instead
      // of inferred from a tier-level stamp.
      {
        name: "referral-loop-closer", // Match referred customers to bookings/invoices, SMS both parties
        businessHoursOnly: true,
        oncePerShopDay: true,
        handler: async () => {
          const { closeReferralLoop } = await import("./jobs/crudAutomation");
          return closeReferralLoop();
        },
      },
      {
        name: "vip-auto-recognition", // Notify new VIP customers (3+ visits, $2000+ spent)
        businessHoursOnly: true,
        oncePerShopDay: true,
        handler: async () => {
          const { notifyNewVips } = await import("./jobs/crudAutomation");
          return notifyNewVips();
        },
      },
      {
        // Wave 4 (REVENUE-OPS-ROADMAP) · consolidates missed-revenue
        // opportunities (unresolved estimates, pending callbacks) into
        // the durable revenue_opportunities queue. READ-ONLY against
        // sources; writes only its own table; NEVER contacts customers.
        // Degrades to a no-op until migration 0099 is hand-applied.
        name: "opportunity-queue-refresh",
        businessHoursOnly: true,
        oncePerShopDay: true,
        handler: async () => {
          const { refreshOpportunityQueue } = await import("../services/opportunityQueue");
          return refreshOpportunityQueue();
        },
      },
      {
        // Promise Ledger sweep (0102) · overdue customer promises
        // escalate ONCE into the Decision Inbox (promise_overdue) and
        // rot to `missed` after 48h — the ledger tells the truth about
        // broken promises. NEVER contacts customers; keeping a promise
        // stays a human action. No-op until 0102 is applied.
        name: "promise-sweep",
        businessHoursOnly: true,
        oncePerShopDay: true,
        handler: async () => {
          const { sweepOverduePromises } = await import("../services/promiseLedger");
          return sweepOverduePromises();
        },
      },
      {
        // 2026-08-07 estate audit · weekly revenue digest (Mondays).
        // The weekly intelligence report never read `invoices`; this is
        // the missing sales report — paid-only mirror revenue, WoW delta,
        // parts/labor mix, repeat-revenue share, arrivals→invoice receipts,
        // pushed via Telegram. Lives in THIS tier (not daily) per ROS-081:
        // the 24h tier's phase can park outside business hours forever;
        // here it gets ~7 chances and the claim keeps it exactly-once.
        // Self-gates to shop-TZ Mondays inside the job.
        name: "weekly-revenue-digest",
        oncePerShopDay: true,
        handler: async () => {
          const { runWeeklyRevenueDigest } = await import("./jobs/weeklyRevenueDigest");
          return runWeeklyRevenueDigest();
        },
      },
      {
        // 2026-10-08 · weekly Search Console digest (Mondays) — the search-side
        // twin of the revenue digest above. Official 28-day GSC totals vs the
        // prior 28 days, top queries/pages, plus CTR opportunities and 7-day
        // ranking moves from the search_performance mirror, pushed via
        // Telegram. GSC numbers had reached the operator only by pull (admin
        // Market card, `pnpm gsc:report`, the bridge); the daily gsc-pipeline
        // alert fires only on a 5-position drop. Same tier + claim (ROS-081);
        // self-gates to shop-TZ Mondays inside the job. Fails closed: no
        // official total → nothing sent, run rejects. The env gate is the
        // presence marker _core/index.ts derives from the service-account
        // creds at boot, the same one gsc-pipeline uses.
        name: "weekly-gsc-digest",
        requiresEnv: "GOOGLE_SEARCH_CONSOLE_KEY",
        oncePerShopDay: true,
        handler: async () => {
          const { runWeeklyGscDigest } = await import("./jobs/weeklyGscDigest");
          return runWeeklyGscDigest();
        },
      },
      {
        // 2026-09-01 (audit F-4) · kpi_snapshots had NO writer for the life of
        // the schema; kpi.history returned [] to every caller. One row per
        // completed shop week, idempotent, once per shop day.
        //
        // 2026-09-22 · moved here from the daily tier. `oncePerShopDay` claims
        // through claimOncePerShopDay(), which is gated to business hours, so
        // on the 24h tier the job ran only when that tier's phase happened to
        // land inside 07:00-20:59 ET: the boot-claim pass fired the daily tier
        // at 04:29 ET on 09-22 and the job was skipped with no cron_log row,
        // while self-healing reported it 48h stale. Same ROS-081 class as the
        // digest above; here it gets ~7 chances a day and the claim keeps it
        // exactly-once.
        name: "kpi-snapshot",
        oncePerShopDay: true,
        handler: async () => {
          const { processKpiSnapshot } = await import("./jobs/kpiSnapshot");
          return processKpiSnapshot();
        },
      },
      {
        // 2026-08-23 · WIRED. Same defect as campaign-resume: registered in
        // cron/index.ts, present in no tier, ZERO cron_log rows ever.
        //
        // It is the ONLY producer of `sms_learning_recommendations` rows
        // (services/smsLearningEngine.ts). The consumer has been live the whole
        // time — routers/smsOrchestrator.ts lists those rows and approves or
        // rejects them — so the admin review panel showed an empty list, which
        // reads as "the learning engine found nothing to recommend" when the
        // truth was "the engine has never run". Production confirmed the
        // prediction exactly: 0 rows, newest NULL.
        //
        // Declared cadence is weekly. It lives in THIS tier rather than the 24h
        // one for the ROS-081 reason the digest above documents: the daily
        // tier's phase can park outside business hours indefinitely, whereas
        // here it gets several chances a day and oncePerShopDay keeps it to
        // exactly one run. The weekday gate is inside the handler, matching
        // weekly-strategic-insight.
        //
        // ─── 2026-08-25 · STAGED BEHIND THE MANUAL TRIGGER ───────────────
        //
        // Same mechanism as campaign-resume above: `enabled: false` stops the
        // scheduler only; POST /api/admin/run-staged-cron reaches it (the
        // bridge allowlist does NOT — see campaign-resume above).
        //
        // The reason here is NOT a customer side effect — this job writes
        // sms_learning_recommendations rows for an admin panel and texts
        // nobody. It is staged because its first real run is the one worth
        // watching: it is the ONLY producer for that table, the panel has been
        // rendering an empty list since it shipped, and an operator seeing the
        // first batch of recommendations appear unattended cannot tell a good
        // batch from a bad one after the fact.
        //
        // Measured before staging (prod, 2026-08-25): 3 runs — 2026-08-23
        // 18:46Z (Sunday, skipped), 2026-08-24 12:35Z (Monday, ran the real
        // digest: "no threshold crossed — dataset 0 example(s), 0 edit(s)
        // analysed"), 2026-08-25 12:35Z (Tuesday, skipped). 0 records
        // processed, 0 errors. sms_learning_recommendations: 0 rows.
        //
        // TO PROMOTE TO AUTOMATIC: delete the `enabled: false` line, and delete
        // this job's entry from MANUAL_TRIGGER_STAGED in
        // cron/registry-tier-map.ts — the canary fails until both move together.
        name: "sms-learning-digest",
        enabled: false,
        oncePerShopDay: true,
        handler: async () => {
          const dow = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, weekday: "long" });
          if (dow !== "Monday") return { recordsProcessed: 0, details: `${dow}: weekly digest runs Mondays` };
          const { processSmsLearningDigest } = await import("../services/smsLearningEngine");
          return processSmsLearningDigest();
        },
      },
    ],
    running: false,
    lastRun: null,
  });

  // ═══ TIER 4: DAILY (once a day, 09:30 ET slot — wallClockTiers.ts) ═══
  // intervalMs is the nominal cadence consumers read (getJobCadences); no timer uses it.
  // Everything that runs once a day — batched together
  tiers.push({
    name: "daily",
    intervalMs: 24 * 60 * 60 * 1000,
    jobs: [
      {
        /**
         * Plate-read retention (ADR-0017 s7). The 30-day policy shipped in statenour
         * against `device_events`; plate text ALSO lands here in `vehicle_visits.plateText`
         * and nothing removed it, so the policy covered one of the two tables that hold it.
         *
         * Reads nothing on a shop with no plate recogniser wired -- which is today. It is
         * here BEFORE that wiring lands, so turning the recogniser on is not a disclosure.
         */
        name: "plate-retention-scrub",
        handler: async () => {
          const { scrubExpiredPlates, PLATE_RETENTION_DAYS } = await import("../services/plateRetention");
          const r = await scrubExpiredPlates();
          if (r.capped) {
            const { alertSystem } = await import("../services/telegram");
            await Promise.resolve(
              alertSystem(
                "Plate retention scrub hit its batch cap with work still pending",
                `Scrubbed ${r.scrubbed} rows over ${r.batches} batches of ${r.batchSize} and hit the ` +
                  `${r.maxBatches}-batch stop. Plate text older than ${PLATE_RETENTION_DAYS} days is still ` +
                  `in vehicle_visits. Investigate before the next run: a cap means a backfill, a clock ` +
                  `jump, or a policy change.`,
              ),
            ).catch(() => { /* alerting must not fail the scrub it reports on */ });
          }
          return {
            recordsProcessed: r.scrubbed,
            details: r.capped
              ? `CAPPED after ${r.scrubbed} rows (${r.batches}x${r.batchSize}) -- retention is BEHIND`
              : `${r.scrubbed} plate(s) scrubbed, retention current to ${r.cutoff.toISOString().slice(0, 10)}`,
          };
        },
      },
      {
        name: "db-backup",
        handler: async () => {
          const { runDailyBackup } = await import("../services/dbBackup");
          return runDailyBackup();
        },
      },
      {
        name: "engine-health",
        handler: async () => {
          const { runHealthCheck } = await import("../services/failover");
          return runHealthCheck();
        },
      },

      // NOTE: Also runs in hourly tier for more frequent updates
      {
        name: "cleanup",
        handler: async () => {
          const { cleanupOldData } = await import("./jobs/cleanup");
          return cleanupOldData();
        },
      },
      {
        name: "customer-segmentation",
        handler: async () => {
          const { processCustomerSegmentation } = await import("./jobs/customerSegmentation");
          return processCustomerSegmentation();
        },
      },
      // wave-181.111 · psychographic profile (10 segments) daily refresh.
      // Wraps the orphaned segmentCustomer() classifier in a DB-batch
      // pass that writes customers.psycho_profile · powers profile-aware
      // SMS routing + admin chip + analytics. Idempotent · only writes
      // when segment actually changes · Telegram silent on stable runs.
      {
        name: "psycho-profile-refresh",
        handler: async () => {
          const { processPsychoProfileRefresh } = await import("./jobs/psychoProfileRefresh");
          return processPsychoProfileRefresh();
        },
      },
      // wave-181.112 · unmatched tire demand SIGNAL · complements existing
      // analyzeTireInventory in dataPipelines.ts. Aggregates UNMATCHED
      // tire estimates by extracted size · cross-references Gateway live
      // inventory · Telegram ranks top 10 sizes by unresolved estimate
      // value. Signal only — unmatched ≠ proven stockout loss; the alert
      // tells the operator what to verify before ordering.
      {
        name: "inventory-demand-forecast",
        handler: async () => {
          const { processInventoryDemandForecast } = await import("./jobs/inventoryDemandForecast");
          return processInventoryDemandForecast();
        },
      },
      // wave-181.113 · Nick AI call eval (daily quality loop)
      // Scores every VAPI call 0-100 using VAPI's already-extracted
      // analysis signals (outcome, sentiment, successEvaluation) blended
      // with duration + conversion heuristics. Writes back to
      // vapi_call_logs.eval_* + nick_memory · Telegram alerts when avg
      // score drops below 60 or wasted_count >= 3 (signal of real
      // problem, not noise).
      {
        name: "vapi-call-eval",
        requiresEnv: "VAPI_API_KEY",
        handler: async () => {
          const { processVapiCallEval } = await import("./jobs/vapiCallEval");
          return processVapiCallEval();
        },
      },
      // wave-181.x · Tier A · Closed-loop delivery. Measures pending
      // wave_metrics rows whose measure_at has passed · writes lift /
      // no-lift / regression · Telegram digest only on days with
      // actual measurements (silent otherwise).
      {
        name: "closed-loop-measure",
        handler: async () => {
          const { processClosedLoopMeasure } = await import("./jobs/closedLoopMeasure");
          return processClosedLoopMeasure();
        },
      },
      // 2026-08-06 · the R&D gated-edit loop, self-sustaining: every Monday,
      // ghost-replay the served VAPI prompt against fresh Ossuary failures,
      // let the optimizer propose bounded edits, accept only when the paired
      // permutation test on repeated holdout replays clears alpha with no
      // reliably-handled call broken (services/promptEvolutionGate.ts), and
      // PROPOSE the winner (kv + Telegram). The
      // served prompt is never written — Push Config stays the serving gate.
      {
        name: "prompt-evolution-weekly",
        requiresEnv: "OLLAMA_API_KEY",
        // Production 2026-09-28: this job hit the scheduler's 4-minute default
        // and was marked failed while its Promise continued in the background.
        // A full cycle serially ghost-replays train + holdout, generates bounded
        // challengers, then scores the winner on holdout. Give that measured
        // workload its own budget; the daily tier interval is 24h, so 30m stays
        // comfortably below the tier cadence while still bounding a hung lane.
        timeoutMs: 30 * 60 * 1000,
        handler: async () => {
          const { processPromptEvolutionWeekly } = await import("./jobs/promptEvolutionWeekly");
          return processPromptEvolutionWeekly();
        },
      },
      // 2026-08-05 · the missing RESOLVER for the content experiment registry
      // (0108): assignment was wired at enqueue but startExperiment /
      // attachPublishedMedia / recordVerdict had ZERO callers, so no experiment
      // could ever start or conclude. Reads running experiments daily, gathers
      // 72h snapshot observations, records a verdict; refusals persist and
      // leave the experiment running. No-op one-SELECT when nothing is running.
      {
        name: "content-experiment-resolve",
        handler: async () => {
          const { processContentExperimentResolve } = await import("./jobs/contentExperimentResolve");
          return processContentExperimentResolve();
        },
      },
      // 2026-09-15 · Dream-to-Proof wave. The same experiment discipline,
      // pointed at the public site: for every ARMED web experiment
      // (shared/webExperiments.ts + its flag) count exposed visitors per arm
      // from customer_events, run the sequential kernel, PROPOSE the verdict
      // over Telegram and record it in the evidence ledger. Never applies a
      // winner. One flag read when nothing is armed.
      {
        name: "web-experiment-resolve",
        handler: async () => {
          const { processWebExperimentResolve } = await import("./jobs/webExperimentResolve");
          return processWebExperimentResolve();
        },
      },
      // 2026-07-07 · the missing WRITER for the service-affinity closed
      // loop: resolves matured predictions into prediction_outcomes
      // (invoice within 14d via last-10 phone join). The table + its
      // reader (closedLoop resolver service_affinity_acted_to_revenue_14d)
      // shipped with migration 0061 but no job ever inserted rows, so the
      // 50/50 ab_arm experiment ran with no readout. Runs BEFORE the
      // resolver's daily measure in wall-clock terms is not required —
      // both are daily; the resolver simply reflects whatever is resolved
      // so far. Details string carries the treatment-vs-control arm split.
      {
        name: "prediction-outcomes-resolve",
        handler: async () => {
          const { processPredictionOutcomesResolve } = await import("./jobs/predictionOutcomesResolve");
          return processPredictionOutcomesResolve();
        },
      },
      // wave-181.x · Tier A · SEO Forensic · daily SERP rank-shift
      // detection on top-30 GSC queries. Catches drops from rank 4 →
      // rank 18 the DAY AFTER they happen instead of weeks later
      // when revenue cliffs. Telegram alert on warning/alert shifts.
      {
        name: "seo-forensic",
        handler: async () => {
          const { processSeoForensic } = await import("./jobs/seoForensic");
          return processSeoForensic();
        },
      },
      // wave-181.x · Tier A · Monte-Carlo revenue forecast · weekly
      // (Mondays only). 10,000 trials over 13-week sample window.
      // Telegram digest with P10/P50/P90 band + top variance driver.
      // Self-gates on day-of-week · no-op on non-Mondays.
      {
        name: "monte-carlo-forecast",
        handler: async () => {
          const { processMonteCarloForecast } = await import("./jobs/monteCarloForecast");
          return processMonteCarloForecast();
        },
      },
      // wave-181.x · Tier S · Agentic-actions auditor · pairs with
      // call-eval. Reads recent vapi_call_logs · fetches VAPI detail ·
      // audits tool calls vs ground truth (bookings, callbacks,
      // pricing bounds) · writes findings to metadata.agenticAudit ·
      // Telegram alert on price drift / missing booking / etc.
      {
        name: "agentic-auditor",
        requiresEnv: "VAPI_API_KEY",
        handler: async () => {
          const { processAgenticAuditor } = await import("./jobs/agenticAuditor");
          return processAgenticAuditor();
        },
      },
      // wave-181.4 · migrated from statenour-os v10.0.526 Arc A F3.
      // Pulls VAPI call list, derives end-to-end latency, captures
      // rows in voice_latency_events, fires Telegram alert when
      // breach streak ≥ 3 consecutive call-days exceed 500ms p50.
      {
        name: "vapi-latency-sync",
        handler: async () => {
          const { processVapiLatencySync } = await import("./jobs/vapiLatencySync");
          return processVapiLatencySync();
        },
      },
      // wave-181.62 (2026-05-18 PM) · synthetic-call harness · catches
      // the wave-181.50 class of bug (config drift · webhook silent
      // dropout · dispatcher break) in <24h instead of 5 days. Runs
      // both config-drift check + signed webhook roundtrip + 3 read-
      // only tool dispatch smokes. Throws on any failure so cron_log
      // marks 'failed' + cronSkipWatchdog catches it · also fires its
      // own Telegram alert inline (belt + suspenders).
      {
        name: "vapi-harness",
        requiresEnv: "VAPI_WEBHOOK_SECRET",
        handler: async () => {
          const { processVapiHarness } = await import("./jobs/vapiHarness");
          return processVapiHarness();
        },
      },
      {
        name: "retention-all",
        handler: async () => {
          // wave-181.58 · added D7 + D14 to the dispatch list (wave-181.47
          // shipped the tier definitions but never wired the processors).
          const { processRetention7Day, processRetention14Day, processRetention45Day, processRetention90Day, processRetention180Day, processRetention365Day } = await import("./jobs/retentionSequences");
          const r7 = await processRetention7Day();
          const r14 = await processRetention14Day();
          const r45 = await processRetention45Day();
          const r90 = await processRetention90Day();
          const r180 = await processRetention180Day();
          const r365 = await processRetention365Day();
          return {
            recordsProcessed: (r7.recordsProcessed || 0) + (r14.recordsProcessed || 0) + (r45.recordsProcessed || 0) + (r90.recordsProcessed || 0) + (r180.recordsProcessed || 0) + (r365.recordsProcessed || 0),
            details: `7d: ${r7.details || "done"}, 14d: ${r14.details || "done"}, 45d: ${r45.details || "done"}, 90d: ${r90.details || "done"}, 180d: ${r180.details || "done"}, 365d: ${r365.details || "done"}`,
          };
        },
      },
      // wave-fix-2026-05-25 · cross-sell-outreach + service-affinity-compute
      // moved to hourly tier above (see audit #98 + #99 comment there).
      // Their slots here are intentionally empty.
      {
        name: "warranty-alerts",
        handler: async () => {
          const { processWarrantyAlerts } = await import("./jobs/warrantyAlerts");
          return processWarrantyAlerts();
        },
      },
      {
        /*
         * Q-37 · the estimate -> invoice matcher, on a schedule. It used to run
         * only inside runEstimateMirror(), i.e. only after a demand-driven ALG
         * probe logged in AND fetched estimates — so an auth failure or an empty
         * fetch left already-mirrored invoices unmatched, and the next job reads
         * "unmatched" as "declined". The match is local (alg_estimates x
         * invoices); it makes no ALG call and contacts no one.
         *
         * ORDER MATTERS: tier jobs run sequentially, and this sits immediately
         * BEFORE alg-declined-work-recovery so every send decision sees that
         * day's matches. Pinned by estimateInvoiceMatch.test.ts.
         */
        name: "estimate-invoice-match",
        handler: async () => {
          const { backfillMatches } = await import("../services/shopDriverEstimateSync");
          const r = await backfillMatches({ sinceDays: DECLINED_RECOVERY_WINDOW_DAYS });
          if (r.scanned === 0) {
            return { recordsProcessed: 0, details: `no unmatched estimates in the last ${DECLINED_RECOVERY_WINDOW_DAYS}d` };
          }
          return {
            recordsProcessed: r.matched,
            details: `matched ${r.matched} of ${r.scanned} unmatched · ambiguous ${r.ambiguous} · no phone ${r.skippedNoPhone}`,
          };
        },
      },
      {
        name: "alg-declined-work-recovery", // NEW: ALG-sourced walk-in estimates SMS follow-ups
        // Fail closed: this customer-send lane cannot run unless the local
        // estimate->invoice reconciliation actually succeeded in THIS pass.
        requiresSuccessfulJobs: ["estimate-invoice-match"],
        handler: async () => {
          const { runDeclinedWorkRecovery } = await import("./jobs/declinedWorkRecovery");
          // wave-148 · operator chose 50/day to drain the ~$321K declined
          // pool in compliant batches (50/day stays well under the F25e
          // carrier daily-throughput safe zone — blasting all at once would
          // flag the SMS number). Env-overridable; default 50. Per-run cap ==
          // per-day here because this is a once-daily tier job. Activation
          // still requires FEATURE_DECLINED_RECOVERY=1 (else this is dry-run).
          return runDeclinedWorkRecovery({ maxSends: Number(process.env.DECLINED_RECOVERY_MAX_PER_RUN) || 50 });
        },
      },
      {
        name: "unpaid-invoice-recovery", // NEW: courteous 7d/30d payment reminders for pending/partial invoices
        handler: async () => {
          const { runUnpaidInvoiceRecovery } = await import("./jobs/unpaidInvoiceRecovery");
          // Off by default - FEATURE_UNPAID_INVOICE_RECOVERY=1 on Railway enables live
          // sends; without it this is a dry-run (logs + Telegram alert, no SMS out).
          return runUnpaidInvoiceRecovery({ maxSends: Number(process.env.INVOICE_RECOVERY_MAX_PER_RUN) || 30 });
        },
      },
        // voice-recovery moved to hourly tier (see above)
      {
        name: "declined-work-recovery",
        handler: async () => {
          const { getDeclinedWorkLedger } = await import("../services/declinedWorkRecovery");
          const ledger = await getDeclinedWorkLedger(20);

          // Actually ACT on declined work — alert on recoverable revenue
          const unrecovered = ledger.filter(e => e.declinedItems.some(i => !i.recovered));
          const totalRecoverableValue = unrecovered.reduce((sum, e) => sum + e.totalDeclinedValue, 0);
          const safetyItems = unrecovered.filter(e => e.hasSafetyItems);

          if (unrecovered.length > 0) {
            try {
              const { sendTelegram } = await import("../services/telegram");
              const { remember } = await import("../services/nickMemory");

              // Alert on safety-related declined work (highest priority)
              if (safetyItems.length > 0) {
                const topSafety = safetyItems.slice(0, 3);
                await sendTelegram(
                  `⚠️ DECLINED SAFETY WORK — ${safetyItems.length} customers\n\n` +
                  topSafety.map(e =>
                    `${e.customerName || "Customer"} (${e.phone || "no phone"}) — $${e.totalDeclinedValue} — ${e.vehicle}`
                  ).join("\n") +
                  `\n\nTotal recoverable: $${totalRecoverableValue}. Call them back.`
                );
              } else if (totalRecoverableValue > 500) {
                await sendTelegram(
                  `💰 DECLINED WORK: $${totalRecoverableValue} recoverable from ${unrecovered.length} customers.\n` +
                  `Top: ${unrecovered.slice(0, 2).map(e => `${e.customerName || "?"} ($${e.totalDeclinedValue})`).join(", ")}`
                );
              }

              await remember({
                type: "insight",
                content: `Declined work recovery: ${unrecovered.length} customers with $${totalRecoverableValue} recoverable. ${safetyItems.length} safety items.`,
                source: "declined_recovery",
                confidence: 0.85,
              });

              // AUTO-ENROLL declined customers into drip campaign (Gap 12 fix)
              const { enrollInDripCampaign } = await import("../services/workOrderAutomation");
              let enrolled = 0;
              for (const entry of unrecovered.slice(0, 10)) {
                if (entry.phone) {
                  try {
                    await enrollInDripCampaign("declined-estimate", {
                      phone: entry.phone,
                      name: entry.customerName || "there",
                      vehicle: entry.vehicle || undefined,
                      service: entry.declinedItems.map((i) => i.description || "service").join(", ").slice(0, 100),
                    });
                    enrolled++;
                  } catch (e) { log.warn("[cron/scheduler] operation failed:", e); }
                }
              }
              if (enrolled > 0) log.info(`Enrolled ${enrolled} declined-estimate customers in drip`);
            } catch (e) { log.warn("[cron/scheduler] operation failed:", e); }
          }

          return { recordsProcessed: ledger.length, details: `${unrecovered.length} unrecovered ($${totalRecoverableValue}), ${safetyItems.length} safety` };
        },
      },
      {
        name: "staff-performance",
        handler: async () => {
          const { getTeamPerformance } = await import("../services/staffPerformance");
          // AG-20 · persist tech metrics (see cron/index.ts twin).
          const perf = await getTeamPerformance(true);
          return { recordsProcessed: perf.techs?.length || 0, details: "Rollup complete (persisted)" };
        },
      },
      {
        name: "fleet-scoring",
        handler: async () => {
          const { identifyFleetProspects } = await import("../services/fleetScoring");
          return identifyFleetProspects();
        },
      },
      {
        name: "review-monitor",
        requiresEnv: ["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY"],
        handler: async () => {
          const { processReviewMonitor } = await import("./jobs/reviewMonitor");
          return processReviewMonitor();
        },
      },
      {
        // wave-181.28 · daily check that fires a Telegram alert when
        // an env-gated cron job has been silently skipping for 7+ days
        // (Railway env var deleted or never set). Without this, broken
        // keys leave the dashboard quietly stale for weeks.
        name: "cron-skip-watchdog",
        handler: async () => {
          const { processCronSkipWatchdog } = await import("./jobs/cronSkipWatchdog");
          return processCronSkipWatchdog();
        },
      },
      {
        name: "competitor-monitor",
        requiresEnv: ["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY"],
        // Q-48: keep only the Google place_id registry current. Ratings/review
        // counts are read on demand and are not persisted as a historical baseline.
        enabled: true,
        handler: async () => {
          const { runCompetitorMonitorCycle } = await import("../services/competitorMonitor");
          const result = await runCompetitorMonitorCycle();
          return {
            recordsProcessed: result.known,
            details: `${result.known} competitor place_ids known · ${result.newlyResolved} newly resolved · ${result.unresolved} unresolved`,
          };
        },
      },
      // ─── NEW DAILY JOBS ────────────────────────────────
      {
        name: "churn-detection", // Detect at-risk customers and auto-enroll in drip
        handler: async () => {
          try {
            const { analyzeCustomers, getCustomerActionPlan } = await import("../services/customerIntelligence");
            const data = await analyzeCustomers();
            // A failed customer read is not "0 at-risk, 0% retention": fail the run so cron_log says so.
            if (data.unavailable) throw new Error("customer read failed: at-risk and retention are unknown, not zero");
            const plan = await getCustomerActionPlan();
            if (data.atRiskCustomers.length > 0) {
              const { sendTelegram } = await import("../services/telegram");
              await sendTelegram(
                `📉 DAILY CHURN CHECK\n\n` +
                `At-risk: ${data.atRiskCustomers.length} customers\n` +
                `Lapsed: ${data.lapsedCustomers} | Lost: ${data.lostCustomers}\n` +
                `Retention: ${data.retentionRate}%\n` +
                (plan ? `\n${plan.slice(0, 500)}` : "")
              );

              // AUTO-ENROLL at-risk customers into drip campaign (Gap 1+6 fix)
              const { enrollInDripCampaign } = await import("../services/workOrderAutomation");
              let enrolled = 0;
              for (const cust of data.atRiskCustomers.slice(0, 10)) {
                if (cust.phone) {
                  try {
                    await enrollInDripCampaign("at-risk", {
                      phone: cust.phone,
                      name: cust.name || "there",
                    });
                    enrolled++;
                  } catch (e) { log.warn("[cron/scheduler] operation failed:", e); }
                }
              }
              if (enrolled > 0) log.info(`Enrolled ${enrolled} at-risk customers in drip`);
            }
            const atRisk = data.atRiskUnavailable ? "at-risk unknown (lapsed read failed)" : `${data.atRiskCustomers.length} at-risk`;
            return { recordsProcessed: data.atRiskCustomers.length, details: `${atRisk}, ${data.retentionRate}% retention` };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
      {
        name: "qc-comeback-detection", // Detect repeat visits = possible failed repair
        handler: async () => {
          try {
            const { getDb } = await import("../db");
            const d = await getDb();
            if (!d) return { details: "No DB" };
            const { workOrders } = await import("../../drizzle/schema");
            const { sql: sqlFn, and, gte, inArray } = await import("drizzle-orm");
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            // Find work orders created in last 7 days where customer had a completed WO in prior 30 days.
            // wave-181.77 (db-optimizer audit) · was `d.select()` which is
            // SELECT * — fetched 40+ columns including text blobs
            // (diagnosis, customerComplaint, internalNotes, techNotes,
            // serviceDescription, declinedWorkJson) just to read id +
            // customerId. Project only what we actually use.
            const recentWOs = await d.select({ id: workOrders.id, customerId: workOrders.customerId })
              .from(workOrders)
              .where(sqlFn`${workOrders.createdAt} >= ${weekAgo}`)
              .limit(50);

            // Wave-181.61: collapse N+1 — preload prior WOs into a Map keyed by customerId
            // (was: per-row lookup → 1 + N queries; now: 2 queries total).
            // wave-182 (architecture decision #1): work_orders.customer_id is
            // polymorphic and every anonymous walk-in shares the SAME sentinel
            // string ("walk-in"/"WALK-IN"). Grouping by it treats unrelated
            // walk-ins as one returning customer and fabricates "comebacks".
            // Exclude the sentinels — a real returning customer is keyed by a
            // numeric id or a stable phone string, both of which we keep.
            const isAnonWoCustomer = (id: number | null): boolean => {
              return id === null;
            };
            const customerIds: number[] = Array.from(new Set(
              recentWOs
                .map((wo: { customerId: number | null }) => wo.customerId)
                .filter((id: number | null): id is number => !isAnonWoCustomer(id))
            ));
            const priorByCustomer = new Map<number, Set<string>>();
            if (customerIds.length > 0) {
              const priorRows = await d.select({ id: workOrders.id, customerId: workOrders.customerId })
                .from(workOrders)
                .where(and(
                  inArray(workOrders.customerId, customerIds),
                  sqlFn`${workOrders.status} IN ('closed','invoiced','picked_up')`,
                  gte(workOrders.createdAt, thirtyDaysAgo),
                )) as Array<{ id: string; customerId: number | null }>;
              for (const row of priorRows) {
                if (row.customerId === null) continue;
                const existing = priorByCustomer.get(row.customerId);
                if (existing) existing.add(row.id);
                else priorByCustomer.set(row.customerId, new Set([row.id]));
              }
            }

            let comebacks = 0;
            for (const wo of recentWOs) {
              if (isAnonWoCustomer(wo.customerId)) continue;
              const priorIds = priorByCustomer.get(wo.customerId!);
              if (!priorIds) continue;
              // Comeback iff a qualifying prior WO exists that isn't this row itself
              for (const id of priorIds) {
                if (id !== wo.id) { comebacks++; break; }
              }
            }

            if (recentWOs.length > 0) {
              log.info(`QC comeback scan: ${recentWOs.length} recent WOs · ${customerIds.length} customers · ${comebacks} comebacks · 2 queries (was ${1 + recentWOs.length})`);
            }
            if (comebacks > 0) {
              const { remember } = await import("../services/nickMemory");
              await remember({ type: "lesson", content: `QC comeback check: ${comebacks} potential comebacks this week (customers who returned within 30d of a completed job). Review quality.`, source: "qc_detection", confidence: 0.8 });
            }
            return { recordsProcessed: comebacks, details: `${comebacks} potential comebacks detected` };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
      {
        name: "wo-auto-close", // Auto-close stale WOs in picked_up/invoiced >7 days
        handler: async () => {
          const { autoCloseStaleWorkOrders } = await import("../services/workOrderAutomation");
          return autoCloseStaleWorkOrders();
        },
      },
      {
        name: "gateway-price-refresh", // Auto-fetch wholesale tire prices from Gateway B2B
        requiresEnv: "GATEWAY_TIRE_USERNAME",
        handler: async () => {
          const { refreshGatewayPrices } = await import("../services/dataPipelines");
          return refreshGatewayPrices();
        },
      },
      {
        name: "invoice-cross-reconciliation", // Match invoices, flag anomalies, daily totals
        handler: async () => {
          const { crossReconcileInvoices } = await import("../services/dataPipelines");
          return crossReconcileInvoices();
        },
      },
      {
        name: "tire-inventory-intelligence", // Track popular sizes, low-stock alerts
        handler: async () => {
          const { analyzeTireInventory } = await import("../services/dataPipelines");
          return analyzeTireInventory();
        },
      },
      {
        name: "revenue-analytics-pipeline", // Week-over-week, monthly metrics, top services
        handler: async () => {
          const { processRevenueAnalytics } = await import("../services/dataPipelines");
          return processRevenueAnalytics();
        },
      },
      {
        name: "gbp-auto-post", // Generate and push GBP posts via Telegram (Gap 9 fix)
        handler: async () => {
          const { generateAndNotifyGBPPost } = await import("../services/gbpAutoPost");
          return generateAndNotifyGBPPost();
        },
      },
      {
        name: "email-campaign-auto", // Auto-send email campaigns via Resend (Gap 5 fix)
        handler: async () => {
          const { autoSendEmailCampaigns } = await import("../services/emailCampaigns");
          return autoSendEmailCampaigns();
        },
      },
      {
        name: "no-show-detection", // Flag past-date bookings as no-show + follow-up SMS
        handler: async () => {
          const { detectNoShows } = await import("./jobs/crudAutomation");
          return detectNoShows();
        },
      },
      {
        name: "stale-booking-cleanup", // Auto-cancel 30+ day untouched bookings + rebook SMS
        handler: async () => {
          const { autoCleanStaleBookings } = await import("./jobs/crudAutomation");
          return autoCleanStaleBookings();
        },
      },
      {
        name: "wo-auto-advance", // completed → invoiced when invoice exists
        handler: async () => {
          const { autoAdvanceWorkOrders } = await import("./jobs/crudAutomation");
          return autoAdvanceWorkOrders();
        },
      },
      {
        name: "booking-priority-escalation", // 48h+ untouched → high priority
        handler: async () => {
          const { autoEscalateBookingPriority } = await import("./jobs/crudAutomation");
          return autoEscalateBookingPriority();
        },
      },
      {
        name: "review-auto-draft", // Fetch reviews + generate AI reply drafts
        handler: async () => {
          const { autoFetchAndDraftReviews } = await import("./jobs/crudAutomation");
          return autoFetchAndDraftReviews();
        },
      },
      {
        name: "low-stock-alerts", // Telegram when inventory hits reorder threshold
        handler: async () => {
          const { alertLowStock } = await import("./jobs/crudAutomation");
          return alertLowStock();
        },
      },
      {
        name: "content-auto-gen", // Blog article draft (Wed + Sat — 2x/week)
        handler: async () => {
          const { autoGenerateContent } = await import("./jobs/crudAutomation");
          return autoGenerateContent();
        },
      },
      // ROS-081 · `referral-loop-closer` and `vip-auto-recognition` were
      // MOVED OUT of this tier to the 2h hourly tier. Both are
      // businessHoursOnly, and this tier is a 24h interval phased by
      // process start — a pod that booted outside 07:00-20:59 ET skipped
      // them every single day. Do not move them back.
      {
        name: "pricing-intelligence", // Payment-status collections signal (name kept for cron_log continuity; no price advice — see services/pricingIntelligence.ts header)
        handler: async () => {
          const { runPricingIntelligenceJob } = await import("../services/pricingIntelligence");
          return runPricingIntelligenceJob();
        },
      },
      // ROS-081 · `opportunity-queue-refresh` and `promise-sweep` were also
      // MOVED OUT of this tier to the 2h hourly tier, for the same reason.
      // Prod cron_log 2026-07-29 caught the first one: it ran 1 time in 7
      // days against a contract expecting 7.
      {
        name: "alg-auto-discovery", // Probe ShopDriver API for new endpoints
        handler: async () => {
          // SHOP-PROTECT (wave-100, 2026-05-08): TWO gates now.
          // (1) Admin must have been active within the last 60 min, AND
          // (2) Shop must be CLOSED (outside Mon-Sat 8-18, Sun 9-16 ET).
          // Auto-discovery opens a fresh ALG JWT which kicks the shop
          // counter's live session. Only fire when the shop isn't ringing.
          if (isBusinessHours()) {
            return { details: "skipped: shop is open (admin can still discover via manual probe button)" };
          }
          const { runIfAdminActive } = await import("../lib/adminActivity");
          const result = await runIfAdminActive(
            async () => {
              const { runAlgAutoDiscovery } = await import("./jobs/intelligenceAutopilot");
              return runAlgAutoDiscovery();
            },
            { jobName: "alg-auto-discovery", windowMinutes: 60 },
          );
          if ("skipped" in result) return { details: result.reason };
          return result;
        },
      },
      {
        name: "pipelines-auto-run", // GBP reviews + GSC + Instagram — all pipelines that are due
        // 12 MINUTES, not the 4-minute default (2026-10-08). The Instagram
        // pipeline now ends with the delivered-copy QA pass (services/
        // deliveredReelQa.ts): at most two posted Reels per run, each a Graph
        // GET (15 s) + ffprobe of the master and the CDN copy (60 s each) + a
        // full ffmpeg decode of the CDN copy for the flash scan (120 s). Worst
        // case adds ~8.5 min on top of GBP + GSC + the analytics sync; typical
        // adds 1–3. At the 4-minute default a slow pass logged "failed:
        // timeout" while the handler kept running as a zombie. This tier is a
        // daily interval, so the budget stays far inside the lock hand-back.
        timeoutMs: 12 * 60 * 1000,
        handler: async () => {
          const { runDuePipelines } = await import("../pipelines/orchestrator");
          const result = await runDuePipelines();
          return { recordsProcessed: result.ran.length, details: `Ran: ${result.ran.join(", ") || "none"}, skipped: ${result.skipped.join(", ") || "none"}` };
        },
      },
      {
        name: "review-pipeline", // Fetch + analyze Google reviews, alert on negatives
        // The fetch layer (server/_core/map.ts) hard-requires GOOGLE_MAPS_API_KEY;
        // gating on GOOGLE_PLACES_API_KEY let the job run and die on the missing
        // Maps key in any env that has one but not the other (tripwire found
        // 2026-07-16 while diagnosing the empty review_pipeline table).
        requiresEnv: "GOOGLE_MAPS_API_KEY",
        handler: async () => {
          try {
            const { runReviewPipeline, getUrgentReviews } = await import("../pipelines/gbp-reviews");
            const result = await runReviewPipeline();
            const urgent = await getUrgentReviews();
            if (urgent.length > 0) {
              const { sendTelegram } = await import("../services/telegram");
              await sendTelegram(
                `⭐ URGENT REVIEWS: ${urgent.length} need response!\n\n` +
                urgent.slice(0, 3).map((r: Record<string, unknown>) => `${r.rating}★ ${r.authorName || "Anonymous"}: "${(String(r.text || "")).slice(0, 80)}..."`).join("\n") +
                `\n\nRespond ASAP — negative reviews compound damage every hour.`
              );
            }
            return { recordsProcessed: result.fetched || 0, details: `${result.fetched || 0} reviews synced, ${urgent.length} urgent` };
          } catch (e) {
            // Same swallow-into-success shape as gsc-pipeline above. A review
            // sync that silently stops is how negative reviews go unanswered
            // while the cron board stays green.
            log.error("[cron/scheduler] review-pipeline FAILED:", e);
            throw e instanceof Error ? e : new Error(String(e));
          }
        },
      },
      {
        name: "gsc-pipeline", // Google Search Console sync + ranking alerts
        requiresEnv: "GOOGLE_SEARCH_CONSOLE_KEY",
        handler: async () => {
          try {
            const { runGscPipeline, detectRankingChanges } = await import("../pipelines/gsc-data");
            const result = await runGscPipeline();
            const changes = await detectRankingChanges();
            const drops = changes.filter((c) => c.direction === "dropped" && Math.abs(c.delta) >= 5);
            if (drops.length > 0) {
              const { sendTelegram } = await import("../services/telegram");
              await sendTelegram(
                `📉 SEO RANKING DROPS: ${drops.length} queries lost 5+ positions!\n\n` +
                drops.slice(0, 5).map((d) => `"${d.query}" dropped ${Math.abs(d.delta)} spots (now #${d.currentPosition})`).join("\n") +
                `\n\nInvestigate content or technical issues.`
              );
            }
            return { recordsProcessed: result.sync?.fetched || 0, details: `${result.sync?.fetched || 0} rows synced, ${drops.length} ranking drops` };
          } catch (e) {
            // RETHROW. This catch used to return `{ details: "GSC pipeline
            // skipped" }`, which is a NORMAL return — runTier writes
            // status='completed' for it.
            //
            // That mattered the moment the token fetch got a timeout: the job
            // would have gone from visibly failing ("timeout", 6/6 runs) to
            // silently reporting success while syncing nothing. Adding the
            // timeout WITHOUT this change would have made the observability
            // strictly worse, and the new failure observer would never see it.
            log.error("[cron/scheduler] gsc-pipeline FAILED:", e);
            throw e instanceof Error ? e : new Error(String(e));
          }
        },
      },
      {
        name: "full-intelligence-digest", // Compound intelligence report → Telegram
        handler: async () => {
          try {
            const { generateFullIntelligenceReport } = await import("../services/intelligenceEngines");
            const report = await generateFullIntelligenceReport();
            const { sendTelegram } = await import("../services/telegram");
            const { remember } = await import("../services/nickMemory");

            // Build digest from report
            const parts: string[] = [`📊 DAILY INTELLIGENCE DIGEST`];
            const f = report.forecast as Record<string, unknown> | null;
            if (f && !f.error) {
              const fMonth = f.month as Record<string, unknown> | undefined;
              parts.push(`Revenue: $${Math.round(Number(fMonth?.soFar || 0))} MTD (${fMonth?.onPace ? "ON PACE" : "BEHIND"} for $${fMonth?.target || BUSINESS.revenueTarget.monthly})`);
            }
            const ls = report.leadScores as Array<Record<string, unknown>> | null;
            if (ls?.length && ls.length > 0) {
              parts.push(`Leads: ${ls.length} scored, top: ${ls.slice(0, 2).map((l) => `${l.name} (${l.score})`).join(", ")}`);
            }
            const cs = report.crossSell as Record<string, unknown> | null;
            if (cs?.recommendations && (cs.recommendations as unknown[])?.length > 0) {
              parts.push(`Cross-sell: ${(cs.recommendations as unknown[]).length} opportunities`);
            }
            const dec = report.declined as Record<string, unknown> | null;
            if (dec?.totalDeclinedValue && Number(dec.totalDeclinedValue) > 0) {
              // revenue-truth-correction: "recoverable" implied a known
              // recovery rate — this is the declined POOL, recovery TBD.
              parts.push(`Declined work (line items): $${Math.round(Number(dec.totalDeclinedValue))} declined pool`);
            }
            // 2026-05-05 — NEW signal: full unresolved ALG estimates
            // (whole quotes never matched to an invoice). Unresolved ≠
            // walked: could be undecided, repaired elsewhere, or sync lag.
            // Surfaces $X / N count when alg_estimates table has data.
            const wae = report.walkAwayEstimates as Record<string, unknown> | null;
            if (wae && !wae.error && Number(wae.unmatchedCount || 0) > 0) {
              parts.push(
                `Unresolved estimates: ${wae.unmatchedCount} unmatched · ` +
                `$${wae.unmatchedValueDollars} quoted, outcome unknown · ` +
                // wave-181.34: sendTelegram uses parse_mode='HTML' — the literal
                // `(<7d)` was making Telegram's parser try to read `<7d)` as
                // an opening tag and 400 the whole daily-digest. HTML-escape
                // the `<` so it renders as the intended text.
                `${wae.recoveryWindow ? (wae.recoveryWindow as Record<string, number>).last7d : 0} fresh (&lt;7d) · ` +
                `${wae.conversionRate}% matched to invoices`,
              );
            }

            await sendTelegram(parts.join("\n\n"));
            await remember({ type: "insight", content: parts.join(". ").slice(0, 1500), identity: "daily_digest", source: "daily_digest", confidence: 0.9 });
            return { recordsProcessed: 1, details: "Full digest sent" };
          } catch (e: unknown) { log.warn("[cron/scheduler] digest failed:", e); throw e; /* audit F-9 */ }
        },
      },
      {
        // "End-of-day revenue truth" — reports the PREVIOUS COMPLETE shop day.
        //
        // 2026-08-08 · this job reported "$0, 0 jobs" on 7 of the last 8 days
        // while the shop actually took $806 / $1,554 / $3,772 / $2,873 / $2,008
        // on those days. Two compounding causes, both fixed here:
        //
        //   1. It called getDailyRevenueTruth() with no argument, which means
        //      TODAY SO FAR. This job sits in the 24h tier whose phase is set
        //      by pod boot time (the ROS-081 class), so it has been firing at
        //      11:59 / 14:03 / 16:01 / 19:08 UTC — i.e. 08:00-15:00 ET, before
        //      most of the day's invoices exist. It was measuring an empty
        //      morning and labelling it "end-of-day verified".
        //   2. remember() dedupes by CONTENT HASH, so every $0 day collapsed
        //      onto one row: nick_memory_insight_e8bb1cbd7719 reached
        //      **813 uses and confidence 1.0**, making "the shop made $0" the
        //      single most-reinforced revenue memory Nick has. Real days sat
        //      at 1-6 uses. Repetition of a bug outvoted the truth.
        //
        // Fix: read the previous complete shop day, stamp the DATE into the
        // memory content so each day is its own row and can never pile up,
        // and write nothing at all when the day has no jobs — a $0 day is a
        // closed shop or a broken import, never a "verified number".
        name: "revenue-reconciliation",
        handler: async () => {
          try {
            const { getDailyRevenueTruth } = await import("../services/invoiceReconciliation");
            // Previous calendar day in the SHOP's timezone, not the container's.
            const shopToday = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
            const prev = new Date(`${shopToday}T00:00:00Z`);
            prev.setUTCDate(prev.getUTCDate() - 1);
            const day = prev.toISOString().slice(0, 10);

            const truth = await getDailyRevenueTruth(day);
            if (!truth.completedJobs) {
              return { recordsProcessed: 0, details: `${day}: no paid invoices — nothing recorded (closed day or import gap)` };
            }
            const { remember } = await import("../services/nickMemory");
            await remember({
              type: "insight",
              content: `Revenue for ${day}: $${truth.totalRevenue}. Jobs: ${truth.completedJobs}. Avg ticket: $${truth.avgTicket}.`,
              source: "revenue_reconciliation",
              identity: "revenue_reconciliation_latest",
              confidence: 0.95,
            });
            return { recordsProcessed: 1, details: `${day}: $${truth.totalRevenue}, ${truth.completedJobs} jobs` };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
      {
        /*
         * Q-50 phase 2a (ADR-0021) · NHTSA manufacturer warranty extensions.
         * Not warranty-alerts (earlier in this tier), which is the shop's OWN service-warranty
         * reminder to customers; this one only downloads NHTSA's public file and
         * upserts two public-data tables. Sends nothing. Flag-gated
         * (nhtsa_warranty_ingest, default OFF) inside the handler. A Sunday pass
         * streams ~2.6 GB of inflated text, so it gets a 30-minute budget,
         * and it sits LAST in this tier so a long pass never delays a
         * customer lane behind it (tier jobs run sequentially).
         */
        name: "nhtsa-warranty-ingest",
        timeoutMs: 30 * 60 * 1000,
        handler: async () => {
          const { processNhtsaWarrantyIngest } = await import("./jobs/nhtsaWarrantyIngest");
          return processNhtsaWarrantyIngest();
        },
      },
    ],
    running: false,
    lastRun: null,
  });

  // ═══ TIER 5: BRIEFINGS (07:00 and 19:00 ET slots — wallClockTiers.ts) ═══
  // intervalMs is the nominal cadence consumers read (getJobCadences); no timer uses it.
  // Morning brief + daily report — timing-critical
  tiers.push({
    name: "briefings",
    intervalMs: 12 * 60 * 60 * 1000,
    jobs: [
      {
        // 2026-08-09 · Self-gates to a 6am-12pm shop-TZ window inside the job,
        // the same shape daily-report uses for its evening slot. That gate ALONE
        // guarantees at most one send per day: this tier ticks every 12h, and
        // two ticks 12h apart cannot both land inside a 6h window.
        //
        // DELIBERATELY NOT oncePerShopDay — I added that flag first and review
        // caught that it makes things WORSE here. `runTier` calls
        // `claimOncePerShopDay` BEFORE the handler, so a tick that is inside
        // business hours but outside the morning window (a 14:00 phase) claims
        // the day's only slot and THEN skips on the window. The 12h partner tick
        // is then blocked, and since this tier is excluded from runOnStartup
        // (see `runOnStartup` below) the phase never moves — so the brief would
        // stop firing entirely, every day, until a redeploy. Trading "fires
        // twice" for "never fires" is not a fix. The claim is only safe when the
        // job's own gate runs BEFORE it, which is not how runTier is ordered.
        //
        // Residual, stated rather than hidden: if the tier's phase puts neither
        // tick in 06:00-11:59 ET, no brief lands that day. That is the existing
        // posture of its tier-mate daily-report (`if (etHour < 18) return`), it
        // self-corrects on the next redeploy, and it fails toward silence rather
        // than toward a 3am push. Moving this job to the 2h tier would remove
        // the residual outright and is the real fix if it ever bites.
        //
        // 2026-09-23 · that residual is closed: the tier no longer has a phase.
        // Its 07:00 ET slot lands inside this job's window every day and its
        // 19:00 ET slot inside daily-report's and daily-wins-digest's, each
        // claimed once per ET day (wallClockTiers.ts). The job's own window
        // gate stays as the second layer.
        name: "nick-morning-brief",
        handler: async () => {
          const { sendMorningBrief } = await import("./jobs/morningBrief");
          return sendMorningBrief();
        },
      },
      {
        name: "daily-report",
        handler: async () => {
          const { generateDailyReport } = await import("./jobs/dailyReport");
          return generateDailyReport();
        },
      },
      {
        name: "weather-intel",
        // 2026-09-22 · the service already refuses to run without this key, but
        // it did so by RETURNING { details: "No API key" } — a completed run
        // with zero records, eight times in a row, invisible to the skip
        // watchdog, which only reads status "skipped" with a "requiresEnv:"
        // detail. Declared here, the miss becomes the alarm that was built
        // for it. Setting the key ARMS weather_triggered_sms (flag is ON in
        // prod): decide that flag before the key.
        //
        // 2026-09-23 · the service now reads the keyless NWS forecast, so the
        // env gate is gone (OPENWEATHER_API_KEY is no longer read). The job
        // runs operator alerts + GBP drafts days ahead. Customer SMS is SHADOW
        // until env WEATHER_SMS_SEND=1 on top of the flag, because the trigger
        // meaning changed, and even armed it texts only on imminent (24h)
        // triggers. A failed NWS read throws, so cron_log records `failed`.
        handler: async () => {
          const { checkWeatherTriggers } = await import("../services/weatherIntelligence");
          const result = await checkWeatherTriggers();
          return { recordsProcessed: result.triggered.length, details: result.details };
        },
      },
      {
        name: "daily-wins-digest",
        handler: async () => {
          const { sendDailyWinsDigest } = await import("../services/liveFeed");
          return sendDailyWinsDigest();
        },
      },
      {
        name: "weekly-strategic-insight", // AI strategic brief — only fires on Sundays
        handler: async () => {
          const dow = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, weekday: "long" });
          if (dow !== "Sunday") return { details: "Not Sunday, skipped" };
          try {
            const { generateWeeklyInsight } = await import("../services/nickIntelligence");
            const insight = await generateWeeklyInsight();
            if (insight) {
              const { sendTelegram } = await import("../services/telegram");
              await sendTelegram(`🧠 WEEKLY STRATEGIC BRIEF\n\n${insight.slice(0, 3500)}`);
            }
            return { recordsProcessed: 1, details: "Weekly insight sent" };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
      {
        name: "chat-faq-pipeline", // Weekly chat question analysis — Sunday only
        handler: async () => {
          const dow = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, weekday: "long" });
          if (dow !== "Sunday") return { details: "Not Sunday, skipped" };
          try {
            const { runChatFaqPipeline } = await import("./jobs/chatFaqPipeline");
            return runChatFaqPipeline();
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; /* audit F-9: a swallowed error was recorded as completed */ }
        },
      },
    ],
    running: false,
    lastRun: null,
  });
}

let stopWallClockLoop: (() => void) | undefined;

/** Idempotent: builds the tier table once; safe for read-only callers (getJobCadences calls it). */
function ensureTiersBuilt(): void {
  if (tiers.length === 0) buildTiers();
}

export function startTieredScheduler(): void {
  // v1.7 audit fix · set a global flag so the legacy startAllJobs()
  // in cron/index.ts can detect we're active and refuse to
  // double-schedule. Mutex against duplicate SMS sends.
  (globalThis as { __nicksTieredSchedulerActive?: boolean })
    .__nicksTieredSchedulerActive = true;

  ensureTiersBuilt();

  // Start all tiers (staggered to avoid memory spike on boot)
  for (const tier of tiers) {
    const idx = tiers.indexOf(tier);
    // 2026-09-23 · daily and briefings run on the ET wall clock, not on a
    // boot claim + setInterval — 32 deploys overnight meant their 24 h / 12 h
    // timers never ticked and the boot claim set their time of day (daily ran
    // at 04:29 ET, outside every customer lane's send window). They are
    // started by the wall-clock loop below; see wallClockTiers.ts.
    if (isWallClockTier(tier.name)) continue;
    // Every tier decides its boot-time fire from the age of its last run,
    // read from the state resetSkipCount() writes on every run (the
    // forensic-audit CRITICAL fix: cron_log never carried a 'tier:daily'
    // row, so an earlier guard always saw NULL and re-fired daily on every
    // restart, re-sending retention / cross-sell / declined-work SMS).
    //
    // 2026-09-22 · until now only heartbeat, pulse and daily fired at boot;
    // hourly and briefings waited for a setInterval that starts counting at
    // process boot. With deploys under two hours apart — thirteen that day —
    // the hourly tier never reached its first tick: last run 12:29Z, still
    // silent at 20:00Z, ten jobs (voice-recovery, enrich-customer-data,
    // feedback-cycle, safety-check, the statenour syncs). The rule in
    // tierStartup.ts is the daily guard generalised: fire when the last run
    // is at least one interval old (daily keeps its 20 h allowance), or when
    // the tier has never run. The pass is CLAIMED by one conditional UPDATE
    // on cron_tier_skip_state — a row can be changed once, so of two replicas
    // booting together exactly one fires (review P1) — the age is computed in
    // SQL because a driver-parsed TIMESTAMP arrives zone-shifted, and no
    // claim means no fire. tierStartup.ts carries the full rationale and the
    // P2 residual: a pass killed mid-way keeps its start stamp (the full
    // hourly pass measured 89 s live, so about 1.3 % of a thirteen-deploy day).
    const stagger = idx * 30_000;

    // 2026-10-08 · the recurring timer starts once the tier's phase is known,
    // not at boot. A tier that was not due at boot used to wait a full interval
    // from boot, and every deploy before that tick reset the wait: the 2-hour
    // tier ran 131/168/189 min apart that day. Now it gets one claimed check
    // when it falls due (firstTickDelayMs), and the interval starts there.
    const startRecurring = () => {
      if (isCronDraining() || tier.handle) return;
      tier.handle = setInterval(() => {
        runTier(tier).catch(err => log.error(`Tier ${tier.name} failed:`, { error: err instanceof Error ? err.message : String(err) }));
      }, tier.intervalMs);
    };

    setTimeout(async () => {
      const allowanceMs = startupAllowanceMs(tier.name, tier.intervalMs);
      let lastRunAgeMs: number | null = null;
      let claim: StartupClaim | null = null;
      let claimError: string | null = null;
      try {
        const { getDb } = await import("../db");
        const d = await getDb();
        if (d) {
          try {
            lastRunAgeMs = await readLastRunAgeMs(d, tier.name);
          } catch {
            // informational only — the claim below is the decision
          }
          claim = await claimStartupPass(d, tier.name, allowanceMs);
        }
      } catch (e) {
        claimError = e instanceof Error ? e.message : String(e);
      }
      const decision = describeStartup({ tierName: tier.name, allowanceMs, claim, lastRunAgeMs, claimError });
      log.info(`${tier.name} tier startup: ${decision.fire ? "FIRING" : "skipping"} — ${decision.reason}`);
      const dueInMs = firstTickDelayMs({ allowanceMs, lastRunAgeMs, claim });
      if (dueInMs === null) {
        startRecurring();
      } else {
        log.info(`${tier.name} tier falls due in ${Math.round(dueInMs / 60000)} min — a claimed check runs then, and the interval starts from it`);
        tier.dueCheck = setTimeout(async () => {
          tier.dueCheck = undefined;
          let dueClaim: StartupClaim | null = null;
          let dueError: string | null = null;
          try {
            const { getDb } = await import("../db");
            const d = await getDb();
            if (d) dueClaim = await claimStartupPass(d, tier.name, allowanceMs);
          } catch (e) {
            dueError = e instanceof Error ? e.message : String(e);
          }
          const due = describeDueCheck(dueClaim, dueError);
          log.info(`${tier.name} tier due check: ${due.fire ? "FIRING" : "skipping"} — ${due.reason}`);
          startRecurring();
          if (!due.fire) return;
          runTier(tier).catch(err => log.error(`Tier ${tier.name} due check failed:`, { error: err instanceof Error ? err.message : String(err) }));
        }, dueInMs);
      }
      if (!decision.fire) return;
      runTier(tier).catch(err => log.error(`Tier ${tier.name} startup failed:`, { error: err instanceof Error ? err.message : String(err) }));
    }, stagger);
  }

  const wallClockTierNames = tiers.filter((t) => isWallClockTier(t.name)).map((t) => t.name);
  const wallClockRunner = createWallClockRunner({
    getDb: async () => {
      const { getDb } = await import("../db");
      return getDb();
    },
    runTier: async (tierName) => {
      const tier = tiers.find((t) => t.name === tierName);
      if (tier) await runTier(tier);
    },
    isTierRunning: (tierName) => tiers.find((t) => t.name === tierName)?.running === true,
    log,
  });
  stopWallClockLoop = startWallClockLoop(wallClockRunner, wallClockTierNames, {
    // after the staggered boot passes of the interval tiers
    bootDelayMs: tiers.length * 30_000,
    onError: (tierName, err) => log.error(`Tier ${tierName} wall-clock pass failed:`, { error: err instanceof Error ? err.message : String(err) }),
  });

  log.info(`Tiered scheduler started: ${tiers.length} tiers, ${tiers.reduce((s, t) => s + t.jobs.length, 0)} jobs`);

  // Seed business model into Nick's memory (runs once on startup)
  setTimeout(async () => {
    try {
      const { remember } = await import("../services/nickMemory");
      await remember({
        type: "preference",
        content: "BUSINESS MODEL: Nick's Tire & Auto is FIRST COME FIRST SERVE (FCFS). No appointments needed. DROP-OFFS PREFERRED — customer drops car off, holds their place in line without waiting. Most jobs done SAME DAY if dropped off before 10am. Quick inspections are FREE. Estimates are free. We don't charge to look at a car. Walk-ins welcome 7 days a week. If a customer didn't come through the website, they're a walk-in. ALG estimates without matching invoices are declined work (customer walked). Free inspections keep bays busy and build trust.",
        source: "business_model_seed",
        confidence: 1.0,
      });
    } catch (e) { log.warn("[cron/scheduler] operation failed:", e); }
  }, 60_000); // Wait 60s after boot for DB to be ready
}

/**
 * Stop the tiered scheduler.
 */
export function stopTieredScheduler(): void {
  // Q-10 · clearing the intervals alone left a pass already inside runTier
  // free to start every remaining job in its list after SIGTERM.
  beginCronDrain();
  stopWallClockLoop?.();
  stopWallClockLoop = undefined;
  for (const tier of tiers) {
    if (tier.handle) clearInterval(tier.handle);
    if (tier.dueCheck) clearTimeout(tier.dueCheck);
    // Cleared, not just cancelled: startRecurring refuses a tier that still has
    // a handle, so a stale one would keep a restarted scheduler's tier silent.
    tier.handle = undefined;
    tier.dueCheck = undefined;
  }
  log.info("Tiered scheduler stopped");
}

/**
 * Get tier statuses for admin dashboard.
 */
/**
 * The cadence each job ACTUALLY runs at, taken from the tier that owns it.
 *
 * The legacy registry in cron/index.ts still carries its own `intervalMin` per
 * job, and those numbers no longer describe reality: `review-requests` declares
 * 30 minutes but sits in the 2-hour tier, `review-monitor` declares 6 hours but
 * sits in the daily tier, `sms-scheduler` declares 5 minutes but sits in the
 * 15-minute business-hours tier. Anything comparing observed run times against
 * the legacy numbers will call healthy jobs stale.
 *
 * `businessHoursOnly` is returned alongside because such a job legitimately does
 * not run overnight — a staleness check that ignores it fires every night.
 *
 * `oncePerShopDay` is returned for the same reason, and matters MORE: those
 * jobs sit in the 2h tier so they get enough chances to land inside business
 * hours (ROS-081), but they deliberately run only once a day. A consumer that
 * judged them on the raw 120-minute interval would call a perfectly healthy
 * job stale within hours — see the two-shop-day allowance in `selfHealing`.
 *
 * A job absent from this map is in NO tier, which means it cannot run at all,
 * regardless of what the legacy registry says about it.
 */
export function getJobCadences(): Map<
  string,
  {
    intervalMin: number;
    businessHoursOnly: boolean;
    oncePerShopDay: boolean;
    tier: string;
    scheduledAutomatically: boolean;
    /** Env keys the tier loop requires (any one set) before it runs the job; empty = no env gate. */
    requiresEnv: string[];
  }
> {
  const out = new Map<
    string,
    {
      intervalMin: number;
      businessHoursOnly: boolean;
      oncePerShopDay: boolean;
      tier: string;
      scheduledAutomatically: boolean;
      requiresEnv: string[];
    }
  >();
  ensureTiersBuilt();
  for (const t of tiers) {
    for (const j of t.jobs) {
      out.set(j.name, {
        intervalMin: Math.round(t.intervalMs / 60000),
        businessHoursOnly: j.businessHoursOnly === true,
        oncePerShopDay: j.oncePerShopDay === true,
        tier: t.name,
        /*
         * 2026-08-25 · ADDED WITH THE STAGING FLAG, because without it every
         * consumer of this map reports a staged job as a live scheduled one.
         *
         * The cron-status surface renders tier + intervalMin + lastCompletedAt.
         * For campaign-resume that would have read "heartbeat tier, every 5
         * min, last completed 2026-08-25 14:19" -- forever, since the last
         * automatic run is frozen in cron_log and nothing will ever update it.
         * A job that cannot fire, displayed as one that fires every 5 minutes
         * and recently did.
         *
         * `enabled` is deliberately NOT the field name here. cron/index.ts has
         * its own `enabled` on the legacy registry, defaulting to true and
         * meaning something else entirely; two flags of the same name that
         * disagree is how the next reader gets it wrong.
         */
        scheduledAutomatically: j.enabled !== false,
        requiresEnv: j.requiresEnv ? (Array.isArray(j.requiresEnv) ? j.requiresEnv : [j.requiresEnv]) : [],
      });
    }
  }
  return out;
}

export function getTierStatuses(): Array<{ name: string; intervalMin: number; jobCount: number; running: boolean; lastRun: string | null }> {
  return tiers.map(t => ({
    name: t.name,
    intervalMin: Math.round(t.intervalMs / 60000),
    jobCount: t.jobs.length,
    running: t.running,
    lastRun: t.lastRun?.toISOString() || null,
  }));
}

/**
 * Run a single tier job by name. Searches all tiers.
 */
/**
 * Run a tier job's handler WITHOUT acquiring the cron lock, for callers that
 * ALREADY hold it.
 *
 * Found in review of PR #1996: `runJobByName` (cron/index.ts) acquires the lock
 * for the job name and then invokes its handler. A staged-job adapter that
 * called `runTierJobByName` from inside that handler would try to take the SAME
 * lock with a new token, get `held-by-other`, and return status "skipped" - and
 * the adapter discarded that status, so the outer runner recorded a successful
 * completion while NOTHING GENERATED. That is staging-as-silent-decommission
 * wearing a green tick, which is the exact failure the staging canary exists to
 * prevent.
 *
 * THROWS on handler error, deliberately: the caller's own try/catch is what
 * records status='failed', so swallowing here would convert a real failure into
 * "completed" a second time.
 */
export async function runTierJobHandlerUnlocked(
  jobName: string,
): Promise<{ recordsProcessed?: number; details?: string }> {
  for (const tier of tiers) {
    const job = tier.jobs.find((j) => j.name === jobName);
    if (job) return await job.handler();
  }
  throw new Error(`Tier job "${jobName}" not found — cannot run its handler`);
}

export async function runTierJobByName(jobName: string): Promise<{ status: string; recordsProcessed?: number; details?: string }> {
  for (const tier of tiers) {
    const job = tier.jobs.find(j => j.name === jobName);
    if (job) {
      // wave-fix-2026-05-25 (audit #87) · same cross-dyno lock as the
      // auto-tier loop. Manual admin-triggered runs go through this
      // path and can race against the scheduler-fired run of the same
      // job. Without the lock the operator pressing "Run Now" while the
      // tier was mid-firing the same job → double-fire.
      const lockResult = await acquireCronLock(job.name, jobTimeoutMs(job) * 2);
      if (lockResult.status === "held-by-other") {
        return { status: "skipped", details: "manual run skipped — cross-dyno lock held by another process" };
      }
      if (isCronDraining()) {
        if (lockResult.status === "acquired") await releaseCronLock(lockResult);
        return { status: "skipped", details: "server shutting down — no new job starts" };
      }
      try {
        const result = await trackCronRun(job.name, job.handler());
        return { status: "completed", recordsProcessed: result.recordsProcessed, details: result.details };
      } catch (err) {
        return { status: "failed", details: err instanceof Error ? err.message : String(err) };
      } finally {
        if (lockResult.status === "acquired") {
          await releaseCronLock(lockResult);
        }
      }
    }
  }
  const allNames = tiers.flatMap(t => t.jobs.map(j => j.name));
  return { status: "not_found", details: `Job "${jobName}" not found. Available: ${allNames.join(", ")}` };
}
