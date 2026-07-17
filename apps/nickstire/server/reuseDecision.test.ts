/**
 * Media reuse decision engine (milestone 13 §26). Reuse a strong, relevant,
 * in-rights, un-fatigued asset; reference a fatigued one for a fresh gen;
 * create new when nothing qualifies. Never reuse blindly.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_REUSE, chooseReuse, decideReuse, type ReuseCandidate } from "./services/reuseDecision";

const cand = (over: Partial<ReuseCandidate>): ReuseCandidate => ({
  assetId: "ma_x", qualityScore: 85, usageCount: 0, daysSinceLastUse: null,
  rightsOk: true, relevance: 0.9, hasRepairableDefect: false, ...over,
});

describe("decideReuse", () => {
  it("reuses a strong, relevant, fresh, in-rights asset AS-IS", () => {
    expect(decideReuse(cand({})).decision).toBe("REUSE_AS_IS");
  });
  it("never reuses without rights", () => {
    expect(decideReuse(cand({ rightsOk: false })).decision).toBe("DO_NOT_REUSE");
  });
  it("irrelevant asset -> create new", () => {
    expect(decideReuse(cand({ relevance: 0.2 })).decision).toBe("CREATE_NEW");
  });
  it("fatigued-by-overuse strong asset -> visual reference for a fresh gen (no literal repeat)", () => {
    expect(decideReuse(cand({ usageCount: 5 })).decision).toBe("USE_AS_VISUAL_REFERENCE");
  });
  it("fatigued-by-recency -> reference, not repeat", () => {
    expect(decideReuse(cand({ daysSinceLastUse: 3 })).decision).toBe("USE_AS_VISUAL_REFERENCE");
  });
  it("strong asset with a fixable defect -> reuse with repair", () => {
    expect(decideReuse(cand({ hasRepairableDefect: true, qualityScore: 80 })).decision).toBe("REUSE_WITH_REPAIR");
  });
  it("mediocre but not-fatigued asset -> reference; too-low -> create new", () => {
    expect(decideReuse(cand({ qualityScore: 55 })).decision).toBe("USE_AS_VISUAL_REFERENCE");
    expect(decideReuse(cand({ qualityScore: 20 })).decision).toBe("CREATE_NEW");
  });
});

describe("chooseReuse", () => {
  it("empty library -> create new", () => {
    expect(chooseReuse([]).decision).toBe("CREATE_NEW");
  });
  it("prefers the reuse-as-is asset over a create-new candidate", () => {
    const r = chooseReuse([cand({ assetId: "weak", qualityScore: 20 }), cand({ assetId: "strong", qualityScore: 90 })]);
    expect(r.decision).toBe("REUSE_AS_IS");
    expect(r.assetId).toBe("strong");
  });
  it("all rights-blocked -> create new (never publishes a blocked asset)", () => {
    const r = chooseReuse([cand({ rightsOk: false }), cand({ rightsOk: false })]);
    expect(r.decision).toBe("CREATE_NEW");
  });
});
