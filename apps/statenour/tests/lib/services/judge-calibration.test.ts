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
  // The verdict reads Cohen's kappa, not raw agreement (deep scout v2 item 7). These cases
  // used to mint a judge that always said v2, so "60% agreement" was really "the operator
  // liked 60% of v2": a worthless judge scored moderate or well-calibrated. Balanced fixtures
  // now: half the reactions up, half down, the judge right on `agreeing` of `total`, so
  // kappa = 2 * agreement - 1. Boundary cases live in judge-calibration-kappa.test.ts.
  function mintRows(total: number, agreeing: number) {
    const rows = [];
    const half = total / 2;
    const wrong = total - agreeing;
    const wrongUp = Math.floor(wrong / 2); // thumbs-up the judge failed
    const wrongDown = wrong - wrongUp; // thumbs-down the judge passed
    for (let i = 0; i < half - wrongUp; i++) rows.push(row("v2", `u${i}`, 1));
    for (let i = 0; i < wrongUp; i++) rows.push(row("v1", `wu${i}`, 1));
    for (let i = 0; i < half - wrongDown; i++) rows.push(row("v1", `d${i}`, -1));
    for (let i = 0; i < wrongDown; i++) rows.push(row("v2", `wd${i}`, -1));
    return rows;
  }

  function verdictFor(total: number, agreeing: number): CalibrationVerdict {
    return computeCalibration(mintRows(total, agreeing), 30, fixed).verdict;
  }

  it("verdict = 'preliminary' when total < 30 even at 100% agreement", () => {
    expect(verdictFor(28, 28)).toBe("preliminary");
  });

  it("verdict = 'miscalibrated' when kappa < 0.4 and n ≥ 30", () => {
    expect(verdictFor(30, 20)).toBe("miscalibrated"); // 67% agreement, kappa 0.33
  });

  it("verdict = 'moderate' when kappa 0.4-0.59 and n ≥ 30", () => {
    expect(verdictFor(30, 22)).toBe("moderate"); // 73% agreement, kappa 0.47
  });

  it("verdict = 'well-calibrated' when kappa ≥ 0.6 and n ≥ 30", () => {
    expect(verdictFor(30, 26)).toBe("well-calibrated"); // 87% agreement, kappa 0.73
  });

  it("verdict reason mentions the agreement %", () => {
    const r = computeCalibration(mintRows(30, 26), 30, fixed);
    expect(r.verdictReason).toContain("%");
  });
});
