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
import {
  comparePairedTrain,
  describeSuccessVerdict,
  describeVerdict,
  judgeConfirmation,
  judgeHoldout,
  judgeSuccessCohort,
  minSeedsForAlpha,
  toSeedTrials,
  toSuccessTrials,
  type SeedTrials,
} from "./promptEvolutionGate";

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
    evaluatorUnavailable: false,
    violations: Array(repeats).fill(false),
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

  it("minSeedsForAlpha is the smallest n with 2^-n <= alpha, and the gate's underpowered line sits exactly there", () => {
    expect([0.05, 0.025, 0.01, 1 / 32, 0.5, 1].map(minSeedsForAlpha)).toEqual([5, 6, 7, 5, 1, 0]);
    expect(minSeedsForAlpha(0)).toBe(Number.POSITIVE_INFINITY);
    for (const alpha of [0.05, 0.01]) {
      const n = minSeedsForAlpha(alpha);
      const sweep = (k: number) =>
        judgeHoldout(
          Array.from({ length: k }, (_, i) => tr(`s${i}`, "000")),
          Array.from({ length: k }, (_, i) => tr(`s${i}`, "111")),
          { alpha },
        ).reason;
      expect(sweep(n)).toBe("improved");
      expect(sweep(n - 1)).toBe("underpowered");
    }
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
  const t = (id: string, passes: boolean[], unresolvable = false): SeedTrials => ({
    id, passes, unresolvable, evaluatorUnavailable: false, violations: passes.map(() => false),
  });
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
  const arm = (id: string, k: number): SeedTrials => ({
    id, passes: [0, 1, 2].map((i) => i < k), unresolvable: false, evaluatorUnavailable: false, violations: [false, false, false],
  });
  const seed = (id: string, base: number, cand: number) => ({ b: arm(id, base), c: arm(id, cand) });
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
  // 2026-10-09: the folded trial also carries evaluatorUnavailable and a
  // per-replay violation flag (brief B4). The pass/unresolvable folding this
  // test pinned before is unchanged.
  it("folds repeated scorings into per-seed trials and counts an unresolvable replay as no pass", () => {
    const run = (pass: boolean, unresolvable = false) => ({
      grades: [{ id: "a", pass, ...(unresolvable ? { unresolvable } : {}) }],
    });
    expect(toSeedTrials([run(true), run(false), run(true, true)])).toEqual([
      {
        id: "a",
        passes: [true, false, false],
        unresolvable: true,
        evaluatorUnavailable: false,
        unverified: [false, false, false],
        violations: [false, false, false],
      },
    ]);
  });

  it("marks a seed evaluator-unavailable when ANY replay's judge was down, and records WHICH replay", () => {
    const [a] = toSeedTrials([
      { grades: [{ id: "a", pass: true }] },
      { grades: [{ id: "a", pass: true, judgeUnavailable: true }] },
      { grades: [{ id: "a", pass: false }] },
    ]);
    expect(a.evaluatorUnavailable).toBe(true);
    expect(a.unverified).toEqual([false, true, false]);
    const [clean] = toSeedTrials([{ grades: [{ id: "a", pass: true, judgeUnavailable: false }] }]);
    expect(clean.evaluatorUnavailable).toBe(false);
    expect(clean.unverified).toEqual([false]);
  });

  it("flags each replay that carried any critical violation -- each class alone is enough", () => {
    const g = (extra: object) => ({ grades: [{ id: "a", pass: false, priceLeaks: 0, guarantees: 0, emptyReplies: 0, claimViolations: [], ...extra }] });
    const [a] = toSeedTrials([
      g({}),
      g({ priceLeaks: 1 }),
      g({ guarantees: 2 }),
      g({ emptyReplies: 1 }),
      g({ claimViolations: ["wait_time_estimate"] }),
    ]);
    expect(a.violations).toEqual([false, true, true, true, true]);
  });
});

// -- 2026-10-09: evaluator outage, paired train, success cohort, confirmation --

type Grade = { id: string; pass: boolean; unresolvable?: boolean; judgeUnavailable?: boolean; guarantees?: number };

/**
 * Hand-built trials: passes as a 0/1 string ("110"), optional flags.
 *   down -- seed-level flag only (no per-replay array): the gate must read
 *           every replay of the seed as unverified;
 *   unv  -- per-replay flags as a 0/1 string ("010" = only replay 2 was graded
 *           with the judge down); sets the seed-level flag when any is 1.
 */
function tr(id: string, bits: string, o: { down?: boolean; unv?: string; unresolvable?: boolean; viol?: string } = {}): SeedTrials {
  const unverified = o.unv === undefined ? undefined : [...o.unv].map((b) => b === "1");
  return {
    id,
    passes: [...bits].map((b) => b === "1"),
    unresolvable: o.unresolvable ?? false,
    evaluatorUnavailable: (o.down ?? false) || Boolean(unverified?.some(Boolean)),
    ...(unverified ? { unverified } : {}),
    violations: [...(o.viol ?? "0".repeat(bits.length))].map((b) => b === "1"),
  };
}

/**
 * Outage model: each replay of an arm hits an outage episode with probability
 * `episode`; inside one, each seed's grade is judge-unavailable with
 * probability `perSeed` (recorded per replay, as toSeedTrials does), and an
 * unavailable grade is the bare regex verdict, forced to `outageBit`:
 *   false -- a regex MISS the judge would have rescued (the D3 asymmetry);
 *   true  -- a regex HIT the judge would have ruled "deflected" (verifyHits,
 *            ghostReplay.ts): an unverified PASS. In the candidate arm this is
 *            the direction that inflates the candidate; a forced FAIL there only
 *            ever hurts it, so it cannot show a candidate-arm defect (review
 *            finding, 2026-10-09: the first cut's candidate-arm test used it and
 *            passed on a mutant that ignored candidate-arm outages).
 */
function replayWithOutage(probs: number[], repeats: number, rng: Rng, episode: number, perSeed: number, outageBit = false): SeedTrials[] {
  const trials = probs.map((_, i) => ({ ...tr(`s${i}`, ""), unverified: [] as boolean[] }));
  for (let r = 0; r < repeats; r++) {
    const inEpisode = rng() < episode;
    probs.forEach((p, i) => {
      const down = inEpisode && rng() < perSeed;
      const pass = rng() < p;
      trials[i].passes.push(down ? outageBit : pass);
      trials[i].unverified.push(down);
      trials[i].violations.push(false);
      trials[i].evaluatorUnavailable ||= down;
    });
  }
  return trials;
}
/** What the gate saw before 2026-10-09: the same pass bits, no outage flag. */
const blind = (t: SeedTrials[]): SeedTrials[] => t.map((s) => ({ ...s, evaluatorUnavailable: false, unverified: undefined }));
/**
 * The FIRST CUT of the outage rule, kept as a CONTROL: drop every outage seed
 * from both arms and judge the survivors. It hides a loss that lands on an
 * outage seed -- the defect the one-sided rule fixes.
 */
const dropOutageSeeds = (b: SeedTrials[], c: SeedTrials[]) => {
  const down = new Set([...b, ...c].filter((s) => s.evaluatorUnavailable).map((s) => s.id));
  const keep = (t: SeedTrials[]) => t.filter((s) => !down.has(s.id));
  return [keep(b), keep(c)] as const;
};
/** Set the outage flag on `ids` in one arm, pass bits untouched. */
const flag = (t: SeedTrials[], ids: ReadonlySet<string>) => t.map((s) => (ids.has(s.id) ? { ...s, evaluatorUnavailable: true } : s));

