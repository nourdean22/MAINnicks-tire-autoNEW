/**
 * Recall quarantine · lib/brain/categories.ts (2026-08-16).
 *
 * lib/intelligence/ingest.ts and promote.ts both stated for months that
 * promoted external claims were "quarantined from chat recall until a human
 * promotes them". Nothing implemented it: RECALL_EXCLUDE_CATEGORIES was the
 * only quarantine mechanism and never contained the category, while
 * candidates are minted at confidence 0.3 against contextual-recall's
 * `gte: 0.3` floor — so they passed the filter exactly, not narrowly.
 *
 * This is the test that makes the comment load-bearing. Deleting the
 * exclusion silently re-opens the hole; this goes red instead.
 */
import { describe, it, expect } from "vitest";
import { BRAIN_CATEGORIES, RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";
import { CANDIDATE_CONFIDENCE } from "@/lib/intelligence/promote";

describe("chat-recall quarantine", () => {
  it("excludes un-promoted research claim candidates", () => {
    expect(RECALL_EXCLUDE_CATEGORIES).toContain(BRAIN_CATEGORIES.RESEARCH_CLAIM_CANDIDATE);
  });

  it("does NOT exclude the trusted category — promotion is what unlocks recall", () => {
    expect(RECALL_EXCLUDE_CATEGORIES).not.toContain(BRAIN_CATEGORIES.RESEARCH_CLAIM);
  });

  it("documents why a confidence floor alone was never the guard", () => {
    // The recall keyword lane filters `confidence: { gte: 0.3 }` and
    // candidates are minted at exactly 0.3 — inclusive, so they passed.
    // If this ever changes, the exclusion above is still the real guard.
    expect(CANDIDATE_CONFIDENCE).toBe(0.3);
  });

  it("keeps the pre-existing exclusions intact", () => {
    expect(RECALL_EXCLUDE_CATEGORIES).toContain(BRAIN_CATEGORIES.MORNING_BRIEF_AUDIO);
    expect(RECALL_EXCLUDE_CATEGORIES).toContain(BRAIN_CATEGORIES.SUGGESTION_HYPOTHESIS);
  });
});

/**
 * Graduated-flag defaults (2026-08-16). Both of this wave's new capabilities
 * were flipped default-ON by operator instruction WITHOUT the shadow-review
 * evidence that graduated Phase-1. These tests pin the kill-switches, because
 * an accepted-risk default is only acceptable while its rollback lever works.
 */
describe("graduated flag defaults", () => {
  it("registers NICK_NOVELTY_RECALL as default-ON with a working kill-switch", async () => {
    const { FLAG_REGISTRY, getFlag } = await import("@/lib/feature-flags");
    const spec = FLAG_REGISTRY.find((f) => f.key === "NICK_NOVELTY_RECALL");
    // An UNREGISTERED key makes getFlag return null and the `?? false` idiom at
    // the call site swallow it — the feature would be permanently, silently off.
    expect(spec).toBeDefined();
    expect(spec?.defaultOn).toBe(true);

    const prev = process.env.NICK_NOVELTY_RECALL;
    try {
      delete process.env.NICK_NOVELTY_RECALL;
      expect(getFlag("NICK_NOVELTY_RECALL")?.isOn).toBe(true);
      process.env.NICK_NOVELTY_RECALL = "0";
      expect(getFlag("NICK_NOVELTY_RECALL")?.isOn).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.NICK_NOVELTY_RECALL;
      else process.env.NICK_NOVELTY_RECALL = prev;
    }
  });

  it("leaves non-graduated flags default-OFF", async () => {
    const { getFlag } = await import("@/lib/feature-flags");
    const prev = process.env.NICK_IMPORTANCE_RECALL;
    try {
      delete process.env.NICK_IMPORTANCE_RECALL;
      expect(getFlag("NICK_IMPORTANCE_RECALL")?.isOn).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.NICK_IMPORTANCE_RECALL;
      else process.env.NICK_IMPORTANCE_RECALL = prev;
    }
  });
});
