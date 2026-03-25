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

/** Run a single job with logging */
async function runJob(job: CronJob): Promise<void> {
  const startedAt = new Date();
  try {
    const result = await job.handler();
    const durationMs = Date.now() - startedAt.getTime();
    job.lastRun = new Date();

    // Log to DB (fire-and-forget)
    logCronRun(job.name, "completed", durationMs, result.recordsProcessed, result.details).catch(() => {});

    if (result.recordsProcessed && result.recordsProcessed > 0) {
      log.info(`Cron completed: ${job.name}`, { duration: durationMs, records: result.recordsProcessed });
    }
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    const error = err instanceof Error ? err.message : String(err);
    logCronRun(job.name, "failed", durationMs, 0, error).catch(() => {});
    log.error(`Cron failed: ${job.name}`, { duration: durationMs, error });
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

/** Register all cron jobs — called from startAllJobs or server startup */
export function registerAllJobs(): void {
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
  }, false); // Disabled by default

  // Retention sequences (every 24 hours)
  registerJob("retention-90day", 24 * 60 * 60 * 1000, async () => {
    const { processRetention90Day } = await import("./jobs/retentionSequences");
    return processRetention90Day();
  }, false); // Disabled by default

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

  log.info("All cron jobs registered");
}
