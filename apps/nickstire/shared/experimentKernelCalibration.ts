/**
 * Experiment kernel CALIBRATION — 2026-09-15.
 *
 * The kernel (experimentKernel.ts) promises an always-valid p-value: read
 * daily, P(any day's p <= alpha | no effect) <= alpha. Until today that
 * promise rested on a citation. This module measures it, on this code,
 * with a seeded generator so the numbers are reproducible:
 *
 *   A/A          — both arms convert at the same rate; the fraction of runs
 *                  that EVER declare a winner across daily peeks is the
 *                  any-peek false-positive rate. Must be <= alpha.
 *   injected     — the variant converts at base + delta; the fraction that
 *                  declares the RIGHT arm is power at that traffic.
 *   broken split — a randomiser that sends 60/40 must be refused as
 *                  invalid_design (sample-ratio mismatch), not scored.
 *
 * The OPPONENT: a plain two-proportion z-test peeked daily — the thing the
 * mSPRT exists to replace. Its any-peek false-positive rate is expected to
 * exceed alpha by a wide margin; if it did not, the harness could not tell
 * a valid rule from an invalid one and its green would mean nothing.
 *
 * Pure. No DB, no network, no Math.random — a mulberry32 stream from a seed.
 */
import { evaluateWebExperiment, mSprt, type ArmMetricCounts, type WebExperimentDefinition, type WebExperimentVerdict } from "./experimentKernel";

/** Small, fast, seedable PRNG (mulberry32). Deterministic per seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CalibrationScenario {
  name: string;
  /** True conversion rate of the control arm. */
  controlRate: number;
  /** True conversion rate of the variant arm (== controlRate for A/A). */
  variantRate: number;
  /** New exposed sessions per simulated day, across both arms. */
  sessionsPerDay: number;
  /** Daily peeks. */
  days: number;
  /** Probability a session lands in control (0.5 = the intended split). */
  controlShare?: number;
  alpha?: number;
  tau?: number;
  minExposuresPerArm?: number;
  /** SRM alarm settings under test (kernel defaults when omitted). */
  srmMinTotal?: number;
  srmAlpha?: number;
}

/** The evaluation settings a decision rule receives, resolved from the scenario. */
export interface EvalSettings {
  alpha: number;
  tau: number;
  minExposuresPerArm: number;
  srmMinTotal?: number;
  srmAlpha?: number;
}

export interface CalibrationRun {
  /** First day a winner was declared, or null if never. */
  declaredDay: number | null;
  /** Verdict on the last day (or the day the run stopped). */
  finalStatus: WebExperimentVerdict["status"];
  /** Whether the declared winner is the truly better arm; null if none declared or A/A. */
  declaredCorrect: boolean | null;
  /** Whether any day refused the design (sample-ratio mismatch or confound). */
  refusedDesign: boolean;
  finalExposuresPerArm: number;
}

export interface CalibrationReport {
  scenario: string;
  runs: number;
  seed: number;
  /** Fraction of runs that declared a winner on ANY day. */
  anyPeekDeclareRate: number;
  /** Fraction of runs whose declared winner was the truly better arm (injected effect only). */
  correctDeclareRate: number;
  /** Fraction of runs that declared the WRONG arm. In A/A this equals anyPeekDeclareRate (every declaration is wrong). */
  wrongDeclareRate: number;
  /** Fraction of runs refused as invalid_design on some day. */
  refusedDesignRate: number;
  /** Median day of declaration among runs that declared; null if none. */
  medianDeclaredDay: number | null;
  meanFinalExposuresPerArm: number;
}

const DEF: WebExperimentDefinition = {
  experimentId: "calibration",
  primaryVariable: "subline",
  primaryMetric: "converted",
  guardrails: [],
  surfaces: ["/"],
  preregisteredAt: "2026-09-15T00:00:00.000Z",
  arms: [
    { armId: "control", variantValue: "a", subline: "one" },
    { armId: "variant", variantValue: "b", subline: "two" },
  ],
};

