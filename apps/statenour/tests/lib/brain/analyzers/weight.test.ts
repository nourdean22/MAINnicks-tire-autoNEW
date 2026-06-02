import { describe, it, expect } from "vitest";

import {
  computeWeightTrend,
  type BodyRow,
  type WeightGoalInput,
} from "@/lib/brain/analyzers/weight";

const NOW = new Date(2026, 1, 1); // fixed — no Date.now()

/** ET YYYY-MM-DD key for a fixed offset (BodyTracking is string-dated). */
function dayStr(offset: number): string {
  return new Date(2026, 0, 1 + offset).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}
function body(offset: number, over: Partial<BodyRow> = {}): BodyRow {
  return {
    date: dayStr(offset),
    weight: over.weight ?? null,
    bodyFatPct: over.bodyFatPct ?? null,
    waistInches: over.waistInches ?? null,
  };
}

describe("computeWeightTrend", () => {
  it("returns an honest gap with zero weight logs", () => {
    const r = computeWeightTrend({ body: [], weightGoal: null, days: 30 }, NOW);
    expect(r.weight).toBeNull();
    expect(r.dataCompleteness.sufficient).toBe(false);
    expect(r.dataCompleteness.note).toMatch(/no weight logged/i);
  });

  it("flags <5 weight points as insufficient, not a trend", () => {
    const rows = [body(0, { weight: 180 }), body(1, { weight: 181 }), body(2, { weight: 180 })];
    const r = computeWeightTrend({ body: rows, weightGoal: null, days: 30 }, NOW);
    expect(r.weight?.insufficient).toBe(true);
    expect(r.dataCompleteness.sufficient).toBe(false);
  });

  it("computes a falling weight trend with a per-week rate + net change", () => {
    // weight drops 185 -> ~179 over 7 logs
    const rows = Array.from({ length: 7 }, (_, i) => body(i, { weight: 185 - i }));
    const r = computeWeightTrend({ body: rows, weightGoal: null, days: 30 }, NOW);
    expect(r.weight?.insufficient).toBe(false);
    expect(r.weight?.direction).toBe("falling");
    expect(r.weight?.perWeekChange ?? 0).toBeLessThan(0);
    expect(r.weight?.netChange).toBe(-6); // 179 - 185
  });

  it("never moralizes a rising weight (direction only, no good/bad)", () => {
    const rows = Array.from({ length: 7 }, (_, i) => body(i, { weight: 180 + i }));
    const r = computeWeightTrend({ body: rows, weightGoal: null, days: 30 }, NOW);
    expect(r.weight?.direction).toBe("rising");
    // guidance describes the move but never labels it good/bad/healthy
    expect(r.guidance.join(" ")).not.toMatch(/bad|worse|unhealthy|too heavy|good job|great/i);
  });

  it("surfaces distance to an active weight goal (signed, neutral)", () => {
    const rows = Array.from({ length: 6 }, (_, i) => body(i, { weight: 190 - i }));
    // latest weight = 185; target 175 -> +10 above target
    const goal: WeightGoalInput = { metric: "weight", targetValue: 175, unit: "lb" };
    const r = computeWeightTrend({ body: rows, weightGoal: goal, days: 30 }, NOW);
    expect(r.goal?.currentWeight).toBe(185);
    expect(r.goal?.distanceToTarget).toBe(10);
    expect(r.guidance.join(" ")).toMatch(/above your weight target/i);
  });

  it("omits the goal block when no weight goal is provided", () => {
    const rows = Array.from({ length: 6 }, (_, i) => body(i, { weight: 180 }));
    const r = computeWeightTrend({ body: rows, weightGoal: null, days: 30 }, NOW);
    expect(r.goal).toBeNull();
  });

  it("trends body-fat and waist independently", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      body(i, { weight: 180, bodyFatPct: 22 - i * 0.3, waistInches: 35 - i * 0.1 }),
    );
    const r = computeWeightTrend({ body: rows, weightGoal: null, days: 30 }, NOW);
    expect(r.bodyFat?.insufficient).toBe(false);
    expect(r.bodyFat?.direction).toBe("falling");
    expect(r.waist?.insufficient).toBe(false);
    expect(r.waist?.direction).toBe("falling");
  });
});
