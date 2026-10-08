/**
 * Content experiment validity — seeded calibration (2026-10-08).
 *
 * Noise model (an assumption, stated): per-post reach log-normal around ~400,
 * per-post shares-per-reach log-normal around 2% with sigma 0.7. Instagram
 * outcomes swing several-fold post to post; that is what makes "leads by 10%
 * after 4 posts" a coin toss.
 *
 * The resolver re-evaluates EVERY DAY, so the rule is sequential whether or
 * not it was designed as one: a test that is valid at a single look is fooled
 * by the first lucky day. The shipped rule decides only at the planned looks
 * (DECISION_LOOKS per arm), splits the 5% budget across them, and calls a tie
 * only from the 48-per-arm look. The calibration below therefore walks the
 * daily looks the way the cron does (n = 4 … 100 per arm) and scores the
 * FIRST verdict, which is the one the resolver acts on.
 *
 * CONTROL: the rule that shipped before this change, re-stated here, must be
 * fooled often by identical arms — otherwise this harness could not tell a
 * valid rule from an invalid one.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "./experimentKernelCalibration";
import {
  buildExperimentPreset,
  DECISION_LOOKS,
  evaluateExperiment,
  isDecisionLook,
  nextDecisionLook,
  permutationP,
  type ArmObservation,
} from "./contentExperiments";

const def = buildExperimentPreset("hook_style_v1");
const [control, variant] = def.arms.map((a) => a.armId);
const MAX_PER_ARM = 100;

type Sample = { armId: string; reach: number; value: number };

/** One experiment's worth of posts per arm, drawn up front so every look sees the same history. */
function drawArms(rng: () => number, liftFor: Record<string, number> = {}): Sample[][] {
  const gauss = () => Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(2 * Math.PI * rng());
  return def.arms.map((arm) =>
    Array.from({ length: MAX_PER_ARM }, () => {
      const reach = Math.round(Math.exp(6 + 0.8 * gauss()));
      const rate = Math.exp(Math.log(0.02) + 0.7 * gauss()) * (liftFor[arm.armId] ?? 1);
      return { armId: arm.armId, reach, value: Math.round(rate * reach) };
    }),
  );
}

function observationsAt(arms: Sample[][], perArm: number): ArmObservation[] {
  const out: ArmObservation[] = [];
  for (const arm of arms) {
    for (let k = 0; k < perArm; k++) {
      out.push({ armId: arm[k].armId, mediaId: `${arm[k].armId}-${k}`, horizonHours: 72, reach: arm[k].reach, metricValue: arm[k].value });
    }
  }
  return out;
}

/** The resolver's daily walk: the first winner/tie verdict, or "running" at the budget. */
function firstVerdict(arms: Sample[][]): { status: "winner" | "tie" | "running"; armId?: string; perArm: number } {
  for (let n = 4; n <= MAX_PER_ARM; n++) {
    const v = evaluateExperiment(def, observationsAt(arms, n), 72);
    if (v.status === "winner") return { status: "winner", armId: v.armId, perArm: n };
    if (v.status === "tie") return { status: "tie", perArm: n };
  }
  return { status: "running", perArm: MAX_PER_ARM };
}

/** The pre-2026-10-08 decision: >= 4 posts per arm and a >= 10% lead. */
function legacyWinner(obs: ArmObservation[]): boolean {
  const rates = def.arms.map((a) => {
    const mine = obs.filter((o) => o.armId === a.armId);
    return mine.reduce((s, o) => s + (o.metricValue as number) / (o.reach as number), 0) / mine.length;
  }).sort((x, y) => y - x);
  return rates[1] > 0 && (rates[0] - rates[1]) / rates[1] >= 0.1;
}

function tally(liftFor: Record<string, number>, runs: number, seed: number) {
  const rng = mulberry32(seed);
  const t = { winnerVariant: 0, winnerControl: 0, tie: 0, running: 0, perArmSum: 0 };
  for (let i = 0; i < runs; i++) {
    const r = firstVerdict(drawArms(rng, liftFor));
    if (r.status === "winner") (r.armId === variant ? t.winnerVariant++ : t.winnerControl++);
    else if (r.status === "tie") t.tie++;
    else t.running++;
    t.perArmSum += r.perArm;
  }
  return t;
}

