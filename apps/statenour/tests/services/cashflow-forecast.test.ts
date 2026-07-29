/**
 * tests/services/cashflow-forecast.test.ts — Wave-7 (2026-07-29): the
 * pure projection + confidence math. Honesty contracts: empty basis
 * yields null projection; unknown freshness floors confidence; the
 * digest line always names itself revenue-side, never cash position.
 */

import { describe, it, expect } from "vitest";
import {
  projectRevenue,
  forecastConfidence,
  forecastDigestLine,
  type CashflowForecast,
} from "@/lib/services/cashflow-forecast";

describe("projectRevenue", () => {
  it("null on empty basis — no projection from nothing", () => {
    expect(projectRevenue([])).toBeNull();
    expect(projectRevenue([NaN, -5])).toBeNull();
  });

  it("single week: ±20% band around it", () => {
    expect(projectRevenue([1000])).toEqual({ low: 800, mid: 1000, high: 1200 });
  });

  it("multi-week: mean ± mean-absolute-deviation, floored at 0", () => {
    const p = projectRevenue([800, 1200]);
    expect(p).toEqual({ low: 800, mid: 1000, high: 1200 });
  });
});

describe("forecastConfidence", () => {
  it("live + full basis + no gaps = 1", () => {
    expect(forecastConfidence("live", 4, 0)).toBe(1);
  });
  it("unknown freshness floors hard regardless of basis", () => {
    expect(forecastConfidence("uncollected", 4, 0)).toBeLessThanOrEqual(0.2);
  });
  it("gaps and thin basis discount multiplicatively", () => {
    expect(forecastConfidence("live", 2, 2)).toBeLessThan(forecastConfidence("live", 4, 0));
  });
});

describe("forecastDigestLine", () => {
  const base: CashflowForecast = {
    kind: "revenue_side_forecast",
    weekStart: "2026-07-29",
    projectedRevenue: { low: 800, mid: 1000, high: 1200 },
    basis: { trailingWeeks: [900, 1100], estimatesPipeline: 500, bookingsOpen: 3 },
    confidence: 0.85,
    dataGaps: [],
    freshness: "recent",
  };

  it("always names itself revenue-side, never cash position", () => {
    expect(forecastDigestLine(base)).toContain("NOT cash position");
  });

  it("empty basis renders UNAVAILABLE, not zeros", () => {
    const line = forecastDigestLine({
      ...base,
      basis: { ...base.basis, trailingWeeks: [] },
      dataGaps: ["revenue_range week -1: bridge unreachable"],
    });
    expect(line).toContain("UNAVAILABLE");
    expect(line).not.toContain("$0–$0");
  });
});
