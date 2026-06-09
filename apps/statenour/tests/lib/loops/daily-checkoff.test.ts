import { describe, it, expect } from "vitest";
import { isDailyCheckoff } from "@/lib/loops/daily-checkoff";

describe("isDailyCheckoff", () => {
  it("detects a DAILY check-off (loopKind DAILY + a lastCompletedAt patch)", () => {
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: new Date() })).toBe(true);
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: "2026-06-09T00:00:00Z" })).toBe(true);
  });

  it("does NOT fire on a plain DAILY edit (no lastCompletedAt) — so no spurious credit", () => {
    expect(isDailyCheckoff("DAILY", {})).toBe(false);
    expect(isDailyCheckoff("DAILY", { lastCompletedAt: null })).toBe(false);
  });

  it("only fires for DAILY — ONCE/WEEKLY/PROMISE complete via other paths", () => {
    expect(isDailyCheckoff("ONCE", { lastCompletedAt: new Date() })).toBe(false);
    expect(isDailyCheckoff("WEEKLY", { lastCompletedAt: new Date() })).toBe(false);
    expect(isDailyCheckoff("PROMISE", { lastCompletedAt: new Date() })).toBe(false);
    expect(isDailyCheckoff(null, { lastCompletedAt: new Date() })).toBe(false);
    expect(isDailyCheckoff(undefined, { lastCompletedAt: new Date() })).toBe(false);
  });
});
