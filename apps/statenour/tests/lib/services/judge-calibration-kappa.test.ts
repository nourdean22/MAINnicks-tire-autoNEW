/**
 * tests/lib/services/judge-calibration-kappa.test.ts · deep scout v2 item 7.
 *
 * WHY: the report called a judge "well-calibrated" on raw agreement alone. A judge that
 * ALWAYS picks v2 agrees with the operator exactly as often as the operator thumbs-ups
 * v2 (80% of the time when 80% of reactions are positive), while telling us nothing: it
 * passes every reply the operator rejected. Cohen's kappa removes the chance agreement;
 * false-pass and false-fail rates say which way the judge errs.
 *
 * Mechanism: ChainForge evalgen/executor.ts computeAlignmentStats (lines 649-759:
 * false_pass 712-713, false_fail 714-715, kappa 737, rates 746-757). Their rates fall
 * back to 0.0 on an empty denominator; ours are null, because "no data" is not "no errors".
 *
 * Positive class = "v2 is good". TP = judge v2 + thumbs up, FP (false pass) = judge v2 +
 * thumbs down, TN = judge v1 + thumbs down, FN (false fail) = judge v1 + thumbs up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ memFindMany: vi.fn(), msgFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findMany: m.memFindMany },
    chatMessage: { findMany: m.msgFindMany },
  },
}));

import { buildJudgeCalibration, computeCalibration } from "@/lib/services/judge-calibration";

const fixed = new Date("2026-10-17T00:00:00Z");

type Row = { winner: "v1" | "v2" | "tie"; sourceMessageId: string | null; feedbackScore: number | null };

/** Mint rows from the four cells of the matrix. */
function cells(tp: number, fp: number, tn: number, fn: number): Row[] {
  const rows: Row[] = [];
  let i = 0;
  const add = (n: number, winner: "v1" | "v2", score: number) => {
    for (let k = 0; k < n; k++) rows.push({ winner, sourceMessageId: `m${i++}`, feedbackScore: score });
  };
  add(tp, "v2", 1);
  add(fp, "v2", -1);
  add(tn, "v1", -1);
  add(fn, "v1", 1);
  return rows;
}

describe("(a) a judge that always says v2 is not well-calibrated", () => {
  // 40 comparisons, judge always v2, operator thumbs-up on 32 (80%).
  const r = computeCalibration(cells(32, 8, 0, 0), 30, fixed);

  it("agreement looks fine (80%) but kappa is about zero", () => {
    expect(r.totalScored).toBe(40);
    expect(r.agreementPct).toBe(80);
    expect(r.kappa).not.toBeNull();
    expect(Math.abs(r.kappa as number)).toBeLessThan(0.05);
  });

  it("the verdict is not well-calibrated and names kappa", () => {
    expect(r.verdict).not.toBe("well-calibrated");
    expect(r.verdict).toBe("miscalibrated");
    expect(r.verdictReason).toContain("kappa");
  });

  it("false-pass rate is 1.0: every operator-rejected reply was passed", () => {
    expect(r.falsePassRate).toBe(1);
    // No v1 ruling and the operator liked 32 of 32 positives the judge passed: nothing was failed.
    expect(r.falseFailRate).toBe(0);
  });
});

describe("(b) POSITIVE CONTROL: a judge that matches the operator", () => {
  // Balanced set (50 up / 50 down), judge agrees on 90 of 100.
  const r = computeCalibration(cells(45, 5, 45, 5), 30, fixed);

  it("kappa is high and the verdict is well-calibrated", () => {
    expect(r.agreementPct).toBe(90);
    expect(r.kappa as number).toBeGreaterThanOrEqual(0.6);
    expect(r.kappa).toBe(0.8);
    expect(r.verdict).toBe("well-calibrated");
  });

  it("both error rates are small and measured", () => {
    expect(r.falsePassRate).toBeCloseTo(0.1, 6);
    expect(r.falseFailRate).toBeCloseTo(0.1, 6);
  });
});

