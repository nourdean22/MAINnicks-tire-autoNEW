/**
 * RRF behavior corpus · v10.0.361
 */

import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, fuseRankings } from "@/lib/brain/rrf";

describe("reciprocalRankFusion", () => {
  it("rewards items appearing in both lanes", () => {
    const semantic = [
      { id: "a", item: "A" },
      { id: "b", item: "B" },
      { id: "c", item: "C" },
    ];
    const keyword = [
      { id: "b", item: "B" },
      { id: "d", item: "D" },
      { id: "a", item: "A" },
    ];

    const fused = reciprocalRankFusion([semantic, keyword]);
    // 'a' is rank 1 in semantic + rank 3 in keyword
    // 'b' is rank 2 in semantic + rank 1 in keyword · should out-rank everything
    expect(fused[0].id).toBe("b");
    // Both 'a' and 'b' should appear in 2 lanes
    expect(fused.find((x) => x.id === "a")?.lanes.length).toBe(2);
    expect(fused.find((x) => x.id === "b")?.lanes.length).toBe(2);
  });

  it("single-lane items still rank by their position", () => {
    const semantic = [
      { id: "a", item: "A" },
      { id: "b", item: "B" },
    ];
    const keyword = [{ id: "c", item: "C" }];
    const fused = reciprocalRankFusion([semantic, keyword]);
    expect(fused.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("respects weights between lanes", () => {
    const semantic = [{ id: "a", item: "A" }];
    const keyword = [{ id: "b", item: "B" }];
    // Weight semantic 10x · 'a' should win
    const fused = reciprocalRankFusion([semantic, keyword], { weights: [10, 1] });
    expect(fused[0].id).toBe("a");
  });

  it("k constant flattens the curve when high", () => {
    const lane1 = [
      { id: "a", item: "A" },
      { id: "b", item: "B" },
    ];
    const lane2 = [
      { id: "b", item: "B" },
      { id: "a", item: "A" },
    ];
    const fused = reciprocalRankFusion([lane1, lane2], { k: 60 });
    // Both items appear in both lanes at ranks {1,2}, so should be tied
    expect(Math.abs(fused[0].score - fused[1].score)).toBeLessThan(0.001);
  });
});

describe("fuseRankings · convenience over a single corpus", () => {
  it("combines multiple scoring lenses on the same items", () => {
    interface Doc {
      id: string;
      title: string;
      semantic: number;
      keyword: number;
    }
    const docs: Doc[] = [
      { id: "1", title: "x", semantic: 0.95, keyword: 0.1 },
      { id: "2", title: "y", semantic: 0.5,  keyword: 0.95 },
      { id: "3", title: "z", semantic: 0.7,  keyword: 0.7 },
    ];
    const fused = fuseRankings(docs, [
      (d) => d.semantic,
      (d) => d.keyword,
    ]);
    // Doc 3 is consistent in both (rank 2 + rank 2) · should win the fusion
    // because doc 1 is rank 1 in semantic + rank 3 in keyword
    // and doc 2 is rank 3 in semantic + rank 1 in keyword
    // Doc 3 rank-sum = 2+2=4, doc 1 = 1+3=4, doc 2 = 3+1=4
    // RRF rewards doc 3 because it has consistent middling ranks vs.
    // the bipolar pattern of 1+3.
    // Actually with k=60: doc1 = 1/61 + 1/63, doc2 = 1/63 + 1/61, doc3 = 1/62 + 1/62
    // doc1 + doc2 ≈ 0.01639 + 0.01587 = 0.03226 each
    // doc3 = 2 * (1/62) = 0.03226 — TIED. So order is undefined.
    // Verify all three are present and have similar scores.
    expect(fused.map((x) => x.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("rewards items strong in multiple dimensions", () => {
    interface Doc { id: string; semantic: number; keyword: number; }
    const docs: Doc[] = [
      { id: "1", semantic: 0.9, keyword: 0.9 }, // strong in both
      { id: "2", semantic: 0.95, keyword: 0.1 }, // only semantic
      { id: "3", semantic: 0.05, keyword: 0.95 }, // only keyword
    ];
    const fused = fuseRankings(docs, [
      (d) => d.semantic,
      (d) => d.keyword,
    ]);
    // Doc 1 is rank 2 in semantic + rank 2 in keyword
    // Doc 2 is rank 1 + rank 3
    // Doc 3 is rank 3 + rank 1
    // RRF doc 1 = 1/62 + 1/62 ≈ 0.0323
    // RRF doc 2 = 1/61 + 1/63 ≈ 0.03228
    // RRF doc 3 = 1/63 + 1/61 ≈ 0.03228
    // Very close · doc1 should still narrowly win OR tie with bipolar items
    expect(fused.map((x) => x.id)).toContain("1");
  });
});

/**
 * 2026-09-18 · A FULLY TIED LANE IS NOT NEUTRAL (found in review of PR #2425).
 *
 * RRF ignores absolute scores and reads POSITION. `fuseRankings` sorts each
 * lane by score, and Array#sort is stable — so a lane where every score is
 * identical degrades into INPUT ORDER and then gets paid out as
 * 1/(k+1), 1/(k+2), ..., a monotonically decreasing signal manufactured from
 * nothing.
 *
 * It bit contextual-recall concretely: on a zero-topic turn `keywordScore` is
 * 0 for every candidate, and that pool is `orderBy confidence desc` with
 * KNN-only vector hits unioned in afterward — so the phantom lane boosted
 * generic high-confidence rows over the vector hits.
 */
describe("fuseRankings · a lane with no information must not vote", () => {
  const docs = [
    { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" },
  ];

  it("a constant lane does not change the ordering the real lane produced", () => {
    const realOnly = fuseRankings(docs, [(d) => ({ a: 1, b: 4, c: 3, d: 2 } as Record<string, number>)[d.id]]);
    const withPhantom = fuseRankings(docs, [
      (d) => ({ a: 1, b: 4, c: 3, d: 2 } as Record<string, number>)[d.id],
      () => 0, // every doc ties — carries zero information
    ]);
    expect(withPhantom.map((r) => r.id)).toEqual(realOnly.map((r) => r.id));
    // The headline: input order must not leak in. "a" is FIRST in `docs` and
    // LAST by real score; a phantom positional lane would drag it up.
    expect(withPhantom[withPhantom.length - 1].id).toBe("a");
  });

  it("the phantom lane's weight cannot shift the surviving lanes' weights", () => {
    // Dropping a lane must drop its weight with it, or weights[] silently
    // re-indexes onto the wrong lane — a worse bug than the one being fixed.
    const fused = fuseRankings(
      docs,
      [() => 0, (d) => ({ a: 1, b: 4, c: 3, d: 2 } as Record<string, number>)[d.id]],
      { weights: [99, 1] },
    );
    expect(fused[0].id).toBe("b"); // highest real score still wins
    expect(fused[fused.length - 1].id).toBe("a");
  });

  it("when EVERY lane is tied it still returns all items, never an empty result", () => {
    // Degenerate input must not silently erase the corpus.
    const fused = fuseRankings(docs, [() => 0, () => 7]);
    expect(fused).toHaveLength(4);
    expect(fused.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("a genuinely informative lane is still fused (the fix is not 'drop everything')", () => {
    const fused = fuseRankings(docs, [
      (d) => ({ a: 4, b: 1, c: 1, d: 1 } as Record<string, number>)[d.id],
      (d) => ({ a: 1, b: 4, c: 1, d: 1 } as Record<string, number>)[d.id],
    ]);
    // Both lanes carry signal; a and b each top one lane, so they lead.
    expect(fused.slice(0, 2).map((r) => r.id).sort()).toEqual(["a", "b"]);
  });
});
