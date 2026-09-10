/**
 * RECOMMENDATION NOVELTY tests -- 2026-09-10.
 *
 * Audit finding: "Huberman, Naval, Goggins, Daily Stoic showed up three
 * separate times in one session" -- each time as if fresh. The golden
 * case below is that exact stack.
 */
import { describe, it, expect } from "vitest";
import {
  checkNovelty,
  buildNoveltyBlock,
  type PriorRecommendation,
} from "@/lib/ai/chat/recommendation-novelty";

const NOW = new Date("2026-09-10T12:00:00Z");
const prior = (name: string, days: number, times = 1): PriorRecommendation => ({
  name,
  lastSurfacedAt: new Date(NOW.getTime() - days * 86_400_000),
  timesSurfaced: times,
});

describe("the re-served stack", () => {
  const DRAFT = [
    "Three that will move you:",
    "- **Huberman Lab** -- the protocol podcast.",
    "- **Daily Stoic** -- the discipline channel.",
    "- **Deep Work** -- the focus book.",
  ].join("\n");

  it("separates what is genuinely new from what has already been served", () => {
    const r = checkNovelty(DRAFT, [prior("Huberman Lab", 3, 2), prior("Daily Stoic", 9, 3)], NOW);
    expect(r.repeats.map((x) => x.name).sort()).toEqual(["Daily Stoic", "Huberman Lab"]);
    expect(r.fresh).toEqual(["Deep Work"]);
    expect(r.allRepeats).toBe(false);
  });

  it("carries how often and how recently, so the reply can be specific", () => {
    const r = checkNovelty(DRAFT, [prior("Huberman Lab", 3, 2)], NOW);
    const h = r.repeats.find((x) => x.name === "Huberman Lab");
    expect(h?.timesSurfaced).toBe(2);
    expect(h?.daysSinceLast).toBe(3);
  });

  it("flags the case the audit actually caught -- nothing in the list is new", () => {
    const r = checkNovelty(
      DRAFT,
      [prior("Huberman Lab", 3, 2), prior("Daily Stoic", 9, 3), prior("Deep Work", 20, 2)],
      NOW,
    );
    expect(r.allRepeats).toBe(true);
    const block = buildNoveltyBlock(r);
    expect(block).toMatch(/EVERY item/);
    expect(block).toMatch(/offer to search/i);
  });

  it("matches names regardless of a leading article or punctuation", () => {
    // "The Daily Stoic podcast" and "Daily Stoic" are the same thing;
    // a checker that misses that re-serves the same pick forever.
    const r = checkNovelty("- **The Daily Stoic** -- still the pick.", [prior("Daily Stoic", 5)], NOW);
    expect(r.repeats).toHaveLength(1);
    expect(r.fresh).toHaveLength(0);
  });

  // CONTROL: without this, a checker that flags everything as a repeat
  // would pass every assertion above.
  it("CONTROL - a genuinely new list is all fresh and emits no block", () => {
    const r = checkNovelty(DRAFT, [prior("Something Else", 5)], NOW);
    expect(r.repeats).toHaveLength(0);
    expect(r.fresh).toHaveLength(3);
    expect(buildNoveltyBlock(r)).toBe("");
  });

  it("CONTROL - a turn that recommends nothing is not a repeat", () => {
    const r = checkNovelty("You already know the answer to this one. Go run.", [
      prior("Huberman Lab", 1, 5),
    ], NOW);
    expect(r.considered).toBe(0);
    expect(r.allRepeats).toBe(false);
    expect(buildNoveltyBlock(r)).toBe("");
  });

  it("CONTROL - no priors at all means everything is fresh, never everything stale", () => {
    const r = checkNovelty(DRAFT, [], NOW);
    expect(r.allRepeats).toBe(false);
    expect(r.fresh).toHaveLength(3);
  });
});
