import { describe, expect, it } from "vitest";
import {
  formatDatabaseDependencyAlert,
  formatFailureAlertGroup,
  formatResolvedAlertGroup,
  formatShapeAlertGroup,
  isCronAlertQuietHours,
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

  it("names DB outage as the inhibiting root cause", () => {
    const text = formatDatabaseDependencyAlert(new Error("ECONNREFUSED"));
    expect(text).toContain("database unavailable");
    expect(text).toContain("Downstream job-failure pages are inhibited");
    expect(text).toContain("ECONNREFUSED");
  });
});
