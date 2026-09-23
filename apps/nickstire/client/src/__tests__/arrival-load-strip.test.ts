/**
 * NT-008 · ArrivalLoadStrip pure helpers.
 *
 * The strip is a planning signal for a deliberately slot-less walk-in shop, so
 * the load-bearing logic is WHICH bookings count as tomorrow's load. Wrong
 * inclusion here quietly turns history (completed/cancelled) or the no-show
 * sweep's backlog (past dates) into fake demand.
 */
import { describe, expect, it } from "vitest";
import { bookingsForDate, phoneDemandLine, stripHasNothingToSay, tomorrowBusinessDateKey } from "../pages/admin/today/ArrivalLoadStrip";
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

describe("stripHasNothingToSay (self-review fix: untrustworthy is never silence)", () => {
  const quiet = {
    arrivalsError: false,
    arrivalsLoaded: true,
    arrivalsCount: 0,
    tomorrowCount: 0,
    bookingsTrustworthy: true,
  };

  it("suppresses only the genuinely-quiet, fully-trustworthy board", () => {
    expect(stripHasNothingToSay(quiet)).toBe(true);
  });

  it("renders when the bookings slice is UNREADABLE even with zero arrivals — the bug this fixes", () => {
    expect(stripHasNothingToSay({ ...quiet, bookingsTrustworthy: false })).toBe(false);
  });

  it("renders on an arrivals error (unknown, not empty)", () => {
    expect(stripHasNothingToSay({ ...quiet, arrivalsError: true })).toBe(false);
  });

  it("renders while arrivals are still loading, and whenever either count is non-zero", () => {
    expect(stripHasNothingToSay({ ...quiet, arrivalsLoaded: false })).toBe(false);
    expect(stripHasNothingToSay({ ...quiet, arrivalsCount: 2 })).toBe(false);
    expect(stripHasNothingToSay({ ...quiet, tomorrowCount: 1 })).toBe(false);
  });
});

describe("phone tire demand (2026-09-23)", () => {
  const quiet = { arrivalsError: false, arrivalsLoaded: true, arrivalsCount: 0, tomorrowCount: 0, bookingsTrustworthy: true };

  it("a tire caller today is something to say, and an unreadable count is never silence", () => {
    expect(stripHasNothingToSay({ ...quiet, phoneDemandCount: 0 })).toBe(true);
    expect(stripHasNothingToSay({ ...quiet, phoneDemandCount: 2 })).toBe(false);
    expect(stripHasNothingToSay({ ...quiet, phoneDemandError: true })).toBe(false);
  });

  it("lists the sizes to pull, most-asked first, with the new/used split", () => {
    expect(phoneDemandLine({
      total: 5,
      sizes: [{ size: "225/65R17", count: 3, new: 1, used: 2 }, { size: "205/55R16", count: 1, new: 0, used: 0 }],
      sizeUnknown: 1,
    })).toBe("225/65R17 ×3 (2 used, 1 new) · 205/55R16 · 1 without a size");
  });

  it("caps the list and says how many more", () => {
    const sizes = ["A", "B", "C", "D", "E", "F"].map((size) => ({ size, count: 1, new: 0, used: 0 }));
    expect(phoneDemandLine({ total: 6, sizes, sizeUnknown: 0 })).toBe("A · B · C · D · +2 more");
  });

  it("nobody asked: no line", () => {
    expect(phoneDemandLine({ total: 0, sizes: [], sizeUnknown: 0 })).toBeNull();
  });
});

