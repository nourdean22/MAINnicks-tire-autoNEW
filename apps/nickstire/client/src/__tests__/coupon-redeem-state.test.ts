/**
 * CouponsSection — getRedeemState helper unit tests.
 *
 * Tests the pure helper exported from CouponsSection.tsx.
 * No DOM, no tRPC, no DB. Safe to run in any environment.
 */
import { describe, it, expect } from "vitest";
import { getRedeemState } from "@/pages/admin/customers/CouponsSection";

const future = new Date(Date.now() + 86400000 * 30);
const past   = new Date(Date.now() - 86400000 * 1);

const BASE = {
  isActive: 1 as number,
  expiresAt: null as Date | string | null,
  maxRedemptions: 0,
  currentRedemptions: 0,
};

describe("getRedeemState — Mark Redeemed button state", () => {
  // maxRedemptions = 0 → unlimited
  it("unlimited: disabled=false, label=Mark Redeemed, badge=Unlimited", () => {
    const rs = getRedeemState({ ...BASE, maxRedemptions: 0 });
    expect(rs.disabled).toBe(false);
    expect(rs.label).toBe("Mark Redeemed");
    expect(rs.badge).toBe("Unlimited");
  });

  it("unlimited with many redemptions: still enabled (no cap)", () => {
    const rs = getRedeemState({ ...BASE, maxRedemptions: 0, currentRedemptions: 9999 });
    expect(rs.disabled).toBe(false);
    expect(rs.badge).toBe("Unlimited");
  });

  // capped coupon — remaining slots
  it("capped with 3 remaining: disabled=false, badge='3 left'", () => {
    const rs = getRedeemState({ ...BASE, maxRedemptions: 5, currentRedemptions: 2 });
    expect(rs.disabled).toBe(false);
    expect(rs.badge).toBe("3 left");
  });

  it("capped with 1 remaining: disabled=false, badge='1 left'", () => {
    const rs = getRedeemState({ ...BASE, maxRedemptions: 3, currentRedemptions: 2 });
    expect(rs.disabled).toBe(false);
    expect(rs.badge).toBe("1 left");
  });

  // fully claimed
  it("fully claimed (current === max): disabled=true, label=Fully Claimed", () => {
    const rs = getRedeemState({ ...BASE, maxRedemptions: 3, currentRedemptions: 3 });
    expect(rs.disabled).toBe(true);
    expect(rs.label).toBe("Fully Claimed");
    expect(rs.badge).toBeNull();
  });

  it("over-claimed (current > max): disabled=true", () => {
    const rs = getRedeemState({ ...BASE, maxRedemptions: 3, currentRedemptions: 5 });
    expect(rs.disabled).toBe(true);
    expect(rs.label).toBe("Fully Claimed");
  });

  // inactive coupon
  it("inactive: disabled=true, label=Inactive", () => {
    const rs = getRedeemState({ ...BASE, isActive: 0, maxRedemptions: 10 });
    expect(rs.disabled).toBe(true);
    expect(rs.label).toBe("Inactive");
    expect(rs.badge).toBeNull();
  });

  it("inactive wins over cap check", () => {
    // isActive=0 checked first — should return Inactive, not Fully Claimed
    const rs = getRedeemState({ ...BASE, isActive: 0, maxRedemptions: 3, currentRedemptions: 3 });
    expect(rs.label).toBe("Inactive");
  });

  // expired coupon
  it("expired: disabled=true, label=Expired", () => {
    const rs = getRedeemState({ ...BASE, expiresAt: past });
    expect(rs.disabled).toBe(true);
    expect(rs.label).toBe("Expired");
  });

  it("future expiry: not expired, enabled when under cap", () => {
    const rs = getRedeemState({ ...BASE, expiresAt: future, maxRedemptions: 5, currentRedemptions: 2 });
    expect(rs.disabled).toBe(false);
    expect(rs.badge).toBe("3 left");
  });

  it("expired wins over cap check (inactive checked first, expired second)", () => {
    const rs = getRedeemState({ ...BASE, isActive: 1, expiresAt: past, maxRedemptions: 10 });
    expect(rs.label).toBe("Expired");
  });

  // edge: maxRedemptions = 0, inactive
  it("unlimited but inactive: disabled=true", () => {
    const rs = getRedeemState({ ...BASE, isActive: 0, maxRedemptions: 0 });
    expect(rs.disabled).toBe(true);
    expect(rs.label).toBe("Inactive");
  });
});