describe("verdict bands read kappa (n >= 30)", () => {
  const verdict = (tp: number, fp: number, tn: number, fn: number) =>
    computeCalibration(cells(tp, fp, tn, fn), 30, fixed);

  it("kappa 0.6 is well-calibrated (boundary)", () => {
    const r = verdict(16, 4, 16, 4);
    expect(r.kappa).toBe(0.6);
    expect(r.verdict).toBe("well-calibrated");
  });

  it("kappa 0.4 is moderate (boundary)", () => {
    const r = verdict(14, 6, 14, 6);
    expect(r.kappa).toBe(0.4);
    expect(r.verdict).toBe("moderate");
  });

  it("kappa 0.5 is moderate", () => {
    expect(verdict(15, 5, 15, 5).verdict).toBe("moderate");
  });

  it("kappa 0.1 is miscalibrated even at 55% agreement", () => {
    const r = verdict(11, 9, 11, 9);
    expect(r.agreementPct).toBe(55);
    expect(r.verdict).toBe("miscalibrated");
  });

  it("under 30 scored stays preliminary, whatever kappa says", () => {
    const r = verdict(14, 0, 14, 0); // 28 scored, perfect agreement
    expect(r.kappa).toBe(1);
    expect(r.verdict).toBe("preliminary");
  });

  it("the reason names kappa and the agreement in plain words", () => {
    const r = verdict(15, 5, 15, 5);
    expect(r.verdictReason).toMatch(/kappa 0\.50/);
    expect(r.verdictReason).toContain("75");
  });
});

describe("bands compare the 2-place kappa that is shown", () => {
  // cohensKappa rounds to 3 places, the tile and the reason print 2. A kappa that prints
  // 0.60 must read well-calibrated; one that prints 0.40 must not read miscalibrated.
  const at = (tp: number, fp: number, tn: number, fn: number) => computeCalibration(cells(tp, fp, tn, fn), 30, fixed);

  it("kappa 0.597 prints 0.60 and reads well-calibrated", () => {
    const r = at(8, 3, 20, 3);
    expect(r.kappa).toBe(0.597);
    expect(r.verdict).toBe("well-calibrated");
    expect(r.verdictReason).toContain("kappa 0.60");
  });

  it("kappa 0.595 prints 0.59 and reads moderate", () => {
    const r = at(6, 1, 19, 4);
    expect(r.kappa).toBe(0.595);
    expect(r.verdict).toBe("moderate");
    expect(r.verdictReason).toContain("kappa 0.59");
  });

  it("kappa 0.395 and 0.397 print 0.40 and read moderate", () => {
    const a = at(9, 4, 12, 5);
    const b = at(8, 4, 14, 5);
    expect([a.kappa, b.kappa]).toEqual([0.395, 0.397]);
    expect([a.verdict, b.verdict]).toEqual(["moderate", "moderate"]);
    expect(a.verdictReason).toContain("kappa 0.40");
  });
});

describe("negative kappa reads worse than chance", () => {
  // Judge right on 10 of 40 with both classes present: kappa -0.5.
  const r = computeCalibration(cells(5, 15, 5, 15), 30, fixed);

  it("kappa is negative and the verdict is miscalibrated", () => {
    expect(r.kappa).toBe(-0.5);
    expect(r.verdict).toBe("miscalibrated");
  });

  it("the reason says worse than chance, not 'adds little'", () => {
    expect(r.verdictReason).toContain("worse than chance");
    expect(r.verdictReason).not.toContain("adds little");
  });

  it("CONTROL: a small positive kappa still says it adds little beyond chance", () => {
    const low = computeCalibration(cells(11, 9, 11, 9), 30, fixed); // kappa 0.1
    expect(low.verdictReason).toContain("adds little beyond chance");
    expect(low.verdictReason).not.toContain("worse than chance");
  });
});

describe("(c) one-class data: kappa is undefined, never 0", () => {
  // Judge always v2, operator always thumbs-up: both raters used one answer.
  const r = computeCalibration(cells(40, 0, 0, 0), 30, fixed);

  it("kappa is null", () => {
    expect(r.totalScored).toBe(40);
    expect(r.agreementPct).toBe(100);
    expect(r.kappa).toBeNull();
    expect(r.kappa).not.toBe(0);
  });

  it("the verdict is preliminary (nothing was measured) and the reason names the one-class reactions", () => {
    expect(r.verdict).toBe("preliminary");
    expect(r.verdictReason).toContain("thumbs-up");
    expect(r.verdictReason).toContain("kappa cannot check the judge");
  });

  it("false-pass rate is unknown (no rejected replies), false-fail rate is 0 of 40 positives", () => {
    expect(r.falsePassRate).toBeNull();
    expect(r.falseFailRate).toBe(0);
  });
});

