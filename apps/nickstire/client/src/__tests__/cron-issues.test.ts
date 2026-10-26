import { describe, it, expect } from "vitest";
import { deriveCronIssues, type CronHealthSummary } from "../pages/admin/settings/cron-issues";

/**
 * Locks the fix for the false "All clear / 0 open issues" banner: the Settings counter must surface the scheduled-work
 * signals it fetches (a data-accuracy finding, a failing job, the observer's failing count), not sit green over them.
 * 2026-10-26: reads nickActions.cronHealthSummary (one row per job) instead of the flat run log.
 */
type Job = CronHealthSummary["jobs"][number];
const job = (over: Partial<Job> & { jobName: string }): Job => ({
  lastStatus: "completed",
  lastStartedAt: new Date().toISOString(),
  lastDurationMs: 10,
  lastDetails: null,
  lastErrorMessage: null,
  lastSuccessAt: null,
  runs: 1,
  failed: 0,
  skipped: 0,
  ...over,
});
const summary = (jobs: Job[], observer: CronHealthSummary["observer"] = null): CronHealthSummary => ({
  since: new Date().toISOString(),
  to: new Date().toISOString(),
  jobs,
  observer,
});
const observer = (over: Partial<NonNullable<CronHealthSummary["observer"]>>): NonNullable<CronHealthSummary["observer"]> => ({
  at: new Date().toISOString(),
  failing: 0,
  shapesJudged: null,
  shapes: [],
  undeclaredLoops: null,
  queuesStuck: [],
  raw: "",
  ...over,
});

describe("deriveCronIssues", () => {
  it("surfaces the data-accuracy finding as a warning carrying the finding text", () => {
    const issues = deriveCronIssues(summary([job({ jobName: "data-accuracy-check", lastDetails: "2388 of 9000 invoices have no customer phone" })]));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].detail).toBe("2388 of 9000 invoices have no customer phone");
  });

  it("surfaces cron-failure-observer's failing count as an alert", () => {
    const issues = deriveCronIssues(summary([], observer({ failing: 1 })));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("alert");
    expect(issues[0].title).toMatch(/1 scheduled job failing/);
  });

  it("an observer string without a failing count says nothing, never 0 or an alert", () => {
    expect(deriveCronIssues(summary([], observer({ failing: null })))).toEqual([]);
  });

  it("surfaces a failed job as an alert with its error and its 24 h denominator", () => {
    const issues = deriveCronIssues(summary([job({ jobName: "statenour-live-sync", lastStatus: "failed", lastErrorMessage: "ECONNRESET", runs: 4, failed: 2 })]));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("alert");
    expect(issues[0].detail).toContain("2 of 4 runs in 24 h failed");
    expect(issues[0].detail).toContain("ECONNRESET");
  });

  it("returns no issues when everything is clean, including skipped-by-design jobs", () => {
    const issues = deriveCronIssues(
      summary(
        [
          job({ jobName: "data-accuracy-check", lastDetails: "All checks clean: 0 of 25 invoices without a phone · probes: x=1" }),
          job({ jobName: "alg-mirror-health", lastStatus: "skipped", lastDetails: "skipped: admin inactive", runs: 12, skipped: 12 }),
          job({ jobName: "self-healing", lastDetails: "All healthy" }),
        ],
        observer({ failing: 0 }),
      ),
    );
    expect(issues).toEqual([]);
  });

  it("a missing summary (still loading or failed) yields no issues; the failed-check banner covers the error", () => {
    expect(deriveCronIssues(undefined)).toEqual([]);
  });

  it("with a real defect + a failing observer present, produces >=1 alert (so the green banner cannot render)", () => {
    const issues = deriveCronIssues(
      summary([job({ jobName: "data-accuracy-check", lastDetails: "2388 of 9000 invoices have no customer phone" })], observer({ failing: 1 })),
    );
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.some((i) => i.severity === "alert")).toBe(true);
  });

  it("a stuck queue under a day reads in hours", () => {
    const issues = deriveCronIssues(summary([], observer({ queuesStuck: [{ loop: "followup-cadence", ageMinutes: 300, maxAgeMinutes: 120 }] })));
    expect(issues[0].title).toBe("Queue stuck · follow-up cadence");
    expect(issues[0].detail).toContain("waited 5 hours (limit 2 hours)");
  });
});
