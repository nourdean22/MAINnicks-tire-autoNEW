import { describe, it, expect } from "vitest";
import { nextWeekdayOccurrence } from "@/lib/loops/weekday";
import { weekdayET } from "@/lib/utils/datetime";

// Calendar-agnostic: assert the RETURNED weekday + day-distance, never a
// hardcoded date — so the test can't rot when the anchor's weekday shifts.
//
// ET-ANCHORED, 2026-08-23. The anchor was `new Date(2026, 5, 1)` — LOCAL
// midnight, which is 2026-06-01T00:00Z in CI and therefore 8pm ET on MAY 31: a
// different weekday. nextWeekdayOccurrence reads the ET weekday, so this test
// passed on an ET laptop and failed in CI on the same commit. Noon UTC is 8am ET,
// comfortably inside the same calendar day in both zones, so the fixture no
// longer depends on where it runs.
const ANCHOR = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const dayDiff = (a: Date, b: Date) =>
  Math.round(
    (new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() -
      new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) /
      86_400_000,
  );

describe("nextWeekdayOccurrence — WEEKLY recurrence math", () => {
  it("returns null for empty / invalid day sets", () => {
    expect(nextWeekdayOccurrence([], ANCHOR)).toBeNull();
    expect(nextWeekdayOccurrence([7, -1, 9.5], ANCHOR)).toBeNull();
  });

  it("returns a date 1-7 days ahead whose weekday is the requested one", () => {
    const next = nextWeekdayOccurrence([4], ANCHOR); // Thursday
    expect(next).not.toBeNull();
    expect(weekdayET(next!)).toBe(4);
    expect(dayDiff(ANCHOR, next!)).toBeGreaterThanOrEqual(1);
    expect(dayDiff(ANCHOR, next!)).toBeLessThanOrEqual(7);
  });

  it("is strictly after `from`: completing ON the day jumps a full week", () => {
    const thu = nextWeekdayOccurrence([4], ANCHOR)!; // a guaranteed Thursday
    const after = nextWeekdayOccurrence([4], thu)!;
    expect(weekdayET(after)).toBe(4);
    expect(dayDiff(thu, after)).toBe(7);
  });

  it("multi-day set picks the nearest upcoming match", () => {
    const next = nextWeekdayOccurrence([1, 3, 5], ANCHOR)!; // Mon/Wed/Fri
    expect([1, 3, 5]).toContain(weekdayET(next));
    expect(dayDiff(ANCHOR, next)).toBeGreaterThanOrEqual(1);
    expect(dayDiff(ANCHOR, next)).toBeLessThanOrEqual(7);
  });

  it("returns local midnight (no time component)", () => {
    const next = nextWeekdayOccurrence([4], ANCHOR)!;
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
    expect(next.getSeconds()).toBe(0);
  });
});
