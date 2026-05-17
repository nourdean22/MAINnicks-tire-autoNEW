/**
 * tests/lib/brain-correlation-finder.test.ts — pearson + isKnownChain
 *
 * The full findCorrelations() pipeline is DB-dominated, but the two
 * primitives below carry ALL the math + suppression logic. If they
 * drift, every "hidden correlation" surfaced to Nour is suspect.
 */

import { describe, it, expect } from "vitest";
import { pearson, isKnownChain } from "@/lib/brain/correlation-finder";

describe("pearson", () => {
  it("returns 0 with fewer than 5 data points", () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBe(0);
  });

  it("returns 1 for perfectly positive correlation", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    expect(pearson(x, y)).toBeCloseTo(1, 5);
  });

  it("returns -1 for perfectly negative correlation", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 8, 6, 4, 2];
    expect(pearson(x, y)).toBeCloseTo(-1, 5);
  });

  it("returns 0 when one series is constant (denominator zero)", () => {
    expect(pearson([1, 2, 3, 4, 5], [7, 7, 7, 7, 7])).toBe(0);
    expect(pearson([3, 3, 3, 3, 3], [1, 2, 3, 4, 5])).toBe(0);
  });

  it("returns ~0 for uncorrelated series", () => {
    const x = [1, 3, 2, 5, 4, 7, 6];
    const y = [5, 2, 8, 1, 7, 3, 9];
    const r = pearson(x, y);
    expect(Math.abs(r)).toBeLessThan(0.5);
  });

  it("handles mismatched lengths by using the shorter (min of both)", () => {
    // Should effectively use the first 5 of y, same x.
    const r = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10, 99, 99]);
    expect(r).toBeCloseTo(1, 5);
  });

  it("is symmetric: pearson(x, y) === pearson(y, x)", () => {
    const x = [1, 3, 5, 2, 4];
    const y = [8, 4, 2, 6, 3];
    expect(pearson(x, y)).toBeCloseTo(pearson(y, x), 10);
  });
});

describe("isKnownChain", () => {
  it("recognizes a direct known chain (workout → revenue)", () => {
    expect(isKnownChain("workout", "revenue")).toBe(true);
  });

  it("is order-independent (revenue → workout same as workout → revenue)", () => {
    expect(isKnownChain("revenue", "workout")).toBe(true);
  });

  it("recognizes chain via substring (case-sensitive includes)", () => {
    // Metric names use lowercase in the engine — "workout_freq" still
    // matches "workout".
    expect(isKnownChain("workout_freq", "revenue_week")).toBe(true);
  });

  it("returns false for unrelated metric pairs", () => {
    expect(isKnownChain("shopHumidity", "customerGender")).toBe(false);
  });

  it("returns false when neither side matches any chain endpoint", () => {
    expect(isKnownChain("randomA", "randomB")).toBe(false);
  });

  it("recognizes loop-derived chains (openLoops → energy)", () => {
    expect(isKnownChain("openLoops", "energyLevel")).toBe(true);
  });
});
