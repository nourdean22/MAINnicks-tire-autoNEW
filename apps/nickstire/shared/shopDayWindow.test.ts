/**
 * shopDayWindow -- the shop's business window for one local day, as epoch ms, from the same
 * BUSINESS.hours.structured everything else reads (camera coverage, audit N2).
 */
import { describe, expect, it } from "vitest";
import { shopDayWindow } from "./shopState";

const TZ = "America/New_York";
const HOURS = {
  monday: "08:00-18:00",
  tuesday: "08:00-18:00",
  wednesday: "08:00-18:00",
  thursday: "08:00-18:00",
  friday: "08:00-18:00",
  saturday: "08:00-18:00",
  sunday: "09:00-16:00",
};

describe("shopDayWindow", () => {
  it("a Thursday afternoon in EDT: local midnight, 08:00 open and 18:00 close as UTC instants", () => {
    const w = shopDayWindow(new Date(Date.UTC(2026, 9, 8, 16, 34, 12, 345)), TZ, HOURS); // 12:34:12 EDT
    expect(w.weekday).toBe("thursday");
    expect(w.dayStartMs).toBe(Date.UTC(2026, 9, 8, 4, 0));
    expect(w.openMs).toBe(Date.UTC(2026, 9, 8, 12, 0));
    expect(w.closeMs).toBe(Date.UTC(2026, 9, 8, 22, 0));
  });

  it("Sunday has its own hours; a day without hours has null open and close but still a midnight", () => {
    const sunday = shopDayWindow(new Date(Date.UTC(2026, 9, 11, 15, 0)), TZ, HOURS);
    expect(sunday.weekday).toBe("sunday");
    expect(sunday.openMs).toBe(Date.UTC(2026, 9, 11, 13, 0));
    expect(sunday.closeMs).toBe(Date.UTC(2026, 9, 11, 20, 0));
    const closed = shopDayWindow(new Date(Date.UTC(2026, 9, 11, 15, 0)), TZ, { ...HOURS, sunday: "" });
    expect(closed.openMs).toBeNull();
    expect(closed.closeMs).toBeNull();
    expect(closed.dayStartMs).toBe(Date.UTC(2026, 9, 11, 4, 0));
  });

  it("before midnight UTC but after midnight local, the window is the LOCAL day's", () => {
    // 2026-10-08 23:30 EDT = 2026-10-09 03:30Z: still Thursday in the shop.
    const w = shopDayWindow(new Date(Date.UTC(2026, 9, 9, 3, 30)), TZ, HOURS);
    expect(w.weekday).toBe("thursday");
    expect(w.dayStartMs).toBe(Date.UTC(2026, 9, 8, 4, 0));
  });

  it("the fall-back day (2026-11-01): midnight is still EDT, 08:00 is EST, and the open is not an hour early", () => {
    const w = shopDayWindow(new Date(Date.UTC(2026, 10, 1, 18, 0)), TZ, HOURS); // 13:00 EST
    expect(w.weekday).toBe("sunday");
    expect(w.dayStartMs).toBe(Date.UTC(2026, 10, 1, 4, 0)); // 00:00 EDT
    expect(w.openMs).toBe(Date.UTC(2026, 10, 1, 14, 0)); // 09:00 EST (Sunday hours)
    expect(w.closeMs).toBe(Date.UTC(2026, 10, 1, 21, 0)); // 16:00 EST
  });

  it("the spring-forward day (2026-03-08): midnight is EST, the Sunday 09:00 open is EDT, eight real hours later", () => {
    const w = shopDayWindow(new Date(Date.UTC(2026, 2, 8, 16, 0)), TZ, HOURS); // 12:00 EDT
    expect(w.dayStartMs).toBe(Date.UTC(2026, 2, 8, 5, 0)); // 00:00 EST
    expect(w.openMs).toBe(Date.UTC(2026, 2, 8, 13, 0)); // 09:00 EDT (Sunday hours)
    expect(w.openMs! - w.dayStartMs).toBe(8 * 3_600_000);
  });
});
