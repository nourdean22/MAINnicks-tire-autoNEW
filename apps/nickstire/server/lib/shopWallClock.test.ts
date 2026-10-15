import { describe, expect, it } from "vitest";
import { algEstimates, invoices } from "../../drizzle/schema";
import { shopInstant, shopWallClock } from "./timezoneAssert";

describe("the date columns store a wall-clock value as its Eastern fields, in any process timezone", () => {
  // Drizzle binds a timestamp column with toISOString(), i.e. the Date's UTC fields. The wall-clock Date
  // carries the Eastern fields in those UTC fields, so the row keeps the shop's clock. Pinned here so a change
  // to the column mode (or a raw bind of the Date) that would shift the stored hour fails the suite.
  it("the invoice and estimate columns map 21:00 on Oct 12 to that stored value", () => {
    const wall = shopWallClock(new Date("2026-10-13T01:00:00Z"));
    expect(invoices.invoiceDate.mapToDriverValue(wall)).toBe("2026-10-12 21:00:00.000");
    expect(algEstimates.estimateDate.mapToDriverValue(wall)).toBe("2026-10-12 21:00:00.000");
  });
});

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

describe("shopInstant: the inverse of shopWallClock, so ages are measured between instants", () => {
  it("turns a stored 21:00 shop-day clock back into the EDT instant it was written at", () => {
    // Stored as 2026-10-12 21:00 (the Cleveland clock); the instant is 2026-10-13T01:00Z.
    expect(shopInstant(new Date("2026-10-12T21:00:00Z")).toISOString()).toBe("2026-10-13T01:00:00.000Z");
  });

  it("uses the winter offset too: a stored 21:00 in January is 02:00Z the next day", () => {
    expect(shopInstant(new Date("2026-01-14T21:00:00Z")).toISOString()).toBe("2026-01-15T02:00:00.000Z");
  });

  it("round-trips with shopWallClock across the March and November changes", () => {
    for (const instant of [
      "2026-03-08T06:30:00Z", // just before EST→EDT
      "2026-03-08T08:30:00Z", // after the change
      "2026-10-13T01:00:00Z", // EDT
      // The repeated 01:00-02:00 hour on Nov 1 has two instants for one wall time, so it cannot
      // round-trip; 00:30 EDT is the last clean EDT reading before it.
      "2026-11-01T04:30:00Z", // 00:30 EDT
      "2026-11-01T07:30:00Z", // EST
    ]) {
      const i = new Date(instant);
      expect(shopInstant(shopWallClock(i)).getTime()).toBe(i.getTime());
    }
  });
});
