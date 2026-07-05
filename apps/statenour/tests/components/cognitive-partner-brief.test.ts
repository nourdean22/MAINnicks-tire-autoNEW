/**
 * cognitive-partner-brief · once-per-day gate for the proactive morning
 * brief. Guards against the regression where useChat's non-persistent
 * state made messages.length === 0 true on every mount, firing a paid
 * LLM stream on every Home visit. The gate must fire at most once per
 * calendar day.
 */

import { describe, expect, it } from "vitest";
import {
  shouldFireBrief,
  todayStamp,
} from "@/lib/home/cognitive-partner-brief";

describe("shouldFireBrief · once-per-day gate", () => {
  it("fires when never fired before (null stamp)", () => {
    expect(shouldFireBrief(null, "2026-07-05")).toBe(true);
  });

  it("does NOT fire when already fired today (same stamp)", () => {
    expect(shouldFireBrief("2026-07-05", "2026-07-05")).toBe(false);
  });

  it("fires again on a new day (stale stamp)", () => {
    expect(shouldFireBrief("2026-07-04", "2026-07-05")).toBe(true);
  });
});

describe("todayStamp · ISO calendar day", () => {
  it("returns YYYY-MM-DD for a given instant", () => {
    expect(todayStamp(new Date("2026-07-05T14:32:00.000Z"))).toBe("2026-07-05");
  });

  it("is a valid YYYY-MM-DD shape by default", () => {
    expect(todayStamp()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
