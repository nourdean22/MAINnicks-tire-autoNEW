import { describe, it, expect } from "vitest";
import { estimateRecoveredRevenue, CAPTURE_LOW, CAPTURE_HIGH } from "../services/receptionistRoi";

describe("estimateRecoveredRevenue", () => {
  it("returns a capture-band range from conversions × avg ticket", () => {
    // 100 conversions × $200 avg ticket (20000 cents)
    const b = estimateRecoveredRevenue(100, 20000);
    expect(b.lowCents).toBe(Math.round(100 * 20000 * CAPTURE_LOW)); // $8,000
    expect(b.highCents).toBe(Math.round(100 * 20000 * CAPTURE_HIGH)); // $14,000
    expect(b.lowCents).toBeLessThan(b.highCents);
  });

  it("is zero when there are no conversions or no ticket value", () => {
    expect(estimateRecoveredRevenue(0, 20000)).toEqual({ lowCents: 0, highCents: 0 });
    expect(estimateRecoveredRevenue(100, 0)).toEqual({ lowCents: 0, highCents: 0 });
  });

  it("never returns negative (defensive against bad inputs)", () => {
    expect(estimateRecoveredRevenue(-5, 20000)).toEqual({ lowCents: 0, highCents: 0 });
  });
});
