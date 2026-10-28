import type { RouterOutputs } from "@/lib/trpc";
import { timeAgoShort } from "../shared/format";
import type { OpenIssue } from "./useSettingsStatus";

export type CronHealthSummary = RouterOutputs["nickActions"]["cronHealthSummary"];
export type CronJobSummary = CronHealthSummary["jobs"][number];

/** The Scheduled work panel on the Status tab; issues link here. */
const SCHEDULED_WORK_HREF = "/admin?tab=settings&settingsTab=status#scheduled-work";

/** The data-accuracy cron writes "<finding> · probes: <codes>"; only the finding is for the owner. */
const PROBES_SEPARATOR = " · probes: ";

const LOOP_WORDS: Record<string, string> = {
  "reminder-queue": "maintenance reminders",
  "followup-cadence": "follow-up cadence",
  "reel-pipeline": "reel pipeline",
  "reel-pipeline:publish": "reel publishing",
};

const LOOP_WHY: Record<string, string> = {
  "reminder-queue":
    "The reminder job holds a due reminder for a customer who got a retention or drip text or a reminder in the last 7 days, or has an open declined estimate from the last 30 days, and cancels it 30 days past due. Its last run below says how many it sent and how many it held.",
};

/** 23664 -> "16.4 days", 1440 -> "1 day", 120 -> "2 hours". */
function waitInWords(minutes: number): string {
  if (minutes < 1440) {
    const hours = Math.max(1, Math.round(minutes / 60));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const text = String(Math.round((minutes / 1440) * 10) / 10);
  return `${text} day${text === "1" ? "" : "s"}`;
}

/**
 * Settings "Open issues" from the per-job cron summary (one row per job over 24 h) and the cron-failure observer.
 * Skipped runs are expected (admin inactive, quiet hours) and are not issues; the panel lists them.
 */
export function deriveCronIssues(summary: CronHealthSummary | undefined): OpenIssue[] {
  if (!summary) return [];
  const issues: OpenIssue[] = [];

  for (const job of summary.jobs) {
    // A) latest run failed -> alert
    if (job.lastStatus === "failed") {
      const cause = job.lastErrorMessage?.trim() || job.lastDetails?.trim() || "No error text was logged.";
      issues.push({
        key: `cron-failed-${job.jobName}`,
        severity: "alert",
        title: `Scheduled job failed · ${job.jobName}`,
        detail: `${job.jobName} failed ${job.lastStartedAt ? timeAgoShort(job.lastStartedAt) : "at a time the log did not record"}; ${job.failed} of ${job.runs} runs in 24 h failed. ${cause}`,
        whyText: "A failing job stops the automation it drives (sync, alerts, posting) until it is fixed.",
        actionHref: SCHEDULED_WORK_HREF,
        actionLabel: "See scheduled work",
      });
      continue;
    }

    // B) data-accuracy finding -> warning, in words; the probe codes go in the why text
    if (job.jobName === "data-accuracy-check") {
      const details = job.lastDetails?.trim() ?? "";
      const cut = details.indexOf(PROBES_SEPARATOR);
      const finding = cut >= 0 ? details.slice(0, cut) : details;
      const probes = cut >= 0 ? details.slice(cut + PROBES_SEPARATOR.length) : "";
      // "No finding in the checks that ran" = nothing found, with a probe that could not measure named after it
      // (server/cron/dataAccuracyDetails.ts); the Scheduled work panel shows that line, it is not a finding.
      if (finding && !/^(All (checks|data) clean|No finding in the checks that ran)/.test(finding)) {
        issues.push({
          key: "data-accuracy",
          severity: "warning",
          title: "Data accuracy finding",
          detail: finding,
          whyText: `The data-accuracy check only reports; nothing is fixed automatically.${probes ? ` Checks run this pass: ${probes}` : ""}`,
        });
      }
    }
  }

  const obs = summary.observer;
  if (obs) {
    // C) observer counted failing jobs -> alert (null = the count was not in its text: say nothing)
    if (obs.failing !== null && obs.failing > 0) {
      issues.push({
        key: "cron-failures",
        severity: "alert",
        title: `${obs.failing} scheduled job${obs.failing === 1 ? "" : "s"} failing`,
        detail: `The cron-failure observer counted ${obs.failing} failing job${obs.failing === 1 ? "" : "s"} on its latest run${obs.at ? ` ${timeAgoShort(obs.at)}` : " (time unknown)"}.`,
        whyText: "The observer scans every job, so a failure counts here even when that job's own row is not in view.",
        actionHref: SCHEDULED_WORK_HREF,
        actionLabel: "See scheduled work",
      });
    }

    // D) a queue whose oldest due item is older than its loop's limit
    for (const q of obs.queuesStuck) {
      const lastRun = summary.jobs.find((j) => j.jobName === q.loop)?.lastDetails?.trim();
      issues.push({
        key: `queue-stuck-${q.loop}`,
        severity: "warning",
        title: `Queue stuck · ${LOOP_WORDS[q.loop] ?? q.loop}`,
        detail: `The oldest due item has waited ${waitInWords(q.ageMinutes)} (limit ${waitInWords(q.maxAgeMinutes)}); the job may be running and sending nothing.`,
        note: lastRun ? `Last run: ${lastRun}` : undefined,
        whyText:
          LOOP_WHY[q.loop] ??
          "The cron-failure observer measures the age of the oldest due item in this loop's queue. Past the limit, the loop is not draining it.",
        actionHref: SCHEDULED_WORK_HREF,
        actionLabel: "See scheduled work",
      });
    }

    // E) lanes declared but not running
    const off = obs.shapes.filter((s) => s.shape === "missing" || s.shape === "dormant");
    if (off.length > 0) {
      const list = off.map((s) => `${s.job} (${s.shape})`).join(", ");
      issues.push({
        key: "lane-shapes",
        severity: "warning",
        title: `Scheduled lanes not running as declared · ${off.length}`,
        detail: obs.shapesJudged !== null ? `${off.length} of ${obs.shapesJudged} judged lanes: ${list}` : list,
        whyText:
          "Missing means the lane never logged a run in the observer's window. Dormant means it is declared but did no work in that window.",
        actionHref: SCHEDULED_WORK_HREF,
        actionLabel: "See scheduled work",
      });
    }
  }

  return issues;
}
