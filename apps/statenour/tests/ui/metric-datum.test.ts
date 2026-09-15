/**
 * Metric grammar · 2026-09-15.
 *
 * The invariants that make a number readable and honest:
 *   · `unavailable` never renders a number (no fabricated zero)
 *   · `degraded` shows the stale value and SAYS it is stale
 *   · a delta exists only against a supplied baseline — no baseline, no delta
 *   · the delta's tone follows the metric's valence, neutral when it has none
 */
import { describe, expect, it } from "vitest";
import type { MetricResult } from "@/lib/services/metric-result";
import { deltaVsBaseline, describeMetric, formatAge, formatNumber } from "@/lib/ui/metric-datum";

const NOW = new Date("2026-09-15T12:00:00Z");
const ok = (value: number, extra: Partial<Extract<MetricResult<number>, { status: "ok" }>> = {}): MetricResult<number> => ({
  status: "ok",
  value,
  measuredAt: "2026-09-15T09:00:00Z",
  source: "whoop",
  ...extra,
});

describe("describeMetric", () => {
  it("unavailable → 'unknown' with the error code, and NEVER a number", () => {
    const view = describeMetric({ status: "unavailable", source: "whoop", errorCode: "ETIMEDOUT" }, { label: "readiness" }, NOW);
    expect(view.status).toBe("unavailable");
    expect(view.primary).toBe("unknown");
    expect(view.delta).toBeNull();
    expect(view.reason).toContain("ETIMEDOUT");
    expect(view.primary).not.toMatch(/\d/);
  });

  it("degraded with a value → the stale number plus a stale reason", () => {
    const view = describeMetric(
      { status: "degraded", value: 72, measuredAt: "2026-09-14T12:00:00Z", source: "whoop", errorCode: "STALE", staleSince: "2026-09-14T12:00:00Z" },
      { label: "readiness" },
      NOW,
    );
    expect(view.status).toBe("stale");
    expect(view.primary).toBe("72");
    expect(view.reason).toMatch(/^stale/);
    expect(view.reason).toContain("STALE");
  });

  it("degraded WITHOUT a value is unknown, not a stale zero", () => {
    const view = describeMetric({ status: "degraded", source: "whoop", errorCode: "PARTIAL" }, { label: "readiness" }, NOW);
    expect(view.status).toBe("unavailable");
    expect(view.primary).toBe("unknown");
  });

  it("measured with a baseline → delta with percent and valence tone", () => {
    const view = describeMetric(ok(72, { sampleSize: 18 }), {
      label: "readiness",
      unit: "%",
      window: "30d",
      baseline: { value: 80, label: "30-day baseline" },
      range: { lo: 75, hi: 82 },
      higherIsBetter: true,
    }, NOW);
    expect(view.status).toBe("measured");
    expect(view.primary).toBe("72");
    expect(view.unit).toBe("%");
    expect(view.delta).toEqual({ text: "-8 (-10%) vs 30-day baseline", tone: "bad" });
    expect(view.outOfRange).toBe(true);
    expect(view.context).toEqual(["normal 75–82", "window 30d", "n=18", "measured 3h ago", "source: whoop"]);
  });

  it("no baseline → no delta (not a delta of zero)", () => {
    const view = describeMetric(ok(72), { label: "gap", unit: "d" }, NOW);
    expect(view.delta).toBeNull();
    expect(view.context).toEqual(["measured 3h ago", "source: whoop"]);
  });
});

describe("deltaVsBaseline", () => {
  it("tone: lower-is-better flips the valence; no valence stays neutral", () => {
    expect(deltaVsBaseline(29, { value: 10, label: "usual cadence 10d" }, false).tone).toBe("bad");
    expect(deltaVsBaseline(8, { value: 10, label: "usual cadence 10d" }, false).tone).toBe("good");
    expect(deltaVsBaseline(8, { value: 10, label: "b" }, null).tone).toBe("neutral");
    expect(deltaVsBaseline(10, { value: 10, label: "b" }, true)).toEqual({ text: "flat vs b", tone: "neutral" });
  });

  it("skips the percent when the baseline is zero or the percent is absurd", () => {
    expect(deltaVsBaseline(5, { value: 0, label: "b" }, true).text).toBe("+5 vs b");
    expect(deltaVsBaseline(5000, { value: 1, label: "b" }, true).text).toBe("+4,999 vs b");
  });
});

describe("formatAge / formatNumber", () => {
  it("tiers", () => {
    const t = (secondsAgo: number) => formatAge(new Date(NOW.getTime() - secondsAgo * 1000), NOW);
    expect(t(3)).toBe("just now");
    expect(t(45)).toBe("45s ago");
    expect(t(5 * 60)).toBe("5m ago");
    expect(t(3 * 3600)).toBe("3h ago");
    expect(t(2 * 86400)).toBe("2d ago");
    expect(t(21 * 86400)).toBe("3w ago");
  });

  it("formats integers with grouping and decimals to a sane precision", () => {
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(3.14159)).toBe("3.14");
    expect(formatNumber(12.345)).toBe("12.3");
    expect(formatNumber(Number.NaN)).toBe("unknown");
  });
});