describe("evaluator outage - calibration (A/A, judge outages in ONE arm only)", () => {
  // 20 holdout seeds, 3 replays; half the replays hit an outage episode that
  // takes out 30% of seeds. Measured at seed 20261008 (this file's default):
  // see the numbers in each title. The price is refusals -- 68% of these A/A
  // runs read "evaluator-unavailable" (67.7% baseline arm, 68.8% candidate
  // arm, after the round-2 worst-case view) -- which is the honest answer to
  // an evaluator that was down that often.
  const OUT = { n: 20, episode: 0.5, perSeed: 0.3 };

  it("CONTROL: a gate blind to the flag accepts identical prompts far above alpha when the BASELINE's judge drops out -- measured 25.2%", () => {
    const fp = rate(RUNS, (rng) => {
      const probs = seedProbs(OUT.n, rng);
      return judgeHoldout(blind(replayWithOutage(probs, 3, rng, OUT.episode, OUT.perSeed)), replay(probs, 3, rng)).accept;
    });
    // If this ever falls near alpha, the simulation no longer exercises the
    // outage and the two assertions below prove nothing.
    expect(fp).toBeGreaterThan(0.15);
  });

  it("baseline-arm outages (regex misses): acceptance stays <= alpha + 0.01 -- measured 0.10%", () => {
    const fp = rate(RUNS, (rng) => {
      const probs = seedProbs(OUT.n, rng);
      return judgeHoldout(replayWithOutage(probs, 3, rng, OUT.episode, OUT.perSeed), replay(probs, 3, rng)).accept;
    });
    expect(fp).toBeLessThanOrEqual(0.06);
  });

  it("CONTROL: a gate blind to the flag accepts identical prompts far above alpha when the CANDIDATE's outage replays are unverified passes -- measured 26.25%", () => {
    const fp = rate(RUNS, (rng) => {
      const probs = seedProbs(OUT.n, rng);
      return judgeHoldout(replay(probs, 3, rng), blind(replayWithOutage(probs, 3, rng, OUT.episode, OUT.perSeed, true))).accept;
    });
    expect(fp).toBeGreaterThan(0.15);
  });

  it("candidate-arm outages (unverified passes): acceptance stays <= alpha + 0.01 -- measured 0.22%", () => {
    const fp = rate(RUNS, (rng) => {
      const probs = seedProbs(OUT.n, rng);
      return judgeHoldout(replay(probs, 3, rng), replayWithOutage(probs, 3, rng, OUT.episode, OUT.perSeed, true)).accept;
    });
    expect(fp).toBeLessThanOrEqual(0.06);
  });

  it("DOCUMENTED COST: power under candidate-arm outages (fix 5 of 12, unverified passes) -- measured 83.0% with no outage, 68.7% at episode 0.2/perSeed 0.1, 17.1% at 0.5/0.3", () => {
    // Not a bug, a policy: an unverified candidate pass never counts for the
    // candidate, so outages cost real winners. Pinned so the price cannot drift
    // silently in either direction.
    const power = (episode: number, perSeed: number) =>
      rate(RUNS, (rng) => {
        const probs = [...Array(5).fill(0), ...seedProbs(7, rng)];
        const candProbs = probs.map((p, i) => (i < 5 ? 0.9 : p));
        return judgeHoldout(replay(probs, 3, rng), replayWithOutage(candProbs, 3, rng, episode, perSeed, true)).accept;
      });
    const mild = power(0.2, 0.1);
    expect(mild).toBeGreaterThan(0.6);
    expect(mild).toBeLessThan(0.78);
    expect(power(0.5, 0.3)).toBeLessThan(0.3);
  });

  // Two outage models for the candidate's broken seed: a regex MISS (false)
  // and an unverified regex HIT (true). The second is the round-2 review
  // finding: the judge would have failed the reply, the regex passed it.
  it.each([
    [false, "regex misses"],
    [true, "unverified hits"],
  ])("a candidate that reliably breaks one won call (and fixes 5) is never accepted, however its judge drops out (outage bit %s: %s) -- 0 of 4000", (outageBit) => {
    // Reviewer's Monte Carlo (2026-10-09): candidate-arm outages hid the
    // broken seed in ~38% of runs; the first cut then judged the survivors
    // (7.25% accepted), and the second read the outage seed's raw bits, so an
    // unverified hit on it was accepted in 0.70% of runs (reviewer's probe).
    let dropAccepts = 0;
    let blindAccepts = 0;
    const accepts = rate(RUNS, (rng) => {
      const probs = [1, ...Array(5).fill(0), ...seedProbs(OUT.n - 6, rng)];
      const candProbs = probs.map((p, i) => (i === 0 ? 0 : i < 6 ? 0.9 : p));
      const b = replay(probs, 3, rng);
      const c = replayWithOutage(candProbs, 3, rng, OUT.episode, OUT.perSeed, outageBit);
      if (judgeHoldout(...dropOutageSeeds(b, c)).accept) dropAccepts++;
      if (judgeHoldout(b, blind(c)).accept) blindAccepts++;
      return judgeHoldout(b, c).accept;
    });
    // The instrument sees the defect: the first cut's drop rule accepts this input.
    expect(dropAccepts / RUNS).toBeGreaterThan(0.03);
    // With unverified hits the bits themselves lie: a gate reading them at face value accepts too.
    if (outageBit) expect(blindAccepts).toBeGreaterThan(0);
    expect(accepts).toBe(0);
  });

  it("an unverified replay never creates a winner: each flagged replay rewritten to its most misleading regex verdict (1 in the candidate arm, 0 in the baseline arm) -- accepted => the judged truth accepts", () => {
    // Round-2 review finding: the previous version of this property set the
    // flag with the bits UNCHANGED, so it could not see an unverified regex hit
    // standing in for a judged fail. Here the judged replays are the truth and
    // the outage REWRITES the flagged replays -- including on seeds the judged
    // gate calls regressed. Checked twice: with per-replay flags (what
    // toSeedTrials emits) and with the seed-level flag alone (the stricter
    // fallback, which must never accept what the per-replay reading refuses).
    const rng = mulberry32(31337);
    let flaggedRegressions = 0;
    let flaggedAccepts = 0;
    let seedLevelAccepts = 0;
    let rawReaderViolations = 0;
    let dropViolations = 0;
    for (let run = 0; run < 3000; run++) {
      const n = 6 + Math.floor(rng() * 14);
      const probs = seedProbs(n, rng);
      // Real improvements, and sometimes a reliable regression on an always-won call.
      const candProbs = probs.map((p) => (p === 1 && rng() < 0.08 ? 0 : rng() < 0.3 ? 0.9 : p));
      const base = replay(probs, 3, rng);
      const cand = replay(candProbs, 3, rng);
      const judged = judgeHoldout(base, cand);
      const ids = new Set(base.filter(() => rng() < 0.15).map((s) => s.id));
      for (const id of judged.regressedSeeds) if (rng() < 0.7) ids.add(id);
      const outage = (t: SeedTrials[], regexBit: boolean): SeedTrials[] =>
        t.map((s) => {
          if (!ids.has(s.id)) return s;
          const unverified = s.passes.map(() => rng() < 0.5);
          if (!unverified.some(Boolean)) unverified[Math.floor(rng() * unverified.length)] = true;
          return { ...s, passes: s.passes.map((p, i) => (unverified[i] ? regexBit : p)), evaluatorUnavailable: true, unverified };
        });
      const inBase = rng() < 0.5;
      const fb = inBase ? outage(base, false) : base;
      const fc = inBase ? cand : outage(cand, true);
      const v = judgeHoldout(fb, fc);
      if (v.accept) {
        flaggedAccepts++;
        expect(judged.accept).toBe(true);
      }
      const seedLevel = (t: SeedTrials[]): SeedTrials[] => t.map((s) => ({ ...s, unverified: undefined }));
      if (judgeHoldout(seedLevel(fb), seedLevel(fc)).accept) {
        seedLevelAccepts++;
        expect(v.accept).toBe(true);
      }
      if (judged.regressedSeeds.some((id) => ids.has(id))) {
        flaggedRegressions++;
        expect(v.accept).toBe(false);
        expect(v.regressedSeeds.every((id) => !ids.has(id))).toBe(true); // never manufactured as regressed-seed
      }
      // CONTROLS: a gate reading the rewritten bits at face value, and the first cut's drop rule.
      if (judgeHoldout(blind(fb), blind(fc)).accept && !judged.accept) rawReaderViolations++;
      if (judgeHoldout(...dropOutageSeeds(fb, fc)).accept && !judged.accept) dropViolations++;
    }
    // Measured: 711 hidden regressions, 121 accepts, 92 seed-level accepts, 262 control violations.
    expect(flaggedRegressions).toBeGreaterThan(100); // the property ran on hidden regressions...
    expect(flaggedAccepts).toBeGreaterThan(100); // ...and on real acceptances
    expect(seedLevelAccepts).toBeGreaterThan(50); // ...and the fallback path is not a blanket refusal
    expect(rawReaderViolations).toBeGreaterThan(0); // CONTROL: the rewrite does manufacture false wins
    expect(dropViolations).toBeGreaterThan(0); // CONTROL: the first cut's drop rule breaks this property
  });

  it("outage-only differences never flip a winner: adding outage seeds never moves the judged statistic and never creates an acceptance", () => {
    const rng = mulberry32(4242);
    let checked = 0;
    let acceptedBefore = 0;
    for (let run = 0; run < 1500; run++) {
      const n = 6 + Math.floor(rng() * 12);
      const probs = seedProbs(n, rng);
      const candProbs = probs.map((p) => (rng() < 0.3 ? 0.9 : p)); // some runs carry a real improvement
      const base = replay(probs, 3, rng);
      const cand = replay(candProbs, 3, rng);
      const before = judgeHoldout(base, cand);
      // Up to 25% extra seeds where ONE arm's judge was down, with arbitrary
      // pass bits pointing whichever way -- the outage "evidence".
      const extra = Math.floor(rng() * (Math.floor(n / 3) + 1));
      const xb: SeedTrials[] = [];
      const xc: SeedTrials[] = [];
      for (let i = 0; i < extra; i++) {
        const id = `x${i}`;
        const downInBase = rng() < 0.5;
        const bits = () => [0, 1, 2].map(() => (rng() < 0.5 ? "1" : "0")).join("");
        xb.push(tr(id, bits(), { down: downInBase }));
        xc.push(tr(id, bits(), { down: !downInBase }));
      }
      const after = judgeHoldout([...base, ...xb], [...cand, ...xc]);
      expect(after.pValue).toBe(before.pValue);
      expect(after.comparable).toBe(before.comparable);
      expect(after.regressedSeeds).toEqual(before.regressedSeeds);
      expect(after.evaluatorUnavailableSeeds).toHaveLength(extra);
      if (after.accept) expect(before.accept).toBe(true); // an outage never creates a winner
      if (after.reason !== "evaluator-unavailable") expect(after.reason).toBe(before.reason);
      if (extra && after.evaluatorOutageShare <= 0.25 && after.reason !== "evaluator-unavailable") checked++;
      if (before.accept) acceptedBefore++;
    }
    // The property ran on real winners and on real outage seeds, not on an empty set.
    expect(acceptedBefore).toBeGreaterThan(100);
    expect(checked).toBeGreaterThan(300);
  });
});

