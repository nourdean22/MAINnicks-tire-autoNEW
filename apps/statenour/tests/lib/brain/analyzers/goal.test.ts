import { describe, it, expect } from "vitest";

import {
  computeGoalAnalysis,
  type GoalInput,
} from "@/lib/brain/analyzers/goal";

const NOW = new Date(2026, 5, 1); // fixed — no Date.now()

function goal(over: Partial<GoalInput> = {}): GoalInput {
  return {
    domain: "business",
    title: "Hit $15K revenue this month",
    metric: "revenue",
    targetValue: 15000,
    currentValue: 7500,
    unit: "$",
    deadline: new Date(2026, 5, 30),
    status: "active",
    progress: 50,
    kind: "metric",
    horizon: "MONTH",
    why: "Fund the next hire",
    parentGoalId: null,
    createdAt: new Date(2026, 5, 1),
    ...over,
  };
}

describe("computeGoalAnalysis", () => {
  it("grades a well-formed SMART goal highly", () => {
    const r = computeGoalAnalysis([goal()], NOW);
    expect(["S", "A"]).toContain(r.goals[0].grade);
    expect(r.goals[0].smart.measurable).toBe(5);
    expect(r.goals[0].smart.timeBound).toBe(5);
  });

  it("flags a target=0 metric goal as not measurable", () => {
    const r = computeGoalAnalysis(
      [goal({ targetValue: 0, currentValue: 0, unit: "" })],
      NOW,
    );
    expect(r.goals[0].smart.measurable).toBe(1);
    expect(r.goals[0].weaknesses.join(" ")).toMatch(/not measurable/i);
    expect(r.portfolio?.unmeasurableCount).toBe(1);
  });

  it("flags a goal with no deadline/horizon as not time-bound", () => {
    const r = computeGoalAnalysis([goal({ deadline: null, horizon: null })], NOW);
    expect(r.goals[0].smart.timeBound).toBe(1);
    expect(r.goals[0].weaknesses.join(" ")).toMatch(/not time-bound/i);
    expect(r.goals[0].pace).toBe("no-deadline");
  });

  it("computes progress % from current/target", () => {
    const r = computeGoalAnalysis(
      [goal({ currentValue: 3000, targetValue: 15000 })],
      NOW,
    );
    expect(r.goals[0].progressPct).toBe(20);
  });

  it("marks a goal behind pace when progress lags elapsed time", () => {
    // created Jun 1, deadline Jun 30; now Jun 24 (~79% elapsed); progress 10%
    const r = computeGoalAnalysis(
      [goal({ currentValue: 1500, targetValue: 15000 })],
      new Date(2026, 5, 24),
    );
    expect(["behind", "severely-behind"]).toContain(r.goals[0].pace);
  });

  it("returns an honest gap for an empty portfolio", () => {
    const r = computeGoalAnalysis([], NOW);
    expect(r.dataCompleteness.sufficient).toBe(false);
    expect(r.portfolio).toBeNull();
    expect(r.guidance.join(" ")).toMatch(/no active goals/i);
  });
});
