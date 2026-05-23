/**
 * tests/lib/services/judge-calibration.test.ts · task #22 slice 5.5.
 *
 * Pure-helper test for the ghost-vs-outcome calibration metric. The
 * service has a single pure aggregator (`computeCalibration`) plus a
 * thin Prisma adapter (`buildJudgeCalibration`). We test the pure
 * helper end-to-end · the adapter is a 2-query glue layer that would
 * mostly mock Prisma if tested.
 *
 * The metric's correctness is structurally the metric's WHOLE value
 * (a wrong number here misleads the V1→V2 cutover) so the cases
 * cover the 4-cell confusion matrix + every exclusion path + each
 * verdict band.
 */

import { describe, it, expect } from "vitest";

import {
  computeCalibration,
  type CalibrationVerdict,
} from "@/lib/services/judge-calibration";

const fixed = new Date("2026-05-23T00:00:00Z");

// Small helper · keeps the test rows compact + readable
function row(
  winner: "v1" | "v2" | "tie",
  sourceMessageId: string | null,
  feedbackScore: number | null,
) {
  return { winner, sourceMessageId, feedbackScore };
}

describe("computeCalibration · ground-truth feedback math", () => {
  it("returns the preliminary empty report when no rows", () => {
    const r = computeCalibration([], 30, fixed);
    expect(r.totalScored).toBe(0);
    expect(r.agreementPct).toBe(-1);
    expect(r.matrix).toHaveLength(4);
    expect(r.matrix.every((c) => c.count === 0)).toBe(true);
    expect(r.verdict).toBe("preliminary");
  });

  it("excludes rows missing sourceMessageId · they can't be scored", () => {
    const r = computeCalibration(
      [
        row("v2", null, 1),
        row("v1", null, -1),
      ],
      30,
      fixed,
    );
    expect(r.noSourceMessage).toBe(2);
    expect(r.totalScored).toBe(0);
  });

  it("excludes rows with no operator reaction · null feedback is excluded", () => {
    const r = computeCalibration(
      [
        row("v2", "m1", null),
        row("v1", "m2", 0), // 0 is also 'no clear reaction'
      ],
      30,
      fixed,
    );
    expect(r.noOperatorReaction).toBe(2);
    expect(r.totalScored).toBe(0);
  });

  it("excludes ties · agreement is undefined for ties", () => {
    const r = computeCalibration(
      [
        row("tie", "m1", 1),
        row("tie", "m2", -1),
      ],
      30,
      fixed,
    );
    expect(r.ties).toBe(2);
    expect(r.totalScored).toBe(0);
  });

  it("counts agree = judge v2 + human +1", () => {
    const r = computeCalibration([row("v2", "m1", 1)], 30, fixed);
    expect(r.totalScored).toBe(1);
    expect(r.agreementPct).toBe(100);
    const cell = r.matrix.find((c) => c.judge === "v2" && c.human === "thumbs_up");
    expect(cell?.count).toBe(1);
  });

  it("counts agree = judge v1 + human −1", () => {
    const r = computeCalibration([row("v1", "m1", -1)], 30, fixed);
    expect(r.agreementPct).toBe(100);
    const cell = r.matrix.find((c) => c.judge === "v1" && c.human === "thumbs_down");
    expect(cell?.count).toBe(1);
  });

  it("counts disagree = judge v2 + human −1 (false positive)", () => {
    const r = computeCalibration([row("v2", "m1", -1)], 30, fixed);
    expect(r.agreementPct).toBe(0);
    const cell = r.matrix.find(
      (c) => c.judge === "v2" && c.human === "thumbs_down",
    );
    expect(cell?.count).toBe(1);
  });

  it("counts disagree = judge v1 + human +1 (false negative)", () => {
    const r = computeCalibration([row("v1", "m1", 1)], 30, fixed);
    expect(r.agreementPct).toBe(0);
    const cell = r.matrix.find((c) => c.judge === "v1" && c.human === "thumbs_up");
    expect(cell?.count).toBe(1);
  });

  it("computes mixed agreement · 3 agree + 2 disagree = 60%", () => {
    const r = computeCalibration(
      [
        row("v2", "m1", 1), // agree
        row("v2", "m2", 1), // agree
        row("v1", "m3", -1), // agree
        row("v2", "m4", -1), // disagree
        row("v1", "m5", 1), // disagree
      ],
      30,
      fixed,
    );
    expect(r.totalScored).toBe(5);
    expect(r.agreementPct).toBe(60);
  });

  it("preserves the row of the matrix as 4 cells in fixed order", () => {
    const r = computeCalibration([], 30, fixed);
    expect(r.matrix.map((c) => `${c.judge}-${c.human}`)).toEqual([
      "v2-thumbs_up",
      "v2-thumbs_down",
      "v1-thumbs_up",
      "v1-thumbs_down",
    ]);
  });
});

describe("computeCalibration · verdict bands", () => {
  // Helper to mint N rows with K agreeing
  function mintRows(total: number, agreeing: number) {
    const rows = [];
    for (let i = 0; i < agreeing; i++) rows.push(row("v2", `m${i}`, 1));
    for (let i = agreeing; i < total; i++)
      rows.push(row("v2", `m${i}`, -1));
    return rows;
  }

  function verdictFor(total: number, agreeing: number): CalibrationVerdict {
    return computeCalibration(mintRows(total, agreeing), 30, fixed).verdict;
  }

  it("verdict = 'preliminary' when total < 30 even at 100% agreement", () => {
    expect(verdictFor(29, 29)).toBe("preliminary");
  });

  it("verdict = 'miscalibrated' when agreement < 50% and n ≥ 30", () => {
    expect(verdictFor(30, 14)).toBe("miscalibrated"); // ~47%
  });

  it("verdict = 'moderate' when agreement 50-69% and n ≥ 30", () => {
    expect(verdictFor(30, 18)).toBe("moderate"); // 60%
  });

  it("verdict = 'well-calibrated' when agreement ≥ 70% and n ≥ 30", () => {
    expect(verdictFor(30, 24)).toBe("well-calibrated"); // 80%
  });

  it("verdict reason mentions the agreement %", () => {
    const r = computeCalibration(mintRows(30, 24), 30, fixed);
    expect(r.verdictReason).toContain("%");
  });
});
