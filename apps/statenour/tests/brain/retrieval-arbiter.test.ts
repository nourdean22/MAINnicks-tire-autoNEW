/**
 * tests/brain/retrieval-arbiter.test.ts · 2026-09-08 (Brain plan §6.4, Wave 2)
 *
 * Unit tests on the PURE arbiter: union, content-identity dedupe, lane
 * attribution, RRF ordering (hand-computed at k = 60), tie-breaks, greedy
 * MMR, budget, garbage tolerance, determinism. Nothing is wired yet.
 */
import { describe, it, expect } from "vitest";
import { arbitrate, normalizeContent, type ArbiterCandidate, type EvidenceItem } from "@/lib/brain/retrieval-arbiter";

const hybrid = (id: string, rank: number, extra: Partial<ArbiterCandidate> = {}): ArbiterCandidate => ({ id, lane: "hybrid", rank, ...extra });
const contextual = (id: string, rank: number, extra: Partial<ArbiterCandidate> = {}): ArbiterCandidate => ({ id, lane: "contextual", rank, ...extra });
const ids = (items: EvidenceItem[]) => items.map((i) => i.id);
/** A similarity that returns the configured value for an unordered id pair, 0 otherwise. */
const pairSimilarity = (pairs: Record<string, number>) => (a: EvidenceItem, b: EvidenceItem) => pairs[[a.id, b.id].sort().join("|")] ?? 0;

describe("normalizeContent", () => {
  it("collapses whitespace, trims and lowercases — the content-identity key", () => {
    expect(normalizeContent("  Rent   is\n$1,900 \t a Month ")).toBe("rent is $1,900 a month");
  });
});