describe("A/A — identical arms, walked daily", () => {
  it("CONTROL: the replaced rule crowns a winner at the first look in most runs (measured 85.8% at 4 posts/arm)", () => {
    const rng = mulberry32(7);
    let hits = 0;
    for (let i = 0; i < 2000; i++) if (legacyWinner(observationsAt(drawArms(rng), 4))) hits++;
    expect(hits / 2000).toBeGreaterThan(0.6);
  });

  // Measured 2026-10-08, 400 runs, seed 7: 3.8% false winner, 69.5% tie,
  // 26.8% still running at 100 per arm, mean first verdict at 73.5 per arm.
  // The budget is 5% across ALL looks — this is the family-wise number, which
  // a per-look-only test could not show.
  it("crowns a false winner in at most 6% of experiments across every look (measured 3.8%)", () => {
    const t = tally({}, 300, 7);
    expect((t.winnerVariant + t.winnerControl) / 300).toBeLessThanOrEqual(0.06);
    // and it resolves: identical arms end as a tie in most runs rather than running forever
    expect(t.tie / 300).toBeGreaterThan(0.5);
  }, 120_000);
});

describe("a real difference, walked daily", () => {
  // Measured 2026-10-08, 400 runs, seed 7: doubled rate 99.8% winner, 0.0%
  // wrong arm, 0.0% tie, mean first verdict at 27.5 per arm; a 1.5x rate
  // 85.0% winner, 2.5% tie, 12.5% still running at 100, mean 61.4 per arm.
  it("a doubled share rate is found in nearly every experiment, never on the wrong arm, inside ~30 posts per arm", () => {
    const t = tally({ [variant]: 2 }, 200, 11);
    expect(t.winnerVariant / 200).toBeGreaterThanOrEqual(0.95);
    expect(t.winnerControl).toBe(0);
    expect(t.perArmSum / 200).toBeLessThan(40);
    expect(control).not.toBe(variant);
  }, 120_000);

  it("a 1.5x share rate is found in most experiments and never on the wrong arm", () => {
    const t = tally({ [variant]: 1.5 }, 200, 13);
    expect(t.winnerVariant / 200).toBeGreaterThanOrEqual(0.7);
    expect(t.winnerControl).toBe(0);
  }, 120_000);
});

