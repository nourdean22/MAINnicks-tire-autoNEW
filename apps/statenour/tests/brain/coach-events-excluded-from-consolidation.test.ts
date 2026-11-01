/**
 * Pulse rows stay out of the nightly consolidation (2026-11-01).
 *
 * A coach_event row's `content` is the Pulse item's title (rowToCoachEvent) and
 * the event itself lives in metadata. Prod 11-01: the os-drift row's content had
 * been rewritten into LLM prose ("OS monitoring has repeatedly detected persistent
 * drift..."), and merged rows were soft-deleted, the neglect-penalty alert 81s
 * after it was written on 10-03. memory-consolidation.ts merges every category
 * NOT in CONSOLIDATION_EXCLUDE_CATEGORIES (`category: { notIn: [...] }`).
 */
import { describe, expect, it } from "vitest";
import { BRAIN_CATEGORIES, CONSOLIDATION_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";

describe("coach events stay out of consolidation", () => {
  it("coach_event is never consolidated", () => {
    expect(BRAIN_CATEGORIES.COACH_EVENT).toBe("coach_event");
    expect(CONSOLIDATION_EXCLUDE_CATEGORIES).toContain("coach_event");
  });

  it("CONTROL: a belief category is still consolidated", () => {
    expect(CONSOLIDATION_EXCLUDE_CATEGORIES).not.toContain("wisdom");
  });
});
