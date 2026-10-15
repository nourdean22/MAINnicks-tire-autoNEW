/**
 * shiftDateKey moves a calendar date by whole days and nothing else.
 *
 * The naive version subtracts 24-hour multiples from an instant and reads the
 * Eastern date back. Across the March change that lands one day early: 2026-03-14
 * 00:30 EDT minus 168 hours is 2026-03-06 23:30 EST, because the week contained
 * an hour less. The first case pins that boundary.
 */
import { describe, expect, it } from "vitest";
import { shiftDateKey } from "./timezoneAssert";

describe("shiftDateKey", () => {
  it("steps back seven calendar days across the March daylight-saving change", () => {
    expect(shiftDateKey("2026-03-14", -7)).toBe("2026-03-07");
  });

  it("crosses a year boundary", () => {
    expect(shiftDateKey("2026-01-03", -7)).toBe("2025-12-27");
  });

  it("respects month length, including a leap February", () => {
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDateKey("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("steps forward, and a zero shift is the same date", () => {
    expect(shiftDateKey("2026-10-12", 1)).toBe("2026-10-13");
    expect(shiftDateKey("2026-10-12", 0)).toBe("2026-10-12");
  });
});
