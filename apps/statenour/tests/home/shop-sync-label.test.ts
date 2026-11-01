/**
 * The Home Nick's Tire card says when the shop's numbers were last synced, not when we read them
 * (2026-10-31, missed-asks row 48; nickstire PR 3482 adds `syncedAt` to revenue_today).
 *
 * Contract: `syncedAt` is a UTC ISO instant. null or absent means "sync time unknown". An OLD value is a
 * true statement (a failed probe never moves it), so the card shows its age instead of hiding it.
 * Times render in America/New_York whatever the server or phone zone is.
 */
import { describe, expect, it } from "vitest";
import { SHOP_SYNC_STALE_MS, shopSyncLabel } from "@/lib/home/shop-sync-label";

// Saturday 2026-10-31, 3:30 PM EDT. DST ends 2026-11-01, so every stamp below is EDT (UTC-4).
const NOW = new Date("2026-10-31T19:30:00Z");

describe("shopSyncLabel", () => {
  it("a stamp from today ET is a bare time", () => {
    expect(shopSyncLabel("2026-10-31T18:40:00.000Z", NOW)).toEqual({ text: "as of 2:40 PM", state: "fresh" });
  });

  it("a stamp from yesterday ET carries the date, so 2:40 PM cannot be read as today", () => {
    const l = shopSyncLabel("2026-10-30T18:40:00.000Z", NOW);
    expect(l.text.startsWith("as of Oct 30, 2:40 PM")).toBe(true);
  });

  it("null is unknown, and says so in words", () => {
    expect(shopSyncLabel(null, NOW)).toEqual({ text: "sync time unknown", state: "unknown" });
  });

  it("absent (an older nickstire without the field) behaves like null", () => {
    expect(shopSyncLabel(undefined, NOW)).toEqual({ text: "sync time unknown", state: "unknown" });
  });

  it("an unparseable stamp is unknown, never Invalid Date and never the read time", () => {
    for (const bad of ["soon", "", "not-a-date"]) {
      expect(shopSyncLabel(bad, NOW)).toEqual({ text: "sync time unknown", state: "unknown" });
    }
  });

  it("older than 2 hours is stale and the age is in the words, not only the colour", () => {
    // 12:05 PM EDT, 3 h 25 m before NOW.
    expect(shopSyncLabel("2026-10-31T16:05:00.000Z", NOW)).toEqual({ text: "as of 12:05 PM, 3 h old", state: "stale" });
  });

  it("the 2 hour line: exactly 2 h is fresh, one millisecond over is stale", () => {
    const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
    expect(shopSyncLabel(at(SHOP_SYNC_STALE_MS), NOW).state).toBe("fresh");
    expect(shopSyncLabel(at(SHOP_SYNC_STALE_MS + 1), NOW).state).toBe("stale");
  });

  it("a stamp a minute in the future (clock skew) is fresh, not stale", () => {
    expect(shopSyncLabel("2026-10-31T19:31:00.000Z", NOW)).toEqual({ text: "as of 3:31 PM", state: "fresh" });
  });

  it("days: past 48 h the age reads in days", () => {
    const l = shopSyncLabel("2026-10-28T18:40:00.000Z", NOW);
    expect(l.text).toBe("as of Oct 28, 2:40 PM, 3 days old");
    expect(l.state).toBe("stale");
  });

  it("the day is judged in ET, not UTC: 7:50 PM ET is still today when the UTC date has rolled over", () => {
    // NOW2 = 11:30 PM EDT Oct 31, but 03:30Z Nov 1. The stamp is 7:50 PM EDT Oct 31 (23:50Z Oct 31).
    const now2 = new Date("2026-11-01T03:30:00Z");
    const l = shopSyncLabel("2026-10-31T23:50:00.000Z", now2);
    expect(l.text.startsWith("as of 7:50 PM")).toBe(true);
    expect(l.text).not.toContain("Oct");
  });

  it("the time is in ET: 18:40Z is 2:40 PM, never 6:40 PM", () => {
    expect(shopSyncLabel("2026-10-31T18:40:00.000Z", NOW).text).not.toContain("6:40");
  });

  it("uses a plain space before PM so a copied line matches what is typed", () => {
    expect(shopSyncLabel("2026-10-31T18:40:00.000Z", NOW).text).not.toMatch(/ | /);
  });

  it("copy has no em dash", () => {
    for (const s of [null, "2026-10-30T18:40:00.000Z", "2026-10-31T16:05:00.000Z"]) {
      expect(shopSyncLabel(s, NOW).text).not.toContain("—");
    }
  });
});
