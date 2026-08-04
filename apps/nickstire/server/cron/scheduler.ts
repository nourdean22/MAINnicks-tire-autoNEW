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
 * TIER 4 (24 hr):  Daily — segmentation, retention, reports, cleanup
 *
 * Each tier runs its jobs SEQUENTIALLY within the tier to avoid
 * DB connection stampedes. Jobs still have individual timeout + skip
 * protection from the existing runJob() infrastructure.
 */

import { createLogger } from "../lib/logger";
import { BUSINESS } from "@shared/business";
import { acquireCronLock, releaseCronLock } from "./index";

const log = createLogger("scheduler");

interface TieredJob {
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
  /** Skip if disabled */
  enabled?: boolean;
}

interface Tier {
  name: string;
  intervalMs: number;
  jobs: TieredJob[];
  running: boolean;
  lastRun: Date | null;
  handle?: ReturnType<typeof setInterval>;
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

async function runTier(tier: Tier): Promise<void> {
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

  for (const job of tier.jobs) {
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
    const lockResult = await acquireCronLock(job.name);
    if (lockResult.status === "held-by-other") {
      skipped++;
      logTierJob(job.name, "skipped", 0, 0, "cross-dyno lock held by another process").catch((e) => { log.warn("[cron/scheduler] fire-and-forget failed:", e); });
      continue;
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
        job.handler(),
        new Promise<never>((_, reject) => {
          jobTimer = setTimeout(() => { timedOut = true; reject(new Error("timeout")); }, 4 * 60 * 1000);
        }),
      ]) as { recordsProcessed?: number; details?: string };
      completed++;
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

export function startTieredScheduler(): void {
  // v1.7 audit fix · set a global flag so the legacy startAllJobs()
  // in cron/index.ts can detect we're active and refuse to
  // double-schedule. Mutex against duplicate SMS sends.
  (globalThis as { __nicksTieredSchedulerActive?: boolean })
    .__nicksTieredSchedulerActive = true;

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

            if (issues.length > 0) {
              // Log internally only — no external notifications
              const { createLogger } = await import("../lib/logger");
              const accuracyLog = createLogger("cron:data-accuracy");
              accuracyLog.warn("Data accuracy issues found", { issues });
              const { remember } = await import("../services/nickMemory");
              await remember({ type: "lesson", content: `Data accuracy: ${issues.join(". ")}`, source: "accuracy_check", confidence: 0.8 });
            }

            return { recordsProcessed: issues.length, details: issues.length === 0 ? "All data clean" : issues.join("; ") };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Accuracy check failed" }; }
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
        name: "higgsfield-session-keepalive",
        handler: async () => {
          const { getHiggsfieldCredentialsJson, getHiggsfieldAccountHealth } = await import("../services/higgsfieldStudio");
          if (!(await getHiggsfieldCredentialsJson())) return { recordsProcessed: 0, details: "no higgsfield creds — skip" };
          const health = await getHiggsfieldAccountHealth();
          if (!health.credsValid) {
            log.error("Higgsfield session keepalive FAILED — refresh token likely revoked; re-login required", { raw: health.raw.slice(0, 200) });
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
              `Higgsfield keepalive FAILED — re-login required (refresh token revoked). ${health.raw.slice(0, 160)}`,
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
            return { details: `overnight probe failed: ${(e as Error).message}` };
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
            return { details: `evening probe failed: ${(e as Error).message}` };
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
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Revenue pulse skipped" }; }
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
        name: "reel-pipeline",
        // requiresFlag (not requiresEnv): the stages compare against the
        // exact string "true", so the gate must too — otherwise the cron
        // runs and silently no-ops. See the requiresFlag docstring.
        requiresFlag: "REEL_GENERATION_ENABLED",
        handler: async () => {
          const { processNextReelJob, processNextAssemblyJob, recoverStuckReelJobs } = await import(
            "../services/reelPipeline"
          );
          // Settle each stage independently: a pre-try DB rejection in the gen
          // stage must not skip assembly this pulse (the job simply retries on the
          // next pulse). Both stages share the same one-job-per-pulse cadence.
          type StageResult = { processed: boolean; jobId?: number; status?: string; error?: string };
          const settle = (p: Promise<StageResult>): Promise<StageResult> =>
            p.catch((e) => ({ processed: true, status: "error", error: e instanceof Error ? e.message : String(e) }));
          // First: requeue any orphaned in-flight jobs (hung CLI / process restart
          // mid-stage) so a stuck row can't silently wedge the pipeline forever.
          const recovered = await recoverStuckReelJobs()
            .then((r) => r.recovered)
            .catch(() => 0);
          const gen = await settle(processNextReelJob());
          const { processNextRepairJob } = await import("../services/selectiveRepair");
          const rep = await settle(processNextRepairJob());
          const asm = await settle(processNextAssemblyJob());
          const details = [
            recovered ? `recovered ${recovered}` : null,
            gen.processed ? `gen ${gen.jobId ?? "?"}: ${gen.status}` : null,
            asm.processed ? `assemble ${asm.jobId ?? "?"}: ${asm.status}` : null,
            rep.processed ? `repair ${rep.jobId ?? "?"}: ${rep.status}` : null,
          ].filter(Boolean).join("; ");
          return {
            recordsProcessed: recovered + (gen.processed ? 1 : 0) + (asm.processed ? 1 : 0) + (rep.processed ? 1 : 0),
            details: details || "no reel jobs to process",
          };
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
            let imported = 0;

            // Pull insights (brain analysis, reflections, predictions)
            for (const insight of (brain.recentInsights || []).slice(0, 5)) {
              await remember({ type: "insight", content: `[statenour] ${insight.title || insight.content || ""}`.slice(0, 500), source: "statenour_pull", confidence: 0.8 });
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
              await remember({ type: "preference", content: `[statenour-commitment] ${commit.text || commit.title || ""} — deadline: ${commit.deadline || "none"}, status: ${commit.status || "active"}`.slice(0, 500), source: "statenour_commitments", confidence: 0.9 });
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
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Pull failed" }; }
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
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Segmentation skipped" }; }
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
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Promise risk check skipped" }; }
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
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Stale estimate check failed" }; }
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
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Escalation check skipped" }; }
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
    ],
    running: false,
    lastRun: null,
  });

  // ═══ TIER 4: DAILY (every 24 hr) ═══
  // Everything that runs once a day — batched together
  tiers.push({
    name: "daily",
    intervalMs: 24 * 60 * 60 * 1000,
    jobs: [
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
        name: "alg-declined-work-recovery", // NEW: ALG-sourced walk-in estimates SMS follow-ups
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
        // wave-181.x · Tier S · enabled now that competitor_snapshots
        // table persists baselines across pod restarts. Without
        // persistence the in-memory diff reset on every restart and
        // change detection never fired (which is why this was off).
        enabled: true,
        handler: async () => {
          const { runCompetitorMonitorCycle } = await import("../services/competitorMonitor");
          const result = await runCompetitorMonitorCycle();
          return {
            recordsProcessed: result.fetched,
            details: `${result.fetched} competitors · ${result.changes} changes${result.alerted ? " · alerted" : ""}`,
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
            return { recordsProcessed: data.atRiskCustomers.length, details: `${data.atRiskCustomers.length} at-risk, ${data.retentionRate}% retention` };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Churn detection failed" }; }
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
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "QC comeback detection failed" }; }
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
        name: "estimate-followup", // Auto-follow up on unconverted estimates after 2-3 days
        handler: async () => {
          const { processEstimateFollowUp } = await import("../services/workOrderAutomation");
          return processEstimateFollowUp();
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
            await remember({ type: "insight", content: parts.join(". ").slice(0, 1500), source: "daily_digest", confidence: 0.9 });
            return { recordsProcessed: 1, details: "Full digest sent" };
          } catch (e: unknown) { return { details: `Digest failed: ${(e as Error).message}` }; }
        },
      },
      {
        name: "revenue-reconciliation", // End-of-day revenue truth
        handler: async () => {
          try {
            const { getDailyRevenueTruth } = await import("../services/invoiceReconciliation");
            const truth = await getDailyRevenueTruth();
            const { remember } = await import("../services/nickMemory");
            await remember({
              type: "insight",
              content: `Daily revenue truth: $${truth.totalRevenue || 0}. Jobs: ${truth.completedJobs || 0}. Avg ticket: $${truth.avgTicket || 0}. This is the end-of-day verified number.`,
              source: "revenue_reconciliation",
              confidence: 0.95,
            });
            return { recordsProcessed: 1, details: `Revenue: $${truth.totalRevenue || 0}, ${truth.completedJobs || 0} jobs` };
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Revenue reconciliation failed" }; }
        },
      },
    ],
    running: false,
    lastRun: null,
  });

  // ═══ TIER 5: BRIEFINGS (every 12 hr) ═══
  // Morning brief + daily report — timing-critical
  tiers.push({
    name: "briefings",
    intervalMs: 12 * 60 * 60 * 1000,
    jobs: [
      {
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
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Weekly insight failed" }; }
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
          } catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Chat FAQ pipeline failed" }; }
        },
      },
    ],
    running: false,
    lastRun: null,
  });

