/**
 * tests/ai/judge-calibration-kappa.test.ts
 *
 * WHY: lib/ai/judge-eval/calibration.ts already reported judge-vs-operator
 * `agreement` plus per-class precision/recall — a good report that was
 * missing the two measures that decide whether a judge is worth trusting.
 *
 * 1. Raw agreement is the number that LOOKS trustworthy and is not. With
 *    three classes and a tie-heavy distribution, two raters can agree 70%
 *    of the time purely by both favouring the majority class. Cohen's
 *    kappa corrects for that chance agreement.
 *
 * 2. The module header has always cited MT-Bench's position-bias finding
 *    as the reason the label loop exists — but nothing measured it.
 *    Published production judges show >0.95 self-consistency ALONGSIDE
 *    >0.10 position bias. Self-consistency is what you accidentally
 *    measure; validity is what you need.
 *
 * CANARY DISCIPLINE: the dangerous failure is a metric that returns a
 * flattering number when the judge is worthless. So the headline case
 * here is the INVERSE one — high agreement, near-zero kappa — asserted
 * explicitly. A kappa implementation that just returned `agreement`
 * would pass every "good judge" test and fail this one.
 */

import { describe, it, expect } from "vitest";
import {
  judgeCalibration,
  cohensKappa,
  positionBias,
  MIN_TRUSTED_SWAP_PAIRS,
  type LabeledComparison,
  type SwappedComparison,
} from "@/lib/ai/judge-eval/calibration";

function rows(spec: Array<[LabeledComparison["judgeWinner"], LabeledComparison["operatorWinner"], number]>) {
  const out: LabeledComparison[] = [];
  for (const [j, o, n] of spec) {
    for (let i = 0; i < n; i++) out.push({ judgeWinner: j, operatorWinner: o });
  }
  return out;
}

describe("cohensKappa", () => {
  it("CANARY: high agreement with near-zero kappa — the worthless judge that looks fine", () => {
    // Both raters call almost everything "tie". They agree 82% of the time.
    // That agreement is chance, not skill.
    const r = rows([
      ["tie", "tie", 82],
      ["v1", "tie", 9],
      ["tie", "v1", 9],
    ]);

    const report = judgeCalibration(r);
    expect(report.agreement).toBeGreaterThan(0.8); // looks great
    expect(report.kappa).not.toBeNull();
    // ...and is statistically near-worthless.
    expect(report.kappa as number).toBeLessThan(0.2);
  });

  it("scores a genuinely good judge high", () => {
    const r = rows([
      ["v1", "v1", 30],
      ["v2", "v2", 30],
      ["tie", "tie", 30],
      ["v1", "v2", 5],
      ["v2", "v1", 5],
    ]);
    const k = cohensKappa(r);
    expect(k).not.toBeNull();
    expect(k as number).toBeGreaterThan(0.8);
  });

  it("scores a judge that is anti-correlated below zero", () => {
    const r = rows([
      ["v1", "v2", 40],
      ["v2", "v1", 40],
    ]);
    const k = cohensKappa(r);
    expect(k).not.toBeNull();
    expect(k as number).toBeLessThan(0);
  });

  it("returns null — NOT 1 — when both raters used a single class for everything", () => {
    // Expected agreement is 1, so kappa is mathematically undefined.
    // Returning 1 here would be a confident-zero in reverse: a
    // degenerate label set reported as a perfect judge.
    expect(cohensKappa(rows([["tie", "tie", 50]]))).toBeNull();
  });

  it("returns null on no labels", () => {
    expect(cohensKappa([])).toBeNull();
  });

  it("is exposed on the report so a caller cannot read agreement alone", () => {
    const report = judgeCalibration(rows([["v1", "v1", 10], ["v2", "v2", 10]]));
    expect(report).toHaveProperty("kappa");
  });
});

describe("positionBias", () => {
  function swaps(spec: Array<[SwappedComparison["normalWinner"], SwappedComparison["swappedWinner"], number]>) {
    const out: SwappedComparison[] = [];
    for (const [n, s, count] of spec) {
      for (let i = 0; i < count; i++) out.push({ normalWinner: n, swappedWinner: s });
    }
    return out;
  }

  it("scores a consistent judge at zero inconsistency", () => {
    // v1/v2 are SLOTS. Same content winning both runs means the LABELS
    // differ: it sat in slot 2 normally and slot 1 when swapped.
    const r = positionBias(swaps([["v2", "v1", 25]]));
    expect(r.inconsistencyRate).toBe(0);
    expect(r.trusted).toBe(true);
  });

  it("CANARY: catches a judge that always picks whichever side is shown FIRST", () => {
    // The SAME label twice means the same SLOT won both times, regardless
    // of what was in it. This is the failure the module header cited for
    // a year without ever measuring.
    const r = positionBias(swaps([["v1", "v1", 30]]));
    expect(r.inconsistencyRate).toBe(1);
    expect(r.firstPositionRate).toBe(1);
  });

  it("distinguishes second-slot preference from first-slot preference", () => {
    const r = positionBias(swaps([["v2", "v2", 30]]));
    expect(r.inconsistencyRate).toBe(1);
    expect(r.firstPositionRate).toBe(0); // biased, but toward the SECOND slot
  });

  it("does not treat ties as evidence either way", () => {
    const r = positionBias(swaps([["tie", "v1", 10], ["v2", "tie", 10]]));
    // Every pair has a tie on one side, so none are decisive.
    expect(r.inconsistencyRate).toBeNull();
    expect(r.firstPositionRate).toBeNull();
  });

  it("reports untrusted below the pair floor rather than a confident number", () => {
    const r = positionBias(swaps([["v2", "v1", 3]]));
    expect(r.pairs).toBe(3);
    expect(r.trusted).toBe(false);
    expect(r.minTrustedPairs).toBe(MIN_TRUSTED_SWAP_PAIRS);
  });

  it("returns nulls, not zeros, on an empty set", () => {
    const r = positionBias([]);
    expect(r.pairs).toBe(0);
    expect(r.inconsistencyRate).toBeNull();
    expect(r.firstPositionRate).toBeNull();
    expect(r.trusted).toBe(false);
  });
});
