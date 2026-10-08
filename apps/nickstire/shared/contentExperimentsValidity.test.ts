/**
 * Content experiment validity — seeded calibration (2026-10-08).
 *
 * Noise model (an assumption, stated): per-post reach log-normal around ~400,
 * per-post shares-per-reach log-normal around 2% with sigma 0.7. Instagram
 * outcomes swing several-fold post to post; that is what makes "leads by 10%
 * after 4 posts" a coin toss.
 *
 * CONTROL: the rule that shipped before this change, re-stated here, must be
 * fooled often by identical arms — otherwise this harness could not tell a
 * valid rule from an invalid one.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "./experimentKernelCalibration";
import { buildExperimentPreset, evaluateExperiment, permutationP, type ArmObservation } from "./contentExperiments";

const def = buildExperimentPreset("hook_style_v1");

function simulate(rng: () => number, postsPerArm: number, liftFor: Record<string, number> = {}): ArmObservation[] {
  const gauss = () => Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(2 * Math.PI * rng());
  const obs: ArmObservation[] = [];
  for (const arm of def.arms) {
    for (let k = 0; k < postsPerArm; k++) {
      const reach = Math.round(Math.exp(6 + 0.8 * gauss()));
      const rate = Math.exp(Math.log(0.02) + 0.7 * gauss()) * (liftFor[arm.armId] ?? 1);
      obs.push({ armId: arm.armId, mediaId: `${arm.armId}-${k}`, horizonHours: 72, reach, metricValue: Math.round(rate * reach) });
    }
  }
  return obs;
}

/** The pre-2026-10-08 decision: >= 4 posts per arm and a >= 10% lead. */
function legacyWinner(obs: ArmObservation[]): boolean {
  const rates = def.arms.map((a) => {
    const mine = obs.filter((o) => o.armId === a.armId);
    return mine.reduce((s, o) => s + (o.metricValue as number) / (o.reach as number), 0) / mine.length;
  }).sort((x, y) => y - x);
  return rates[1] > 0 && (rates[0] - rates[1]) / rates[1] >= 0.1;
}

const RUNS = 2000;
const rate = (trial: (rng: () => number) => boolean, seed = 7) => {
  const rng = mulberry32(seed);
  let hits = 0;
  for (let i = 0; i < RUNS; i++) if (trial(rng)) hits++;
  return hits / RUNS;
};

describe("A/A — identical arms", () => {
  it("CONTROL: the replaced rule crowns a winner in most runs (measured 85.8% at 4 posts/arm)", () => {
    expect(rate((rng) => legacyWinner(simulate(rng, 4)))).toBeGreaterThan(0.6);
  });

  it("evaluateExperiment now crowns a winner at or under alpha, at 4 and at 8 posts per arm", () => {
    for (const n of [4, 8]) {
      expect(rate((rng) => evaluateExperiment(def, simulate(rng, n), 72).status === "winner")).toBeLessThanOrEqual(0.06);
    }
  });
});

describe("a real difference", () => {
  // Measured 58.1% over 2,000 runs (seed 11). That is the honest power of a
  // 12-post-per-arm test on a doubled share rate under this noise: about half
  // of real effects this large will read as a tie, never as the wrong winner.
  it("a doubled share rate is found about half the time at 12 posts per arm, and never on the wrong arm", () => {
    const [control, variant] = def.arms.map((a) => a.armId);
    let right = 0;
    let wrong = 0;
    const rng = mulberry32(11);
    const runs = 400;
    for (let i = 0; i < runs; i++) {
      const v = evaluateExperiment(def, simulate(rng, 12, { [variant]: 2 }), 72);
      if (v.status === "winner") (v.armId === variant ? right++ : wrong++);
    }
    expect(right / runs).toBeGreaterThanOrEqual(0.45);
    expect(wrong).toBe(0);
    expect(control).not.toBe(variant);
  });
});

describe("permutationP", () => {
  it("is exact on a hand-countable case: perfectly separated 3 v 3 is 2/20", () => {
    expect(permutationP([4, 5, 6], [1, 2, 3])).toBeCloseTo(2 / 20, 12);
  });
  it("identical samples give p = 1", () => {
    expect(permutationP([1, 1, 1], [1, 1, 1])).toBe(1);
  });
  it("is deterministic on the Monte Carlo path (same data, same p)", () => {
    const a = Array.from({ length: 14 }, (_, i) => i * 1.3);
    const b = Array.from({ length: 14 }, (_, i) => i * 1.1 + 2);
    expect(permutationP(a, b)).toBe(permutationP(a, b));
  });
});
