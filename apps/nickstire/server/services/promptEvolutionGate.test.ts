/**
 * Holdout gate · calibration + doctrine.
 *
 * The calibration half follows shared/experimentKernelCalibration.ts: seeded
 * simulated replays, the rule under test against the rule it replaced. The
 * replaced rule (`candidate passRate > baseline passRate`, one replay) is kept
 * here as the CONTROL — if the harness could not show it failing, the new
 * rule's green would mean nothing.
 *
 * Noise model, from CURRENT-TRUTH ("deepseek stays +/-1-2 seeds
 * nondeterministic even at temperature 0"): of the holdout seeds, 30% the
 * served prompt always fails, 30% it always passes, 40% are coin flips.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "@shared/experimentKernelCalibration";
import { describeVerdict, judgeHoldout, toSeedTrials, type SeedTrials } from "./promptEvolutionGate";

type Rng = () => number;

/** Plain one-sided sign test, P(X >= k | Bin(n, 1/2)) — the CONTROL rule only. */
function signTestP(k: number, n: number): number {
  if (n <= 0 || k <= 0) return 1;
  let tail = 0;
  let c = 1;
  for (let i = 0; i <= n; i++) {
    if (i >= k) tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return tail / 2 ** n;
}

/** True per-seed pass probabilities for the served prompt. */
function seedProbs(n: number, rng: Rng): number[] {
  return Array.from({ length: n }, () => {
    const u = rng();
    return u < 0.3 ? 0 : u < 0.6 ? 1 : 0.5;
  });
}

function replay(probs: number[], repeats: number, rng: Rng): SeedTrials[] {
  return probs.map((p, i) => ({
    id: `s${i}`,
    passes: Array.from({ length: repeats }, () => rng() < p),
    unresolvable: false,
  }));
}

/** The rule this gate replaced, verbatim in effect: one replay, strict >. */
function legacyAccepts(base: SeedTrials[], cand: SeedTrials[]): boolean {
  const passes = (t: SeedTrials[]) => t.filter((s) => s.passes[0]).length;
  return passes(cand) > passes(base);
}

function rate(runs: number, trial: (rng: Rng) => boolean, seed = 20261008): number {
  const rng = mulberry32(seed);
  let hits = 0;
  for (let i = 0; i < runs; i++) if (trial(rng)) hits++;
  return hits / runs;
}

const RUNS = 4000;

describe("calibration — identical prompts (A/A)", () => {
  it("CONTROL: the replaced rule proposes noise in a large share of runs at its real size (~5 holdout seeds, 1 replay)", () => {
    const fp = rate(RUNS, (rng) => {
      const probs = seedProbs(5, rng);
      return legacyAccepts(replay(probs, 1, rng), replay(probs, 1, rng));
    });
    // If this ever drops near alpha the simulation can no longer tell the
    // rules apart, and the assertion below proves nothing.
    expect(fp).toBeGreaterThan(0.2);
  });

  it("the gate holds false acceptance at or under alpha (12 seeds, 3 replays) — measured 0.7% at seed 99", () => {
    const fp = rate(RUNS, (rng) => {
      const probs = seedProbs(12, rng);
      return judgeHoldout(replay(probs, 3, rng), replay(probs, 3, rng)).accept;
    });
    expect(fp).toBeLessThanOrEqual(0.05);
  });

  it("pins the underpowered boundary: 5 comparable seeds can still reach alpha, 4 cannot", () => {
    const rng = mulberry32(7);
    const probs = seedProbs(5, rng);
    const v = judgeHoldout(replay(probs, 3, rng), replay(probs, 3, rng));
    // 5 seeds: a clean sweep is p = 1/32 < 0.05, so it is NOT underpowered;
    // 4 seeds (1/16) is. Pin the boundary exactly.
    expect(v.bestPossibleP).toBeCloseTo(1 / 32);
    const four = judgeHoldout(replay(probs.slice(0, 4), 3, rng), replay(probs.slice(0, 4), 3, rng));
    expect(four.reason).toBe("underpowered");
    expect(four.accept).toBe(false);
  });
});

describe("calibration — a real improvement", () => {
  // Exactly `fix` seeds the served prompt always fails and the candidate
  // passes 90% of the time; the rest drawn from the noise model. (The first
  // draft of this test drew the failing seeds at random and counted every run
  // that drew too few as a PASS — at 12 seeds that was most runs, so its
  // ">= 80%" was measuring the escape hatch, not the gate. Caught by
  // re-measuring outside the test before shipping.)
  const power = (n: number, fix: number) =>
    rate(RUNS, (rng) => {
      const probs = [...Array(fix).fill(0), ...seedProbs(n - fix, rng)];
      const candProbs = probs.map((p, i) => (i < fix ? 0.9 : p));
      return judgeHoldout(replay(probs, 3, rng), replay(candProbs, 3, rng)).accept;
    });

  it("accepts a candidate that fixes five always-failing calls in most runs (12 seeds, 3 replays) — measured 82% at seed 99", () => {
    expect(power(12, 5)).toBeGreaterThanOrEqual(0.75);
  });

  it("CONTROL: a plain sign test (direction only) loses most of that power — magnitude is the signal", () => {
    const signOnly = rate(RUNS, (rng) => {
      const probs = [...Array(5).fill(0), ...seedProbs(7, rng)];
      const candProbs = probs.map((p, i) => (i < 5 ? 0.9 : p));
      const b = replay(probs, 3, rng);
      const c = replay(candProbs, 3, rng);
      const d = b.map((s, i) => Math.sign(c[i].passes.filter(Boolean).length - s.passes.filter(Boolean).length));
      return signTestP(d.filter((x) => x > 0).length, d.filter((x) => x !== 0).length) <= 0.05;
    });
    expect(signOnly).toBeLessThan(power(12, 5) - 0.2);
  });
});

describe("refusals", () => {
  const t = (id: string, passes: boolean[], unresolvable = false): SeedTrials => ({ id, passes, unresolvable });
  const Y = [true, true, true];
  const N = [false, false, false];

  it("vetoes a candidate that reliably breaks a call the served prompt reliably handles, however many it fixes", () => {
    const base = [t("keep", Y), ...Array.from({ length: 8 }, (_, i) => t(`f${i}`, N))];
    const cand = [t("keep", N), ...Array.from({ length: 8 }, (_, i) => t(`f${i}`, Y))];
    const v = judgeHoldout(base, cand);
    expect(v.improved).toBe(8);
    expect(v.reason).toBe("regressed-seed");
    expect(v.regressedSeeds).toEqual(["keep"]);
    expect(v.accept).toBe(false);
  });

  it("a candidate cannot shrink its denominator: its own 'unresolvable' loss still counts as a loss", () => {
    const base = Array.from({ length: 6 }, (_, i) => t(`s${i}`, i === 0 ? Y : N));
    const cand = Array.from({ length: 6 }, (_, i) => (i === 0 ? t("s0", N, true) : t(`s${i}`, Y)));
    const v = judgeHoldout(base, cand);
    expect(v.comparable).toBe(6);
    expect(v.worsened).toBe(1);
    expect(v.reason).toBe("regressed-seed");
  });

  it("a seed the BASELINE's judge ruled unwinnable leaves the comparison for both arms", () => {
    const base = [t("gone", N, true), ...Array.from({ length: 5 }, (_, i) => t(`s${i}`, N))];
    const cand = [t("gone", Y), ...Array.from({ length: 5 }, (_, i) => t(`s${i}`, Y))];
    const v = judgeHoldout(base, cand);
    expect(v.comparable).toBe(5);
    expect(v.improved).toBe(5);
    expect(v.accept).toBe(true);
  });

  it("no difference at all is not-significant with p = 1, never an acceptance", () => {
    const same = Array.from({ length: 8 }, (_, i) => t(`s${i}`, i % 2 ? Y : N));
    const v = judgeHoldout(same, same);
    expect(v).toMatchObject({ accept: false, reason: "not-significant", pValue: 1, tied: 8 });
  });
});

describe("permutation p (through judgeHoldout)", () => {
  // Three replays per arm, so a seed's difference is (cand - base) passes in
  // units of 1/3: 0/3 -> 3/3 weighs 3, 0/3 -> 1/3 weighs 1.
  const seed = (id: string, base: number, cand: number) => ({
    b: { id, passes: [0, 1, 2].map((i) => i < base), unresolvable: false },
    c: { id, passes: [0, 1, 2].map((i) => i < cand), unresolvable: false },
  });
  const p = (...seeds: Array<ReturnType<typeof seed>>) =>
    judgeHoldout(seeds.map((s) => s.b), seeds.map((s) => s.c)).pValue;

  it("is exact on hand-countable cases", () => {
    expect(p(...[0, 1, 2, 3, 4].map((i) => seed(`s${i}`, 0, 1)))).toBeCloseTo(1 / 32, 12); // only all-plus reaches 5
    expect(p(seed("a", 0, 3), seed("b", 0, 1))).toBeCloseTo(1 / 4, 12); // weights {3,1}: only {+3,+1}
    expect(p(seed("a", 0, 3), seed("b", 1, 0))).toBeCloseTo(2 / 4, 12); // {3,-1}: {+3+1}, {+3-1}
    expect(p(seed("a", 2, 2), seed("b", 1, 1))).toBe(1);
    expect(p(seed("a", 3, 1), seed("b", 2, 1))).toBe(1);
  });

  it("ignores ties: an unchanged seed neither helps nor dilutes", () => {
    const moved = [0, 1, 2].map((i) => seed(`m${i}`, 0, 1));
    const still = [0, 1, 2].map((i) => seed(`t${i}`, 1, 1));
    expect(p(...moved, ...still)).toBeCloseTo(p(...moved), 12);
  });
});

describe("toSeedTrials", () => {
  it("folds repeated scorings into per-seed trials and counts an unresolvable replay as no pass", () => {
    const run = (pass: boolean, unresolvable = false) => ({
      grades: [{ id: "a", pass, ...(unresolvable ? { unresolvable } : {}) }],
    });
    expect(toSeedTrials([run(true), run(false), run(true, true)])).toEqual([
      { id: "a", passes: [true, false, false], unresolvable: true },
    ]);
  });
});

describe("describeVerdict", () => {
  it("names the reason, the seed counts and the p-value in one line", () => {
    const line = describeVerdict(judgeHoldout(
      Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, passes: [false], unresolvable: false })),
      Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, passes: [true], unresolvable: false })),
    ));
    expect(line).toContain("improved");
    expect(line).toContain("+6 -0 =0 of 6");
    expect(line).toContain("p=0.016");
  });
});
