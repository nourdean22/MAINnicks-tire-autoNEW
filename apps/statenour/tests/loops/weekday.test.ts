import { describe, it, expect } from "vitest";
import { nextWeekdayOccurrence } from "@/lib/loops/weekday";

// Calendar-agnostic: assert the RETURNED weekday + day-distance, never a
// hardcoded date — so the test can't rot when the anchor's weekday shifts.
const ANCHOR = new Date(2026, 5, 1); // arbitrary fixed local date
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
    expect(next!.getDay()).toBe(4);
    expect(dayDiff(ANCHOR, next!)).toBeGreaterThanOrEqual(1);
    expect(dayDiff(ANCHOR, next!)).toBeLessThanOrEqual(7);
  });

  it("is strictly after `from`: completing ON the day jumps a full week", () => {
    const thu = nextWeekdayOccurrence([4], ANCHOR)!; // a guaranteed Thursday
    const after = nextWeekdayOccurrence([4], thu)!;
    expect(after.getDay()).toBe(4);
    expect(dayDiff(thu, after)).toBe(7);
  });

  it("multi-day set picks the nearest upcoming match", () => {
    const next = nextWeekdayOccurrence([1, 3, 5], ANCHOR)!; // Mon/Wed/Fri
    expect([1, 3, 5]).toContain(next.getDay());
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
