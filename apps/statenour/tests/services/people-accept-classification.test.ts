/**
 * Accepting a suggestion applies a proposed cadence (people W2, 2026-10-30).
 *
 * The update the accept mutation writes is built by acceptClassificationData,
 * so the cadence half is testable without the router. Delete the cadenceDays
 * branch and the first case goes red.
 */
import { describe, expect, it } from "vitest";

import { acceptClassificationData } from "@/lib/services/people/accept-classification";

describe("acceptClassificationData", () => {
  it("applies a proposed cadence and clears the suggestion", () => {
    expect(acceptClassificationData({ cadenceDays: 14, basis: "default for close friend" }, 0.5)).toEqual({
      pendingClassification: null,
      cadenceDays: 14,
    });
  });

  it("refuses a cadence outside 1..365 or a non-integer", () => {
    for (const cadenceDays of [0, -3, 400, 2.5, Number.NaN]) {
      expect(acceptClassificationData({ cadenceDays }, 0.5)).toEqual({ pendingClassification: null });
    }
  });

  it("keeps the old fields working: role, notes, trust", () => {
    expect(acceptClassificationData({ role: "friend", leverageNotes: "  call Sundays ", trustAdjustment: 0.1 }, 0.5)).toEqual({
      pendingClassification: null,
      role: "friend",
      leverageNotes: "call Sundays",
      trustScore: 0.6,
    });
    expect(acceptClassificationData({ role: "not-a-role" }, 0.5)).toEqual({ pendingClassification: null });
  });

  it("no suggestion: nothing but the clear", () => {
    expect(acceptClassificationData(null, 0.5)).toEqual({ pendingClassification: null });
  });

  // W8b (audit B7): a Home love-map answer he typed since the proposal is never overwritten by an older suggestion.
  it("appends the suggested notes to non-empty, different current notes; replaces only empty ones", () => {
    expect(acceptClassificationData({ leverageNotes: "Call on Sundays" }, 0.5, "Loves hiking")).toEqual({
      pendingClassification: null,
      leverageNotes: "Loves hiking\nCall on Sundays",
    });
    expect(acceptClassificationData({ leverageNotes: "Call on Sundays" }, 0.5, "")).toEqual({
      pendingClassification: null,
      leverageNotes: "Call on Sundays",
    });
    expect(acceptClassificationData({ leverageNotes: "Call on Sundays" }, 0.5, null)).toEqual({
      pendingClassification: null,
      leverageNotes: "Call on Sundays",
    });
    // Same text already there: no second copy.
    expect(acceptClassificationData({ leverageNotes: " Call on Sundays " }, 0.5, "Call on Sundays")).toEqual({ pendingClassification: null });
  });
});
