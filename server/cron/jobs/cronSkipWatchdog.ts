/**
 * Cron Skip Watchdog — wave-181.28
 *
 * Purpose:
 *   Env-gated cron jobs (review-monitor, gsc-pipeline, gateway-tire-*)
 *   skip silently when their required env var isn't set in Railway.
 *   Before this watchdog landed, an accidentally-deleted API key meant
 *   the admin dashboard would show stale review/GSC/tire data for weeks
 *   with no alert — operator's "info doesn't match" perception had no
 *   upstream signal.
 *
 *   This job runs DAILY (lightweight DB scan) and fires a single
 *   Telegram alert if ANY tracked job has been skipping for 7+
 *   consecutive days due to a missing env var.
 *
 * Implementation:
 *   - Read `cron_log` table for the last 7 days
 *   - For each unique job_name that ONLY has status='skipped' entries
 *     (i.e. never completed successfully in the window), check if the
 *     details column contains "requiresEnv:" — confirming this is an
 *     env-skip, not a business-hours-skip or admin-inactive-skip
 *   - Emit one consolidated Telegram alert listing all affected jobs
 *   - Dedupe via in-memory state — alert fires once per day max, not
 *     once per skipped job
 *
 * Tradeoff:
 *   - 7-day threshold means a 6-day-old broken key won't alert until
 *     day 7. Tolerable — by then admin data drift is already visible.
 *   - Daily cadence vs hourly. Daily is enough because env-keys don't
 *     break silently within 24h (it'd be a deliberate config change).
 */

import { createLogger } from "../../lib/logger";
import { sendTelegramMessage } from "../../services/telegram";
import { db } from "../../lib/db-helper";
import { sql } from "drizzle-orm";

const log = createLogger("cron:skip-watchdog");

// In-memory dedupe: only alert once per process per affected-job-set.
// Reset on process restart (acceptable — Railway restarts re-evaluate).
let lastAlertedJobs: string[] = [];

interface SkippedJobSummary {
  name: string;
  envVar: string;
  skipCount: number;
  daysSinceLastSuccess: number;
}

export async function processCronSkipWatchdog(): Promise<{
  recordsProcessed: number;
  details?: string;
}> {
  try {
    const d = await db();
    if (!d) {
      return { recordsProcessed: 0, details: "DB unavailable" };
    }

    // Pull the last 7 days of cron_log entries. For each job_name, count
    // skipped + completed runs and find the last completion timestamp.
    // Filter to jobs where skipped > 0 AND completed === 0 AND the skip
    // reason contains "requiresEnv:".
    type LogRow = {
      jobName: string | null;
      status: string | null;
      details: string | null;
      runAt: Date | string | null;
    };

    const result = await d.execute(sql`
      SELECT job_name as jobName, status, details, run_at as runAt
      FROM cron_log
      WHERE run_at >= NOW() - INTERVAL 7 DAY
      ORDER BY job_name, run_at DESC
    `);

    // Drizzle's mysql driver returns [rows, fields] from execute() — unwrap.
    // Cast through unknown to satisfy strictness on the dynamic-SQL return.
    const rows = result as unknown as [LogRow[]] | LogRow[];
    const logs: LogRow[] = Array.isArray(rows[0]) ? (rows[0] as LogRow[]) : (rows as LogRow[]);

    // Group by job_name
    const byJob = new Map<string, { skips: LogRow[]; completes: LogRow[] }>();
    for (const r of logs) {
      if (!r.jobName) continue;
      if (!byJob.has(r.jobName)) byJob.set(r.jobName, { skips: [], completes: [] });
      const entry = byJob.get(r.jobName)!;
      if (r.status === "skipped") entry.skips.push(r);
      else if (r.status === "completed") entry.completes.push(r);
    }

    // Find jobs that are exclusively env-skipping for 7+ days
    const affected: SkippedJobSummary[] = [];
    for (const [jobName, { skips, completes }] of byJob) {
      if (skips.length === 0) continue;
      if (completes.length > 0) continue; // had at least one successful run — not silently stuck

      // Verify the skip reason is env-related (not business-hours or admin-inactive)
      const envSkip = skips.find((s) => (s.details || "").includes("requiresEnv:"));
      if (!envSkip) continue;

      // Extract the env var name from the details column
      const envMatch = (envSkip.details || "").match(/requiresEnv:([A-Z0-9_]+)/);
      const envVar = envMatch ? envMatch[1] : "(unknown)";

      affected.push({
        name: jobName,
        envVar,
        skipCount: skips.length,
        daysSinceLastSuccess: 7, // by construction (we scanned 7d window)
      });
    }

    if (affected.length === 0) {
      return { recordsProcessed: 0, details: "no env-skip jobs in 7d window" };
    }

    // Dedupe: alert only if the set of affected jobs changed since the
    // last alert (avoids daily spam when a key is permanently broken).
    const affectedNames = affected.map((a) => a.name).sort();
    const lastNames = [...lastAlertedJobs].sort();
    if (
      affectedNames.length === lastNames.length &&
      affectedNames.every((n, i) => n === lastNames[i])
    ) {
      return {
        recordsProcessed: affected.length,
        details: `${affected.length} env-skipping jobs (already alerted)`,
      };
    }

    // Compose the alert
    const lines = [
      "*Cron Skip Watchdog — env-gated jobs silent for 7+ days*",
      "",
      ...affected.map(
        (a) =>
          `· \`${a.name}\` — missing env \`${a.envVar}\` (skipped ${a.skipCount}x in 7d, 0 successful runs)`,
      ),
      "",
      "Action: check Railway env vars. If a key was deleted intentionally, mark these jobs as `enabled: false` in scheduler.ts to silence this alert.",
    ];

    await sendTelegramMessage(lines.join("\n"), "system");

    lastAlertedJobs = affectedNames;

    log.info(
      `[skip-watchdog] alerted on ${affected.length} env-skipping jobs: ${affectedNames.join(", ")}`,
    );

    return {
      recordsProcessed: affected.length,
      details: `alerted on ${affected.map((a) => a.name).join(", ")}`,
    };
  } catch (err) {
    log.error("Cron skip watchdog failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { recordsProcessed: 0, details: `error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