describe("arbitrate · union + dedupe", () => {
  it("unions a row both lanes nominated: one item, both ranks, lane attribution, fields filled first-wins", () => {
    const out = arbitrate([
      // contextual-recall emits `key: ""` for a keyless memory (contextual-recall.ts onRanked) — seen FIRST here on purpose
      contextual("m1", 3, { key: "", source: "operator", category: "money", relevance: "direct" }),
      hybrid("m1", 0, { content: "Rent is $1,900 a month", key: "rent", category: "finance" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "m1",
      lanes: ["hybrid", "contextual"],
      ranks: { hybrid: 0, contextual: 3 },
      content: "Rent is $1,900 a month", // filled from the hybrid hit
      key: "rent", // "" counts as absent, so the hybrid hit's key fills in
      category: "money", // first candidate wins
      source: "operator",
    });
    expect(out[0]).not.toHaveProperty("relevance");
    expect(out[0].rrf).toBeCloseTo(1 / 61 + 1 / 64, 12);
  });

  it("keeps the best (lowest) rank when the same lane nominates an id twice", () => {
    const out = arbitrate([hybrid("m1", 4), hybrid("m1", 1)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ lanes: ["hybrid"], ranks: { hybrid: 1 } });
    expect(out[0].rrf).toBeCloseTo(1 / 62, 12);
  });

  it("merges items whose content is identical after normalization — first id wins, lanes and ranks union", () => {
    const out = arbitrate([
      hybrid("m1", 0, { content: "Rent is $1,900 a month" }),
      contextual("m2", 1, { content: "rent  is $1,900 a month", source: "operator" }),
      contextual("m3", 0, { content: "Sister visits in October" }),
    ]);
    expect(ids(out)).toEqual(["m1", "m3"]);
    expect(out[0]).toMatchObject({ id: "m1", lanes: ["hybrid", "contextual"], ranks: { hybrid: 0, contextual: 1 }, source: "operator" });
    expect(out[1]).toMatchObject({ id: "m3", lanes: ["contextual"], ranks: { contextual: 0 } });
  });

  it("never merges items that carry no content", () => {
    expect(ids(arbitrate([hybrid("m1", 0), hybrid("m2", 1)]))).toEqual(["m1", "m2"]);
  });
});

describe("arbitrate · RRF ordering (k = 60)", () => {
  it("scores each lane 1/(k + rank + 1) and orders by the sum — hand-computed", () => {
    const out = arbitrate([hybrid("a", 0), hybrid("b", 1), contextual("b", 0), contextual("c", 1)]);
    expect(ids(out)).toEqual(["b", "a", "c"]);
    expect(out[0].rrf).toBeCloseTo(1 / 62 + 1 / 61, 12); // b: hybrid rank 1 + contextual rank 0
    expect(out[1].rrf).toBeCloseTo(1 / 61, 12); // a: hybrid rank 0
    expect(out[2].rrf).toBeCloseTo(1 / 62, 12); // c: contextual rank 1
  });

  it("an item in both lanes outranks a top-1 single-lane item only when the arithmetic says so", () => {
    // ranks (0, 3) vs (-, 0): 1/61 + 1/64 = 0.03202 > 1/61 = 0.01639 → the two-lane item wins
    const wins = arbitrate([hybrid("both", 0), contextual("both", 3), contextual("solo", 0)]);
    expect(ids(wins)).toEqual(["both", "solo"]);
    expect(wins[0].rrf).toBeCloseTo(1 / 61 + 1 / 64, 12);
    expect(wins[1].rrf).toBeCloseTo(1 / 61, 12);

    // ranks (62, 62) vs (-, 0): 2/123 = 0.01626 < 1/61 = 0.01639 → the single-lane top-1 wins
    const loses = arbitrate([hybrid("both", 62), contextual("both", 62), contextual("solo", 0)]);
    expect(ids(loses)).toEqual(["solo", "both"]);
    expect(loses[1].rrf).toBeCloseTo(2 / 123, 12);
    expect(loses[1].rrf).toBeLessThan(loses[0].rrf);

    // ranks (61, 61) vs (-, 0): 1/122 + 1/122 === 1/61 bit-for-bit → an exact tie, broken by lane count
    const ties = arbitrate([hybrid("both", 61), contextual("both", 61), contextual("solo", 0)]);
    expect(ties[0].rrf).toBe(ties[1].rrf);
    expect(ids(ties)).toEqual(["both", "solo"]);
  });

  it("breaks exact ties by lane count, then hybrid before contextual, then id", () => {
    const out = arbitrate([contextual("zeta", 0), hybrid("mid", 0), contextual("alpha", 0)]);
    expect(out.every((i) => i.rrf === 1 / 61)).toBe(true);
    expect(ids(out)).toEqual(["mid", "alpha", "zeta"]);
  });

  it("honours a custom k", () => {
    const out = arbitrate([hybrid("a", 0), contextual("a", 1)], { k: 1 });
    expect(out[0].rrf).toBeCloseTo(1 / 2 + 1 / 3, 12);
  });
});

describe("arbitrate · redundancy (greedy MMR) + budget", () => {
  it("drops a near-duplicate (custom similarity 0.9) and keeps a distinct one; only KEPT items block later ones", () => {
    const similarity = pairSimilarity({ "a|b": 0.9, "b|c": 0.9 });
    const out = arbitrate([hybrid("a", 0), hybrid("b", 1), hybrid("c", 2)], { similarity });
    // a kept · b: 0.9 to a ≥ 0.65 → dropped · c: 0 to a (b was never kept, so its 0.9 to c is moot) → kept
    expect(ids(out)).toEqual(["a", "c"]);
  });

  it("defaults to Jaccard over lowercase word tokens; missing content is never penalized", () => {
    const out = arbitrate([
      hybrid("a", 0, { content: "Rent is $1,900 a month" }),
      hybrid("b", 1, { content: "rent is $1,900 per month" }), // tokens share 5 of 7 → 0.714 ≥ 0.65 → dropped
      hybrid("c", 2, { content: "Sister visits in October" }), // 0 → kept
      hybrid("d", 3), // no content → 0 → kept
    ]);
    expect(ids(out)).toEqual(["a", "c", "d"]);
  });

  it("redundancyPenalty 0 keeps everything short of an identical token set; 1 keeps only the first item", () => {
    const pack = [
      hybrid("a", 0, { content: "Rent is $1,900 a month" }),
      hybrid("b", 1, { content: "rent is $1,900 per month" }),
      hybrid("c", 2, { content: "Sister visits in October" }),
    ];
    expect(ids(arbitrate(pack, { redundancyPenalty: 0 }))).toEqual(["a", "b", "c"]);
    expect(ids(arbitrate(pack, { redundancyPenalty: 1 }))).toEqual(["a"]);
  });

  it("cuts to limit AFTER the redundancy pass, so a dropped duplicate frees its slot", () => {
    const five = ["a", "b", "c", "d", "e"].map((id, rank) => hybrid(id, rank));
    expect(ids(arbitrate(five, { limit: 2 }))).toEqual(["a", "b"]);
    expect(ids(arbitrate(five, { limit: 2, similarity: pairSimilarity({ "a|b": 0.9 }) }))).toEqual(["a", "c"]);
    expect(arbitrate(five, { limit: 0 })).toEqual([]);
  });
});

describe("arbitrate · garbage tolerance + determinism", () => {
  it("returns [] for empty and non-array input", () => {
    expect(arbitrate([])).toEqual([]);
    expect(arbitrate(undefined as unknown as ArbiterCandidate[])).toEqual([]);
    expect(arbitrate(null as unknown as ArbiterCandidate[])).toEqual([]);
  });

  it("drops candidates without a usable id, lane or rank and never throws", () => {
    const garbage = [
      { lane: "hybrid", rank: 0 }, // no id
      { id: "", lane: "contextual", rank: 0 }, // contextual rows can carry id: ""
      { id: 42, lane: "hybrid", rank: 0 }, // non-string id
      { id: "x", lane: "vector", rank: 0 }, // unknown lane
      { id: "y", lane: "hybrid", rank: Number.NaN }, // NaN rank would poison the sort
      { id: "z", lane: "hybrid", rank: -1 }, // negative rank
      { id: "w", lane: "hybrid" }, // missing rank
      null,
      "not an object",
      { id: "ok", lane: "hybrid", rank: 0, content: 7, key: "" }, // non-string / empty fields read as absent, the item survives
    ] as unknown as ArbiterCandidate[];
    const out = arbitrate(garbage);
    expect(ids(out)).toEqual(["ok"]);
    expect(out[0].content).toBeUndefined();
    expect(out[0].key).toBeUndefined();
  });

  it("is deterministic and does not mutate its input", () => {
    const input = [
      hybrid("m1", 0, { content: "Rent is $1,900 a month", key: "rent" }),
      contextual("m2", 0, { content: "rent  is $1,900 a month", source: "operator" }),
      contextual("m3", 1, { content: "Sister visits in October" }),
      hybrid("m4", 1, { content: "Rent is $1,900 per month" }),
      hybrid("m5", 2),
    ];
    const snapshot = structuredClone(input);
    const first = arbitrate(input);
    const second = arbitrate(input);
    expect(first).toEqual(second);
    expect(input).toEqual(snapshot);
    expect(ids(first)).toEqual(["m1", "m3", "m5"]); // m2 merged into m1 by content, m4 dropped by Jaccard
  });
});
