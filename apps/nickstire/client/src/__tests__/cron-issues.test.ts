import { describe, it, expect } from "vitest";
import { deriveCronIssues, type CronHealthRow } from "../pages/admin/settings/cron-issues";

/**
 * Locks the fix for the false "All clear / 0 open issues" banner: the Settings
 * counter must surface the cron signals it already fetches (the perpetual
 * 2388-missing-phone finding + any failing cron), not sit green over them.
 */
describe("deriveCronIssues", () => {
  it("surfaces the data-accuracy finding (the 2388) as a warning carrying the detail text", () => {
    const rows: CronHealthRow[] = [
      { jobName: "data-accuracy-check", status: "completed", recordsProcessed: 1, details: "2388 invoices missing customer phone" },
    ];
    const issues = deriveCronIssues(rows);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].detail).toContain("2388 invoices missing customer phone");
  });

  it("surfaces cron-failure-observer's failing count as an alert", () => {
    const rows: CronHealthRow[] = [
      { jobName: "cron-failure-observer", status: "completed", details: "scanned: 1 failing jobs; alerts sent: 0; suppressed (recent): 1" },
    ];
    const issues = deriveCronIssues(rows);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("alert");
    expect(issues[0].title).toMatch(/1 cron job failing/);
  });

  it("surfaces any failed cron run as an alert", () => {
    const issues = deriveCronIssues([{ jobName: "statenour-live-sync", status: "failed", details: "ECONNRESET" }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("alert");
  });

  it("returns no issues when everything is clean", () => {
    const rows: CronHealthRow[] = [
      { jobName: "data-accuracy-check", status: "completed", recordsProcessed: 0, details: "All data clean" },
      { jobName: "cron-failure-observer", status: "completed", details: "scanned: 0 failing jobs; alerts sent: 0; suppressed (recent): 0" },
      { jobName: "self-healing", status: "completed", details: "All healthy" },
    ];
    expect(deriveCronIssues(rows)).toEqual([]);
  });

  it("dedupes to the latest run per job (newest-first), so a recovered job stops firing", () => {
    // Newest row first (success) → the older failed row for the same job is ignored.
    const rows: CronHealthRow[] = [
      { jobName: "data-accuracy-check", status: "completed", recordsProcessed: 0, details: "All data clean" },
      { jobName: "data-accuracy-check", status: "failed", recordsProcessed: 1, details: "2388 invoices missing customer phone" },
    ];
    expect(deriveCronIssues(rows)).toEqual([]);
  });

  it("with a real defect + a failing observer present, produces >=1 alert (so the green banner cannot render)", () => {
    const rows: CronHealthRow[] = [
      { jobName: "data-accuracy-check", status: "completed", recordsProcessed: 1, details: "2388 invoices missing customer phone" },
      { jobName: "cron-failure-observer", status: "completed", details: "scanned: 1 failing jobs" },
    ];
    const issues = deriveCronIssues(rows);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.some((i) => i.severity === "alert")).toBe(true);
  });
});
