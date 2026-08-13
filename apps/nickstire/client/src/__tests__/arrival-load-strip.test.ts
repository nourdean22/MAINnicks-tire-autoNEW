/**
 * NT-008 · ArrivalLoadStrip pure helpers.
 *
 * The strip is a planning signal for a deliberately slot-less walk-in shop, so
 * the load-bearing logic is WHICH bookings count as tomorrow's load. Wrong
 * inclusion here quietly turns history (completed/cancelled) or the no-show
 * sweep's backlog (past dates) into fake demand.
 */
import { describe, expect, it } from "vitest";
import { bookingsForDate, tomorrowBusinessDateKey } from "../pages/admin/today/ArrivalLoadStrip";
import type { BookingItem } from "../pages/admin/today/types";

const b = (over: Partial<BookingItem>): BookingItem => ({
  id: 1,
  name: "Test",
  status: "new",
  createdAt: "2026-08-13T12:00:00Z",
  ...over,
});

describe("bookingsForDate", () => {
  const key = "2026-08-14";

  it("keeps only new/confirmed bookings dated exactly tomorrow", () => {
    const rows = [
      b({ id: 1, preferredDate: key, status: "new" }),
      b({ id: 2, preferredDate: key, status: "confirmed" }),
      b({ id: 3, preferredDate: key, status: "completed" }), // history, not load
      b({ id: 4, preferredDate: key, status: "cancelled" }),
      b({ id: 5, preferredDate: "2026-08-13", status: "new" }), // today ≠ tomorrow
      b({ id: 6, preferredDate: undefined, status: "new" }), // no date → no load claim
    ];
    expect(bookingsForDate(rows, key).map((r) => r.id)).toEqual([1, 2]);
  });

  it("returns empty on an empty board (renders as zero, which is true here)", () => {
    expect(bookingsForDate([], key)).toEqual([]);
  });
});

describe("tomorrowBusinessDateKey", () => {
  it("is tomorrow in SHOP time even when UTC already rolled over", () => {
    // 02:00 UTC Aug 14 = 22:00 EDT Aug 13 → shop-tomorrow is Aug 14,
    // NOT Aug 15 (which is what naive UTC+24h would produce).
    expect(tomorrowBusinessDateKey(new Date("2026-08-14T02:00:00Z"))).toBe("2026-08-14");
  });

  it("crosses the month boundary correctly", () => {
    expect(tomorrowBusinessDateKey(new Date("2026-08-31T15:00:00Z"))).toBe("2026-09-01");
  });
});
