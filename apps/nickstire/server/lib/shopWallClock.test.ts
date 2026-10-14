import { describe, expect, it } from "vitest";
import { shopWallClock } from "./timezoneAssert";

describe("shopWallClock: the shop's wall clock, stored as a shop-local TIMESTAMP", () => {
  it("reads the Cleveland clock in the UTC fields during EDT: 21:00 on Oct 12", () => {
    // 2026-10-13T01:00Z is 21:00 EDT on Oct 12. A stored row must read back as Oct 12, 21:00.
    expect(shopWallClock(new Date("2026-10-13T01:00:00Z")).toISOString()).toBe("2026-10-12T21:00:00.000Z");
  });

  it("follows the winter offset during EST: 21:00 on Jan 14", () => {
    expect(shopWallClock(new Date("2026-01-15T02:00:00Z")).toISOString()).toBe("2026-01-14T21:00:00.000Z");
  });

  it("keeps an evening sale on its shop day, where the UTC clock would move it to the next day", () => {
    // 00:30Z on Oct 13 is 20:30 EDT on Oct 12: the shop day is still Oct 12.
    expect(shopWallClock(new Date("2026-10-13T00:30:00Z")).toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(new Date("2026-10-13T00:30:00Z").toISOString().slice(0, 10)).toBe("2026-10-13");
  });

  it("defaults to the current instant", () => {
    const before = Date.now();
    const wall = shopWallClock().getTime();
    // The wall-clock Date is shifted by the zone offset (4 or 5 hours), never by more than a day.
    expect(Math.abs(wall - before)).toBeLessThan(24 * 60 * 60 * 1000);
  });
});
