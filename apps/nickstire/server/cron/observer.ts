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

import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { sendTelegramMessage } from "../services/telegram";
import { createLogger } from "../lib/logger";

const log = createLogger("cron:observer");

/** In-memory dedupe: jobName → ms timestamp of last alert. Cleared on restart. */
const lastAlertAt: Map<string, number> = new Map();
const ALERT_SUPPRESS_MS = 6 * 60 * 60 * 1000; // 6 hours
const CONSECUTIVE_FAILURE_THRESHOLD = 2;
/**
 * 7 days, not 24 hours.
 *
 * A once-per-day job contributes at most ONE row to a 24-hour window, so its
 * failure streak was capped at 1 and could never reach the threshold of 2. Daily
 * jobs that failed on every single run alerted zero times, forever — the only
 * failure alarm for the entire daily tier was structurally dead.
 */
const LOOKBACK_HOURS = 24 * 7;
/** Runs examined per job. Only needs to exceed the streak threshold. */
const RUNS_PER_JOB = 6;

interface JobFailureSnapshot {
  jobName: string;
  consecutiveFailures: number;
  latestError: string | null;
  latestFailureAt: Date;
}

/**
 * Fetch the last RUNS_PER_JOB runs for each distinct job_name and return the
 * jobs whose most recent runs are an unbroken failure streak.
 *
 * The per-job partition is load-bearing, not a tidiness choice — see the
 * comment on the query itself.
 */
async function fetchFailingJobs(): Promise<JobFailureSnapshot[]> {
  const db = await getDb();
  if (!db) return [];

  // Take the last RUNS_PER_JOB runs PER JOB, not the last N rows overall.
  //
  // The previous query was `ORDER BY completed_at DESC LIMIT 2000` across every
  // job at once. Production writes roughly 2,600 cron rows per day, so that
  // limit did not even span the 24-hour window it was filtering on: the
  // high-frequency jobs (every 2 minutes) consumed the entire budget and the
  // low-frequency jobs — exactly the ones a daily failure alarm exists for —
  // could fall off the end of the result set entirely and be invisible.
  //
  // Partitioning per job makes each job's history independent of how noisy its
  // neighbours are.
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const [raw] = await db.execute(sql`
    SELECT job_name AS jobName, status, error_message AS errorMessage, completed_at AS completedAt
    FROM (
      SELECT job_name, status, error_message, completed_at,
             ROW_NUMBER() OVER (PARTITION BY job_name ORDER BY completed_at DESC) AS rn
      FROM cron_log
      WHERE completed_at >= ${since}
    ) ranked
    WHERE rn <= ${RUNS_PER_JOB}
    ORDER BY job_name, completedAt DESC
  `);

  type Run = { jobName: string; status: string; errorMessage: string | null; completedAt: Date | null };
  const rows: Run[] = (raw as Array<Record<string, unknown>>).map((r) => ({
    jobName: String(r.jobName),
    status: String(r.status),
    errorMessage: r.errorMessage == null ? null : String(r.errorMessage),
    completedAt: r.completedAt ? new Date(r.completedAt as string) : null,
  }));

  const byJob = new Map<string, Run[]>();
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