/** A decision rule: given cumulative counts, does it declare a winner, and which arm? */
export type DecisionRule = (control: ArmMetricCounts, variant: ArmMetricCounts, s: EvalSettings) =>
  | { declared: false; status: WebExperimentVerdict["status"] }
  | { declared: true; winnerArmId: string; status: "winner" };

/** THE KERNEL under test, unchanged: evaluateWebExperiment with the real refusals. */
export const kernelRule: DecisionRule = (control, variant, s) => {
  const v = evaluateWebExperiment(DEF, [control, variant], {
    alpha: s.alpha,
    tau: s.tau,
    minExposuresPerArm: s.minExposuresPerArm,
    srmMinTotal: s.srmMinTotal,
    srmAlpha: s.srmAlpha,
  });
  if (v.status === "winner") return { declared: true, winnerArmId: v.armId, status: "winner" };
  return { declared: false, status: v.status };
};

/** erf via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7) — adequate for p-value comparisons. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** P(Z > z) for a standard normal. */
function normalSurvival(z: number): number {
  return 0.5 * (1 - erf(z / Math.SQRT2));
}

/**
 * THE OPPONENT: a fixed-horizon two-proportion z-test, peeked daily, with the
 * same floor. Valid at ONE pre-chosen horizon; every extra peek inflates its
 * false-positive rate. Not for production — it exists so the harness has a
 * known-invalid rule to distinguish the kernel from.
 */
export const naivePeekingZRule: DecisionRule = (control, variant, s) => {
  const nc = control.exposures;
  const nv = variant.exposures;
  if (Math.min(nc, nv) < s.minExposuresPerArm) return { declared: false, status: "insufficient_data" };
  const xc = control.conversions.converted ?? 0;
  const xv = variant.conversions.converted ?? 0;
  const pc = xc / nc;
  const pv = xv / nv;
  const pooled = (xc + xv) / (nc + nv);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nc + 1 / nv));
  if (!(se > 0)) return { declared: false, status: "no_signal" };
  const z = (pv - pc) / se;
  const pTwoSided = 2 * normalSurvival(Math.abs(z));
  if (pTwoSided < s.alpha) return { declared: true, winnerArmId: z > 0 ? "variant" : "control", status: "winner" };
  return { declared: false, status: "keep_running" };
};

export function simulateOne(scenario: CalibrationScenario, rng: () => number, rule: DecisionRule = kernelRule): CalibrationRun {
  const s: EvalSettings = {
    alpha: scenario.alpha ?? 0.05,
    tau: scenario.tau ?? 0.02,
    minExposuresPerArm: scenario.minExposuresPerArm ?? 50,
    srmMinTotal: scenario.srmMinTotal,
    srmAlpha: scenario.srmAlpha,
  };
  const controlShare = scenario.controlShare ?? 0.5;
  const control: ArmMetricCounts = { armId: "control", exposures: 0, conversions: { converted: 0 } };
  const variant: ArmMetricCounts = { armId: "variant", exposures: 0, conversions: { converted: 0 } };
  const trulyBetter = scenario.variantRate > scenario.controlRate ? "variant" : scenario.variantRate < scenario.controlRate ? "control" : null;
  let declaredDay: number | null = null;
  let declaredCorrect: boolean | null = null;
  let refusedDesign = false;
  let finalStatus: WebExperimentVerdict["status"] = "insufficient_data";

  for (let day = 1; day <= scenario.days; day++) {
    for (let i = 0; i < scenario.sessionsPerDay; i++) {
      const arm = rng() < controlShare ? control : variant;
      arm.exposures += 1;
      const rate = arm === control ? scenario.controlRate : scenario.variantRate;
      if (rng() < rate) arm.conversions.converted = (arm.conversions.converted ?? 0) + 1;
    }
    const d = rule(control, variant, s);
    finalStatus = d.status;
    if (d.status === "invalid_design") refusedDesign = true;
    if (d.declared) {
      declaredDay = day;
      declaredCorrect = trulyBetter === null ? null : d.winnerArmId === trulyBetter;
      break; // the resolver proposes and the experiment ends
    }
  }
  return { declaredDay, finalStatus, declaredCorrect, refusedDesign, finalExposuresPerArm: Math.min(control.exposures, variant.exposures) };
}