describe("evaluator outage - refusals", () => {
  const sweep = (n: number, prefix = "s") => ({
    base: Array.from({ length: n }, (_, i) => tr(`${prefix}${i}`, "000")),
    cand: Array.from({ length: n }, (_, i) => tr(`${prefix}${i}`, "111")),
  });

  it("POSITIVE CONTROL: 3 of 10 seeds down (30% > 25%) refuses a clean sweep the survivors would accept", () => {
    const { base, cand } = sweep(10);
    base[0] = tr("s0", "000", { down: true });
    cand[1] = tr("s1", "111", { down: true });
    base[2] = tr("s2", "000", { down: true });
    const v = judgeHoldout(base, cand);
    expect(v.reason).toBe("evaluator-unavailable");
    expect(v.accept).toBe(false);
    expect(v.evaluatorUnavailableSeeds).toEqual(["s0", "s1", "s2"]);
    expect(v.evaluatorOutageShare).toBeCloseTo(0.3);
    expect(v.comparable).toBe(7);
    expect(v.pValue).toBeLessThanOrEqual(0.05); // the survivors alone WOULD have accepted
  });

  it("unbroken: 2 of 10 down (20%) is tolerated -- the survivors decide", () => {
    const { base, cand } = sweep(10);
    base[0] = tr("s0", "000", { down: true });
    cand[1] = tr("s1", "111", { down: true });
    const v = judgeHoldout(base, cand);
    expect(v).toMatchObject({ accept: true, reason: "improved", comparable: 8, eligible: 10 });
    expect(v.evaluatorUnavailableSeeds).toEqual(["s0", "s1"]);
  });

  it("the share boundary: exactly 25% (3 of 12) is tolerated, 4 of 12 refuses", () => {
    const at = sweep(12);
    for (const i of [0, 1, 2]) at.base[i] = tr(`s${i}`, "000", { down: true });
    const v = judgeHoldout(at.base, at.cand);
    expect(v.evaluatorOutageShare).toBe(0.25);
    expect(v.reason).toBe("improved"); // not "> 0.25": the survivors decide
    const over = sweep(12);
    for (const i of [0, 1, 2, 3]) over.base[i] = tr(`s${i}`, "000", { down: true });
    expect(judgeHoldout(over.base, over.cand).reason).toBe("evaluator-unavailable");
  });

  it("the share threshold is an option: 30% passes at maxEvaluatorOutageShare 0.35", () => {
    const { base, cand } = sweep(10);
    for (const i of [0, 1, 2]) base[i] = tr(`s${i}`, "000", { down: true });
    expect(judgeHoldout(base, cand, { maxEvaluatorOutageShare: 0.35 }).reason).toBe("improved");
  });

  it("exclusions that alone cost the power read evaluator-unavailable, not underpowered (5 eligible, 1 down)", () => {
    const { base, cand } = sweep(5);
    cand[4] = tr("s4", "111", { down: true });
    const v = judgeHoldout(base, cand);
    expect(v.evaluatorOutageShare).toBeCloseTo(0.2); // under the share cap...
    expect(v.reason).toBe("evaluator-unavailable"); // ...but 4 survivors cannot reach alpha, 5 could
    // Unbroken twin: 4 eligible seeds were underpowered before any outage.
    const small = sweep(4);
    expect(judgeHoldout(small.base, small.cand).reason).toBe("underpowered");
  });

  it("precedence: a regression on a judged seed outranks the outage refusal", () => {
    const { base, cand } = sweep(10);
    base[0] = tr("s0", "111");
    cand[0] = tr("s0", "000");
    for (const i of [1, 2, 3, 4]) base[i] = tr(`s${i}`, "000", { down: true });
    const v = judgeHoldout(base, cand);
    expect(v.evaluatorOutageShare).toBeCloseTo(0.4);
    expect(v.reason).toBe("regressed-seed");
  });

  // 2026-10-09 contract change (review finding, critical): the first cut
  // pinned "improved" here -- dropping the seed hid a possible regression.
  // An outage still cannot MANUFACTURE a regressed-seed (its bits are
  // regex-only), but it cannot hide one either: it refuses as
  // evaluator-unavailable.
  it("an outage seed whose raw bits show a won call lost refuses as evaluator-unavailable -- never regressed-seed, never improved", () => {
    const { base, cand } = sweep(10);
    base[0] = tr("s0", "111", { down: true });
    cand[0] = tr("s0", "000");
    const v = judgeHoldout(base, cand);
    expect(v.regressedSeeds).toEqual([]);
    expect(v.outageRegressionSeeds).toEqual(["s0"]);
    expect(v.reason).toBe("evaluator-unavailable");
    expect(v.accept).toBe(false);
  });

  it("POSITIVE CONTROL (reviewer's probe): the candidate's judge failing on its own broken seeds turns no veto into an acceptance", () => {
    // r0-r2: baseline 111 -> candidate 000; f0-f8: 000 -> 111. 12 seeds.
    const arms = (downOnBroken: boolean) => {
      const base = [...["r0", "r1", "r2"].map((id) => tr(id, "111")), ...Array.from({ length: 9 }, (_, i) => tr(`f${i}`, "000"))];
      const cand = [
        ...["r0", "r1", "r2"].map((id) => tr(id, "000", { down: downOnBroken })),
        ...Array.from({ length: 9 }, (_, i) => tr(`f${i}`, "111")),
      ];
      return [base, cand] as const;
    };
    const judged = judgeHoldout(...arms(false));
    expect(judged).toMatchObject({ accept: false, reason: "regressed-seed", regressedSeeds: ["r0", "r1", "r2"] });
    const down = judgeHoldout(...arms(true));
    expect(down.evaluatorOutageShare).toBe(0.25); // at the cap, not over it: the share rule alone would let it through
    expect(down.pValue).toBeLessThanOrEqual(0.05); // and the survivors are a clean sweep
    expect(down.accept).toBe(false);
    expect(down.reason).toBe("evaluator-unavailable");
    expect(down.outageRegressionSeeds).toEqual(["r0", "r1", "r2"]);
    // CONTROL: the first cut's drop rule accepts exactly this input.
    expect(judgeHoldout(...dropOutageSeeds(...arms(true))).accept).toBe(true);
  });

  // Round 2 (2026-10-09): the outage fixtures below name WHICH replays were
  // down (unv). They are chosen so the worst case equals the raw bits -- the
  // candidate's down replays are its fails, the baseline's down replays its
  // passes -- so these tests pin the clamp arithmetic; the cases where the
  // worst case differs from the raw bits are pinned in the next block.
  it("POSITIVE CONTROL: outage seeds' LOSSES count against the candidate (worst-case p); their gains never count for it", () => {
    // 6 judged seeds 000 -> 001 (p = 1/64), plus 2 outage seeds (25%, tolerated).
    const judged = () => ({
      base: Array.from({ length: 6 }, (_, i) => tr(`s${i}`, "000")),
      cand: Array.from({ length: 6 }, (_, i) => tr(`s${i}`, "001")),
    });
    const lost = judged();
    lost.base.push(tr("o0", "111"), tr("o1", "111"));
    // Down on the 2 failing replays each (regex misses): not a full regression.
    lost.cand.push(tr("o0", "001", { unv: "110" }), tr("o1", "001", { unv: "110" }));
    const v = judgeHoldout(lost.base, lost.cand);
    expect(v.outageRegressionSeeds).toEqual([]);
    expect(v.pValue).toBeCloseTo(1 / 64, 12); // the judged seeds alone would accept...
    expect(v.worstCaseP).toBeCloseTo(102 / 256, 12); // ...{+1 x6, -2 x2}: the outage could be hiding the losses
    expect(v.reason).toBe("evaluator-unavailable");
    // Same bits, judged: the gate would call it not-significant -- the outage
    // must not turn that into a win.
    expect(judgeHoldout(lost.base, blind(lost.cand)).reason).toBe("not-significant");
    // Unbroken twin: outage seeds whose worst case points UP change nothing
    // (the baseline's judge was down on the replay it passed anyway).
    const gained = judged();
    gained.base.push(tr("o0", "001", { unv: "001" }), tr("o1", "001", { unv: "001" }));
    gained.cand.push(tr("o0", "111"), tr("o1", "111"));
    const g = judgeHoldout(gained.base, gained.cand);
    expect(g.evaluatorUnavailableSeeds).toEqual(["o0", "o1"]);
    expect(g.worstCaseP).toBe(g.pValue);
    expect(g.reason).toBe("improved");
  });

  it("one outage seed's gain cannot offset another's loss (the clamp is per seed)", () => {
    // 8 judged seeds 000 -> 001 (p = 1/256); outage o0 111 -> 001 (-2), o1 001 -> 111 (+2); share 2/10.
    const base = [...Array.from({ length: 8 }, (_, i) => tr(`s${i}`, "000")), tr("o0", "111"), tr("o1", "001", { unv: "001" })];
    const cand = [...Array.from({ length: 8 }, (_, i) => tr(`s${i}`, "001")), tr("o0", "001", { unv: "110" }), tr("o1", "111")];
    const v = judgeHoldout(base, cand);
    // Netted, the two outage seeds cancel and the same bits judged would pass (p = 9.75/256)...
    expect(judgeHoldout(blind(base), blind(cand))).toMatchObject({ reason: "improved" });
    expect(judgeHoldout(blind(base), blind(cand)).pValue).toBeCloseTo(9.75 / 256, 12);
    // ...but the outage's gain must not pay for its possible loss: {+1 x8, -2}.
    expect(v.worstCaseP).toBeCloseTo(19 / 256, 12);
    expect(v.reason).toBe("evaluator-unavailable");
  });

  it("describeVerdict reports the outage, a possible regression under it, and a worst-case p that differs", () => {
    const { base, cand } = sweep(10);
    base[0] = tr("s0", "000", { down: true });
    const plain = describeVerdict(judgeHoldout(base, cand));
    expect(plain).toContain("evaluator outage 1/10");
    expect(plain).not.toContain("worst-case");
    base[1] = tr("s1", "111", { down: true });
    const hidden = describeVerdict(judgeHoldout(base, cand.map((s) => (s.id === "s1" ? tr("s1", "000") : s))));
    expect(hidden).toContain("possible regression under outage s1");
    expect(hidden).toContain("worst-case p=");
  });
});

