/**
 * SpecialsPage — mapDbCouponToSpecial unit tests.
 *
 * Verification of coupon mapping to public specials format.
 * No tRPC, no DB. Safe to run in any environment.
 */
import { describe, it, expect } from "vitest";
import { mapDbCouponToSpecial } from "@/pages/SpecialsPage";
import type { RouterOutputs } from "@/lib/trpc";

type DbCoupon = NonNullable<RouterOutputs["coupons"]["active"]>[number];

const BASE_COUPON: DbCoupon = {
  id: 1,
  title: "Test Coupon",
  description: "Save on services",
  discountType: "dollar",
  discountValue: 10,
  code: "SAVE10",
  applicableServices: "all",
  terms: "Terms details",
  maxRedemptions: 0,
  currentRedemptions: 0,
  isActive: 1,
  isFeatured: 0,
  startsAt: new Date(),
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("mapDbCouponToSpecial — Surfacing active coupons", () => {
  // 1. dollar-off coupon maps correctly.
  it("maps dollar discount correctly", () => {
    const special = mapDbCouponToSpecial({
      ...BASE_COUPON,
      discountType: "dollar",
      discountValue: 15,
    }, 0);
    expect(special.discountLabel).toBe("$15 OFF");
    expect(special.salePrice).toBe("COUPON");
    expect(special.headline).toBe("Test Coupon");
  });

  // 2. percent-off coupon maps correctly.
  it("maps percent discount correctly", () => {
    const special = mapDbCouponToSpecial({
      ...BASE_COUPON,
      discountType: "percent",
      discountValue: 20,
    }, 0);
    expect(special.discountLabel).toBe("20% OFF");
  });

  // 3. free-service coupon maps correctly.
  it("maps free discount correctly", () => {
    const special = mapDbCouponToSpecial({
      ...BASE_COUPON,
      discountType: "free",
    }, 0);
    expect(special.discountLabel).toBe("FREE");
  });

  // 4. maxRedemptions = 0 does not show remaining count.
  it("does not show remaining count when maxRedemptions = 0", () => {
    const special = mapDbCouponToSpecial({
      ...BASE_COUPON,
      maxRedemptions: 0,
    }, 0);
    expect(special.limited).toBe(false);
    expect(special.badgeText).toBeUndefined();
  });

  // 5. maxRedemptions > 0 shows remaining count.
  it("shows remaining count when maxRedemptions > 0", () => {
    const special = mapDbCouponToSpecial({
      ...BASE_COUPON,
      maxRedemptions: 50,
      currentRedemptions: 20,
    }, 0);
    expect(special.limited).toBe(true);
    expect(special.badgeText).toBe("30 LEFT");
  });

  // 6. expiresAt maps to valid-through text.
  it("maps expiresAt to localized date string", () => {
    const expiry = new Date("2026-12-31T00:00:00.000Z");
    const special = mapDbCouponToSpecial({
      ...BASE_COUPON,
      expiresAt: expiry,
    }, 0);
    // Since local timezone might affect date string representation, check for month name and year
    expect(special.validThrough).toContain("December");
    expect(special.validThrough).toContain("2026");
  });

  it("handles null expiresAt with 'Available now' for unlimited coupons", () => {
    const special = mapDbCouponToSpecial({
      ...BASE_COUPON,
      maxRedemptions: 0,
      expiresAt: null,
    }, 0);
    expect(special.validThrough).toBe("Available now");
  });

  it("handles null expiresAt with 'While supplies last' for capped coupons", () => {
    const special = mapDbCouponToSpecial({
      ...BASE_COUPON,
      maxRedemptions: 10,
      expiresAt: null,
    }, 0);
    expect(special.validThrough).toBe("While supplies last");
  });

  // 7. featured coupon gets priority/highlight flag.
  it("maps featured flag correctly", () => {
    const specialFeatured = mapDbCouponToSpecial({
      ...BASE_COUPON,
      isFeatured: 1,
    }, 0);
    expect(specialFeatured.isFeatured).toBe(true);

    const specialRegular = mapDbCouponToSpecial({
      ...BASE_COUPON,
      isFeatured: 0,
    }, 0);
    expect(specialRegular.isFeatured).toBe(false);
  });
});