/** One day's cumulative counts plus the kernel's always-valid p on that day. */
export interface DailySnapshot {
  day: number;
  nc: number;
  xc: number;
  nv: number;
  xv: number;
  /** mSprt p-value on the cumulative counts (1 when below the per-arm floor). */
  kernelP: number;
}

/**
 * The full daily stream of ONE run, never stopped early: an external engine
 * (GrowthBook's gbstats, see scripts/proof/growthbook-crosscheck.py) can be
 * fed exactly the counts the kernel saw and apply its own stopping rule, so
 * the two engines are compared on identical data rather than on two
 * different simulations that merely share a seed.
 */
export function simulateStream(scenario: CalibrationScenario, rng: () => number): DailySnapshot[] {
  const tau = scenario.tau ?? 0.02;
  const floor = scenario.minExposuresPerArm ?? 50;
  const controlShare = scenario.controlShare ?? 0.5;
  let nc = 0;
  let xc = 0;
  let nv = 0;
  let xv = 0;
  const out: DailySnapshot[] = [];
  for (let day = 1; day <= scenario.days; day++) {
    for (let i = 0; i < scenario.sessionsPerDay; i++) {
      if (rng() < controlShare) {
        nc += 1;
        if (rng() < scenario.controlRate) xc += 1;
      } else {
        nv += 1;
        if (rng() < scenario.variantRate) xv += 1;
      }
    }
    const kernelP =
      Math.min(nc, nv) < floor ? 1 : mSprt({ exposures: nc, conversions: xc }, { exposures: nv, conversions: xv }, { tau }).pValue;
    out.push({ day, nc, xc, nv, xv, kernelP });
  }
  return out;
}

export function calibrate(scenario: CalibrationScenario, runs: number, seed = 20260915, rule: DecisionRule = kernelRule): CalibrationReport {
  const rng = mulberry32(seed);
  const results: CalibrationRun[] = [];
  for (let r = 0; r < runs; r++) results.push(simulateOne(scenario, rng, rule));
  const declared = results.filter((x) => x.declaredDay !== null);
  const aa = scenario.controlRate === scenario.variantRate;
  const correct = declared.filter((x) => x.declaredCorrect === true).length;
  const wrong = aa ? declared.length : declared.filter((x) => x.declaredCorrect === false).length;
  const days = declared.map((x) => x.declaredDay as number).sort((a, b) => a - b);
  return {
    scenario: scenario.name,
    runs,
    seed,
    anyPeekDeclareRate: declared.length / runs,
    correctDeclareRate: correct / runs,
    wrongDeclareRate: wrong / runs,
    refusedDesignRate: results.filter((x) => x.refusedDesign).length / runs,
    medianDeclaredDay: days.length ? days[Math.floor(days.length / 2)] : null,
    meanFinalExposuresPerArm: results.reduce((a, x) => a + x.finalExposuresPerArm, 0) / runs,
  };
}

/** The scenarios the ledger row cites. Traffic is sized to nickstire.org (~100 exposed sessions/day). */
export const CALIBRATION_SCENARIOS: Record<string, CalibrationScenario> = {
  aa5: { name: "A/A at 5%", controlRate: 0.05, variantRate: 0.05, sessionsPerDay: 100, days: 30 },
  aa5Long: { name: "A/A at 5%, 90 daily peeks", controlRate: 0.05, variantRate: 0.05, sessionsPerDay: 100, days: 90 },
  plus2pp: { name: "+2pp at base 5%", controlRate: 0.05, variantRate: 0.07, sessionsPerDay: 100, days: 30 },
  plus3pp: { name: "+3pp at base 5%", controlRate: 0.05, variantRate: 0.08, sessionsPerDay: 100, days: 30 },
  plus5pp: { name: "+5pp at base 5%", controlRate: 0.05, variantRate: 0.1, sessionsPerDay: 100, days: 30 },
  brokenSplit: { name: "A/A with a 60/40 randomiser", controlRate: 0.05, variantRate: 0.05, sessionsPerDay: 100, days: 30, controlShare: 0.6 },
};
