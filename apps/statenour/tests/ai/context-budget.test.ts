/**
 * tests/ai/context-budget.test.ts · 2026-09-17 (Brain plan §6.5, Wave 3)
 *
 * Unit tests on the PURE receipt builder: threshold pass-through, critical
 * force-keep, greedy utility ordering, the exact budget boundary, MMR
 * redundancy, and garbage tolerance. Nothing is wired to gate `addendum` yet
 * — see the file header in lib/ai/context-budget.ts.
 */
import { describe, it, expect } from "vitest";
import { buildContextReceipt, estimateTokens, type ContextBudgetBlock } from "@/lib/ai/context-budget";

describe("estimateTokens", () => {
  it("is ceil(chars / 4), and 0 for falsy content", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1); // exactly 4 chars -> 1 token
    expect(estimateTokens("abcde")).toBe(2); // 5 chars -> ceil(1.25) = 2
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });
});

describe("buildContextReceipt · threshold pass-through", () => {
  it("a block rerankContextBlocks already dropped never enters the budget pass", () => {
    const blocks: ContextBudgetBlock[] = [
      { name: "identity", content: "AAAAAAAA", similarity: 0.5, critical: true, kept: true },
      { name: "ghost", content: "below the cosine cut", similarity: 0.05, kept: false },
    ];
    const receipt = buildContextReceipt(blocks, 1000);
    const ghost = receipt.entries.find((e) => e.name === "ghost");
    expect(ghost).toMatchObject({ kept: false, reason: "below_threshold", similarity: 0.05 });
  });
});

describe("buildContextReceipt · critical + greedy utility + exact budget boundary", () => {
  // A: critical, 8 chars -> 2 tokens, sim 0.5 (always kept regardless of utility).
  // B: 4 chars -> 1 token, sim 0.9 -> utility 0.90 (ranks ABOVE C).
  // C: 40 chars -> 10 tokens, sim 0.4 -> utility 0.04.
  // D: already below-threshold, receipt-only.
  const A: ContextBudgetBlock = { name: "identity", content: "AAAAAAAA", similarity: 0.5, critical: true, kept: true };
  const B: ContextBudgetBlock = { name: "recall", content: "BBBB", similarity: 0.9, kept: true };
  const C: ContextBudgetBlock = { name: "skills", content: "C".repeat(40), similarity: 0.4, kept: true };
  const D: ContextBudgetBlock = { name: "nudges", content: "low signal", similarity: 0.05, kept: false };

  it("budget with room for everything: all threshold survivors fit, ranked critical-first then by utility", () => {
    const receipt = buildContextReceipt([A, B, C, D], 100);
    expect(receipt.entries.map((e) => e.name)).toEqual(["nudges", "identity", "recall", "skills"]);
    // below_threshold entries are emitted first (fixed pass), survivors in ranked order after.
    expect(receipt.entries.map((e) => e.reason)).toEqual([
      "below_threshold",
      "critical",
      "fits_budget",
      "fits_budget",
    ]);
    expect(receipt.tokensKept).toBe(2 + 1 + 10); // A + B + C
    expect(receipt.tokensDropped).toBe(estimateTokens(D.content));
    expect(receipt.droppedCount).toBe(1);
  });

  it("exact boundary: spent + tokens === budget still fits (>, not >=, is the cut)", () => {
    // A (critical) spends 2. B (utility 0.9, ranks first among non-critical) needs 1
    // more: 2 + 1 = 3 === budget(3) -> fits. C (utility 0.04, needs 10) would push
    // 3 + 10 = 13 > 3 -> over_budget.
    const receipt = buildContextReceipt([A, B, C], 3);
    expect(receipt.entries.find((e) => e.name === "identity")).toMatchObject({ kept: true, reason: "critical" });
    expect(receipt.entries.find((e) => e.name === "recall")).toMatchObject({ kept: true, reason: "fits_budget" });
    expect(receipt.entries.find((e) => e.name === "skills")).toMatchObject({ kept: false, reason: "over_budget" });
    expect(receipt.tokensKept).toBe(3);
  });

  it("one token under the boundary: the same block now fails", () => {
    const receipt = buildContextReceipt([A, B, C], 2); // A alone already spends the whole budget
    expect(receipt.entries.find((e) => e.name === "recall")).toMatchObject({ kept: false, reason: "over_budget" });
    expect(receipt.tokensKept).toBe(2); // only the critical block
  });

  it("critical is kept even when it alone exceeds the budget", () => {
    const receipt = buildContextReceipt([A], 0);
    expect(receipt.entries).toEqual([
      { name: "identity", tokens: 2, similarity: 0.5, critical: true, kept: true, reason: "critical" },
    ]);
  });
});

