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
});
