/**
 * tests/ai/judge-eval-rubric.test.ts
 *
 * Pins the composite invariant from lib/ai/judge-eval.ts: `composite`
 * is the mean of the five CORE axes only. The three persona axes added
 * 2026-08-18 (obedience, nonSycophancy, calibration — closing the gap
 * GATE-2026-08-14-nick-chat-persona.md identified) must never be folded
 * in, or every historical `reply_judgment` row on disk and
 * lib/observability/persona-lane-census.ts's cross-lane comparisons
 * silently stop meaning what they meant yesterday.
 */

import { describe, expect, it } from "vitest";
import { clamp, computeCompositeScore, type JudgeRubric } from "@/lib/ai/judge-eval";

const baseRubric: JudgeRubric = {
  accuracy: 8,
  actionability: 8,
  brevity: 8,
  tone: 8,
  evidence: 8,
  obedience: 0,
  nonSycophancy: 0,
  calibration: 0,
};

describe("computeCompositeScore · persona-axis exclusion", () => {
  it("computes the mean of the five core axes", () => {
    expect(computeCompositeScore(baseRubric)).toBe(8);
  });

  it("is unaffected by persona axes moving from 0 to 10", () => {
    const withPersonaMaxed: JudgeRubric = {
      ...baseRubric,
      obedience: 10,
      nonSycophancy: 10,
      calibration: 10,
    };
    expect(computeCompositeScore(withPersonaMaxed)).toBe(computeCompositeScore(baseRubric));
  });

  it("still reflects a real change in a core axis", () => {
    const lowerTone: JudgeRubric = { ...baseRubric, tone: 0 };
    expect(computeCompositeScore(lowerTone)).toBeLessThan(computeCompositeScore(baseRubric));
  });
});

describe("clamp", () => {
  it("clamps to the 0-10 range", () => {
    expect(clamp(15)).toBe(10);
    expect(clamp(-3)).toBe(0);
    expect(clamp(7)).toBe(7);
  });

  it("defaults non-numeric or missing input to 0", () => {
    expect(clamp(undefined)).toBe(0);
    expect(clamp("high")).toBe(0);
    expect(clamp(Number.NaN)).toBe(0);
  });
});
