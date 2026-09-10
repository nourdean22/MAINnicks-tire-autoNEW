/**
 * PRE-GENERATION PRIORS BLOCK -- 2026-09-10.
 *
 * `checkNovelty` is the post-hoc check; this is the one that actually
 * changes the reply, because it runs BEFORE the model writes. The
 * distinction matters: a post-hoc check can only delete a repeat, which
 * loses the answer. Told up front, the model can say "you've already got
 * Huberman -- here's what's new", which is what was asked for.
 */
import { describe, it, expect } from "vitest";
import {
  buildPriorRecommendationsBlock,
  type PriorRecommendation,
} from "@/lib/ai/chat/recommendation-novelty";

const NOW = new Date("2026-09-10T12:00:00Z");
const p = (name: string, days: number, times = 1): PriorRecommendation => ({
  name,
  lastSurfacedAt: new Date(NOW.getTime() - days * 86_400_000),
  timesSurfaced: times,
});

describe("priors block", () => {
  it("names what has already been served and forbids re-presenting it", () => {
    const block = buildPriorRecommendationsBlock([p("Huberman Lab", 3, 3), p("Daily Stoic", 9)], NOW);
    expect(block).toMatch(/ALREADY RECOMMENDED/);
    expect(block).toMatch(/Huberman Lab \(3x\)/);
    expect(block).toMatch(/Daily Stoic \(9d ago\)/);
    expect(block).toMatch(/not present any of these as a fresh find/i);
  });

  it("ranks the most-repeated first -- those are the ones about to repeat again", () => {
    const block = buildPriorRecommendationsBlock(
      [p("Once", 1, 1), p("Thrice", 30, 3), p("Twice", 2, 2)],
      NOW,
    );
    expect(block.indexOf("Thrice")).toBeLessThan(block.indexOf("Twice"));
    expect(block.indexOf("Twice")).toBeLessThan(block.indexOf("Once"));
  });

  it("caps the list so it cannot grow without bound in the system prompt", () => {
    const many = Array.from({ length: 40 }, (_, i) => p(`Item ${i}`, i + 1, 1));
    const block = buildPriorRecommendationsBlock(many, NOW);
    // 12 names, and nothing beyond them.
    expect((block.match(/Item \d+/g) ?? []).length).toBe(12);
  });

  // CONTROL: no priors must produce no block at all. An empty
  // "ALREADY RECOMMENDED:" header would be worse than silence -- it
  // tells the model something was checked and found, when nothing was.
  it("CONTROL - no priors emits nothing", () => {
    expect(buildPriorRecommendationsBlock([], NOW)).toBe("");
  });
});
