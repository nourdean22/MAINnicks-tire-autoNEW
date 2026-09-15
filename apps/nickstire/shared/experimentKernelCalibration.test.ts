/**
 * Kernel calibration — 2026-09-15.
 *
 * The ledger row for the first web experiment said "H4 is PROVISIONAL until
 * the kernel's A/A + injected-effect calibration exists". This is that
 * calibration, run on THIS kernel with a seeded generator, so the numbers
 * are reproducible and a regression in mSprt/srmCheck moves them.
 *
 * Measured at 2,000 runs, seed 20260915, ~100 exposed sessions/day:
 *   A/A, 30 daily peeks      kernel declares 1.3 %  · naive z-test 26.1 %
 *   A/A, 90 daily peeks      kernel 2.2 %           · naive 34.1 %
 *   +2pp / +3pp / +5pp       power 30.5 % / 67.8 % / 98.7 %, wrong arm 0 %
 *   60/40 randomiser         refused 100 %          · naive scores 25.3 % of them
 *   balanced A/A refused     1.45 % under the ORIGINAL per-look SRM alpha of
 *                            0.001 (the alarm is peeked daily too). Fixed the
 *                            same day: DEFAULT_SRM_ALPHA 1e-4 → 0.05 %, with
 *                            60/40 still refused 100 % and 55/45 95.1 %.
 *
 * The thresholds here run 400 runs to stay fast and leave sampling margin.
 * The OPPONENT assertion is the harness's own positive control: if the naive
 * rule did NOT blow past alpha, the harness could not tell valid from invalid.
 */
import { describe, expect, it } from "vitest";
import { CALIBRATION_SCENARIOS, calibrate, kernelRule, mulberry32, naivePeekingZRule, simulateOne, simulateStream } from "./experimentKernelCalibration";

const RUNS = 400;
const SEED = 20260915;

describe("mulberry32", () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const xs = Array.from({ length: 1000 }, () => a());
    const ys = Array.from({ length: 1000 }, () => b());
    expect(xs).toEqual(ys);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(990);
  });
});

describe("A/A — the always-valid promise, measured", () => {
  it("kernel: any-peek false-positive rate over 30 daily reads is at or under alpha", () => {
    const r = calibrate(CALIBRATION_SCENARIOS.aa5, RUNS, SEED, kernelRule);
    expect(r.anyPeekDeclareRate).toBeLessThanOrEqual(0.05);
    expect(r.correctDeclareRate).toBe(0); // there is no better arm to be right about
  });

  it("OPPONENT (positive control): a fixed-horizon z-test peeked daily declares far above alpha", () => {
    const r = calibrate(CALIBRATION_SCENARIOS.aa5, RUNS, SEED, naivePeekingZRule);
    expect(r.anyPeekDeclareRate).toBeGreaterThan(0.15); // measured 0.26 — the classic ~5% -> ~26% inflation
  });

  it("kernel stays valid under 90 peeks (validity does not decay with more looks)", () => {
    const r = calibrate(CALIBRATION_SCENARIOS.aa5Long, RUNS, SEED, kernelRule);
    expect(r.anyPeekDeclareRate).toBeLessThanOrEqual(0.05);
  });

  it("a balanced split is (almost) never refused as SRM under the default alarm; the OLD per-look 0.001 alarm refused 1.45%", () => {
    // The harness found this: peeked daily, the "conventional" p<0.001 SRM alarm
    // falsely refused a perfectly balanced split in 1.45% of 30-day runs. The
    // sweep (floor x alpha) showed the floor does nothing and alpha 1e-4 takes
    // it to 0.05% with 60/40 still caught 100% of the time. CONTROL first: the
    // old alpha must still reproduce the defect through this harness, or the
    // green below would prove nothing about the fix.
    const old = calibrate({ ...CALIBRATION_SCENARIOS.aa5, srmAlpha: 1e-3 }, RUNS, SEED, kernelRule);
    expect(old.refusedDesignRate).toBeGreaterThan(0.004); // measured 0.0145 at 2,000 runs
    const now = calibrate(CALIBRATION_SCENARIOS.aa5, RUNS, SEED, kernelRule);
    expect(now.refusedDesignRate).toBeLessThanOrEqual(0.005); // measured 0.0005 at 2,000 runs
    expect(now.refusedDesignRate).toBeLessThan(old.refusedDesignRate);
  });

  it("the tightened alarm still refuses a mildly broken 55/45 randomiser in the large majority of runs", () => {
    const r = calibrate({ ...CALIBRATION_SCENARIOS.brokenSplit, controlShare: 0.55, name: "55/45" }, RUNS, SEED, kernelRule);
    expect(r.refusedDesignRate).toBeGreaterThanOrEqual(0.9); // measured 0.951 (was 0.984 at the old alpha)
  });
});

