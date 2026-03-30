/**
 * Cron Job Runner — Registers and executes scheduled tasks
 * Uses setInterval (no external cron dependency needed).
 * Each job logs execution to cronLog table.
 */

import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";

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
  registerAllJobs();
  for (const [name, job] of registeredJobs) {
    if (!job.enabled) continue;

    // Run immediately on startup
    runJob(job).catch((err) => log.error(`Cron startup run failed: ${name}`, { error: err.message }));

    // Schedule recurring
    job.intervalId = setInterval(() => {
      runJob(job).catch((err) => log.error(`Cron run failed: ${name}`, { error: err.message }));
    }, job.intervalMs);

    log.info(`Cron job started: ${name}`);
  }
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

/** Run a single job with logging (skip if already running to prevent overlap) */
async function runJob(job: CronJob): Promise<void> {
  if (job.running) {
    // Safety: if a job has been "running" for over MAX_JOB_DURATION_MS, force-reset it
    const stuckMs = job.lastRun ? Date.now() - job.lastRun.getTime() : 0;
    if (stuckMs > MAX_JOB_DURATION_MS * 2) {
      log.warn(`Cron force-reset (stuck ${Math.round(stuckMs / 1000)}s): ${job.name}`);
      job.running = false;
    } else {
      log.info(`Cron skipped (still running): ${job.name}`);
      return;
    }
  }
  job.running = true;
  const startedAt = new Date();

  // Timeout race — prevent hung handlers from blocking forever
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Job timed out after ${MAX_JOB_DURATION_MS / 1000}s`)), MAX_JOB_DURATION_MS)
  );

  try {
    const result = await Promise.race([job.handler(), timeoutPromise]);
    const durationMs = Date.now() - startedAt.getTime();
    job.lastRun = new Date();

    logCronRun(job.name, "completed", durationMs, result.recordsProcessed, result.details).catch(() => {});

    if (result.recordsProcessed && result.recordsProcessed > 0) {
      log.info(`Cron completed: ${job.name}`, { duration: durationMs, records: result.recordsProcessed });
    }
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    const error = err instanceof Error ? err.message : String(err);
    logCronRun(job.name, "failed", durationMs, 0, error).catch(() => {});
    log.error(`Cron failed: ${job.name}`, { duration: durationMs, error });
  } finally {
    job.running = false;
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
      startedAt: new Date(Date.now() - durationMs),
      completedAt: new Date(),
    });
  } catch {
    // Silent — don't let log failures crash cron
  }
}

/** Get status of all registered jobs */
export function getJobStatuses(): Array<{ name: string; enabled: boolean; intervalMin: number; lastRun: string | null }> {
  return Array.from(registeredJobs.values()).map(j => ({
    name: j.name,
    enabled: j.enabled,
    intervalMin: Math.round(j.intervalMs / 60000),
    lastRun: j.lastRun?.toISOString() || null,
  }));
}

/** Run a single job by name (used by Railway cron worker HTTP trigger) */
export async function runJobByName(jobName: string): Promise<{ status: string; recordsProcessed?: number; details?: string }> {
  registerAllJobs();
  const job = registeredJobs.get(jobName);
  if (!job) {
    return { status: "not_found", details: `Job "${jobName}" not found. Available: ${[...registeredJobs.keys()].join(", ")}` };
  }
  const startedAt = Date.now();
  try {
    const result = await job.handler();
    const durationMs = Date.now() - startedAt;
    logCronRun(job.name, "completed", durationMs, result.recordsProcessed, result.details).catch(() => {});
    return { status: "completed", recordsProcessed: result.recordsProcessed, details: result.details };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    logCronRun(job.name, "failed", durationMs, 0, error).catch(() => {});
    return { status: "failed", details: error };
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

  // Retention sequences (every 24 hours)
  registerJob("retention-90day", 24 * 60 * 60 * 1000, async () => {
    const { processRetention90Day } = await import("./jobs/retentionSequences");
    return processRetention90Day();
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

  // Telegram daily digest (every 12 hours — sends at 6:30 AM ET)
  registerJob("telegram-digest", 12 * 60 * 60 * 1000, async () => {
    const { sendDailySummary } = await import("../services/telegram");
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };
    const { bookings, leads } = await import("../../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [bookingCount] = await db.select({ count: sql<number>`count(*)` }).from(bookings).where(sql`${bookings.createdAt} >= ${today}`);
    const [leadCount] = await db.select({ count: sql<number>`count(*)` }).from(leads).where(sql`${leads.createdAt} >= ${today}`);
    await sendDailySummary({
      leads: Number(leadCount?.count || 0),
      bookings: Number(bookingCount?.count || 0),
      revenue: 0,
      reviews: 0,
    });
    return { recordsProcessed: 1, details: "Digest sent" };
  });

  // Declined work recovery (every 24 hours)
  registerJob("declined-work-recovery", 24 * 60 * 60 * 1000, async () => {
    const { getDeclinedWorkLedger } = await import("../services/declinedWorkRecovery");
    const ledger = await getDeclinedWorkLedger(20);
    return { recordsProcessed: ledger.length, details: `${ledger.length} declined items checked` };
  });

  // Competitor monitor (every 24 hours — runs weekly check internally)
  registerJob("competitor-monitor", 24 * 60 * 60 * 1000, async () => {
    const { fetchCompetitorSnapshot } = await import("../services/competitorMonitor");
    const data = await fetchCompetitorSnapshot();
    return { recordsProcessed: data.length, details: `${data.length} competitors checked` };
  }, false); // Disabled until GOOGLE_PLACES_API_KEY is set

  // Staff performance rollup (every 24 hours)
  registerJob("staff-performance", 24 * 60 * 60 * 1000, async () => {
    const { getTeamPerformance } = await import("../services/staffPerformance");
    const perf = await getTeamPerformance();
    return { recordsProcessed: perf.techs?.length || 0, details: "Performance rollup complete" };
  });

  log.info("All cron jobs registered");
}
