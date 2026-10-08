/**
 * Blind pairwise review (2026-10-08): pairing never repeats a compared pair,
 * sides are not a function of recency, and agreement counts only picks the
 * judge could have been right or wrong about.
 */
import { describe, expect, it } from "vitest";
import { judgeAgreement, nextBlindPair, pickRecordFromAuditChanges, type PairCandidate } from "./pairwiseReview";

const c = (id: number, judgeTotal = 70): PairCandidate => ({ id, imageUrl: `https://cdn.example/${id}.jpg`, caption: `post ${id}`, judgeTotal });

describe("nextBlindPair", () => {
  it("pairs the newest two unseen posts and carries no score", () => {
    const pair = nextBlindPair([c(30), c(29), c(28)], new Set());
    expect(pair?.key).toBe("29-30");
    expect(new Set([pair?.a.id, pair?.b.id])).toEqual(new Set([30, 29]));
    expect(JSON.stringify(pair)).not.toContain("judge");
  });
  it("skips pairs already picked, whichever side they were shown on", () => {
    const pair = nextBlindPair([c(30), c(29), c(28)], new Set(["29-30"]));
    expect(pair?.key).toBe("28-30");
  });
  it("null when every pair in the window is compared, or fewer than two posts exist", () => {
    expect(nextBlindPair([c(2), c(1)], new Set(["1-2"]))).toBeNull();
    expect(nextBlindPair([c(1)], new Set())).toBeNull();
  });
  it("the newer post is not always side A", () => {
    const sides = new Set<string>();
    for (let id = 2; id < 40; id++) {
      const p = nextBlindPair([c(id), c(id - 1)], new Set())!;
      sides.add(p.a.id === id ? "newer-left" : "newer-right");
    }
    expect(sides).toEqual(new Set(["newer-left", "newer-right"]));
  });
});

describe("judgeAgreement", () => {
  it("counts agreement only where the judge took a side and so did the operator", () => {
    const r = judgeAgreement([
      { aId: 1, bId: 2, pick: "a", aJudge: 80, bJudge: 60 },   // agreed
      { aId: 3, bId: 4, pick: "b", aJudge: 80, bJudge: 60 },   // disagreed
      { aId: 5, bId: 6, pick: "tie", aJudge: 80, bJudge: 60 }, // tie: not scored
      { aId: 7, bId: 8, pick: "a", aJudge: 70, bJudge: 70 },   // judge indifferent: not scored
      { aId: 9, bId: 10, pick: "a", aJudge: null, bJudge: 60 }, // no snapshot: not scored
    ]);
    expect(r).toEqual({ picks: 5, scored: 2, agreed: 1, disagreed: 1, ties: 1, rate: 0.5 });
  });
  it("no scored pick is a null rate, never 0 or 1", () => {
    expect(judgeAgreement([]).rate).toBeNull();
    expect(judgeAgreement([{ aId: 1, bId: 2, pick: "tie", aJudge: 1, bJudge: 2 }]).rate).toBeNull();
  });
});

describe("pickRecordFromAuditChanges", () => {
  it("reads the shape logAdminAction writes and refuses anything else", () => {
    expect(pickRecordFromAuditChanges({ metadata: { old: null, new: { aId: 1, bId: 2, pick: "b", aJudge: 55, bJudge: 72 } } }))
      .toEqual({ aId: 1, bId: 2, pick: "b", aJudge: 55, bJudge: 72 });
    expect(pickRecordFromAuditChanges({ metadata: { old: null, new: { aId: 1, bId: 2, pick: "maybe" } } })).toBeNull();
    expect(pickRecordFromAuditChanges({ detail: { old: null, new: "x" } })).toBeNull();
    expect(pickRecordFromAuditChanges(null)).toBeNull();
  });
});
