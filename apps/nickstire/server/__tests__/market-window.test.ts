/**
 * server/__tests__/market-window.test.ts · 2026-09-08
 *
 * The Market card says "last 28 days". Review on #2196 caught the first cut:
 * a 28-day subtraction plus an inclusive BETWEEN is 29 date keys, and
 * `toISOString()` flips the boundary at UTC midnight, not Cleveland's — so
 * the window advanced a day early every evening. The window is now built in
 * shop time and is an inclusive 28-date span.
 */
import { describe, it, expect } from "vitest";
import { marketWindow } from "../routers/admin/market";
import { getBusinessDateKey } from "../lib/timezoneAssert";

function inclusiveDays(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

describe("marketWindow", () => {
  it("spans exactly 28 date keys, inclusive", () => {
    const w = marketWindow(new Date("2026-09-08T15:00:00Z"));
    expect(inclusiveDays(w.startDate, w.endDate)).toBe(28);
  });

  it("ends on the SHOP date, not the UTC date — 11pm Cleveland is still today", () => {
    // 2026-09-09T03:30:00Z is 2026-09-08 23:30 in America/New_York (EDT).
    const lateEvening = new Date("2026-09-09T03:30:00Z");
    const w = marketWindow(lateEvening);
    expect(w.endDate).toBe(getBusinessDateKey(lateEvening));
    expect(w.endDate).toBe("2026-09-08");
    expect(w.startDate).toBe("2026-08-12");
  });
});