describe("injected effect — power at this site's traffic", () => {
  it("+5pp at base 5% is found almost always, never the wrong arm", () => {
    const r = calibrate(CALIBRATION_SCENARIOS.plus5pp, RUNS, SEED, kernelRule);
    expect(r.correctDeclareRate).toBeGreaterThanOrEqual(0.9); // measured 0.987
    expect(r.wrongDeclareRate).toBe(0);
    expect(r.medianDeclaredDay).not.toBeNull();
  });

  it("+2pp is real but SLOW at ~100 sessions/day — the row must not promise a verdict in a month", () => {
    const r = calibrate(CALIBRATION_SCENARIOS.plus2pp, RUNS, SEED, kernelRule);
    expect(r.correctDeclareRate).toBeGreaterThan(0.15); // measured 0.305
    expect(r.correctDeclareRate).toBeLessThan(0.6); // if this rises, tau or traffic assumptions changed
    expect(r.wrongDeclareRate).toBe(0);
  });
});

describe("sample-ratio mismatch — a broken randomiser is refused, not scored", () => {
  it("60/40 traffic is refused as invalid_design in every run and never declares", () => {
    const r = calibrate(CALIBRATION_SCENARIOS.brokenSplit, RUNS, SEED, kernelRule);
    expect(r.refusedDesignRate).toBeGreaterThanOrEqual(0.99);
    expect(r.anyPeekDeclareRate).toBe(0);
  });

  it("OPPONENT: the naive rule happily scores a broken split", () => {
    const r = calibrate(CALIBRATION_SCENARIOS.brokenSplit, RUNS, SEED, naivePeekingZRule);
    expect(r.anyPeekDeclareRate).toBeGreaterThan(0.1); // measured 0.253
  });
});

describe("simulateOne", () => {
  it("one run is well-formed, stops at the first declaration, and is deterministic for the same stream", () => {
    const a = simulateOne(CALIBRATION_SCENARIOS.plus5pp, mulberry32(3));
    const b = simulateOne(CALIBRATION_SCENARIOS.plus5pp, mulberry32(3));
    expect(a).toEqual(b);
    expect(a.finalExposuresPerArm).toBeGreaterThan(0);
    if (a.declaredDay !== null) {
      // a declaration ends the run: exposures cannot exceed what that many days could produce
      expect(a.finalExposuresPerArm).toBeLessThanOrEqual(a.declaredDay * CALIBRATION_SCENARIOS.plus5pp.sessionsPerDay);
      expect(a.finalStatus).toBe("winner");
    }
  });
});

describe("simulateStream — the counts an external engine is fed", () => {
  it("is cumulative and monotone, never stops early, reports p=1 below the floor, and is deterministic", () => {
    const s = CALIBRATION_SCENARIOS.plus5pp;
    const a = simulateStream(s, mulberry32(11));
    const b = simulateStream(s, mulberry32(11));
    expect(a).toEqual(b);
    expect(a).toHaveLength(s.days); // a declaration must NOT truncate the stream
    for (let i = 1; i < a.length; i++) {
      expect(a[i].nc).toBeGreaterThanOrEqual(a[i - 1].nc);
      expect(a[i].nv).toBeGreaterThanOrEqual(a[i - 1].nv);
      expect(a[i].xc).toBeGreaterThanOrEqual(a[i - 1].xc);
      expect(a[i].xv).toBeGreaterThanOrEqual(a[i - 1].xv);
      expect(a[i].nc + a[i].nv).toBe((i + 1) * s.sessionsPerDay);
    }
    expect(a[a.length - 1].kernelStatus).toBe("winner"); // +5pp over 30 days is found essentially always
    expect(a[a.length - 1].kernelP).toBeLessThan(0.05);
    // below the per-arm floor the kernel reports no evidence (p = 1), not a noisy p
    const floored = simulateStream({ ...s, minExposuresPerArm: 100_000 }, mulberry32(11));
    expect(floored.every((d) => d.kernelStatus === "insufficient_data" && d.kernelP === 1)).toBe(true);
    expect(floored.map((d) => [d.nc, d.xc, d.nv, d.xv])).toEqual(a.map((d) => [d.nc, d.xc, d.nv, d.xv])); // same counts, same seed
  });

  it("carries the kernel's REAL verdict: a 60/40 stream is refused, never declared, whatever its p", () => {
    // Codex review of #2336: a raw p on a broken split "declared" runs the
    // kernel refuses. The stream must expose the decision, not a number
    // upstream of it.
    for (let seed = 1; seed <= 5; seed++) {
      const days = simulateStream(CALIBRATION_SCENARIOS.brokenSplit, mulberry32(seed));
      expect(days.some((d) => d.kernelStatus === "winner")).toBe(false);
      expect(days[days.length - 1].kernelStatus).toBe("invalid_design");
      expect(days[days.length - 1].kernelP).toBe(1); // a refusal carries no p
    }
  });
});

describe("reproducibility", () => {
  it("the same scenario, runs and seed give byte-identical reports", () => {
    const a = calibrate(CALIBRATION_SCENARIOS.plus3pp, 60, 42, kernelRule);
    const b = calibrate(CALIBRATION_SCENARIOS.plus3pp, 60, 42, kernelRule);
    expect(a).toEqual(b);
    const c = calibrate(CALIBRATION_SCENARIOS.plus3pp, 60, 43, kernelRule);
    expect(c).not.toEqual(a);
  });
});