describe("evaluator outage - the worst case reads each down replay against the candidate (round-2 review)", () => {
  // The reviewer's probe (scratchpad r2/probe-unverified.mts): r0-r2 go from a
  // reliably won 111 to a candidate that DEFLECTS them -- the judge rules each
  // reply a fail (000) -- and f0-f8 go 000 -> 111. 12 seeds, share 3/12 = 0.25.
  const holdout = (r: (id: string) => SeedTrials) => ({
    base: [...["r0", "r1", "r2"].map((id) => tr(id, "111")), ...Array.from({ length: 9 }, (_, i) => tr(`f${i}`, "000"))],
    cand: [...["r0", "r1", "r2"].map(r), ...Array.from({ length: 9 }, (_, i) => tr(`f${i}`, "111"))],
  });

  it("judged truth: the deflections are a regressed-seed veto", () => {
    const { base, cand } = holdout((id) => tr(id, "000"));
    expect(judgeHoldout(base, cand)).toMatchObject({ accept: false, reason: "regressed-seed", regressedSeeds: ["r0", "r1", "r2"] });
  });

  // Round 2 accepted every row but the last as "improved" (worst-case p
  // 0.0195 at 010, 0.0042 at 011): it read the unverified hits as passes.
  it.each([
    ["010", "010", "1 replay down, an unverified HIT"],
    ["011", "011", "2 replays down, unverified HITs"],
    ["111", "111", "all 3 down, unverified HITs"],
    ["010", "011", "2 replays down, one hit and one miss"],
    ["000", "100", "1 replay down, a regex MISS"],
  ])("POSITIVE CONTROL: candidate bits %s, judge down on %s (%s) -- refuses, never improved", (bits, unv) => {
    const { base, cand } = holdout((id) => tr(id, bits, { unv }));
    const v = judgeHoldout(base, cand);
    expect(v.evaluatorOutageShare).toBe(0.25); // at the cap: the share rule alone would let it through
    expect(v.accept).toBe(false);
    expect(v.reason).toBe("evaluator-unavailable");
    expect(v.outageRegressionSeeds).toEqual(["r0", "r1", "r2"]);
    expect(v.regressedSeeds).toEqual([]); // never manufactured as a judged regression
    // CONTROL: the same bits read at face value (no flag) are an acceptance
    // whenever the regex passed any of them -- the lie the worst case undoes.
    if (bits.includes("1")) expect(judgeHoldout(base, blind(cand)).accept).toBe(true);
  });

  it("end to end from grades: toSeedTrials carries WHICH replay was down, so a judged pass is not thrown away -- and an unverified hit still is", () => {
    // s0 is a won call (baseline 111). The candidate passes it on replays 1-2
    // (judged) and its third reply was a regex miss graded with the judge
    // down. s1-s5 go 000 -> 111.
    const ids = ["s0", "s1", "s2", "s3", "s4", "s5"];
    const runs = (pass: (id: string, r: number) => boolean, down: (id: string, r: number) => boolean = () => false) =>
      [0, 1, 2].map((r) => ({ grades: ids.map((id) => ({ id, pass: pass(id, r), judgeUnavailable: down(id, r) })) }));
    const base = toSeedTrials(runs((id) => id === "s0"));
    const cand = toSeedTrials(runs((id, r) => id !== "s0" || r < 2, (id, r) => id === "s0" && r === 2));
    const v = judgeHoldout(base, cand);
    expect(v).toMatchObject({ reason: "improved", evaluatorUnavailableSeeds: ["s0"], outageRegressionSeeds: [] });
    expect(v.worstCaseP).toBeCloseTo(2 / 64, 12); // {+3 x5, -1}: s0's worst case is 110 vs 111
    // POSITIVE CONTROL: the seed-level reading of the same input (which replay
    // unknown) must assume s0 could be 000 -- a possible regression.
    const seedLevel = cand.map((s) => ({ ...s, unverified: undefined }));
    expect(judgeHoldout(base, seedLevel)).toMatchObject({ reason: "evaluator-unavailable", outageRegressionSeeds: ["s0"] });
    // The reviewer's deflection, from grades: the down replay was a regex HIT
    // (010) the judge never saw.
    const deflected = toSeedTrials(runs((id, r) => id !== "s0" || r === 1, (id, r) => id === "s0" && r === 1));
    expect(judgeHoldout(base, deflected)).toMatchObject({ accept: false, reason: "evaluator-unavailable", outageRegressionSeeds: ["s0"] });
  });

  it("the seed-level flag alone (no per-replay array) refuses the same inputs -- the stricter fallback", () => {
    for (const bits of ["010", "011", "111"]) {
      const { base, cand } = holdout((id) => tr(id, bits, { down: true }));
      expect(judgeHoldout(base, cand)).toMatchObject({ accept: false, reason: "evaluator-unavailable", outageRegressionSeeds: ["r0", "r1", "r2"] });
    }
  });

  it("a malformed per-replay array is read as unverified on every replay, never as clean", () => {
    const short = holdout((id) => ({ ...tr(id, "111"), evaluatorUnavailable: true, unverified: [false] }));
    expect(judgeHoldout(short.base, short.cand).reason).toBe("evaluator-unavailable");
    // Too short and marking replay 1: replays 2-3 are NOT thereby verified.
    const shortMarked = holdout((id) => ({ ...tr(id, "111"), evaluatorUnavailable: true, unverified: [true] }));
    expect(judgeHoldout(shortMarked.base, shortMarked.cand).outageRegressionSeeds).toEqual(["r0", "r1", "r2"]);
    const allFalse = holdout((id) => ({ ...tr(id, "111"), evaluatorUnavailable: true, unverified: [false, false, false] }));
    expect(judgeHoldout(allFalse.base, allFalse.cand).outageRegressionSeeds).toEqual(["r0", "r1", "r2"]);
    // An array that marks a replay counts even without the seed-level flag.
    const unflagged = holdout((id) => ({ ...tr(id, "010"), unverified: [false, true, false] }));
    expect(judgeHoldout(unflagged.base, unflagged.cand)).toMatchObject({ reason: "evaluator-unavailable", evaluatorUnavailableSeeds: ["r0", "r1", "r2"] });
  });

  it("POSITIVE CONTROL (baseline arm): a baseline replay graded on a regex miss while the judge was down may hide a pass", () => {
    // Reviewer's probe [5]: r-seeds read 110 because the baseline's third
    // replay was a regex miss the judge never saw; the judged truth is 111.
    const base = [...["r0", "r1", "r2"].map((id) => tr(id, "110", { unv: "001" })), ...Array.from({ length: 9 }, (_, i) => tr(`f${i}`, "000"))];
    const cand = [...["r0", "r1", "r2"].map((id) => tr(id, "000")), ...Array.from({ length: 9 }, (_, i) => tr(`f${i}`, "111"))];
    const truth = base.map((s) => (s.id.startsWith("r") ? tr(s.id, "111") : s));
    expect(judgeHoldout(truth, cand).reason).toBe("regressed-seed");
    const v = judgeHoldout(base, cand);
    expect(v).toMatchObject({ accept: false, reason: "evaluator-unavailable", outageRegressionSeeds: ["r0", "r1", "r2"] });
    expect(judgeHoldout(blind(base), cand).accept).toBe(true); // CONTROL: read at face value, it is accepted
  });

  it("a baseline replay that carried a critical violation stays a fail in the worst case -- no judge verdict could pass it", () => {
    // Every baseline replay of o0 was down AND carried a price leak: it failed
    // whatever the judge would have said, so it is no possible regression.
    const sweep = (viol?: string) => ({
      base: [...Array.from({ length: 9 }, (_, i) => tr(`s${i}`, "000")), tr("o0", "000", { unv: "111", viol })],
      cand: [...Array.from({ length: 9 }, (_, i) => tr(`s${i}`, "111")), tr("o0", "000")],
    });
    const leaked = sweep("111");
    expect(judgeHoldout(leaked.base, leaked.cand)).toMatchObject({ accept: true, reason: "improved", outageRegressionSeeds: [] });
    // POSITIVE CONTROL: the same down replays without the violation could each
    // have been a pass the judge granted -- a possible regression, refused.
    const clean = sweep();
    expect(judgeHoldout(clean.base, clean.cand)).toMatchObject({ accept: false, reason: "evaluator-unavailable", outageRegressionSeeds: ["o0"] });
  });

  it("outage-only CANDIDATE gains never count: an unverified pass on a seed the baseline fails reads as a tie at best", () => {
    // 6 judged seeds 000 -> 001 (p = 1/64); outage o0, o1: baseline 000, candidate 111 all unverified.
    const base = [...Array.from({ length: 6 }, (_, i) => tr(`s${i}`, "000")), tr("o0", "000"), tr("o1", "000")];
    const cand = [...Array.from({ length: 6 }, (_, i) => tr(`s${i}`, "001")), tr("o0", "111", { unv: "111" }), tr("o1", "111", { unv: "111" })];
    const v = judgeHoldout(base, cand);
    expect(v.worstCaseP).toBe(v.pValue); // worst case 000 vs 000: no loss, and the raw +3 never counts
    expect(v.reason).toBe("improved");
    expect(v.comparable).toBe(6);
  });
});