describe("decision looks", () => {
  it("are 12, 24, 48, 96 per arm, then every 48", () => {
    expect([...DECISION_LOOKS]).toEqual([12, 24, 48, 96]);
    for (const n of [12, 24, 48, 96, 144, 192]) expect(isDecisionLook(n)).toBe(true);
    for (const n of [4, 8, 11, 13, 23, 47, 95, 97, 120]) expect(isDecisionLook(n)).toBe(false);
    expect(nextDecisionLook(4)).toBe(12);
    expect(nextDecisionLook(12)).toBe(24);
    expect(nextDecisionLook(50)).toBe(96);
    expect(nextDecisionLook(96)).toBe(144);
    expect(nextDecisionLook(150)).toBe(192);
  });

  const obs = (armId: string, values: number[], reach = 1000): ArmObservation[] =>
    values.map((v, k) => ({ armId, mediaId: `${armId}-${k}`, horizonHours: 72, reach, metricValue: v }));
  const spread = (n: number, base: number) => Array.from({ length: n }, (_, i) => base + ((i * 7) % 11) - 5);

  it("between looks the answer is 'not yet', naming the next look — however large the lead", () => {
    const v = evaluateExperiment(def, [...obs(control, [10, 10, 10, 10, 10]), ...obs(variant, [40, 40, 40, 40, 40])], 72);
    expect(v.status).toBe("insufficient_data");
    expect(v).toMatchObject({ needed: 12, have: 5 });
    expect(v.note).toContain("next verdict at 12 per arm");
  });

  it("at the first look, a lead noise could explain is insufficient_data, not tie or winner", () => {
    const v = evaluateExperiment(def, [...obs(control, spread(12, 20)), ...obs(variant, spread(12, 23).reverse())], 72);
    expect(v.status).toBe("insufficient_data");
    expect(v).toMatchObject({ needed: 24, have: 12 });
  });

  it("arms within 10% are a tie only from the 48-per-arm look; at 12 they are 'too close to call yet'", () => {
    const close = (n: number) => [...obs(control, spread(n, 20)), ...obs(variant, spread(n, 21))];
    const early = evaluateExperiment(def, close(12), 72);
    expect(early.status).toBe("insufficient_data");
    expect(early).toMatchObject({ needed: 24, have: 12 });
    expect(early.note).toContain("too close to call");
    const late = evaluateExperiment(def, close(48), 72);
    expect(late.status).toBe("tie");
  });

  it("a decisive, significant lead at a look is a winner", () => {
    const v = evaluateExperiment(def, [...obs(control, spread(12, 20)), ...obs(variant, spread(12, 40))], 72);
    expect(v.status).toBe("winner");
    expect(v).toMatchObject({ armId: variant });
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
  it("equal weights reproduce the unweighted p exactly", () => {
    const a = [4, 5, 6];
    const b = [1, 2, 3];
    expect(permutationP(a, b, [3, 3, 3], [3, 3, 3])).toBe(permutationP(a, b));
  });

  /** Independent oracle: every k-subset, gap between weighted means of the two groups. */
  function bruteForceP(a: number[], b: number[], wa: number[], wb: number[]): number {
    const v = [...a, ...b];
    const w = [...wa, ...wb];
    const n = v.length;
    const k = a.length;
    const mean = (idx: number[]) => idx.reduce((s, i) => s + v[i] * w[i], 0) / idx.reduce((s, i) => s + w[i], 0);
    const all = Array.from({ length: n }, (_, i) => i);
    const gapOf = (idx: number[]) => Math.abs(mean(idx) - mean(all.filter((i) => !idx.includes(i))));
    const observed = gapOf(all.slice(0, k));
    let hits = 0;
    let total = 0;
    const walk = (start: number, chosen: number[]) => {
      if (chosen.length === k) { total++; if (gapOf(chosen) >= observed - 1e-9) hits++; return; }
      for (let i = start; i < n; i++) walk(i + 1, [...chosen, i]);
    };
    walk(0, []);
    return hits / total;
  }

  it("the weighted exact path matches a brute-force enumeration of weighted-mean gaps", () => {
    const cases: Array<[number[], number[], number[], number[]]> = [
      [[0.1, 5, 6], [1, 2, 3], [100_000, 1, 1], [1, 1, 1]],
      [[2.0, 2.1, 0.5, 1.0], [1.0, 1.1, 0.5, 1.0], [1000, 1000, 10, 10], [1000, 1000, 10, 10]],
      [[3, 1, 1, 1], [2, 2, 2, 2], [50, 1, 1, 1], [5, 5, 5, 5]],
    ];
    for (const [a, b, wa, wb] of cases) {
      expect(permutationP(a, b, wa, wb)).toBeCloseTo(bruteForceP(a, b, wa, wb), 12);
    }
    // and the weights change the answer: the first case is 0.4 unweighted, 1 weighted
    // (one post carrying the whole weight makes every relabelling's gap the same).
    expect(permutationP([0.1, 5, 6], [1, 2, 3])).toBeCloseTo(0.4, 12);
    expect(permutationP([0.1, 5, 6], [1, 2, 3], [100_000, 1, 1], [1, 1, 1])).toBe(1);
  });
});

describe("WEIGHTED_AVERAGE metrics: the significance test weighs posts the way the ranking does", () => {
  // avg_watch_time is reach-weighted in armRates (a 3.0 s average off 5,000
  // viewers outweighs 3.4 s off 40). Before 2026-10-08 the permutation test
  // ran on the plain per-post values, so the ranking and its p-value were
  // computed on different quantities: a lead the ranking saw could be judged
  // on posts that barely counted in it.
  //
  // Known limit, stated: with reach weights, one post carrying most of an
  // arm's reach decides that arm's mean, and the permutation null (posts
  // exchangeable) still treats the labelling as 1 of C(24,12). No dominance
  // guard exists yet; it is listed under the ledger row's deferred scope.
  const watch = { ...def, primaryMetric: "avg_watch_time" };
  const obs = (armId: string, posts: Array<[ms: number, reach: number]>): ArmObservation[] =>
    posts.map(([metricValue, reach], k) => ({ armId, mediaId: `${armId}-${k}`, horizonHours: 72, reach, metricValue }));
  // Eight light posts (reach 10) identical in both arms; four heavy posts
  // (reach 1,000) that separate cleanly: 2.0–2.3 s against 1.0–1.3 s.
  const lights: Array<[number, number]> = [[500, 10], [1000, 10], [1500, 10], [2000, 10], [500, 10], [1000, 10], [1500, 10], [2000, 10]];
  const a = obs(variant, [[2000, 1000], [2100, 1000], [2200, 1000], [2300, 1000], ...lights]);
  const b = obs(control, [[1000, 1000], [1100, 1000], [1200, 1000], [1300, 1000], ...lights]);
  const alphaPerLook = 0.05 / DECISION_LOOKS.length;

  it("a lead carried by the posts that carry the weight is a winner at the first look", () => {
    const v = evaluateExperiment(watch, [...a, ...b], 72);
    expect(v.status).toBe("winner");
    expect(v).toMatchObject({ armId: variant });
    // Measured 2026-10-08: weighted p 0.0054, unweighted 0.18 (Monte Carlo, fixed seed).
    expect(permutationP(a.map((o) => o.metricValue as number), b.map((o) => o.metricValue as number), a.map((o) => o.reach as number), b.map((o) => o.reach as number))).toBeLessThanOrEqual(alphaPerLook);
  });

  it("CONTROL: the per-post test the old code ran cannot tell the same arms apart", () => {
    expect(permutationP(a.map((o) => o.metricValue as number), b.map((o) => o.metricValue as number))).toBeGreaterThan(alphaPerLook);
  });
});
