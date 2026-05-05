/**
 * Cron Failure Observer
 *
 * The IMPROVEMENTS_2026-05-05.md audit flagged: "17 unattended cron jobs.
 * Silent failure → lost reviews/leads/follow-ups. No alerting."
 *
 * The infrastructure already exists for the hard part — every cron run
 * is recorded in `cron_log` with status='completed'|'failed'|... — so
 * this module just adds the alerting layer that was missing:
 *
 *   1. Read last few runs per job from cron_log.
 *   2. If a job's last 2+ consecutive runs failed, alert the owner via
 *      Telegram (channel='critical' = bypasses batching).
 *   3. Suppress duplicate alerts for 6 hours per job (in-memory state)
 *      so a persistent failure doesn't spam the channel.
 *
 * Wire-in: add to the tiered scheduler so it runs every 15 minutes.
 * Cost per run: one SQL query (a few hundred rows scanned, indexed by
 * job_name + completed_at).
 */

import { desc, gte } from "drizzle-orm";
import { cronLog } from "../../drizzle/schema";
import { getDb } from "../db";
import { sendTelegramMessage } from "../services/telegram";
import { createLogger } from "../lib/logger";

const log = createLogger("cron:observer");

/** In-memory dedupe: jobName → ms timestamp of last alert. Cleared on restart. */
const lastAlertAt: Map<string, number> = new Map();
const ALERT_SUPPRESS_MS = 6 * 60 * 60 * 1000; // 6 hours
const CONSECUTIVE_FAILURE_THRESHOLD = 2;
const LOOKBACK_HOURS = 24;

interface JobFailureSnapshot {
  jobName: string;
  consecutiveFailures: number;
  latestError: string | null;
  latestFailureAt: Date;
}

/**
 * Fetch the last N runs per distinct job_name (where N is small enough
 * to detect a 2-failure streak). Returns jobs whose tail is all failures.
 *
 * We pull a window of runs from the last LOOKBACK_HOURS and bucket by
 * job_name in JS rather than building a CTE — the row count is tiny
 * (17 jobs × handful of runs/hr × 24h ≈ low thousands at most).
 */
async function fetchFailingJobs(): Promise<JobFailureSnapshot[]> {
  const db = await getDb();
  if (!db) return [];

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  // Pull the recent window ordered newest-first, group by job in memory.
  const rows = await db
    .select({
      jobName: cronLog.jobName,
      status: cronLog.status,
      errorMessage: cronLog.errorMessage,
      completedAt: cronLog.completedAt,
    })
    .from(cronLog)
    .where(gte(cronLog.completedAt, since))
    .orderBy(desc(cronLog.completedAt))
    .limit(2000);

  const byJob = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byJob.has(r.jobName)) byJob.set(r.jobName, []);
    byJob.get(r.jobName)!.push(r);
  }

  const failing: JobFailureSnapshot[] = [];
  for (const [jobName, runs] of byJob) {
    // runs are newest-first. Count consecutive failures from the head.
    let streak = 0;
    let latestError: string | null = null;
    let latestFailureAt = new Date(0);
    for (const r of runs) {
      if (r.status === "failed") {
        streak++;
        if (streak === 1) {
          latestError = r.errorMessage;
          latestFailureAt = r.completedAt ?? new Date();
        }
      } else {
        break;
      }
    }
    if (streak >= CONSECUTIVE_FAILURE_THRESHOLD) {
      failing.push({ jobName, consecutiveFailures: streak, latestError, latestFailureAt });
    }
  }
  return failing;
}

/**
 * Main entry. Call on a 15-minute schedule (e.g. via the tiered
 * scheduler). Idempotent — safe to call more often if needed.
 */
export async function runCronFailureObserver(): Promise<{ recordsProcessed: number; details: string }> {
  let alertsSent = 0;
  let alertsSkipped = 0;

  try {
    const failing = await fetchFailingJobs();
    const now = Date.now();

    for (const f of failing) {
      const lastAlert = lastAlertAt.get(f.jobName) ?? 0;
      if (now - lastAlert < ALERT_SUPPRESS_MS) {
        alertsSkipped++;
        continue;
      }

      const errorPreview = (f.latestError || "no error message logged").slice(0, 240);
      const text =
        `🚨 Cron failure: \`${f.jobName}\`\n` +
        `${f.consecutiveFailures} consecutive failures over the last ${LOOKBACK_HOURS}h\n` +
        `Latest error: ${errorPreview}\n` +
        `Last failure: ${f.latestFailureAt.toISOString()}`;

      const ok = await sendTelegramMessage(text, "critical");
      if (ok) {
        lastAlertAt.set(f.jobName, now);
        alertsSent++;
        log.warn(`[cron-observer] alert sent for ${f.jobName} (${f.consecutiveFailures} failures)`);
      } else {
        log.error(`[cron-observer] failed to send Telegram alert for ${f.jobName}`);
      }
    }

    return {
      recordsProcessed: alertsSent,
      details: `scanned: ${failing.length} failing jobs; alerts sent: ${alertsSent}; suppressed (recent): ${alertsSkipped}`,
    };
  } catch (err) {
    log.error("[cron-observer] run failed:", err instanceof Error ? err.message : err);
    return {
      recordsProcessed: 0,
      details: `error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
