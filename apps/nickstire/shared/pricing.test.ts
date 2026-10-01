import { describe, expect, it } from "vitest";
import { OIL_COUPON, oilCouponActive } from "./pricing";

describe("oilCouponActive — the coupon runs through its last day in Cleveland", () => {
  it("is active on the last valid day, until midnight Eastern", () => {
    expect(OIL_COUPON.validThrough).toBe("2026-12-31");
    expect(oilCouponActive(new Date("2026-12-31T23:59:00-05:00"))).toBe(true);
  });

  it("ends at midnight Eastern, not midnight UTC", () => {
    // 03:00 UTC on January 1 is still 22:00 on December 31 in Cleveland.
    expect(oilCouponActive(new Date("2027-01-01T03:00:00Z"))).toBe(true);
    expect(oilCouponActive(new Date("2027-01-01T00:00:01-05:00"))).toBe(false);
  });

  it("is active today, 2026-10-01, when the owner set it", () => {
    expect(oilCouponActive(new Date("2026-10-01T12:00:00-04:00"))).toBe(true);
  });
});
