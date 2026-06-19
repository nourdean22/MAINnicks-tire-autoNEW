import type { OpenIssue } from "./useSettingsStatus";

/**
 * A single row from `nickActions.cronHealth` (a cron_log entry).
 * Kept permissive so the pure helper can be unit-tested without the tRPC types.
 */
export interface CronHealthRow {
  jobName: string;
  status?: string | null;
  recordsProcessed?: number | null;
  details?: string | null;
  startedAt?: string | Date | null;
}

/**
 * Derive Settings "Open issues" from the cron-health log.
 *
 * Why this exists: the Settings OPEN-ISSUES counter / all-clear banner used to
 * be built without ever reading cronHealth, so a perpetually-failing data check
 * ("2388 invoices missing customer phone") and a failing cron could sit under a
 * green "All clear" banner. This subscribes the counter to the real signals the
 * page already fetches.
 *
 * Rows arrive newest-first (the query orders by startedAt desc); we keep only
 * the LATEST run per jobName so a job that already recovered stops firing.
 */
export function deriveCronIssues(rows: readonly CronHealthRow[]): OpenIssue[] {
  const issues: OpenIssue[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || !row.jobName || seen.has(row.jobName)) continue;
    seen.add(row.jobName);

    const details = row.details?.trim() || "";

    // A) Any cron whose latest run failed → alert.
    if (row.status === "failed") {
      issues.push({
        key: `cron-failed-${row.jobName}`,
        severity: "alert",
        title: `Cron failing · ${row.jobName}`,
        detail: details || "Latest run failed. See the Cron Health panel below for the error.",
        whyText:
          "A scheduled job is failing on its most recent run. Failing crons silently stop the automation they drive (sync, alerts, posting) until fixed.",
      });
      continue;
    }

    // B) data-accuracy-check found data defects → warning (carries the count).
    if (row.jobName === "data-accuracy-check") {
      if (details && details !== "All data clean" && (row.recordsProcessed ?? 0) > 0) {
        issues.push({
          key: "data-accuracy",
          severity: "warning",
          title: "Data accuracy issues detected",
          detail: details,
          whyText:
            "The data-accuracy cron found records that break downstream automation (e.g. invoices with no customer phone can never be texted). It only reports — remediation is manual until a backfill runs.",
        });
      }
      continue;
    }

    // C) cron-failure-observer counted >= 1 failing job → alert.
    if (row.jobName === "cron-failure-observer") {
      const match = details.match(/scanned:\s*(\d+)\s*failing/i);
      const failing = match ? Number(match[1]) : 0;
      if (failing > 0) {
        issues.push({
          key: "cron-failures",
          severity: "alert",
          title: `${failing} cron job${failing === 1 ? "" : "s"} failing`,
          detail: details || `${failing} scheduled job(s) failing.`,
          whyText:
            "The cron-failure observer scans every job and counts failures. A non-zero count means at least one automation is broken even if its own row isn't currently in view.",
        });
      }
      continue;
    }
  }

  return issues;
}
