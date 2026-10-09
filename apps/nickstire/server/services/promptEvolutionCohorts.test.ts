/**
 * Prompt-evolution cohorts - the three-way split must leave the holdout
 * exactly where ghostReplay.splitSeeds put it, and the copied hash must be
 * the same hash -- proven against the real splitSeeds, with a control showing
 * the fixed id list can tell a near-miss hash apart.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "@shared/experimentKernelCalibration";
import { splitSeeds } from "./ghostReplay";
import { minSeedsForAlpha } from "./promptEvolutionGate";
import {
  excludeConsumed,
  seedBucket,
  selectSuccessCohort,
  splitSeedsThreeWay,
} from "./promptEvolutionCohorts";

/**
 * Fixed ids: UUID-shaped call ids (the production shape) plus edge shapes --
 * empty, one char, and an astral code point, where a charCodeAt(i) loop
 * would read the low surrogate that splitSeeds' for..of never sees.
 */
function fixedIds(): string[] {
  const rng = mulberry32(20261009);
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join("");
  const uuids = Array.from({ length: 300 }, () => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`);
  return [...uuids, "", "a", "019fd32f", "call-\u{1F600}-x", "\u{1F697}\u{1F697}"];
}
const seeds = fixedIds().map((id) => ({ id }));
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

describe("splitSeedsThreeWay - holdout identity with ghostReplay.splitSeeds", () => {
  it("puts exactly the seeds splitSeeds holds out into the holdout, in the same order", () => {
    const three = splitSeedsThreeWay(seeds);
    const two = splitSeeds(seeds, 0.4);
    expect(two.holdout.length).toBeGreaterThan(80); // the list exercises the hash, not an empty slice
    expect(ids(three.holdout)).toEqual(ids(two.holdout));
    // What used to be train is now confirm + train, nothing lost or invented.
    expect(new Set([...ids(three.confirm), ...ids(three.train)])).toEqual(new Set(ids(two.train)));
  });

  it("CONTROL: the fixed list tells a near-miss hash apart (charCodeAt(i) over UTF-16 units)", () => {
    // If this list could not distinguish a wrong hash, the identity test above
    // would pass for a broken copy too.
    const nearMiss = (id: string) => {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      return h % 100;
    };
    const differs = seeds.filter((s) => nearMiss(s.id) !== seedBucket(s.id)).map((s) => s.id);
    expect(differs).toEqual(["call-\u{1F600}-x", "\u{1F697}\u{1F697}"]);
    const wrongHoldout = seeds.filter((s) => nearMiss(s.id) < 40).map((s) => s.id);
    expect(wrongHoldout).not.toEqual(ids(splitSeeds(seeds, 0.4).holdout));
  });

  it("buckets [0,40) holdout, [40,60) confirm, [60,100) train -- a disjoint cover of the input", () => {
    const { train, holdout, confirm } = splitSeedsThreeWay(seeds);
    for (const s of holdout) expect(seedBucket(s.id)).toBeLessThan(40);
    for (const s of confirm) {
      expect(seedBucket(s.id)).toBeGreaterThanOrEqual(40);
      expect(seedBucket(s.id)).toBeLessThan(60);
    }
    for (const s of train) expect(seedBucket(s.id)).toBeGreaterThanOrEqual(60);
    expect(holdout.length + confirm.length + train.length).toBe(seeds.length);
    expect(confirm.length).toBeGreaterThan(30);
  });

  it("is order-independent per seed: shuffling the input moves no seed between slices", () => {
    const shuffled = [...seeds].reverse();
    const a = splitSeedsThreeWay(seeds);
    const b = splitSeedsThreeWay(shuffled);
    for (const k of ["train", "holdout", "confirm"] as const) {
      expect(new Set(ids(b[k]))).toEqual(new Set(ids(a[k])));
    }
  });

  it("honours custom ratios and refuses impossible ones", () => {
    const { holdout, confirm, train } = splitSeedsThreeWay(seeds, { holdout: 0.3, confirm: 0.1 });
    expect(ids(holdout)).toEqual(ids(splitSeeds(seeds, 0.3).holdout));
    for (const s of confirm) expect([30, 31, 32, 33, 34, 35, 36, 37, 38, 39]).toContain(seedBucket(s.id));
    for (const s of train) expect(seedBucket(s.id)).toBeGreaterThanOrEqual(40);
    expect(splitSeedsThreeWay(seeds, { holdout: 0.4, confirm: 0 }).confirm).toEqual([]);
    expect(() => splitSeedsThreeWay(seeds, { holdout: 0.7, confirm: 0.4 })).toThrow(/sum to <= 1/);
    expect(() => splitSeedsThreeWay(seeds, { holdout: -0.1 })).toThrow();
    expect(() => splitSeedsThreeWay(seeds, { confirm: Number.NaN })).toThrow();
  });
});

describe("splitSeedsThreeWay - the confirmation slice is too small at the loop's seed counts", () => {
  // Pins the SIZE numbers in the module header, so the doc cannot drift from
  // the hash. minSeedsForAlpha(0.05) = 5 is where judgeConfirmation stops
  // reading "underpowered".
  const need = minSeedsForAlpha(0.05);
  const rng = mulberry32(20261009);
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join("");
  const uuid = () => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
  const reachRate = (poolSize: number, draws = 4000) => {
    let ok = 0;
    for (let t = 0; t < draws; t++) {
      const pool = Array.from({ length: poolSize }, () => ({ id: uuid() }));
      if (splitSeedsThreeWay(pool).confirm.length >= need) ok++;
    }
    return ok / draws;
  };

  it("needs 5 comparable seeds at alpha 0.05 (6 at 0.025) -- the bar the slice must clear", () => {
    expect(need).toBe(5);
    expect(minSeedsForAlpha(0.025)).toBe(6);
  });

  it("pool 12 reaches it in ~7% of draws, pool 30 in ~75%, pool 44 in >= 95% -- measured 7.4% / 75.5% / 95.6%", () => {
    const r12 = reachRate(12);
    const r30 = reachRate(30);
    const r44 = reachRate(44);
    expect(r12).toBeGreaterThan(0.04);
    expect(r12).toBeLessThan(0.11);
    expect(r30).toBeGreaterThan(0.7);
    expect(r30).toBeLessThan(0.8);
    expect(r44).toBeGreaterThanOrEqual(0.94);
  });
});

describe("excludeConsumed", () => {
  it("drops exactly the consumed ids and keeps input order", () => {
    const xs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(ids(excludeConsumed(xs, ["c", "a", "zz"]))).toEqual(["b", "d"]);
    expect(ids(excludeConsumed(xs, new Set<string>()))).toEqual(["a", "b", "c", "d"]);
  });

  it("a consumed confirmation seed never reaches the next confirmation slice", () => {
    const first = splitSeedsThreeWay(seeds).confirm;
    const spent = ids(first.slice(0, 10));
    const next = splitSeedsThreeWay(excludeConsumed(seeds, spent)).confirm;
    expect(next.length).toBe(first.length - 10);
    for (const id of spent) expect(ids(next)).not.toContain(id);
  });
});

describe("selectSuccessCohort", () => {
  it("is deterministic and independent of the pool's order", () => {
    const pool = seeds.slice(0, 200);
    const a = selectSuccessCohort(pool, 12);
    const b = selectSuccessCohort([...pool].reverse(), 12);
    expect(a).toHaveLength(12);
    expect(ids(b)).toEqual(ids(a));
  });

  it("is a prefix-stable ranking: a larger cohort contains the smaller one", () => {
    const small = ids(selectSuccessCohort(seeds, 8));
    const big = ids(selectSuccessCohort(seeds, 20));
    expect(big.slice(0, 8)).toEqual(small);
  });

  it("breaks hash ties by id, so equal-hash seeds still order deterministically", () => {
    // "Aa" and "BB" collide under h*31 + c (65*31+97 = 66*31+66 = 2112).
    expect(ids(selectSuccessCohort([{ id: "BB" }, { id: "Aa" }], 2))).toEqual(["Aa", "BB"]);
    expect(ids(selectSuccessCohort([{ id: "Aa" }, { id: "BB" }], 2))).toEqual(["Aa", "BB"]);
  });

  it("returns nothing for n <= 0 and the whole pool when n exceeds it", () => {
    expect(selectSuccessCohort(seeds, 0)).toEqual([]);
    expect(selectSuccessCohort(seeds, -3)).toEqual([]);
    expect(selectSuccessCohort(seeds.slice(0, 5), 50)).toHaveLength(5);
  });
});
