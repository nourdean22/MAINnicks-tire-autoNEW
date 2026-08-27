/**
 * Canary · memory-recall CONTEXT_CATEGORIES admits the durable personal layer
 * (2026-08-27 retrieval baseline, docs/RETRIEVAL-BASELINE-2026-08-27.md F1).
 *
 * The measured defect: the whitelist contained NO durable personal category,
 * so the lane KNN'd the corpus correctly and then deleted the answers —
 * hit@5 = 0/28 on the labelled corpus while dense rank was #1 on several
 * cases. This pins the fix in both directions:
 *   · every durable personal category is recallable (positive), and
 *   · telemetry categories stay OUT (negative control — the filter must
 *     still filter; a whitelist that admits everything is no whitelist).
 */
import { describe, expect, it } from "vitest";
import {
  CONTEXT_CATEGORIES,
  DURABLE_PERSONAL_CATEGORIES,
  rrfMergeHitOrders,
  type RecallHit,
} from "../../lib/brain/memory-recall";

/** Synthetic fixture — never live data (Stated Rule 9). */
const hit = (memoryId: string, finalScore = 0.5, knnDistance = 0.5): RecallHit => ({
  memoryId,
  category: "health",
  key: `k_${memoryId}`,
  content: `content ${memoryId}`,
  confidence: 0.8,
  seenCount: 1,
  ageDays: 1,
  factAgeDays: 1,
  knnDistance,
  finalScore,
});

describe("memory-recall · durable personal categories are recallable", () => {
  it("admits every durable personal category", () => {
    for (const cat of DURABLE_PERSONAL_CATEGORIES) {
      expect(CONTEXT_CATEGORIES.has(cat), `${cat} must be context-recallable`).toBe(true);
    }
    // The operator's real query classes from the eval corpus, asserted
    // individually so a future trim of the shared list names the casualty.
    for (const cat of ["relationships", "health", "identity", "event", "biography"]) {
      expect(CONTEXT_CATEGORIES.has(cat), `${cat} is a measured operator query class`).toBe(true);
    }
  });

  it("negative control: telemetry categories are still filtered", () => {
    for (const cat of ["memory_gateway_shadow", "nick_quality", "mastery_xp_event", "persona_drift"]) {
      expect(CONTEXT_CATEGORIES.has(cat), `${cat} is telemetry — must never spend a recall slot`).toBe(false);
    }
  });

  it("regression: the legacy whitelist survives the extension", () => {
    for (const cat of ["wisdom", "insight", "domain_knowledge", "chat_summary", "task_lesson"]) {
      expect(CONTEXT_CATEGORIES.has(cat), `${cat} was recallable before this wave`).toBe(true);
    }
  });
});

/**
 * rrfMergeHitOrders — the durable-lane fusion (measured: hit@5 50% → 86%,
 * identity slice 0/4 → 4/4 on the labelled corpus; eval-datasets/levers*).
 * Synthetic fixtures with positive controls.
 */
describe("memory-recall · rrfMergeHitOrders", () => {
  it("BREAKS: a durable-lane-only hit enters the merged top (the identity-gap mechanism)", () => {
    // Main lane full of noise; the durable lane holds the answer at rank 1.
    const main = [hit("noise1"), hit("noise2"), hit("noise3"), hit("noise4"), hit("noise5")];
    const durable = [hit("pm_identity_age_fixture")];
    const merged = rrfMergeHitOrders(main, durable);
    const rank = merged.findIndex((h) => h.memoryId === "pm_identity_age_fixture");
    expect(rank, "durable rank-1 must land in the merged top-2 (RRF k=60, equal weights)").toBeLessThanOrEqual(1);
  });

  it("positive control: an empty durable lane returns the main ordering untouched", () => {
    const main = [hit("a"), hit("b"), hit("c")];
    expect(rrfMergeHitOrders(main, [])).toEqual(main);
  });

  it("RRF property: a row present in BOTH lanes outranks single-lane peers of equal rank", () => {
    const both = hit("both");
    const main = [hit("mainOnly"), both];
    const durable = [{ ...both }, hit("durOnly")];
    const merged = rrfMergeHitOrders(main, durable);
    expect(merged[0].memoryId).toBe("both");
    // and no duplicates survive the merge
    expect(new Set(merged.map((h) => h.memoryId)).size).toBe(merged.length);
  });

  it("degenerate inputs are safe", () => {
    expect(rrfMergeHitOrders([], [])).toEqual([]);
    const d = [hit("onlyDurable")];
    expect(rrfMergeHitOrders([], d).map((h) => h.memoryId)).toEqual(["onlyDurable"]);
  });
});
