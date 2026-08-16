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
