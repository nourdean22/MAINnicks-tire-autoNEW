/**
 * tests/brain/recall-corpus-tiers.test.ts — the sealed evaluation boundary.
 *
 * StateNour's recall corpus had NO holdout: runRecallEval scored EVERY case on
 * EVERY run, so any weight/prompt/ranking change could be tuned against the same
 * 121 cases used to report the result. A number measured on the data it was
 * fitted to is not a measurement.
 *
 * ⚠ `HOLDOUT_EPISODES_B64` is nickstire's Playwright holdout — a different
 * corpus, runner and product. It has been mistaken for a StateNour holdout more
 * than once. It is not one.
 */
import { describe, it, expect } from "vitest";
import {
  tierForCaseId,
  splitByTier,
  sealedCorpusPath,
  describeSealed,
  improvementIsCitable,
  TIER_SHARES,
  type CorpusTier,
} from "@/lib/brain/recall-corpus-tiers";

describe("tier assignment is deterministic and STABLE under corpus growth", () => {
  it("the same id always lands in the same tier", () => {
    const id = "real-fact-cmu62s2rt016";
    const first = tierForCaseId(id);
    for (let i = 0; i < 50; i++) expect(tierForCaseId(id)).toBe(first);
  });

  it("★ CANARY: adding cases does NOT reshuffle existing assignments", () => {
    // This is the property an index-based split (i % 4) silently destroys. Under
    // that scheme every assignment moves when one case is added, which slides
    // cases between "tuned against" and "sealed" and makes runs incomparable.
    const before = Array.from({ length: 40 }, (_, i) => ({ id: `case-${i}` }));
    const assignedBefore = new Map(before.map((c) => [c.id, tierForCaseId(c.id)]));

    const after = [...before, ...Array.from({ length: 25 }, (_, i) => ({ id: `new-${i}` }))];
    for (const c of after) {
      const prior = assignedBefore.get(c.id);
      if (prior) expect(tierForCaseId(c.id)).toBe(prior);
    }
  });

  it("every tier is reachable — none is dead code", () => {
    const seen = new Set<CorpusTier>();
    for (let i = 0; i < 400; i++) seen.add(tierForCaseId(`probe-${i}`));
    expect(seen).toEqual(new Set(["development", "regression", "sealed"]));
  });

  it("the split is roughly the declared shares", () => {
    const n = 4000;
    const cases = Array.from({ length: n }, (_, i) => ({ id: `s-${i}` }));
    const s = splitByTier(cases);
    expect(s.development.length + s.regression.length + s.sealed.length).toBe(n);
    // Generous tolerance — this pins "the shares are honoured", not the RNG.
    expect(s.sealed.length / n).toBeGreaterThan(TIER_SHARES.sealed - 0.05);
    expect(s.sealed.length / n).toBeLessThan(TIER_SHARES.sealed + 0.05);
    expect(s.development.length / n).toBeGreaterThan(TIER_SHARES.development - 0.05);
  });

  it("splitByTier loses no case and duplicates none", () => {
    const cases = Array.from({ length: 121 }, (_, i) => ({ id: `c-${i}` }));
    const s = splitByTier(cases);
    const all = [...s.development, ...s.regression, ...s.sealed].map((c) => c.id);
    expect(new Set(all).size).toBe(121);
  });
});

describe("the sealed corpus lives OUTSIDE the checkout", () => {
  it("defaults to a home-directory path, not a repo path", () => {
    const p = sealedCorpusPath({ HOME: "/home/nour" } as NodeJS.ProcessEnv);
    expect(p).toContain("/home/nour");
    expect(p).toContain(".nourcity-holdout");
    // The point of the location IS the secrecy — a repo path would be readable
    // by any agent working in the tree and greppable from git.
    expect(p).not.toContain("eval-datasets");
    expect(p).not.toContain("apps/statenour");
  });

  it("RECALL_HOLDOUT_PATH overrides it for CI", () => {
    expect(sealedCorpusPath({ RECALL_HOLDOUT_PATH: "/runner/tmp/s.json" } as NodeJS.ProcessEnv))
      .toBe("/runner/tmp/s.json");
  });
});

describe("an ABSENT sealed tier must never read as a pass", () => {
  it("★ CANARY: unmeasured says so, and says it is not a pass", () => {
    // The whole boundary is worthless if a missing evaluator renders as success.
    // A hidden evaluator is precisely the instrument whose silence nobody notices.
    const s = describeSealed({ status: "unmeasured", cases: 0, precisionAtK: null, reason: "file missing" });
    expect(s).toContain("UNMEASURED");
    expect(s).toContain("NOT a pass");
    expect(s).toContain("file missing");
  });

  it("★ present-but-EMPTY is also not a pass", () => {
    // The subtler failure: the file exists, so a naive check says "found it",
    // and it scores 0 cases while printing a healthy-looking line.
    const s = describeSealed({ status: "measured", cases: 0, precisionAtK: null });
    expect(s).toContain("UNMEASURED");
    expect(s).toContain("NOT a pass");
  });

  it("a measured sealed tier reports aggregate only", () => {
    const s = describeSealed({ status: "measured", cases: 30, precisionAtK: 0.3667 });
    expect(s).toContain("0.3667");
    expect(s).toContain("n=30");
    expect(s).toContain("aggregate only");
  });

  it("a THIN sealed tier is labelled thin rather than quoted confidently", () => {
    const s = describeSealed({ status: "measured", cases: 19, precisionAtK: 0.5 });
    expect(s).toContain("thin");
  });
});

describe("improvementIsCitable stops development-tier movement becoming a claim", () => {
  it("★ CANARY: an unmeasured sealed tier makes NOTHING citable", () => {
    const r = improvementIsCitable({
      sealed: { status: "unmeasured", cases: 0, precisionAtK: null },
      regressionDelta: +0.2,
    });
    // Even a large regression-tier gain does not rescue it: without the sealed
    // tier there is no evidence the change generalises rather than fits.
    expect(r.citable).toBe(false);
    expect(r.reason).toContain("UNMEASURED");
  });

  it("★ a regression DROP blocks the claim even with a measured sealed tier", () => {
    const r = improvementIsCitable({
      sealed: { status: "measured", cases: 30, precisionAtK: 0.4 },
      regressionDelta: -0.05,
    });
    expect(r.citable).toBe(false);
    expect(r.reason).toContain("regression tier DROPPED");
  });

  it("CONTROL: a measured sealed tier with no regression drop IS citable", () => {
    // Without this, a predicate hard-wired to `false` would pass every test above.
    const r = improvementIsCitable({
      sealed: { status: "measured", cases: 30, precisionAtK: 0.4 },
      regressionDelta: +0.01,
    });
    expect(r.citable).toBe(true);
  });

  it("a null regression delta (no baseline yet) does not block on its own", () => {
    const r = improvementIsCitable({
      sealed: { status: "measured", cases: 30, precisionAtK: 0.4 },
      regressionDelta: null,
    });
    expect(r.citable).toBe(true);
  });
});