describe("comparePairedTrain", () => {
  const g = (id: string, pass: boolean, o: Partial<Grade> = {}): Grade => ({ id, pass, ...o });

  it("POSITIVE CONTROL: passRate over each prompt's own denominator rewards a candidate that only confused the judge", () => {
    // Baseline: 5 of 10 pass. The candidate changes nothing, but 4 of its 5
    // losses get ruled "unresolvable" -- scorePrompt drops them from its total.
    const base = Array.from({ length: 10 }, (_, i) => g(`s${i}`, i < 5));
    const cand = Array.from({ length: 10 }, (_, i) => g(`s${i}`, i < 5, i >= 5 && i < 9 ? { unresolvable: true } : {}));
    const ownRate = (gs: Grade[]) => {
      const graded = gs.filter((x) => !x.unresolvable);
      return graded.filter((x) => x.pass).length / graded.length;
    };
    expect(ownRate(base)).toBeCloseTo(0.5);
    expect(ownRate(cand)).toBeCloseTo(5 / 6); // 83% "beats" 50% -- the defect
    const p = comparePairedTrain(base, cand);
    expect(p).toMatchObject({ basePasses: 5, candPasses: 5, margin: 0, comparable: 10, excluded: 0, usable: true });
  });

  // 2026-10-09 contract change (review finding): the first cut dropped outage
  // seeds symmetrically and had no share cap, so this case read margin +1.
  it("excludes only seeds the BASELINE ruled unresolvable; outage seeds leave the judged counts, but a raw outage LOSS still counts against the candidate", () => {
    const base = [g("a", false, { unresolvable: true }), g("b", true), g("c", false), g("d", true, { judgeUnavailable: true }), g("e", false)];
    const cand = [g("a", true), g("b", true), g("c", true), g("d", false), g("e", true, { judgeUnavailable: true })];
    expect(comparePairedTrain(base, cand)).toEqual({
      basePasses: 1,
      candPasses: 2,
      outageLosses: 1, // d: baseline raw pass, candidate fail -- counted; e: a raw gain -- not counted
      margin: 0,
      comparable: 2,
      excluded: 3,
      evaluatorUnavailable: 2,
      evaluatorOutageShare: 0.5,
      usable: false, // 2 of 4 eligible seeds lost: not a reading to act on
    });
  });

  it("POSITIVE CONTROL: a candidate whose judge failed on its own losses no longer reads as winning on train", () => {
    // Baseline passes s0-s4; the candidate fails s0-s4 (judge down on each) and also passes s5.
    const base = Array.from({ length: 10 }, (_, i) => g(`s${i}`, i < 5));
    const cand = Array.from({ length: 10 }, (_, i) => g(`s${i}`, i === 5, i < 5 ? { judgeUnavailable: true } : {}));
    const judged = comparePairedTrain(base, cand.map((x) => ({ ...x, judgeUnavailable: false })));
    expect(judged.margin).toBe(-4); // what the judge would have said on these bits
    const v = comparePairedTrain(base, cand);
    expect(v).toMatchObject({ basePasses: 0, candPasses: 1, outageLosses: 5, margin: -4, evaluatorUnavailable: 5, usable: false });
    // The first cut read {basePasses 0, candPasses 1, margin +1} here and advanced it to the holdout.
    expect(v.candPasses - v.basePasses).toBe(1);
  });

  it("POSITIVE CONTROL (round-2 review, probe [6]): the candidate's unverified passes on won calls it deflected read as losses, not ties", () => {
    // Baseline passes s0-s4. The candidate deflects s0-s4 (judged: fail) and
    // passes s5; its judge was down on s0 and s1, where the regex passed it.
    const base = Array.from({ length: 10 }, (_, i) => g(`s${i}`, i < 5));
    const judged = Array.from({ length: 10 }, (_, i) => g(`s${i}`, i === 5 || (i >= 2 && i < 5)));
    const down = Array.from({ length: 10 }, (_, i) => g(`s${i}`, i <= 5, i < 2 ? { judgeUnavailable: true } : {}));
    expect(comparePairedTrain(base, judged).margin).toBe(-1); // the judge's reading
    const v = comparePairedTrain(base, down);
    // Round 2 read margin +1 here (usable, share 0.2) and advanced it.
    expect(v).toMatchObject({ basePasses: 3, candPasses: 4, outageLosses: 2, margin: -1, usable: true });
    expect(v.margin).toBeLessThanOrEqual(-1);
  });

  it("usable at or under the outage cap (1 of 4 eligible = 25%), unusable above it, and unusable with nothing eligible", () => {
    const base = [g("a", true), g("b", false), g("c", false), g("d", false, { judgeUnavailable: true })];
    const cand = [g("a", true), g("b", true), g("c", false), g("d", false)];
    // d: the baseline's down replay was a regex miss the judge may have
    // rescued, so the candidate's judged fail there is a possible loss (round 2: margin 1).
    expect(comparePairedTrain(base, cand)).toMatchObject({ usable: true, evaluatorOutageShare: 0.25, outageLosses: 1, margin: 0 });
    expect(comparePairedTrain(base, cand, { maxEvaluatorOutageShare: 0.2 }).usable).toBe(false);
    expect(comparePairedTrain([g("a", false, { unresolvable: true })], [g("a", true)])).toMatchObject({ usable: false, comparable: 0 });
    expect(comparePairedTrain([], [])).toMatchObject({ usable: false, margin: 0 });
  });

  it("a candidate missing a seed cannot gain from it (the seed leaves both arms and is counted excluded)", () => {
    const base = [g("a", false), g("b", false), g("c", true)];
    const cand = [g("a", true), g("c", true)];
    expect(comparePairedTrain(base, cand)).toMatchObject({ basePasses: 1, candPasses: 2, comparable: 2, excluded: 1 });
  });

  it("ranks candidates by margin on the same seeds", () => {
    const base = Array.from({ length: 8 }, (_, i) => g(`s${i}`, i < 2));
    const a = Array.from({ length: 8 }, (_, i) => g(`s${i}`, i < 5));
    const b = Array.from({ length: 8 }, (_, i) => g(`s${i}`, i < 4));
    expect(comparePairedTrain(base, a).margin).toBeGreaterThan(comparePairedTrain(base, b).margin);
  });
});

