/**
 * v10.0.411 · improve-agent regression armor.
 *
 * Locks in the analyzeJudgments behavior · pure function over judgment
 * rows · so future axis-tuning can't silently regress the surface
 * thresholds (15% failure rate, 5-msg minimum, axis < 5 = failing).
 */

import { describe, expect, it } from "vitest";
import { analyzeJudgments } from "@/lib/brain/improve-agent";

const baseRubric = { accuracy: 8, actionability: 8, brevity: 8, tone: 8, evidence: 8 };

function row(
  axis: keyof typeof baseRubric,
  score: number,
  reasoning = "test reasoning",
) {
  return {
    messageId: `m_${Math.random().toString(36).slice(2, 9)}`,
    composite: 7,
    rubric: { ...baseRubric, [axis]: score },
    reasoning,
    judgedAt: new Date(),
  };
}

describe("analyzeJudgments · floor + threshold gating", () => {
  it("returns empty when judgment count < 5 (not enough signal)", () => {
    const j = [row("tone", 3), row("tone", 4), row("tone", 2), row("tone", 3)];
    expect(analyzeJudgments(j)).toEqual([]);
  });

  it("returns empty when failure rate < 15% (noise floor)", () => {
    // 1 of 20 = 5% · below the 15% floor
    const j = [
      row("tone", 2),
      ...Array.from({ length: 19 }, () => row("tone", 8)),
    ];
    expect(analyzeJudgments(j)).toEqual([]);
  });

  it("returns empty when failing count < 5 absolute (signal too thin)", () => {
    // 4 of 30 = 13% · also fails count threshold
    const j = [
      ...Array.from({ length: 4 }, () => row("brevity", 2)),
      ...Array.from({ length: 26 }, () => row("brevity", 8)),
    ];
    expect(analyzeJudgments(j)).toEqual([]);
  });

  it("surfaces a hypothesis when both thresholds clear", () => {
    // 6 of 30 = 20% · above 15% AND ≥ 5 absolute
    const j = [
      ...Array.from({ length: 6 }, (_, i) => row("tone", 2, `bad ${i}`)),
      ...Array.from({ length: 24 }, () => row("tone", 8)),
    ];
    const out = analyzeJudgments(j);
    expect(out).toHaveLength(1);
    expect(out[0].axis).toBe("tone");
    expect(out[0].failingCount).toBe(6);
    expect(out[0].totalCount).toBe(30);
    expect(out[0].failureRate).toBeCloseTo(0.2, 2);
    expect(out[0].avgScoreOnFailing).toBe(2);
    expect(out[0].exampleReasonings).toHaveLength(3);
    expect(out[0].proposedRuleChange).toMatch(/sycoph|tone|warm/i);
  });

  it("sorts hypotheses by failure rate descending (highest-impact first)", () => {
    // tone: 8/20 = 40%, brevity: 6/20 = 30%
    const j = [
      ...Array.from({ length: 8 }, () => row("tone", 2)),
      ...Array.from({ length: 6 }, () => row("brevity", 3)),
      ...Array.from({ length: 6 }, () => row("accuracy", 8)),
    ];
    const out = analyzeJudgments(j);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].axis).toBe("tone");
    expect(out[1].axis).toBe("brevity");
    expect(out[0].failureRate).toBeGreaterThan(out[1].failureRate);
  });

  it("caps exampleReasonings at 3 even when more failures exist", () => {
    const j = [
      ...Array.from({ length: 12 }, (_, i) => row("evidence", 1, `failure-${i}`)),
      ...Array.from({ length: 18 }, () => row("evidence", 9)),
    ];
    const out = analyzeJudgments(j);
    expect(out[0].exampleReasonings).toHaveLength(3);
  });

  it("axis at the failure boundary (4) counts as failing", () => {
    // axis < 5 is failing, so 4 should fail.
    const j = [
      ...Array.from({ length: 6 }, () => row("brevity", 4)),
      ...Array.from({ length: 24 }, () => row("brevity", 8)),
    ];
    const out = analyzeJudgments(j);
    expect(out).toHaveLength(1);
    expect(out[0].axis).toBe("brevity");
  });

  it("axis at exactly 5 does NOT fail (strictly less-than)", () => {
    const j = [
      ...Array.from({ length: 6 }, () => row("brevity", 5)),
      ...Array.from({ length: 24 }, () => row("brevity", 8)),
    ];
    expect(analyzeJudgments(j)).toEqual([]);
  });
});
