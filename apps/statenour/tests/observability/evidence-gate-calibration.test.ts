/**
 * The calibration readout must refuse to mislead the promotion decision.
 *
 * AGENTS.md §4 L6 defers enforcement "once the shadow false-positive rate is
 * known". These lock the three rules that make the resulting number safe to act
 * on — each written because the first hand-measurement got it wrong:
 *
 *   1 · cohort at the last precision change (a first pass mixed pre- and
 *       post-fix turns and measured the FIX'S ABSENCE, not the gate)
 *   2 · state no rate at all on a thin sample (post-fix n was 12; "4 of 12"
 *       rendered as 33.3% invites a decision the data cannot support)
 *   3 · split by driver (named-claim blocks fell 21/91 → 1/12 while fact-check
 *       became dominant; an aggregate would promote whichever is loudest)
 */
import { describe, it, expect } from "vitest";
import {
  assembleGateCalibration,
  classifyDriver,
  isBlockingVerdict,
  MIN_SAMPLE,
} from "@/lib/observability/evidence-gate-calibration";

const FIX = "2026-09-16T08:56:00.000Z";
const before = (n: number) => new Date(Date.parse(FIX) - (n + 1) * 60_000);
const after = (n: number) => new Date(Date.parse(FIX) + (n + 1) * 60_000);

const turn = (at: Date, gate: Record<string, unknown>) => ({ createdAt: at, gate, excerpt: "reply" });
const pass = (at: Date) => turn(at, { verdict: "pass" });
const namedBlock = (at: Date, names: string[] = ["Some Channel"]) =>
  turn(at, { verdict: "block", namedClaims: names.length, unreceipted: names, blockingReasons: ["named 1 resource(s) with no tool receipt"] });
const factBlock = (at: Date) =>
  turn(at, { verdict: "repair", namedClaims: 0, blockingReasons: ["fact-check 2/4 unverified (asserted without hedge)"] });
const lengthBlock = (at: Date) =>
  turn(at, { verdict: "repair", namedClaims: 0, blockingReasons: ["length 506 words = 169% of the 300 ceiling"] });

describe("isBlockingVerdict", () => {
  it.each(["pass", "ok", "allow", ""])("treats %s as passing", (v) =>
    expect(isBlockingVerdict(v)).toBe(false),
  );
  it.each(["block", "repair"])("treats %s as blocking", (v) => expect(isBlockingVerdict(v)).toBe(true));
});

describe("classifyDriver", () => {
  it("a named-resource block is the fabrication case the gate exists for", () => {
    expect(classifyDriver({ namedClaims: 2, blockingReasons: ["named 2 resource(s) with no tool receipt"] })).toBe("named_claim");
  });
  it("separates fact-check from named claims", () => {
    expect(classifyDriver({ namedClaims: 0, blockingReasons: ["fact-check 2/4 unverified (asserted without hedge)"] })).toBe("fact_check");
  });
  it("surfaces LENGTH as its own driver — it is not an evidence signal", () => {
    // Folding a 506-word reply into an "evidence" block rate would make the
    // gate look stricter about truth than it is.
    expect(classifyDriver({ namedClaims: 0, blockingReasons: ["length 506 words = 169% of the 300 ceiling"] })).toBe("length");
  });
});

describe("assembleGateCalibration", () => {
  it("COHORTS at the precision change — pre-fix turns never contaminate the decision figure", () => {
    const turns = [
      ...Array.from({ length: 50 }, (_, i) => namedBlock(before(i))), // the old false-positive surface
      ...Array.from({ length: MIN_SAMPLE }, (_, i) => pass(after(i))),
    ];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });

    expect(out.beforeFix.wouldBlock).toBe(50);
    // The post-fix cohort is clean, and that is the only one promotion may use.
    expect(out.afterFix.wouldBlock).toBe(0);
    expect(out.afterFix.wouldBlockPct).toBe(0);
  });

  it("states NO RATE when the post-fix sample is too thin", () => {
    const turns = [
      ...Array.from({ length: 8 }, (_, i) => pass(after(i))),
      ...Array.from({ length: 4 }, (_, i) => namedBlock(after(100 + i))),
    ];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });

    expect(out.afterFix.turns).toBe(12);
    expect(out.afterFix.wouldBlock).toBe(4);
    // 4/12 is not 33.3% — it is "not enough turns". null, never a number.
    expect(out.afterFix.wouldBlockPct).toBeNull();
    expect(out.sufficient).toBe(false);
    expect(out.caveat).toMatch(/No rate is stated/i);
  });

  it("states a rate once the sample supports one", () => {
    const turns = [
      ...Array.from({ length: MIN_SAMPLE - 10 }, (_, i) => pass(after(i))),
      ...Array.from({ length: 10 }, (_, i) => namedBlock(after(500 + i))),
    ];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });

    expect(out.sufficient).toBe(true);
    expect(out.afterFix.turns).toBe(MIN_SAMPLE);
    expect(out.afterFix.wouldBlockPct).toBe(Number(((10 / MIN_SAMPLE) * 100).toFixed(1)));
  });

  it("never calls a block rate a false-positive rate", () => {
    // Deciding whether a block was CORRECT needs human judgement. Conflating
    // the two is how a 37% block rate becomes "37% false positives".
    const turns = Array.from({ length: MIN_SAMPLE }, (_, i) => namedBlock(after(i)));
    const out = assembleGateCalibration(turns, { cohortSince: FIX });
    expect(out.caveat).toMatch(/NOT a false-positive rate/i);
    expect(out.afterFix.sample.length).toBeGreaterThan(0);
  });

  it("splits drivers so promotion cannot be decided on whichever is loudest", () => {
    const turns = [
      ...Array.from({ length: 5 }, (_, i) => namedBlock(after(i))),
      ...Array.from({ length: 9 }, (_, i) => factBlock(after(100 + i))),
      ...Array.from({ length: 3 }, (_, i) => lengthBlock(after(200 + i))),
    ];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });
    expect(out.afterFix.byDriver).toEqual({ named_claim: 5, fact_check: 9, length: 3, other: 0 });
  });

  it("carries the offending names into the sample so a human can judge them", () => {
    // "TEE and Manny" — two people in conversation — survived the 2026-09-16
    // precision fix. A reviewer needs the string, not just a count.
    const turns = [namedBlock(after(1), ["TEE and Manny"])];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });
    expect(out.afterFix.sample[0].unreceipted).toContain("TEE and Manny");
    expect(out.afterFix.sample[0].driver).toBe("named_claim");
  });
});