  // Start all tiers (staggered to avoid memory spike on boot)
  for (const tier of tiers) {
    const idx = tiers.indexOf(tier);
    // Run heartbeat, pulse, and daily on startup. Daily must run on boot because
    // Railway restarts can prevent the 24h interval from ever firing (Bug: 999h no backup).
    // Hourly (idx=2) and briefings (idx=4) can wait for their interval.
    //
    // v1.7 audit fix · daily-tier-on-every-boot was sending duplicate
    // outbound SMS (retention, cross-sell, warranty, declined-work,
    // churn) on every Railway restart. Now we persist a process-local
    // marker so the daily tier only fires on startup if the last run
    // is older than 20h. The setInterval still owns the canonical
    // 24h cadence; this guard only governs the boot-time fire.
    const runOnStartup = idx <= 1 || tier.name === "daily";
    const stagger = idx * 30_000;

    if (runOnStartup) {
      setTimeout(async () => {
        if (tier.name === "daily") {
          try {
            const { getDb } = await import("../db");
            const { sql } = await import("drizzle-orm");
            const d = await getDb();
            if (d) {
              // forensic-audit CRITICAL · the guard queried cron_log for
              // job_name='tier:daily', but logTierJob only ever writes
              // per-JOB names (e.g. 'retention-all') — no 'tier:daily' row
              // is ever written, so this always saw NULL and the daily tier
              // re-fired on EVERY Railway restart, re-sending retention /
              // cross-sell / declined-work SMS to real customers (up to 3x
              // on a multi-restart deploy day). Read the persisted tier
              // state that resetSkipCount() actually writes on every run.
              const [rows] = await d.execute(sql`SELECT last_run_at AS lastRun FROM cron_tier_skip_state WHERE tier_name = 'daily'`);
              const last = (rows as Array<{ lastRun: Date | null }>)[0]?.lastRun;
              if (last && Date.now() - new Date(last).getTime() < 20 * 3600_000) {
                log.info("daily tier: last run < 20h ago, skipping startup fire");
                return;
              }
            }
          } catch (e) {
            log.warn("daily tier boot guard query failed, proceeding", {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        runTier(tier).catch(err => log.error(`Tier ${tier.name} startup failed:`, { error: err instanceof Error ? err.message : String(err) }));
      }, stagger);
    }

    // Schedule recurring
    tier.handle = setInterval(() => {
      runTier(tier).catch(err => log.error(`Tier ${tier.name} failed:`, { error: err instanceof Error ? err.message : String(err) }));
    }, tier.intervalMs);
  }

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
  for (const tier of tiers) {
    if (tier.handle) clearInterval(tier.handle);
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
  { intervalMin: number; businessHoursOnly: boolean; oncePerShopDay: boolean; tier: string }
> {
  const out = new Map<
    string,
    { intervalMin: number; businessHoursOnly: boolean; oncePerShopDay: boolean; tier: string }
  >();
  for (const t of tiers) {
    for (const j of t.jobs) {
      out.set(j.name, {
        intervalMin: Math.round(t.intervalMs / 60000),
        businessHoursOnly: j.businessHoursOnly === true,
        oncePerShopDay: j.oncePerShopDay === true,
        tier: t.name,
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
export async function runTierJobByName(jobName: string): Promise<{ status: string; recordsProcessed?: number; details?: string }> {
  for (const tier of tiers) {
    const job = tier.jobs.find(j => j.name === jobName);
    if (job) {
      // wave-fix-2026-05-25 (audit #87) · same cross-dyno lock as the
      // auto-tier loop. Manual admin-triggered runs go through this
      // path and can race against the scheduler-fired run of the same
      // job. Without the lock the operator pressing "Run Now" while the
      // tier was mid-firing the same job → double-fire.
      const lockResult = await acquireCronLock(job.name);
      if (lockResult.status === "held-by-other") {
        return { status: "skipped", details: "manual run skipped — cross-dyno lock held by another process" };
      }
      try {
        const result = await job.handler();
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
