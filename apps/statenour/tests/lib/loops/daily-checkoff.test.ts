import { describe, it, expect } from "vitest";
import { isDailyCheckoff } from "@/lib/loops/daily-checkoff";

describe("isDailyCheckoff", () => {
  it("detects a first-ever DAILY check-off (no prior timestamp)", () => {
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: new Date() })).toBe(true);
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: "2026-06-09T00:00:00Z" })).toBe(true);
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: new Date() }, null)).toBe(true);
  });

  it("detects a check-off that ADVANCES past the prior completion", () => {
    const prev = new Date("2026-06-08T09:00:00Z");
    const now = new Date("2026-06-09T09:00:00Z");
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: now }, prev)).toBe(true);
    // string forms compare the same way
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: now.toISOString() }, prev.toISOString())).toBe(true);
  });

  it("does NOT fire on a plain DAILY edit (no lastCompletedAt) — so no spurious credit", () => {
    expect(isDailyCheckoff("DAILY", {})).toBe(false);
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: null })).toBe(false);
    // edit that touches other fields but omits lastCompletedAt, with a prior value present
    expect(isDailyCheckoff("DAILY", {}, new Date("2026-06-08T09:00:00Z"))).toBe(false);
  });

  it("does NOT fire when lastCompletedAt is UNCHANGED (an edit echoing the field)", () => {
    const same = new Date("2026-06-09T09:00:00Z");
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: same }, same)).toBe(false);
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: same.toISOString() }, same)).toBe(false);
  });

  it("does NOT fire when lastCompletedAt is OLDER than the prior value (no backwards credit)", () => {
    const prev = new Date("2026-06-09T09:00:00Z");
    const older = new Date("2026-06-08T09:00:00Z");
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: older }, prev)).toBe(false);
  });

  it("only fires for DAILY — ONCE/WEEKLY/PROMISE complete via other paths", () => {
    const now = new Date();
    expect(isDailyCheckoff("ONCE", { lastCompletedAt: now })).toBe(false);
    expect(isDailyCheckoff("WEEKLY", { lastCompletedAt: now })).toBe(false);
    expect(isDailyCheckoff("PROMISE", { lastCompletedAt: now })).toBe(false);
    expect(isDailyCheckoff(null, { lastCompletedAt: now })).toBe(false);
    expect(isDailyCheckoff(undefined, { lastCompletedAt: now })).toBe(false);
  });
});
