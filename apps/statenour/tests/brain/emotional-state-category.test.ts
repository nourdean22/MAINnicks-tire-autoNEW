/**
 * emotional_state is a registered brain category (2026-09-23).
 *
 * journal-ingest and pipeline-controller have written hourly mood rows under
 * "emotional_state" since v10.0.232, but the category was never added to
 * BRAIN_CATEGORIES. So every write took memory-manager's unknown-category path:
 * a log.warn("unknown_category") (5 in production on 09-23, one per chat turn
 * with a mood signal), review_required stamped on the row, and the memory
 * commit gateway's "unknown_category" verdict instead of its normal rules.
 */
import { describe, it, expect } from "vitest";
import { BRAIN_CATEGORIES, isKnownCategory } from "@/lib/brain/categories";

describe("emotional_state category", () => {
  it("is registered, so its writes stop taking the unknown-category path", () => {
    expect(isKnownCategory("emotional_state")).toBe(true);
    expect(BRAIN_CATEGORIES.EMOTIONAL_STATE).toBe("emotional_state");
  });

  // Control: the check still rejects a category nobody registered.
  it("an unregistered category is still unknown", () => {
    expect(isKnownCategory("definitely_not_a_category_2026")).toBe(false);
  });
});
