/**
 * server/lib/solar.ts -- the shop's own sunrise/sunset, pinned against published tables.
 * Reference (surf-life.blue, Cleveland OH, 2026-10-08): sunrise 07:29 EDT, sunset 18:58 EDT,
 * civil twilight about 07:03 / 19:25 EDT. Tolerances are generous on purpose: the window is
 * a paging decision, not an almanac.
 */
import { describe, expect, it } from "vitest";
import { localDayOf, solarDay, solarExpectedOffline } from "./solar";

const CLEVELAND = { lat: 41.5525118, lng: -81.5571875, timezone: "America/New_York" };
const edt = (h: number, m: number, day = 8) => Date.UTC(2026, 9, day, h + 4, m); // EDT = UTC-4
const withinMinutes = (actualMs: number, expectedMs: number, tolerance: number) =>
  Math.abs(actualMs - expectedMs) <= tolerance * 60_000;

describe("solarDay", () => {
  it("matches the published Cleveland table for 2026-10-08 within a few minutes", () => {
    const day = solarDay("2026-10-08", CLEVELAND);
    expect(withinMinutes(day.sunriseMs, edt(7, 29), 4), new Date(day.sunriseMs).toISOString()).toBe(true);
    expect(withinMinutes(day.sunsetMs, edt(18, 58), 4), new Date(day.sunsetMs).toISOString()).toBe(true);
    expect(withinMinutes(day.civilDawnMs, edt(7, 3), 8), new Date(day.civilDawnMs).toISOString()).toBe(true);
    expect(withinMinutes(day.civilDuskMs, edt(19, 25), 8), new Date(day.civilDuskMs).toISOString()).toBe(true);
    expect(day.civilDawnMs).toBeLessThan(day.sunriseMs);
    expect(day.sunsetMs).toBeLessThan(day.civilDuskMs);
  });

  it("days shorten through October (the latest-sunrise week the table names is the 31st)", () => {
    const early = solarDay("2026-10-01", CLEVELAND);
    const late = solarDay("2026-10-31", CLEVELAND);
    expect(late.sunsetMs - late.sunriseMs).toBeLessThan(early.sunsetMs - early.sunriseMs);
  });

  it("explains the two measured recoveries as about two hours after sunrise", () => {
    // 2026-10-04 online 09:15 ET; 2026-10-07 online 09:23 ET (audit section 13, N3).
    const oct4 = solarDay("2026-10-04", CLEVELAND);
    const oct7 = solarDay("2026-10-07", CLEVELAND);
    const lag4 = (edt(9, 15, 4) - oct4.sunriseMs) / 60_000;
    const lag7 = (edt(9, 23, 7) - oct7.sunriseMs) / 60_000;
    expect(lag4).toBeGreaterThan(95);
    expect(lag7).toBeGreaterThan(95);
    // The DEFAULT lag must still cover both measured recovery instants (no page before the
    // camera actually came back) and must end soon after them (a page is still possible).
    expect(solarExpectedOffline(new Date(edt(9, 15, 4)), CLEVELAND).expectedOffline).toBe(true);
    expect(solarExpectedOffline(new Date(edt(9, 23, 7)), CLEVELAND).expectedOffline).toBe(true);
    // The default lag is 150 min (sunrise 07:24 / 07:28 -> about 09:54 / 09:58 on those days).
    expect(solarExpectedOffline(new Date(edt(9, 50, 4)), CLEVELAND).expectedOffline).toBe(true);
    expect(solarExpectedOffline(new Date(edt(10, 5, 4)), CLEVELAND).expectedOffline).toBe(false);
    expect(solarExpectedOffline(new Date(edt(10, 5, 7)), CLEVELAND).expectedOffline).toBe(false);
  });
});

describe("localDayOf", () => {
  it("reads the shop's calendar day, not UTC's", () => {
    // 23:30 ET on the 7th is 03:30Z on the 8th.
    expect(localDayOf(new Date(Date.UTC(2026, 9, 8, 3, 30)), "America/New_York")).toBe("2026-10-07");
    expect(localDayOf(new Date(Date.UTC(2026, 9, 8, 12, 0)), "America/New_York")).toBe("2026-10-08");
  });
});

describe("solarExpectedOffline", () => {
  it("is expected overnight and until two and a half hours after sunrise, not at noon", () => {
    expect(solarExpectedOffline(new Date(edt(5, 0)), CLEVELAND).expectedOffline).toBe(true);
    expect(solarExpectedOffline(new Date(edt(8, 30)), CLEVELAND).expectedOffline).toBe(true); // 07:29 + 150 min = 09:59
    expect(solarExpectedOffline(new Date(edt(9, 45)), CLEVELAND).expectedOffline).toBe(true);
    expect(solarExpectedOffline(new Date(edt(10, 15)), CLEVELAND).expectedOffline).toBe(false);
    expect(solarExpectedOffline(new Date(edt(12, 0)), CLEVELAND).expectedOffline).toBe(false);
    expect(solarExpectedOffline(new Date(edt(19, 40)), CLEVELAND).expectedOffline).toBe(true); // after civil dusk ~19:25
    expect(solarExpectedOffline(new Date(edt(23, 59)), CLEVELAND).expectedOffline).toBe(true);
  });

  it("names the window in the shop's local time so an operator can check it against the sky", () => {
    const night = solarExpectedOffline(new Date(edt(5, 0)), CLEVELAND);
    expect(night.reason).toMatch(/dark from civil dusk \d\d:\d\d until about (09:5\d|10:0\d)/);
    expect(night.fromMs).toBeLessThan(night.untilMs);
    const day = solarExpectedOffline(new Date(edt(12, 0)), CLEVELAND);
    expect(day.reason).toMatch(/daylight/);
    expect(day.fromMs).toBeLessThan(day.untilMs);
  });

  it("a longer recovery lag widens the morning window and nothing else", () => {
    const short = solarExpectedOffline(new Date(edt(9, 45)), CLEVELAND, 120);
    const long = solarExpectedOffline(new Date(edt(9, 45)), CLEVELAND, 180);
    expect(short.expectedOffline).toBe(false);
    expect(long.expectedOffline).toBe(true);
  });
});
