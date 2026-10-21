/**
 * The car counter judged against billed jobs (job 2026-10-21-shop-eyes-ears-pro, S3).
 * Every billed job is a car that came in, so a camera that counted fewer arrivals than the
 * shop billed over the same complete days is missing cars. Thresholds restated by value here
 * (5 billed jobs, 7 days) so a change to either is a decision made in both places.
 */
import { describe, expect, it } from "vitest";
import { WINDOW_DAYS, vehicleCounterTrust } from "./vehicleCounterTrust";

describe("vehicleCounterTrust", () => {
  it("pins the window by value (the 5-job floor is pinned by behaviour below)", () => {
    expect(WINDOW_DAYS).toBe(7);
  });

  it("UNDERCOUNTING when the camera counted fewer arrivals than jobs were billed, in plain words with both numbers", () => {
    const v = vehicleCounterTrust({ arrivals: 9, billed: 32, days: 7 });
    expect(v.level).toBe("UNDERCOUNTING");
    expect(v).toMatchObject({ arrivals: 9, billed: 32, days: 7 });
    expect(v.reason).toContain("9 arrivals");
    expect(v.reason).toContain("32 jobs were billed");
    expect(v.reason).toContain("last 7 days");
  });

  it("one arrival short is already UNDERCOUNTING (arrivals < billed, strictly)", () => {
    expect(vehicleCounterTrust({ arrivals: 29, billed: 30, days: 7 }).level).toBe("UNDERCOUNTING");
  });

  it("OK when arrivals reach the billed count (drive-ins that bought nothing are normal)", () => {
    expect(vehicleCounterTrust({ arrivals: 30, billed: 30, days: 7 }).level).toBe("OK");
    expect(vehicleCounterTrust({ arrivals: 61, billed: 30, days: 7 }).level).toBe("OK");
  });

  it("UNKNOWN, never OK or UNDERCOUNTING, when either count could not be read", () => {
    const a = vehicleCounterTrust({ arrivals: null, billed: 30, days: 7 });
    expect(a.level).toBe("UNKNOWN");
    expect(a.reason).toMatch(/could not read/i);
    const b = vehicleCounterTrust({ arrivals: 3, billed: null, days: 7 });
    expect(b.level).toBe("UNKNOWN");
    expect(b.reason).toMatch(/could not read/i);
    expect(b.arrivals).toBe(3);
    expect(b.billed).toBeNull();
  });

  it("UNKNOWN below 5 billed jobs, even with zero arrivals: too little to judge the counter", () => {
    const v = vehicleCounterTrust({ arrivals: 0, billed: 4, days: 7 });
    expect(v.level).toBe("UNKNOWN");
    expect(v.reason).toContain("too few billed jobs in the last 7 days to judge the counter");
    // the boundary itself is judged
    expect(vehicleCounterTrust({ arrivals: 0, billed: 5, days: 7 }).level).toBe("UNDERCOUNTING");
  });
});