describe("buildContextReceipt · MMR redundancy", () => {
  it("drops a lower-utility block near-duplicate of one already kept", () => {
    const E: ContextBudgetBlock = { name: "recall", content: "EEEE", similarity: 0.9, kept: true }; // utility 0.9, ranks first
    const F: ContextBudgetBlock = { name: "hybridRecall", content: "FFFF", similarity: 0.85, kept: true }; // utility 0.85, ranks second
    const nearDuplicate = (a: string, b: string) =>
      (a === "EEEE" || a === "FFFF") && (b === "EEEE" || b === "FFFF") && a !== b ? 0.95 : 0;

    const receipt = buildContextReceipt([E, F], 1000, { similarityFn: nearDuplicate });
    expect(receipt.entries.find((e) => e.name === "recall")).toMatchObject({ kept: true, reason: "fits_budget" });
    expect(receipt.entries.find((e) => e.name === "hybridRecall")).toMatchObject({ kept: false, reason: "redundant" });
  });

  it("without a similarityFn, redundancy is skipped entirely (near-duplicates both kept)", () => {
    const E: ContextBudgetBlock = { name: "recall", content: "EEEE", similarity: 0.9, kept: true };
    const F: ContextBudgetBlock = { name: "hybridRecall", content: "EEEE", similarity: 0.85, kept: true };
    const receipt = buildContextReceipt([E, F], 1000);
    expect(receipt.entries.every((e) => e.kept)).toBe(true);
  });
});

describe("buildContextReceipt · recallAsOf (2026-09-17) — the silence, not just the trigger", () => {
  const block: ContextBudgetBlock = { name: "identity", content: "abcd", similarity: 0.9, kept: true };

  it("records the point-in-time filter recall ran under", () => {
    const receipt = buildContextReceipt([block], 100, { asOf: new Date("2026-05-01T00:00:00.000Z") });
    expect(receipt.recallAsOf).toBe("2026-05-01T00:00:00.000Z");
  });

  it("is ABSENT for a current-time turn — an always-present field would read as a filter", () => {
    expect(buildContextReceipt([block], 100).recallAsOf).toBeUndefined();
    expect(buildContextReceipt([block], 100, { asOf: null }).recallAsOf).toBeUndefined();
  });

  it("an Invalid Date is dropped, never persisted as the string 'Invalid Date'", () => {
    const receipt = buildContextReceipt([block], 100, { asOf: new Date("not a date") });
    expect(receipt.recallAsOf).toBeUndefined();
  });

  it("survives the garbage-input path too (a truncating filter must still be recorded)", () => {
    const receipt = buildContextReceipt(null as unknown as ContextBudgetBlock[], 100, {
      asOf: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect(receipt.entries).toEqual([]);
    expect(receipt.recallAsOf).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("buildContextReceipt · garbage tolerance (never throws)", () => {
  it("non-array blocks yields an empty receipt, budget still reported", () => {
    const receipt = buildContextReceipt(null as unknown as ContextBudgetBlock[], 100);
    expect(receipt).toEqual({ entries: [], tokensBudget: 100, tokensKept: 0, tokensDropped: 0, droppedCount: 0 });
  });

  it("a non-finite similarity is treated as 0, not NaN-poisoned", () => {
    const block: ContextBudgetBlock = { name: "x", content: "abcd", similarity: NaN, kept: true };
    const receipt = buildContextReceipt([block], 100);
    expect(receipt.entries[0].similarity).toBe(0);
    expect(receipt.entries[0].kept).toBe(true); // still fits the budget
  });

  it("a negative or non-finite budget clamps to 0, not a negative number that would fit nothing yet report wrong", () => {
    const block: ContextBudgetBlock = { name: "x", content: "", similarity: 0.9, critical: true, kept: true };
    const receipt = buildContextReceipt([block], -5);
    expect(receipt.tokensBudget).toBe(0);
  });

  it("missing/undefined content costs 0 tokens and never throws", () => {
    const block = { name: "x", similarity: 0.9, kept: true } as ContextBudgetBlock;
    const receipt = buildContextReceipt([block], 100);
    expect(receipt.entries[0].tokens).toBe(0);
  });
});
