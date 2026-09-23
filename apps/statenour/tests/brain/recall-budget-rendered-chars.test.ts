/**
 * The recall token budget charges what the block RENDERS, not the stored content length.
 *
 * getContextualMemories renders each memory as `${provenancePrefix(m)} ${content clipped to 200 / 150}`,
 * but the budget trim charged the FULL content.length. On production (2026-09-23, read-only) the lexical
 * lane's top-10 memories average 11.5k-13.4k chars — the stored-tsvector fix (#2553) made that lane
 * answer — so one lexical winner at the 15,000-char cap cost ~94% of the 16,000-char budget while
 * rendering 200 of those chars, and the trim popped dense hits off the tail to pay for text the model
 * never saw. The post-fix benchmark shows exactly that: zero-drop turns 15 -> 4, relevant/turn 5.9 -> 4.5.
 *
 * Positive control (recorded): against the full-length accounting, the "long winner" and "renders
 * fits" cases fail — 5 dense hits dropped behind one long winner, and 9 of 10 memories from a block whose
 * rendered size fits the budget.
 */
import { describe, expect, it } from "vitest";

import { provenancePrefix, renderedContent, trimToTokenBudget, type RelevantMemory } from "@/lib/brain/contextual-recall";

const BUDGET_CHARS = 4000 * 4; // DEFAULT_TOKEN_BUDGET × CHARS_PER_TOKEN_APPROX

const mem = (content: string, relevance: RelevantMemory["relevance"], i = 0): RelevantMemory => ({
  id: `m${i}`,
  key: `k${i}`,
  category: "insight",
  content,
  confidence: 0.8,
  relevance,
  source: "manual",
  seenCount: 1,
});

/** The block the renderer emits for these memories, one line each (heading excluded). */
const renderedChars = (ms: RelevantMemory[]) => ms.reduce((s, m) => s + provenancePrefix(m).length + 1 + renderedContent(m).length, 0);

describe("recall budget · charges rendered chars", () => {
  it("renderedContent clips direct to 200 chars and supporting/background to 150 (what the block shows)", () => {
    const long = "x".repeat(15_000);
    expect(renderedContent(mem(long, "direct"))).toHaveLength(200);
    expect(renderedContent(mem(long, "supporting"))).toHaveLength(150);
    expect(renderedContent(mem(long, "background"))).toHaveLength(150);
    expect(renderedContent(mem("short", "direct"))).toBe("short");
  });

  it("CONTROL: short memories that fit are all kept", () => {
    const relevant = Array.from({ length: 10 }, (_, i) => mem(`memory ${i} ${"s".repeat(100)}`, i < 3 ? "direct" : "supporting", i));
    expect(trimToTokenBudget(relevant, BUDGET_CHARS, 0)).toBe(0);
    expect(relevant).toHaveLength(10);
  });

  it("a 15,000-char lexical winner does not evict the dense hits behind it", () => {
    // Production shape: the lexical top hit sits in a direct slot at the 15k content cap; nine
    // ordinary memories follow. Rendered, the whole block is ~2.3k chars — far under 16k.
    const relevant = [
      mem("lexical winner ".repeat(1000), "direct", 0),
      ...Array.from({ length: 9 }, (_, i) => mem(`dense hit ${i} ${"d".repeat(180)}`, i < 2 ? "direct" : "supporting", i + 1)),
    ];
    expect(renderedChars(relevant)).toBeLessThan(BUDGET_CHARS / 4);
    const dropped = trimToTokenBudget(relevant, BUDGET_CHARS, 0);
    expect(dropped).toBe(0);
    expect(relevant.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"]);
  });

  it("whenever the rendered block fits the budget, nothing is dropped", () => {
    const relevant = Array.from({ length: 10 }, (_, i) => mem("y".repeat(15_000), i < 3 ? "direct" : "background", i));
    expect(renderedChars(relevant)).toBeLessThanOrEqual(BUDGET_CHARS);
    expect(trimToTokenBudget(relevant, BUDGET_CHARS, 0)).toBe(0);
    expect(relevant).toHaveLength(10);
  });

  it("the budget still binds: a tight budget trims from the tail until the RENDERED block fits", () => {
    const relevant = Array.from({ length: 12 }, (_, i) => mem("z".repeat(5_000), "supporting", i));
    const budget = 1_000;
    const dropped = trimToTokenBudget(relevant, budget, 0);
    expect(dropped).toBeGreaterThan(0);
    expect(renderedChars(relevant)).toBeLessThanOrEqual(budget);
    // Tail-first: the survivors are the head of the list, in order.
    expect(relevant.map((m) => m.id)).toEqual(Array.from({ length: relevant.length }, (_, i) => `m${i}`));
  });

  it("never trims below the wisdom slots, even when they alone exceed the budget", () => {
    const relevant = Array.from({ length: 5 }, (_, i) => mem("w".repeat(5_000), "direct", i));
    trimToTokenBudget(relevant, 10, 3);
    expect(relevant.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
  });
});