describe("judgeSuccessCohort", () => {
  const clean = (n: number) => Array.from({ length: n }, (_, i) => tr(`w${i}`, "111"));

  it("unbroken: an identical, clean cohort is preserved", () => {
    const v = judgeSuccessCohort(clean(12), clean(12));
    expect(v).toMatchObject({ veto: false, reason: "preserved", comparable: 12, pDegraded: 1 });
  });

  it("POSITIVE CONTROL: a candidate breaking 3 always-passing won calls is vetoed (success-regressed-seed)", () => {
    const cand = clean(12);
    for (const i of [2, 5, 9]) cand[i] = tr(`w${i}`, "000");
    const v = judgeSuccessCohort(clean(12), cand);
    expect(v.veto).toBe(true);
    expect(v.reason).toBe("success-regressed-seed");
    expect(v.regressedSeeds).toEqual(["w2", "w5", "w9"]);
  });

  it("POSITIVE CONTROL: ONE guarantee violation on a clean won call is vetoed (success-new-violation) -- read from real grade shapes", () => {
    // gradeReplies shape: a guarantee fails the replay as well as flagging it.
    const grades = (guaranteeOn: string | null) =>
      Array.from({ length: 12 }, (_, i) => {
        const g = `w${i}` === guaranteeOn ? 1 : 0;
        return { id: `w${i}`, pass: g === 0, priceLeaks: 0, guarantees: g, emptyReplies: 0, claimViolations: [] as string[] };
      });
    const baseRuns = [0, 1, 2].map(() => ({ grades: grades(null) }));
    // Only the second candidate replay of w7 says "guarantee" -- one replay of
    // 36, too small for any pass statistic to notice.
    const candRuns = [0, 1, 2].map((r) => ({ grades: grades(r === 1 ? "w7" : null) }));
    const v = judgeSuccessCohort(toSuccessTrials(baseRuns), toSuccessTrials(candRuns));
    expect(v.reason).toBe("success-new-violation");
    expect(v.newViolationSeeds).toEqual(["w7"]);
    expect(v.candidate.violations).toBe(1);
    expect(v.baseline.violations).toBe(0);
    // Unbroken twin: the same violation on a seed the BASELINE already violated is not new.
    const baseRunsDirty = [0, 1, 2].map((r) => ({ grades: grades(r === 0 ? "w7" : null) }));
    expect(judgeSuccessCohort(toSuccessTrials(baseRunsDirty), toSuccessTrials(candRuns)).reason).toBe("preserved");
  });

  it("toSuccessTrials refuses a grade missing a violation counter instead of reading it violation-free", () => {
    // The ScoredPrompt.grades shape today: no claimViolations. Fed through
    // toSeedTrials, a claim violation would be invisible to the veto.
    const scoredPromptShape = { id: "w0", pass: true, priceLeaks: 0, guarantees: 0, emptyReplies: 0 };
    expect(() => toSuccessTrials([{ grades: [scoredPromptShape as never] }])).toThrow(/w0 has no claimViolations/);
    expect(() => toSuccessTrials([{ grades: [{ id: "w1", pass: true, claimViolations: [] } as never] }])).toThrow(
      /w1 has no priceLeaks, guarantees, emptyReplies/,
    );
    // Unbroken: all four present -- the same fold as toSeedTrials, claim violations seen.
    const full = { ...scoredPromptShape, claimViolations: ["wait_time_estimate"] };
    expect(toSuccessTrials([{ grades: [full] }])).toEqual(toSeedTrials([{ grades: [full] }]));
    expect(toSuccessTrials([{ grades: [full] }])[0].violations).toEqual([true]);
  });

  it("violations are judge-independent: a new violation on an outage or baseline-unresolvable seed still vetoes", () => {
    const base = clean(12);
    const cand = clean(12);
    cand[0] = tr("w0", "111", { down: true, viol: "001" });
    expect(judgeSuccessCohort(base, cand).newViolationSeeds).toEqual(["w0"]);
    const base2 = clean(12);
    base2[3] = tr("w3", "000", { unresolvable: true });
    const cand2 = clean(12);
    cand2[3] = tr("w3", "111", { viol: "100" });
    expect(judgeSuccessCohort(base2, cand2).reason).toBe("success-new-violation");
  });

  it("POSITIVE CONTROL: a broad one-replay slide with no single seed fully lost is vetoed (success-degraded)", () => {
    const cand = Array.from({ length: 12 }, (_, i) => tr(`w${i}`, i < 8 ? "110" : "111"));
    const v = judgeSuccessCohort(clean(12), cand);
    expect(v.regressedSeeds).toEqual([]);
    expect(v.newViolationSeeds).toEqual([]);
    expect(v.pDegraded).toBeCloseTo(1 / 256, 12); // 8 seeds each down 1/3: only all-minus reaches it
    expect(v.reason).toBe("success-degraded");
  });

  it("the non-inferiority margin tolerates a drop smaller than itself, and only that", () => {
    const cand = Array.from({ length: 12 }, (_, i) => tr(`w${i}`, i < 8 ? "110" : "111"));
    // Mean per-seed drop = 8/12 * 1/3 = 0.222.
    expect(judgeSuccessCohort(clean(12), cand, { margin: 0.5 }).reason).toBe("preserved");
    expect(judgeSuccessCohort(clean(12), cand, { margin: 0.05 }).reason).toBe("success-degraded");
    expect(judgeSuccessCohort(clean(12), cand, { margin: 0.05 }).margin).toBe(0.05);
  });

  // 2026-10-09 contract change (review finding): the first cut's "under the
  // cap, preserved" case used candidate bits 000 on the outage seeds -- a won
  // call lost, hidden by the outage. Under the cap the survivors decide only
  // when the outage seeds show no such loss.
  it("POSITIVE CONTROL: an outage over the share cap vetoes as evaluator-unavailable; under it, the survivors decide", () => {
    // Down on ONE replay each (round 2: seed-level flags here; under the
    // worst-case view an all-replays-down won call reads as a possible loss).
    const cand = clean(12);
    for (const i of [0, 1, 2, 3]) cand[i] = tr(`w${i}`, "111", { unv: "100" }); // 4/12 = 33%
    const v = judgeSuccessCohort(clean(12), cand);
    expect(v.reason).toBe("evaluator-unavailable");
    expect(v.outageRegressionSeeds).toEqual([]); // the share alone refused
    const ok = clean(12);
    for (const i of [0, 1]) ok[i] = tr(`w${i}`, "111", { unv: "100" }); // 2/12 = 17%
    expect(judgeSuccessCohort(clean(12), ok).reason).toBe("preserved");
    // ...and a won call whose candidate replays were ALL graded without the
    // judge is a possible loss: any of them may have been a deflection.
    const blindSpot = clean(12);
    blindSpot[0] = tr("w0", "111", { unv: "111" });
    expect(judgeSuccessCohort(clean(12), blindSpot)).toMatchObject({ veto: true, reason: "evaluator-unavailable", outageRegressionSeeds: ["w0"] });
  });

  it("POSITIVE CONTROL: a won call broken under the candidate's outage vetoes (evaluator-unavailable) -- never 'preserved', never manufactured as regressed", () => {
    // Reviewer's probe: w2/w5/w9 go 111 -> 000 and the candidate's judge was
    // down on exactly those (share 0.25, at the cap, not over it).
    const broken = (down: boolean) => {
      const cand = clean(12);
      for (const i of [2, 5, 9]) cand[i] = tr(`w${i}`, "000", { down });
      return judgeSuccessCohort(clean(12), cand);
    };
    expect(broken(false).reason).toBe("success-regressed-seed");
    const v = broken(true);
    expect(v.evaluatorOutageShare).toBe(0.25);
    expect(v).toMatchObject({ veto: true, reason: "evaluator-unavailable", regressedSeeds: [] });
    expect(v.outageRegressionSeeds).toEqual(["w2", "w5", "w9"]);
    // CONTROL: the first cut's drop rule calls exactly this input preserved.
    expect(judgeSuccessCohort(...dropOutageSeeds(clean(12), clean(12).map((s, i) => ([2, 5, 9].includes(i) ? tr(s.id, "000", { down: true }) : s)))).reason).toBe("preserved");
  });

  it.each([
    ["100", "100", "1 replay down, an unverified HIT"],
    ["110", "110", "2 replays down, unverified HITs"],
    ["111", "111", "all 3 down, unverified HITs"],
  ])("POSITIVE CONTROL (round-2 review): won calls the candidate deflected read %s with its judge down on %s (%s) -- vetoed, never preserved", (bits, unv) => {
    // w2/w5/w9: the judge would rule every candidate reply a fail (000); the
    // regex passed the down ones. Round 2 read 100 as "preserved" (worst 0.125).
    const cand = clean(12);
    for (const i of [2, 5, 9]) cand[i] = tr(`w${i}`, bits, { unv });
    const v = judgeSuccessCohort(clean(12), cand);
    expect(v).toMatchObject({ veto: true, reason: "evaluator-unavailable", regressedSeeds: [] });
    expect(v.outageRegressionSeeds).toEqual(["w2", "w5", "w9"]);
    // CONTROL: read at face value, the same bits are preserved.
    expect(judgeSuccessCohort(clean(12), blind(cand)).veto).toBe(false);
  });

  it("POSITIVE CONTROL: outage seeds' worst-case 'worse' evidence counts toward the degradation veto", () => {
    // Judged: 4 won calls 111 -> 110 (p = 1/16, not significant alone).
    // Outage: 2 won calls 111 -> 100, the candidate's judge down on the 2
    // failing replays (regex misses), so the worst case is the raw bits (share 2/12).
    const cand = clean(12);
    for (const i of [0, 1, 2, 3]) cand[i] = tr(`w${i}`, "110");
    for (const i of [4, 5]) cand[i] = tr(`w${i}`, "100", { unv: "011" });
    const v = judgeSuccessCohort(clean(12), cand);
    expect(v.pDegraded).toBeCloseTo(1 / 16, 12);
    expect(v.pDegradedWorstCase).toBeCloseTo(1 / 64, 12);
    expect(v.reason).toBe("evaluator-unavailable");
    expect(judgeSuccessCohort(clean(12), blind(cand)).reason).toBe("success-degraded"); // the judged reading of the same bits
    // Unbroken twin: outage seeds whose worst case is no worse add nothing
    // (the BASELINE's judge was down on replays it passed anyway).
    const base = clean(12);
    for (const i of [4, 5]) base[i] = tr(`w${i}`, "111", { unv: "100" });
    const fine = clean(12);
    for (const i of [0, 1, 2, 3]) fine[i] = tr(`w${i}`, "110");
    const f = judgeSuccessCohort(base, fine);
    expect(f.evaluatorUnavailableSeeds).toEqual(["w4", "w5"]);
    expect(f.pDegradedWorstCase).toBe(f.pDegraded);
    expect(f.reason).toBe("preserved");
    // Per-seed clamp: an outage seed's "better" cannot cancel another's "worse".
    const base2 = clean(12);
    base2[5] = tr("w5", "100", { unv: "100" }); // the baseline's judge down on the replay it passed
    const mixed = clean(12);
    for (const i of [0, 1, 2, 3]) mixed[i] = tr(`w${i}`, "110");
    mixed[4] = tr("w4", "100", { unv: "011" }); // worse by 2/3
    mixed[5] = tr("w5", "111"); // better by 2/3 (against base2's 100)
    const m = judgeSuccessCohort(base2, mixed);
    expect(m.pDegradedWorstCase).toBeCloseTo(1 / 32, 12); // {+1 x4, +2}, not {+1 x4, +2, -2} = 13/64
    expect(m.reason).toBe("evaluator-unavailable");
  });

  it("an empty cohort is a veto (success-empty), never a quiet 'preserved'", () => {
    expect(judgeSuccessCohort([], [])).toMatchObject({ veto: true, reason: "success-empty", comparable: 0 });
  });

  it("POSITIVE CONTROL: 1-4 comparable won calls veto as underpowered -- the degradation test cannot reach alpha; 5 can", () => {
    const slide = (n: number) => judgeSuccessCohort(clean(n), Array.from({ length: n }, (_, i) => tr(`w${i}`, "100")));
    const four = slide(4);
    expect(four.pDegraded).toBeCloseTo(1 / 16, 12); // the first cut read this "preserved"
    expect(four).toMatchObject({ veto: true, reason: "underpowered" });
    expect(judgeSuccessCohort(clean(1), clean(1)).reason).toBe("underpowered");
    // Unbroken: at 5 the statistic is live -- the same slide is caught, an identical cohort passes.
    expect(slide(5).reason).toBe("success-degraded");
    expect(judgeSuccessCohort(clean(5), clean(5))).toMatchObject({ veto: false, reason: "preserved" });
    // Per-seed vetoes still outrank it on a small cohort.
    expect(judgeSuccessCohort(clean(3), [tr("w0", "000"), ...clean(3).slice(1)]).reason).toBe("success-regressed-seed");
  });

  it("an outage on an EXISTING won call never turns a veto into 'preserved' (property, both arms; flagged replays rewritten to their most misleading regex verdict)", () => {
    // Round-2 review: the previous version set the flag with the bits
    // unchanged. Here the judged replays are the truth and each flagged replay
    // is rewritten: 1 in the candidate arm (an unverified hit), 0 in the
    // baseline arm (an unverified miss). Also checked with the bits unchanged
    // and the seed-level flag alone.
    const rng = mulberry32(5150);
    let flaggedRegressions = 0;
    let flaggedPreserved = 0;
    let rawReaderViolations = 0;
    for (let run = 0; run < 2000; run++) {
      const n = 6 + Math.floor(rng() * 12);
      const probs = Array.from({ length: n }, () => (rng() < 0.7 ? 1 : rng() < 0.7 ? 0.9 : 0.5));
      const candProbs = probs.map((p) => (rng() < 0.06 ? 0 : rng() < 0.15 ? Math.max(0, p - 0.3) : p));
      const arm = (ps: number[]) =>
        ps.map((p, i) => tr(`w${i}`, [0, 1, 2].map(() => (rng() < p ? "1" : "0")).join("")));
      const base = arm(probs);
      const cand = arm(candProbs);
      const judged = judgeSuccessCohort(base, cand);
      const ids = new Set(base.filter(() => rng() < 0.2).map((s) => s.id));
      for (const id of judged.regressedSeeds) if (rng() < 0.7) ids.add(id);
      const outage = (t: SeedTrials[], regexBit: boolean): SeedTrials[] =>
        t.map((s) => {
          if (!ids.has(s.id)) return s;
          const unverified = s.passes.map(() => rng() < 0.5);
          if (!unverified.some(Boolean)) unverified[Math.floor(rng() * unverified.length)] = true;
          return { ...s, passes: s.passes.map((p, i) => (unverified[i] ? regexBit : p)), evaluatorUnavailable: true, unverified };
        });
      const inBase = rng() < 0.5;
      const fb = inBase ? outage(base, false) : base;
      const fc = inBase ? cand : outage(cand, true);
      const v = judgeSuccessCohort(fb, fc);
      const unchanged = judgeSuccessCohort(inBase ? flag(base, ids) : base, inBase ? cand : flag(cand, ids));
      if (!v.veto) {
        flaggedPreserved++;
        expect(judged.veto).toBe(false);
      }
      if (!unchanged.veto) expect(judged.veto).toBe(false);
      if (judged.regressedSeeds.some((id) => ids.has(id))) {
        flaggedRegressions++;
        expect(v.veto).toBe(true);
        expect(unchanged.veto).toBe(true);
      }
      if (!judgeSuccessCohort(blind(fb), blind(fc)).veto && judged.veto) rawReaderViolations++;
    }
    expect(flaggedRegressions).toBeGreaterThan(100);
    expect(flaggedPreserved).toBeGreaterThan(100);
    expect(rawReaderViolations).toBeGreaterThan(0); // CONTROL: the rewrite does hide real vetoes from a face-value reader
  });

  it("describeSuccessVerdict names the reason and the offending seeds", () => {
    const cand = clean(12);
    cand[4] = tr("w4", "000");
    const line = describeSuccessVerdict(judgeSuccessCohort(clean(12), cand));
    expect(line).toContain("success-regressed-seed");
    expect(line).toContain("regressed w4");
  });

  describe("calibration (A/A on won calls: 70% always pass, 20% pass 0.9, 10% coin flips; 3 replays)", () => {
    const successProbs = (n: number, rng: Rng) =>
      Array.from({ length: n }, () => {
        const u = rng();
        return u < 0.7 ? 1 : u < 0.9 ? 0.9 : 0.5;
      });
    const wonReplay = (probs: number[], vprobs: number[], rng: Rng) =>
      probs.map((p, i) => ({
        id: `w${i}`,
        passes: [0, 1, 2].map(() => rng() < p),
        unresolvable: false,
        evaluatorUnavailable: false,
        violations: [0, 1, 2].map(() => rng() < vprobs[i]),
      }));
    const aaVeto = (violationProne: number, reason?: string) =>
      rate(RUNS, (rng) => {
        const probs = successProbs(12, rng);
        const vprobs = probs.map(() => (rng() < violationProne ? 0.2 : 0));
        const v = judgeSuccessCohort(wonReplay(probs, vprobs, rng), wonReplay(probs, vprobs, rng));
        return reason ? v.reason === reason : v.veto;
      });

    it("no violation noise: A/A veto rate is small -- measured 1.95% at 12 seeds (1.90% coin-flip regressions, 0.05% degraded)", () => {
      expect(aaVeto(0)).toBeLessThanOrEqual(0.05);
      expect(aaVeto(0, "success-degraded")).toBeLessThanOrEqual(0.05);
    });

    it("DOCUMENTED COST: if 5% of won calls emit a violation on 20% of replays, the strict new-violation rule false-vetoes A/A runs -- measured 14.8%", () => {
      // Not a bug, a policy: one violating candidate reply on a seed whose
      // baseline replays were clean is disqualifying. This pins the price of
      // that policy so it cannot drift silently either way.
      const nv = aaVeto(0.05, "success-new-violation");
      expect(nv).toBeGreaterThan(0.08);
      expect(nv).toBeLessThan(0.2);
    });

    it("power: a candidate that breaks 3 always-passing won calls is vetoed in every run", () => {
      expect(
        rate(500, (rng) => {
          const probs = successProbs(12, rng);
          const none = probs.map(() => 0);
          const candProbs = probs.map((p, i) => (i < 3 ? 0 : p));
          const fixedBase = probs.map((p, i) => (i < 3 ? 1 : p));
          return judgeSuccessCohort(wonReplay(fixedBase, none, rng), wonReplay(candProbs, none, rng)).veto;
        }),
      ).toBe(1);
    });

    it("power under outage (round-2 review, probe [4]): the same 3 broken won calls are vetoed in every run when the candidate's judge drops out and the regex passes its down replays", () => {
      let dropPreserved = 0;
      const vetoRate = rate(2000, (rng) => {
        const probs = successProbs(12, rng);
        const candProbs = probs.map((p, i) => (i < 3 ? 0 : p));
        const fixedBase = probs.map((p, i) => (i < 3 ? 1 : p));
        const b = replay(fixedBase, 3, rng);
        const c = replayWithOutage(candProbs, 3, rng, 0.5, 0.3, true);
        if (!judgeSuccessCohort(...dropOutageSeeds(b, c)).veto) dropPreserved++;
        return judgeSuccessCohort(b, c).veto;
      });
      expect(dropPreserved).toBeGreaterThan(0); // CONTROL: the first cut's drop rule lets some through
      expect(vetoRate).toBe(1);
    });
  });
});

