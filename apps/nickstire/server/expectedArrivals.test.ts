/**
 * Expected-arrival capture must never push a drop-off into the future on an
 * ambiguous phrase (that would drop a same-day customer off today's board), and
 * must guard against unusable input. The date parser is pure + timezone-correct
 * (shop = America/New_York); the DB paths follow the repo convention (mocked).
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: h.getDb }));

import { parseExpectedDate, toShopDateStr, recordExpectedArrival } from "./services/expectedArrivals";

// Fixed instant: 2026-07-21 16:00 UTC = 12:00 ET, a Tuesday. Safe from DST/day edges.
const NOW = new Date("2026-07-21T16:00:00Z");

describe("parseExpectedDate", () => {
  it("defaults to TODAY for empty/undefined/'today'", () => {
    expect(parseExpectedDate(undefined, NOW)).toBe("2026-07-21");
    expect(parseExpectedDate("", NOW)).toBe("2026-07-21");
    expect(parseExpectedDate("today", NOW)).toBe("2026-07-21");
  });

  it("keeps same-day phrases on TODAY (never future)", () => {
    for (const p of ["this afternoon", "this morning", "tonight", "right now", "asap", "later today"]) {
      expect(parseExpectedDate(p, NOW), p).toBe("2026-07-21");
    }
  });

  it("advances one day for 'tomorrow'", () => {
    expect(parseExpectedDate("tomorrow", NOW)).toBe("2026-07-22");
    expect(parseExpectedDate("I'll drop it tomorrow morning", NOW)).toBe("2026-07-22");
  });

  it("resolves a named weekday to its NEXT occurrence", () => {
    expect(parseExpectedDate("I can come friday", NOW)).toBe("2026-07-24"); // Tue -> Fri
    expect(parseExpectedDate("monday", NOW)).toBe("2026-07-27");
    expect(parseExpectedDate("tuesday", NOW)).toBe("2026-07-28"); // same weekday => next week, not today
  });

  it("falls back to TODAY when there is no clear day", () => {
    expect(parseExpectedDate("sometime soon", NOW)).toBe("2026-07-21");
    expect(parseExpectedDate("when I get off work", NOW)).toBe("2026-07-21");
  });
});

describe("toShopDateStr", () => {
  it("formats in the shop timezone (ET), not UTC", () => {
    // 2026-01-01 02:00 UTC = 2025-12-31 21:00 ET — the ET date is the prior day.
    expect(toShopDateStr(new Date("2026-01-01T02:00:00Z"))).toBe("2025-12-31");
  });
});

describe("recordExpectedArrival guards", () => {
  it("returns null for an unusable phone (never records junk)", async () => {
    h.getDb.mockResolvedValue({ execute: vi.fn() });
    expect(await recordExpectedArrival({ phone: "123", source: "voice" })).toBeNull();
  });

  it("returns null when the DB is unavailable", async () => {
    h.getDb.mockResolvedValue(null);
    expect(await recordExpectedArrival({ phone: "2165550100", source: "voice" })).toBeNull();
  });
});
