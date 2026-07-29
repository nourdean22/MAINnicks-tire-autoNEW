/**
 * tests/ai/judge-calibration.test.ts — Wave-5 (2026-07-29): the pure
 * judge-vs-operator agreement math. Per-class precision/recall matters
 * because raw agreement lies on imbalanced labels.
 */

import { describe, it, expect } from "vitest";
import {
  judgeCalibration,
  MIN_TRUSTED_LABELS,
  type LabeledComparison,
} from "@/lib/ai/judge-eval/calibration";

const rows = (pairs: Array<[string, string]>): LabeledComparison[] =>
  pairs.map(([j, o]) => ({ judgeWinner: j, operatorWinner: o }) as LabeledComparison);

describe("judgeCalibration", () => {
  it("empty labels: agreement null, untrusted, no NaN anywhere", () => {
    const r = judgeCalibration([]);
    expect(r.labeled).toBe(0);
    expect(r.agreement).toBeNull();
    expect(r.trusted).toBe(false);
    expect(r.perClass.v1.precision).toBeNull();
    expect(r.perClass.v2.recall).toBeNull();
  });

  it("perfect agreement scores 1 with matching per-class stats", () => {
    const r = judgeCalibration(rows([["v1", "v1"], ["v2", "v2"], ["tie", "tie"]]));
    expect(r.agreement).toBe(1);
    expect(r.perClass.v1.precision).toBe(1);
    expect(r.perClass.v2.recall).toBe(1);
  });

  it("imbalanced labels: raw agreement can look fine while a class's precision is bad", () => {
    // Judge says v2 four times; operator agreed only twice → v2 precision 0.5
    // while overall agreement is 4/6.
    const r = judgeCalibration(
      rows([
        ["v2", "v2"],
        ["v2", "v2"],
        ["v2", "v1"],
        ["v2", "tie"],
        ["v1", "v1"],
        ["tie", "tie"],
      ]),
    );
    expect(r.agreement).toBeCloseTo(4 / 6, 2);
    expect(r.perClass.v2.precision).toBe(0.5);
    expect(r.perClass.v1.recall).toBe(0.5);
  });

  it("trust threshold flips at MIN_TRUSTED_LABELS", () => {
    const many = rows(Array.from({ length: MIN_TRUSTED_LABELS }, () => ["v1", "v1"]));
    expect(judgeCalibration(many.slice(0, MIN_TRUSTED_LABELS - 1)).trusted).toBe(false);
    expect(judgeCalibration(many).trusted).toBe(true);
  });
});