describe("judgeConfirmation", () => {
  it("is judgeHoldout's statistics, unchanged, on random cohorts (same verdict object, every field)", () => {
    const rng = mulberry32(777);
    for (let run = 0; run < 300; run++) {
      const n = 3 + Math.floor(rng() * 14);
      const probs = seedProbs(n, rng);
      const base = replayWithOutage(probs, 3, rng, 0.3, 0.1);
      const cand = replayWithOutage(probs.map((p) => (rng() < 0.3 ? 0.9 : p)), 3, rng, 0.3, 0.1);
      const alpha = rng() < 0.5 ? 0.05 : 0.01;
      expect(judgeConfirmation(base, cand, { alpha })).toEqual(judgeHoldout(base, cand, { alpha }));
    }
  });

  it("returns each holdout reason: improved, not-significant, underpowered, regressed-seed, evaluator-unavailable", () => {
    const n = (k: number, bits: string, prefix = "c") => Array.from({ length: k }, (_, i) => tr(`${prefix}${i}`, bits));
    expect(judgeConfirmation(n(6, "000"), n(6, "111")).reason).toBe("improved");
    expect(judgeConfirmation(n(6, "010"), n(6, "010")).reason).toBe("not-significant");
    expect(judgeConfirmation(n(4, "000"), n(4, "111")).reason).toBe("underpowered");
    expect(judgeConfirmation([tr("k", "111"), ...n(6, "000")], [tr("k", "000"), ...n(6, "111")]).reason).toBe("regressed-seed");
    const down = n(6, "000");
    down[0] = tr("c0", "000", { down: true });
    down[1] = tr("c1", "000", { down: true });
    expect(judgeConfirmation(down, n(6, "111")).reason).toBe("evaluator-unavailable");
  });
});

