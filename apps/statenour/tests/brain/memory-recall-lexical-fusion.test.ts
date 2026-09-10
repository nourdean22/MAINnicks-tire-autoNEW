/**
 * LEXICAL FUSION tests -- 2026-09-10.
 *
 * `lib/brain/memory-recall.ts` advertised "Hybrid search (FTS + KNN)" in
 * its module header from the day it was written, and contained two SQL
 * statements, both `ORDER BY embedding <=> $1::vector`. The FTS half
 * lived in contextual-recall.ts, feeding a different prompt block that
 * the Memory Inspector does not count.
 *
 * These tests pin the three-lane fusion and, more importantly, pin the
 * BACKWARD COMPATIBILITY of the two-lane call -- the existing durable-
 * lane canary depends on the old ordering being untouched when no
 * lexical rows are present.
 *
 * The SQL lane itself needs a database and is therefore not unit-tested
 * here; its behaviour is covered by the provenance contract in
 * recall-provenance.test.ts and belongs to an integration run.
 */
import { describe, it, expect } from "vitest";
import { rrfMergeHitOrders, type RecallHit } from "@/lib/brain/memory-recall";

function hit(id: string, score = 1): RecallHit {
  return {
    memoryId: id,
    category: "fact",
    key: `k:${id}`,
    content: `content ${id}`,
    confidence: 0.8,
    seenCount: 1,
    ageDays: 1,
    factAgeDays: 1,
    knnDistance: 1 - score,
    finalScore: score,
  } as RecallHit;
}

describe("three-lane fusion", () => {
  // CONTROL for the existing durable canary: adding a third lane must
  // not change what a two-lane call does. A "compatible" signature that
  // quietly reorders results is not compatible.
  it("CONTROL - an empty lexical lane leaves the two-lane result untouched", () => {
    const main = [hit("a"), hit("b"), hit("c")];
    const durable = [hit("d")];
    const two = rrfMergeHitOrders(main, durable);
    const three = rrfMergeHitOrders(main, durable, []);
    expect(three.map((h) => h.memoryId)).toEqual(two.map((h) => h.memoryId));
  });

  it("CONTROL - no durable and no lexical returns the main ordering by identity", () => {
    const main = [hit("a"), hit("b")];
    expect(rrfMergeHitOrders(main, [], [])).toBe(main);
  });

  it("surfaces a lexical-only hit that dense retrieval never returned", () => {
    // The whole point: "the taper plan" shares a literal token with the
    // stored memory but sits far away in embedding space, so it appears
    // in no dense lane at all.
    const main = [hit("dense1"), hit("dense2")];
    const fused = rrfMergeHitOrders(main, [], [hit("taper-plan")]);
    expect(fused.map((h) => h.memoryId)).toContain("taper-plan");
  });

  it("a row found by BOTH dense and lexical outranks one found by only one", () => {
    // Agreement across independent retrieval methods is the strongest
    // signal RRF has, and it is the reason to fuse rather than concat.
    const main = [hit("only-dense"), hit("both")];
    const lexical = [hit("both"), hit("only-lexical")];
    const fused = rrfMergeHitOrders(main, [], lexical);
    const rank = (id: string) => fused.findIndex((h) => h.memoryId === id);
    expect(rank("both")).toBeLessThan(rank("only-dense"));
    expect(rank("both")).toBeLessThan(rank("only-lexical"));
  });

  it("does not duplicate a row present in several lanes", () => {
    const fused = rrfMergeHitOrders([hit("x")], [hit("x")], [hit("x")]);
    expect(fused.filter((h) => h.memoryId === "x")).toHaveLength(1);
  });
});
