/**
 * Novelty axis · lib/brain/contextual-recall.ts (2026-08-16).
 *
 * The multiplier this pins is the fix for the structural bias that made
 * recall recite known facts: BrainMemory `confidence` is a re-sighting count
 * (0.5 + 0.1/sighting), so a surprising one-off can never outrank a
 * re-observed banality. Every other ranking signal rewards FIT; this is the
 * only one that rewards DIFFERENCE.
 *
 * Note this is the first unit coverage of ANY recall multiplier — its sibling
 * `importanceMultiplier` has had none since it shipped.
 */
import { describe, it, expect } from "vitest";
import { noveltyMultiplier } from "@/lib/brain/contextual-recall";

const A = [1, 0, 0];
const B = [0, 1, 0];
const A_ISH = [0.96, 0.28, 0];

describe("noveltyMultiplier", () => {
  it("is exactly 1.0 when disabled — ranking must be byte-for-byte unchanged", () => {
    expect(noveltyMultiplier(A, [A], false)).toBe(1.0);
    expect(noveltyMultiplier(B, [A], false)).toBe(1.0);
  });

  it("is 1.0 with nothing to compare against", () => {
    expect(noveltyMultiplier(A, [], true)).toBe(1.0);
    expect(noveltyMultiplier(undefined, [A], true)).toBe(1.0);
    expect(noveltyMultiplier([], [A], true)).toBe(1.0);
  });

  it("penalizes a memory that repeats what is already selected", () => {
    // identical vector → cosine 1 → the floor
    expect(noveltyMultiplier(A, [A], true)).toBeCloseTo(0.95, 5);
  });

  it("rewards a memory orthogonal to everything selected", () => {
    expect(noveltyMultiplier(B, [A], true)).toBeCloseTo(1.18, 5);
  });

  it("ranks a novel memory above a redundant one — the whole point", () => {
    const redundant = noveltyMultiplier(A_ISH, [A], true);
    const novel = noveltyMultiplier(B, [A], true);
    expect(novel).toBeGreaterThan(redundant);
  });

  it("uses the MOST similar selected memory, not the average", () => {
    // A_ISH is near A and far from B. Adding the far one must not rescue it.
    const againstBoth = noveltyMultiplier(A_ISH, [A, B], true);
    const againstNear = noveltyMultiplier(A_ISH, [A], true);
    expect(againstBoth).toBeCloseTo(againstNear, 5);
  });

  it("stays inside a gentle band so it nudges rather than dominates", () => {
    const samples = [A, B, A_ISH, [0.5, 0.5, 0.7]];
    for (const v of samples) {
      const m = noveltyMultiplier(v, [A, B], true);
      expect(m).toBeGreaterThanOrEqual(0.95);
      expect(m).toBeLessThanOrEqual(1.18);
    }
  });

  it("ignores dimension-mismatched vectors instead of throwing", () => {
    expect(() => noveltyMultiplier(A, [[1, 2]], true)).not.toThrow();
    // no comparable vector → nothing to penalize against → max novelty
    expect(noveltyMultiplier(A, [[1, 2]], true)).toBeCloseTo(1.18, 5);
  });
});