describe("describeVerdict", () => {
  it("names the reason, the seed counts and the p-value in one line", () => {
    const line = describeVerdict(judgeHoldout(
      Array.from({ length: 6 }, (_, i) => tr(`s${i}`, "0")),
      Array.from({ length: 6 }, (_, i) => tr(`s${i}`, "1")),
    ));
    expect(line).toContain("improved");
    expect(line).toContain("+6 -0 =0 of 6");
    expect(line).toContain("p=0.016");
    expect(line).not.toContain("evaluator outage");
  });

  it("still describes a verdict written before the outage fields existed (persisted row, old fixture) instead of throwing", () => {
    // Regression: the first cut read v.evaluatorUnavailableSeeds.length and
    // threw inside promptEvolutionWeekly's reporting path on exactly this shape.
    const legacy = {
      accept: false, reason: "regressed-seed" as const, comparable: 12, improved: 5, worsened: 1, tied: 6,
      pValue: 0.04, bestPossibleP: 1 / 4096, baselineSelfDisagreement: 3, regressedSeeds: ["call-7"],
      baseline: { passes: 12, trials: 36 }, candidate: { passes: 25, trials: 36 },
    };
    const line = describeVerdict(legacy);
    expect(line).toContain("regressed-seed · seeds +5 -1 =6 of 12");
    expect(line).toContain("regressed call-7");
    expect(line).not.toContain("evaluator outage");
  });
});
