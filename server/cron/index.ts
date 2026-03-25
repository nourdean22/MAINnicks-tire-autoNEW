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