describe("one-class operator reactions stay preliminary (n >= 30)", () => {
  it("all thumbs-up + a mixed judge: kappa is null (the formula says 0, but nothing was measured), the verdict is preliminary", () => {
    const r = computeCalibration(cells(20, 0, 0, 20), 30, fixed); // judge splits 20 v2 / 20 v1, operator all up
    expect(r.totalScored).toBe(40);
    expect(r.kappa).toBeNull();
    expect(r.falsePassRate).toBeNull();
    expect(r.falseFailRate).toBe(0.5);
    expect(r.verdict).toBe("preliminary");
    expect(r.verdictReason).toContain("thumbs-up");
    expect(r.verdictReason).toContain("40");
  });

  it("all thumbs-down is preliminary too, and the reason names thumbs-down", () => {
    const r = computeCalibration(cells(0, 20, 20, 0), 30, fixed);
    expect(r.kappa).toBeNull();
    expect(r.falseFailRate).toBeNull();
    expect(r.verdict).toBe("preliminary");
    expect(r.verdictReason).toContain("thumbs-down");
  });

  it("CONTROL: one thumbs-down among 39 thumbs-up lifts the guard, and the always-v2 judge is still miscalibrated", () => {
    const r = computeCalibration(cells(39, 1, 0, 0), 30, fixed);
    expect(r.verdict).toBe("miscalibrated");
  });
});

describe("(d) no data: kappa and both rates are null", () => {
  it("empty rows", () => {
    const r = computeCalibration([], 30, fixed);
    expect(r.kappa).toBeNull();
    expect(r.falsePassRate).toBeNull();
    expect(r.falseFailRate).toBeNull();
    expect(r.verdict).toBe("preliminary");
  });

  it("only excluded rows (no reaction, tie, no source message)", () => {
    const r = computeCalibration(
      [
        { winner: "v2", sourceMessageId: "a", feedbackScore: null },
        { winner: "tie", sourceMessageId: "b", feedbackScore: 1 },
        { winner: "v1", sourceMessageId: null, feedbackScore: -1 },
      ],
      30,
      fixed,
    );
    expect(r.totalScored).toBe(0);
    expect(r.kappa).toBeNull();
    expect(r.falsePassRate).toBeNull();
    expect(r.falseFailRate).toBeNull();
  });

  describe("buildJudgeCalibration", () => {
    beforeEach(() => vi.clearAllMocks());

    it("a DB error returns null metrics, not zeros", async () => {
      m.memFindMany.mockRejectedValue(new Error("db down"));
      const r = await buildJudgeCalibration();
      expect(r.kappa).toBeNull();
      expect(r.falsePassRate).toBeNull();
      expect(r.falseFailRate).toBeNull();
      expect(r.agreementPct).toBe(-1);
    });

    it("no comparison rows returns null metrics", async () => {
      m.memFindMany.mockResolvedValue([]);
      const r = await buildJudgeCalibration();
      expect(r.kappa).toBeNull();
      expect(r.falsePassRate).toBeNull();
      expect(r.falseFailRate).toBeNull();
    });
  });
});

describe("(e) hand-computed 4-cell fixture", () => {
  // TP 30, FP 10, TN 20, FN 5 -> n 65.
  // po = 50/65. Judge says v2 on 40/65, operator thumbs-up on 35/65.
  // pe = (40*35 + 25*30) / 65^2 = 2150/4225.  kappa = (3250-2150)/(4225-2150) = 1100/2075 = 0.530.
  const r = computeCalibration(cells(30, 10, 20, 5), 30, fixed);

  it("kappa to 3 decimals", () => {
    expect(r.totalScored).toBe(65);
    expect(r.kappa).toBe(0.53);
  });

  it("false-pass = FP/(FP+TN) = 10/30, false-fail = FN/(FN+TP) = 5/35", () => {
    expect(r.falsePassRate).toBeCloseTo(10 / 30, 9);
    expect(r.falseFailRate).toBeCloseTo(5 / 35, 9);
  });

  it("matrix and agreement are unchanged in shape", () => {
    expect(r.matrix.map((c) => [c.judge, c.human, c.count])).toEqual([
      ["v2", "thumbs_up", 30],
      ["v2", "thumbs_down", 10],
      ["v1", "thumbs_up", 5],
      ["v1", "thumbs_down", 20],
    ]);
    expect(r.agreementPct).toBe(76.9);
  });
});
