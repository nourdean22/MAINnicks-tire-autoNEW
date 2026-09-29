import { describe, expect, it } from "vitest";
import {
  formatDatabaseDependencyAlert,
  formatFailureAlertGroup,
  formatResolvedAlertGroup,
  formatShapeAlertGroup,
  hasDatabaseRootIncident,
  isCronAlertQuietHours,
  isDatabaseDependencyError,
  resolvedIncidentKeys,
} from "./alertPolicy";

const TZ = "America/New_York";

describe("Q-28 Alertmanager-style cron policy", () => {
  it("defers downstream noise during 22:00–07:00 ET, including across DST-capable Intl", () => {
    // Sep 29 2026: EDT (UTC-4).
    expect(isCronAlertQuietHours(Date.parse("2026-09-30T02:30:00Z"), TZ)).toBe(true); // 22:30 ET
    expect(isCronAlertQuietHours(Date.parse("2026-09-30T10:59:00Z"), TZ)).toBe(true); // 06:59 ET
    expect(isCronAlertQuietHours(Date.parse("2026-09-30T11:00:00Z"), TZ)).toBe(false); // 07:00 ET
    expect(isCronAlertQuietHours(Date.parse("2026-09-30T17:00:00Z"), TZ)).toBe(false); // 13:00 ET
  });

  it("supports a same-day quiet window without guessing wraparound", () => {
    const noon = Date.parse("2026-09-29T16:00:00Z");
    expect(isCronAlertQuietHours(noon, TZ, 12, 14)).toBe(true);
    expect(isCronAlertQuietHours(noon, TZ, 14, 12)).toBe(false);
  });

  it("rejects invalid quiet-hour config", () => {
    expect(() => isCronAlertQuietHours(Date.now(), TZ, -1, 7)).toThrow();
    expect(() => isCronAlertQuietHours(Date.now(), TZ, 22, 24)).toThrow();
  });

  it("groups multiple failing jobs into one bounded Telegram body", () => {
    const text = formatFailureAlertGroup(
      [
        {
          jobName: "reviews",
          consecutiveFailures: 3,
          latestError: "provider timeout",
          latestFailureAt: new Date("2026-09-29T12:00:00Z"),
        },
        {
          jobName: "gsc",
          consecutiveFailures: 2,
          latestError: "quota",
          latestFailureAt: new Date("2026-09-29T12:05:00Z"),
        },
      ],
      168,
    );
    expect(text).toContain("2 job(s)");
    expect(text).toContain("reviews");
    expect(text).toContain("gsc");
    expect(text.match(/🚨 Cron failures/g)).toHaveLength(1);
  });

  it("groups loop-shape findings instead of paging once per loop", () => {
    const text = formatShapeAlertGroup([
      { loop: "cross_sell", verdict: "dormant", summary: "no output", firstCheck: "check flag", ros: "ROS-033" },
      { loop: "gsc", verdict: "missing", summary: "no run", firstCheck: "check scheduler" },
    ]);
    expect(text).toContain("2 finding(s)");
    expect(text).toContain("cross_sell");
    expect(text).toContain("gsc");
  });

  it("emits an explicit grouped resolved notice", () => {
    const text = formatResolvedAlertGroup(["failure:reviews", "shape:gsc:missing"]);
    expect(text).toContain("resolved · 2");
    expect(text).toContain("failure:reviews");
  });

  it("names a DB dependency as the inhibiting root cause without overstating availability", () => {
    const inferred = formatDatabaseDependencyAlert(new Error("ECONNREFUSED"));
    expect(inferred).toContain("database dependency incident");
    expect(inferred).toContain("Downstream job/shape pages are inhibited");
    expect(inferred).toContain("ECONNREFUSED");

    const readFailure = formatDatabaseDependencyAlert(new Error("ECONNREFUSED"), true);
    expect(readFailure).toContain("database unavailable");
    expect(readFailure).toContain("Observer error");
  });

  it("requires at least two distinct DB-shaped job failures before inhibiting downstream pages", () => {
    const one = [
      { jobName: "reviews", latestError: "ECONNREFUSED 10.0.0.1", consecutiveFailures: 2, latestFailureAt: new Date() },
    ];
    const two = [
      ...one,
      { jobName: "gsc", latestError: "mysql connection timed out", consecutiveFailures: 2, latestFailureAt: new Date() },
    ];
    expect(hasDatabaseRootIncident(one)).toBe(false);
    expect(hasDatabaseRootIncident(two)).toBe(true);
    expect(isDatabaseDependencyError(new Error("database unavailable"))).toBe(true);
    expect(isDatabaseDependencyError("validation failed")).toBe(false);
  });

  it("reports only incidents that were alerted before and are no longer active as resolved", () => {
    expect(
      resolvedIncidentKeys(
        ["failure:reviews", "shape:gsc:missing", "root:database"],
        ["failure:reviews", "root:database"],
      ),
    ).toEqual(["shape:gsc:missing"]);
  });

});
