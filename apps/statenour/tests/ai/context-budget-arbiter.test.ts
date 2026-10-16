/**
 * tests/ai/context-budget-arbiter.test.ts · 2026-10-16 (Brain W1, the arbiter)
 *
 * The persisted context receipt must say whether NICK_RECALL_ARBITER shaped
 * the turn, so scripts/arbiter-judge-split.ts can split reply_judgment
 * composites by it. A receipt without the field is "unknown" (pre-W1 rows);
 * a receipt the builder produces is never unknown.
 */
import { describe, it, expect } from "vitest";
import { buildContextReceipt, type ContextBudgetBlock } from "@/lib/ai/context-budget";

const block: ContextBudgetBlock = { name: "x", content: "abcd", similarity: 0.5, kept: true };

describe("buildContextReceipt · arbiter (W1)", () => {
  it("records arbiter: false by default, with no rerankBackend", () => {
    const receipt = buildContextReceipt([block], 100);
    expect(receipt.arbiter).toBe(false);
    expect(receipt).not.toHaveProperty("rerankBackend");
  });

  it("records arbiter: true and the rerank backend when the caller says so", () => {
    const receipt = buildContextReceipt([block], 100, { arbiter: true, rerankBackend: "cohere" });
    expect(receipt.arbiter).toBe(true);
    expect(receipt.rerankBackend).toBe("cohere");
  });

  it("survives a JSON round-trip (it is persisted through a Prisma Json column)", () => {
    const receipt = buildContextReceipt([block], 100, { arbiter: true, rerankBackend: "none" });
    expect(JSON.parse(JSON.stringify(receipt))).toMatchObject({ arbiter: true, rerankBackend: "none" });
  });

  it("the garbage branch (non-array blocks) still carries the field", () => {
    const receipt = buildContextReceipt(null as unknown as ContextBudgetBlock[], 100, { arbiter: true, rerankBackend: "bge" });
    expect(receipt.arbiter).toBe(true);
    expect(receipt.rerankBackend).toBe("bge");
  });
});
