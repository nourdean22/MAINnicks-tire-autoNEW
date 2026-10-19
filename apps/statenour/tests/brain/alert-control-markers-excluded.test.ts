/**
 * Codex P1 on #3161: alert_dismiss and alert_mute rows are control markers read by key
 * (lib/brain/alert-suppression.ts), not beliefs. The nightly consolidation merges every category
 * NOT in CONSOLIDATION_EXCLUDE_CATEGORIES, so repeated "noise" dismissals could be merged and
 * soft-deleted overnight, which un-dismisses the alert; and recall would spend slots on them.
 */
import { describe, expect, it } from "vitest";
import { CONSOLIDATION_EXCLUDE_CATEGORIES, RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";

describe("alert control markers stay out of consolidation and recall", () => {
  for (const cat of ["alert_dismiss", "alert_mute"]) {
    it(`${cat} is never consolidated`, () => {
      expect(CONSOLIDATION_EXCLUDE_CATEGORIES).toContain(cat);
    });
    it(`${cat} is never recalled into a prompt`, () => {
      expect(RECALL_EXCLUDE_CATEGORIES).toContain(cat);
    });
  }

  it("CONTROL: a belief category is still consolidated and recalled", () => {
    expect(CONSOLIDATION_EXCLUDE_CATEGORIES).not.toContain("wisdom");
    expect(RECALL_EXCLUDE_CATEGORIES).not.toContain("wisdom");
  });
});
