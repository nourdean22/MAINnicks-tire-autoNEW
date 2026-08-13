import { describe, it, expect } from "vitest";
import { checkBusinessTimezone } from "../lib/timezoneAssert";

describe("business timezone check", () => {
  it("passes on a runtime that has real IANA timezone data", () => {
    const r = checkBusinessTimezone();
    expect(r.ok).toBe(true);
    // US Eastern is UTC-5 (EST) or UTC-4 (EDT) — never anything else.
    expect([-4, -5]).toContain(r.offsetHours);
  });

  // The failure this exists to catch: a container with no tz database resolves
  // America/New_York to UTC, offset 0, and every "ET hour" comparison is wrong
  // while every log line still says ET.
  it("would REJECT a UTC-resolving (offset 0) runtime", () => {
    const r = checkBusinessTimezone();
    expect(r.offsetHours).not.toBe(0);
  });

  it("reports the offset it actually measured, not an assumed one", () => {
    const r = checkBusinessTimezone();
    expect(r.detail).toContain(String(r.offsetHours));
  });

  // A day boundary between UTC and ET must not read as a ±20h offset.
  it("handles the UTC/ET date boundary without wrapping wrong", () => {
    // 01:30 UTC is 21:30 ET the previous day — the naive subtraction is +20.
    const r = checkBusinessTimezone(new Date("2026-07-15T01:30:00Z"));
    expect(r.offsetHours).toBe(-4);
    expect(r.ok).toBe(true);
  });

  it("handles the reverse boundary", () => {
    const r = checkBusinessTimezone(new Date("2026-07-15T23:30:00Z"));
    expect([-4, -5]).toContain(r.offsetHours);
  });

  // Winter: EST, UTC-5. Guards against hardcoding the summer offset.
  it("accepts EST as well as EDT", () => {
    const r = checkBusinessTimezone(new Date("2026-01-15T18:00:00Z"));
    expect(r.offsetHours).toBe(-5);
    expect(r.ok).toBe(true);
  });
});

// NT-009 · getBusinessDateKey — the shop-time twin of the client helper.
// The no-show sweep compares bookings.preferredDate against this key; the bug
// it replaces (bare CURDATE() on a UTC session) flips TODAY's bookings to
// "past" between 20:00 ET and midnight ET.
import { getBusinessDateKey } from "../lib/timezoneAssert";

describe("getBusinessDateKey", () => {
  it("matches the calendar date in ET during the day", () => {
    // 15:00 UTC = 11:00 EDT, same calendar date both zones.
    expect(getBusinessDateKey(new Date("2026-08-13T15:00:00Z"))).toBe("2026-08-13");
  });

  it("stays on TODAY's ET date when UTC has already rolled over (the CURDATE bug)", () => {
    // 02:00 UTC Aug 14 = 22:00 EDT Aug 13. CURDATE() on a UTC session says
    // 2026-08-14 here — which is exactly what auto-cancelled same-day bookings.
    expect(getBusinessDateKey(new Date("2026-08-14T02:00:00Z"))).toBe("2026-08-13");
  });

  it("handles the EST (winter) boundary too", () => {
    // 04:30 UTC Jan 15 = 23:30 EST Jan 14.
    expect(getBusinessDateKey(new Date("2026-01-15T04:30:00Z"))).toBe("2026-01-14");
  });

  it("agrees with the UTC date when both zones share a calendar day", () => {
    expect(getBusinessDateKey(new Date("2026-01-15T18:00:00Z"))).toBe("2026-01-15");
  });
});
