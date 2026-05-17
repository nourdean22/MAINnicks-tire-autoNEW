/**
 * tests/lib/similarity.test.ts — lib/brain/similarity.ts contract
 *
 * Protects the shared Jaccard primitives that /system/ghost-nour and
 * checkAntiPattern both depend on. These tests are cheap and fast
 * (<5ms) — run every CI pass.
 */

import { describe, it, expect } from "vitest";
import { tokenize, jaccard, similarity } from "@/lib/brain/similarity";

describe("tokenize", () => {
  it("lowercases + strips punctuation", () => {
    const t = tokenize("Should I REDUCE pricing?");
    expect(t.has("reduce")).toBe(true);
    expect(t.has("pricing")).toBe(true);
    expect(t.has("should")).toBe(false); // stopword
    expect(t.has("i")).toBe(false);      // stopword + too short
  });

  it("drops tokens shorter than 3 chars", () => {
    const t = tokenize("an ox is on");
    expect(t.size).toBe(0);
  });

  it("de-duplicates via Set", () => {
    const t = tokenize("pricing pricing PRICING");
    expect(t.size).toBe(1);
    expect(t.has("pricing")).toBe(true);
  });

  it("strips common stopwords", () => {
    const t = tokenize("the that this these those what which");
    expect(t.size).toBe(0);
  });

  it("handles empty input cleanly", () => {
    expect(tokenize("").size).toBe(0);
    expect(tokenize("   ").size).toBe(0);
    expect(tokenize("!!!").size).toBe(0);
  });
});

describe("jaccard", () => {
  it("returns 1 for identical sets", () => {
    const a = new Set(["pricing", "brake", "quote"]);
    const b = new Set(["pricing", "brake", "quote"]);
    expect(jaccard(a, b)).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["pricing", "brake"]);
    const b = new Set(["camera", "light"]);
    expect(jaccard(a, b)).toBe(0);
  });

  it("returns 0 for either-empty", () => {
    const a = new Set(["pricing"]);
    const b = new Set<string>();
    expect(jaccard(a, b)).toBe(0);
    expect(jaccard(b, a)).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it("computes intersection / union correctly", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    // intersection = {b, c} = 2; union = {a, b, c, d} = 4; → 0.5
    expect(jaccard(a, b)).toBeCloseTo(0.5, 5);
  });
});

describe("similarity (convenience)", () => {
  it("finds partial matches between related intents", () => {
    const s = similarity(
      "should I reduce pricing on brake jobs?",
      "considering lowering prices on brake repair work"
    );
    // "pricing"/"brake" vs "prices"/"brake" → partial overlap
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it("returns 0 for unrelated texts", () => {
    const s = similarity("light the shop", "pricing decisions");
    expect(s).toBe(0);
  });

  it("is symmetric", () => {
    const a = "pricing on brake jobs";
    const b = "brake job pricing questions";
    expect(similarity(a, b)).toBe(similarity(b, a));
  });
});
