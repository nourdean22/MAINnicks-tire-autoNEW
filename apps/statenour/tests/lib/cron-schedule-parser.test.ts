import { describe, it, expect } from "vitest";

/**
 * Unit test for the cron schedule interval parser used by the
 * watcher cron. Internal helper — we duplicate the logic here
 * rather than export it from the route to avoid leaking route
 * internals just for tests. Keep this in sync if the route
 * estimator changes.
 */
function estimateIntervalHours(schedule: string): number | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    if (minute.startsWith("*/")) {
      const n = parseInt(minute.slice(2), 10);
      return n > 0 ? n / 60 : null;
    }
    return 1;
  }
  if (minute.startsWith("*/")) {
    const n = parseInt(minute.slice(2), 10);
    return n > 0 ? n / 60 : null;
  }
  // Every N hours: "0 */N * * *"
  if (hour.startsWith("*/")) {
    const n = parseInt(hour.slice(2), 10);
    return n > 0 ? n : null;
  }
  if (hour.includes(",")) {
    const n = hour.split(",").length;
    if (n > 0) return 24 / n;
  }
  if (dayOfMonth === "*" && dayOfWeek === "*") return 24;
  if (dayOfWeek && dayOfWeek !== "*") {
    if (dayOfWeek.includes(",")) {
      return 168 / dayOfWeek.split(",").length;
    }
    return 168;
  }
  return 24;
}

describe("cron schedule parser", () => {
  it("parses */15 * * * * as 15min", () => {
    expect(estimateIntervalHours("*/15 * * * *")).toBeCloseTo(0.25);
  });

  it("parses 0 * * * * as hourly", () => {
    expect(estimateIntervalHours("0 * * * *")).toBe(1);
  });

  it("parses 0 9 * * * as 24h", () => {
    expect(estimateIntervalHours("0 9 * * *")).toBe(24);
  });

  it("parses multi-hour (3 fires/day)", () => {
    expect(estimateIntervalHours("0 12,16,21 * * *")).toBeCloseTo(8);
  });

  it("parses 0 */3 * * * as 3h (fixed Apr 18)", () => {
    // Previously fell through to daily (24h); watcher's 2× SLA grace
    // masked the bug but real 3h cron went undetected when it stalled
    // for 6–24h. Now returns the actual cadence.
    expect(estimateIntervalHours("0 */3 * * *")).toBe(3);
  });

  it("parses 0 */6 * * * as 6h", () => {
    expect(estimateIntervalHours("0 */6 * * *")).toBe(6);
  });

  it("parses weekly on Sunday", () => {
    expect(estimateIntervalHours("0 2 * * 0")).toBe(168);
  });

  it("returns null for malformed input", () => {
    expect(estimateIntervalHours("bogus")).toBeNull();
    expect(estimateIntervalHours("0 0")).toBeNull();
  });
});
