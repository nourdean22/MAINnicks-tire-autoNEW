/**
 * Cron Job Runner — Registers and executes scheduled tasks
 * Uses setInterval (no external cron dependency needed).
 * Each job logs execution to cronLog table.
 */

import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";

import { BUSINESS } from "@shared/business";
const log = createLogger("cron");

interface CronJob {
  name: string;
  intervalMs: number;
  handler: () => Promise<{ recordsProcessed?: number; details?: string }>;
  enabled: boolean;
  lastRun?: Date;
  running?: boolean;
  intervalId?: ReturnType<typeof setInterval>;
}

const registeredJobs = new Map<string, CronJob>();

/** Register a cron job */
export function registerJob(
  name: string,
  intervalMs: number,
  handler: () => Promise<{ recordsProcessed?: number; details?: string }>,
  enabled = true
): void {
  registeredJobs.set(name, { name, intervalMs, handler, enabled });
  log.info(`Cron job registered: ${name} (every ${Math.round(intervalMs / 60000)}min, ${enabled ? "enabled" : "disabled"})`);
}

/** Start all registered jobs */
export function startAllJobs(): void {
  throw new Error("startAllJobs() is decommissioned. Use startTieredScheduler() from cron/scheduler.ts instead.");
}

/** Stop all jobs */
export function stopAllJobs(): void {
  for (const [name, job] of registeredJobs) {
    if (job.intervalId) {
      clearInterval(job.intervalId);
      job.intervalId = undefined;
    }
  }
  log.info("All cron jobs stopped");
}

const MAX_JOB_DURATION_MS = 5 * 60 * 1000; // 5 min safety timeout
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
export async function acquireCronLock(jobName: string): Promise<LockResult> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { status: "fallback", reason: "db-null" };

  const newToken = randomUUID() as LockToken;
  const ttlSeconds = Math.ceil(LOCK_TTL_MS / 1000);

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
    return arr[0].lock_token === newToken
      ? { status: "acquired", jobName, token: newToken }
      : { status: "held-by-other" };
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
export async function releaseCronLock(lock: Extract<LockResult, { status: "acquired" }>): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;
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

/** Run a single job with logging (skip if already running to prevent overlap) */
async function runJob(job: CronJob): Promise<void> {
  // wave-168: two-tier lock. In-memory (fast path, prevents same-process
  // overlap) PLUS DB-level (slow path, prevents cross-dyno overlap +
  // self-heals after crash). If either layer says "someone else is on it"
  // we skip.
  if (job.running) {
    const stuckMs = job.lastRun ? Date.now() - job.lastRun.getTime() : 0;
    if (stuckMs > MAX_JOB_DURATION_MS * 2) {
      log.warn(`Cron force-reset (stuck ${Math.round(stuckMs / 1000)}s): ${job.name}`);
      job.running = false;
    } else {
      log.info(`Cron skipped (still running in-memory): ${job.name}`);
      return;
    }
  }

  // DB-level acquire. Three explicit outcomes:
  //   acquired      → safe to run on this dyno
  //   held-by-other → another dyno owns it, SKIP this tick (no double-fire)
  //   fallback      → cron_locks table unavailable or DB error; proceed
  //                   using only the in-memory lock so we don't stall cron
  //                   when the wave-168 migration hasn't been hand-applied
  //                   yet. The reason field discriminates "expected" from
  //                   "real bug" for observability.
  // We keep the full LockResult in scope (rather than collapsing to
  // string | null) so releaseCronLock can take the typed variant.
  const lockResult = await acquireCronLock(job.name);
  if (lockResult.status === "held-by-other") {
    log.info(`Cron skipped (held by another dyno): ${job.name}`);
    return;
  }

  job.running = true;
  const startedAt = new Date();

  // Timeout race — prevent hung handlers from blocking forever
  let jobTimeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    jobTimeout = setTimeout(() => reject(new Error(`Job timed out after ${MAX_JOB_DURATION_MS / 1000}s`)), MAX_JOB_DURATION_MS);
  });

  try {
    const result = await Promise.race([job.handler(), timeoutPromise]);
    const durationMs = Date.now() - startedAt.getTime();
    job.lastRun = new Date();

    logCronRun(job.name, "completed", durationMs, result.recordsProcessed, result.details).catch((e) => { log.warn("[cron/index] fire-and-forget failed:", e); });

    if (result.recordsProcessed && result.recordsProcessed > 0) {
      log.info(`Cron completed: ${job.name}`, { duration: durationMs, records: result.recordsProcessed });
    }
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    const error = err instanceof Error ? err.message : String(err);
    logCronRun(job.name, "failed", durationMs, 0, error).catch((e) => { log.warn("[cron/index] fire-and-forget failed:", e); });
    log.error(`Cron failed: ${job.name}`, { duration: durationMs, error });
  } finally {
    if (jobTimeout) clearTimeout(jobTimeout);
    job.running = false;
    // Only release if we actually acquired the DB lock. Fallback path
    // never wrote a row, so there's nothing to delete.
    if (lockResult.status === "acquired") {
      await releaseCronLock(lockResult);
    }
  }
}

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

/** Get status of all registered jobs */
export function getJobStatuses(): Array<{ name: string; enabled: boolean; intervalMin: number; lastRun: string | null }> {
  // Ensure jobs are registered (tiered scheduler may have started instead of startAllJobs)
  if (registeredJobs.size === 0) {
    registerAllJobs();
  }
  return Array.from(registeredJobs.values()).map(j => ({
    name: j.name,
    enabled: j.enabled,
    intervalMin: Math.round(j.intervalMs / 60000),
    lastRun: j.lastRun?.toISOString() || null,
  }));
}

/** Reset the running flag for a stuck job — used by self-healing */
export function resetJobRunningFlag(jobName: string): boolean {
  const job = registeredJobs.get(jobName);
  if (job && job.running) {
    job.running = false;
    return true;
  }
  return false;
}

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
  const lockResult = await acquireCronLock(job.name);
  if (lockResult.status === "held-by-other") {
    return { status: "skipped", details: "cross-dyno lock held by another process (Railway worker HTTP trigger)" };
  }

  const startedAt = Date.now();
  try {
    const result = await job.handler();
    const durationMs = Date.now() - startedAt;
    logCronRun(job.name, "completed", durationMs, result.recordsProcessed, result.details).catch((e) => { log.warn("[cron/index] fire-and-forget failed:", e); });
    return { status: "completed", recordsProcessed: result.recordsProcessed, details: result.details };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    logCronRun(job.name, "failed", durationMs, 0, error).catch((e) => { log.warn("[cron/index] fire-and-forget failed:", e); });
    return { status: "failed", details: error };
  } finally {
    if (lockResult.status === "acquired") {
      await releaseCronLock(lockResult);
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
  // trigger them manually + getJobStatuses() didn't report them. Now
  // wired alongside their D30/D90/D180/D365 siblings.
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
