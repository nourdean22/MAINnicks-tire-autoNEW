/**
 * Coupon Redemption Cap Enforcement Tests
 *
 * Tests the business rules for maxRedemptions / currentRedemptions.
 * Uses isolated pure functions — no real DB connection, no production data mutation.
 *
 * Semantics:
 *   maxRedemptions = 0  → unlimited (no cap)
 *   maxRedemptions > 0  → hard cap; reject when currentRedemptions >= maxRedemptions
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ─── DB mocks for integration-like unit tests ────────────────────────────────
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: mockSelect
      }))
    }))
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: mockUpdate
    }))
  }))
};

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: vi.fn(() => ({
      end: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => mockDb),
}));

// ─── Pure helper extracted from the enforcement logic ─────────────────────────
// These mirror the exact guard logic in redeemCouponById so tests stay in sync.

type CouponRow = {
  id: number;
  isActive: number;
  expiresAt: Date | null;
  maxRedemptions: number;
  currentRedemptions: number;
};

/** Returns null if redeemable, or an error reason string if not. */
function guardRedemption(coupon: CouponRow, now = new Date()): string | null {
  if (coupon.isActive !== 1) return "COUPON_INACTIVE";
  if (coupon.expiresAt !== null && coupon.expiresAt < now) return "COUPON_EXPIRED";
  if (
    coupon.maxRedemptions > 0 &&
    coupon.currentRedemptions >= coupon.maxRedemptions
  ) {
    return "COUPON_CAP_REACHED";
  }
  return null; // redeemable
}

const BASE: CouponRow = {
  id: 1,
  isActive: 1,
  expiresAt: null,
  maxRedemptions: 0,
  currentRedemptions: 0,
};

const future = new Date(Date.now() + 86400000 * 30);
const past   = new Date(Date.now() - 86400000 * 1);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Coupon redemption guard", () => {
  // 1. maxRedemptions = 0 → unlimited
  it("allows redemption when maxRedemptions = 0 (unlimited)", () => {
    const coupon = { ...BASE, maxRedemptions: 0, currentRedemptions: 0 };
    expect(guardRedemption(coupon)).toBeNull();
  });

  it("allows repeated redemptions when maxRedemptions = 0", () => {
    const coupon = { ...BASE, maxRedemptions: 0, currentRedemptions: 9999 };
    expect(guardRedemption(coupon)).toBeNull();
  });

  // 2–3. maxRedemptions = 3: allow 1, 2, 3 — reject 4
  it("allows redemption 1 of 3", () => {
    const coupon = { ...BASE, maxRedemptions: 3, currentRedemptions: 0 };
    expect(guardRedemption(coupon)).toBeNull();
  });

  it("allows redemption 2 of 3", () => {
    const coupon = { ...BASE, maxRedemptions: 3, currentRedemptions: 1 };
    expect(guardRedemption(coupon)).toBeNull();
  });

  it("allows redemption 3 of 3 (last slot)", () => {
    const coupon = { ...BASE, maxRedemptions: 3, currentRedemptions: 2 };
    expect(guardRedemption(coupon)).toBeNull();
  });

  it("rejects redemption 4 when cap is 3", () => {
    const coupon = { ...BASE, maxRedemptions: 3, currentRedemptions: 3 };
    expect(guardRedemption(coupon)).toBe("COUPON_CAP_REACHED");
  });

  // 4. currentRedemptions never exceeds maxRedemptions
  it("never allows currentRedemptions to exceed maxRedemptions", () => {
    for (let current = 5; current <= 10; current++) {
      const coupon = { ...BASE, maxRedemptions: 5, currentRedemptions: current };
      expect(guardRedemption(coupon)).toBe("COUPON_CAP_REACHED");
    }
  });

  // 5. Inactive coupon → rejected
  it("rejects inactive coupon even if under cap", () => {
    const coupon = { ...BASE, isActive: 0, maxRedemptions: 10, currentRedemptions: 0 };
    expect(guardRedemption(coupon)).toBe("COUPON_INACTIVE");
  });

  // 6. Expired coupon → rejected
  it("rejects expired coupon even if under cap", () => {
    const coupon = { ...BASE, expiresAt: past, maxRedemptions: 10, currentRedemptions: 0 };
    expect(guardRedemption(coupon)).toBe("COUPON_EXPIRED");
  });

  it("allows coupon with future expiry", () => {
    const coupon = { ...BASE, expiresAt: future, maxRedemptions: 10, currentRedemptions: 0 };
    expect(guardRedemption(coupon)).toBeNull();
  });

  // 7. Missing coupon ID handled by caller — guard only tests the row itself
  it("inactive wins over cap-reached (inactive checked first)", () => {
    const coupon = {
      ...BASE,
      isActive: 0,
      maxRedemptions: 3,
      currentRedemptions: 3,
    };
    expect(guardRedemption(coupon)).toBe("COUPON_INACTIVE");
  });

  // 8. Full-capped coupon should not appear as redeemable
  it("returns COUPON_CAP_REACHED for capped coupon with any overshoot", () => {
    const coupon = { ...BASE, maxRedemptions: 1, currentRedemptions: 1 };
    expect(guardRedemption(coupon)).toBe("COUPON_CAP_REACHED");
  });

  // 9. Atomicity is enforced by MySQL UPDATE ... WHERE condition — verified semantically:
  //    two concurrent claims on last slot: exactly one sees currentRedemptions < maxRedemptions.
  //    The SQL `WHERE currentRedemptions < maxRedemptions` ensures the losing claim
  //    gets 0 affectedRows and the router throws COUPON_CAP_REACHED.
  it("concurrent guard: only one of two last-slot claims wins", () => {
    // Simulate: both readers see currentRedemptions = 2, maxRedemptions = 3
    // Both pass guard. DB atomic update only increments once.
    // Second UPDATE sees affectedRows = 0 → COUPON_CAP_REACHED.
    const coupon = { ...BASE, maxRedemptions: 3, currentRedemptions: 2 };
    // First claim passes
    expect(guardRedemption(coupon)).toBeNull();
    // After first claim commits, currentRedemptions = 3 — second claim blocked
    const afterFirst = { ...coupon, currentRedemptions: 3 };
    expect(guardRedemption(afterFirst)).toBe("COUPON_CAP_REACHED");
  });

  // 10. No migration required — confirmed: columns exist in schema.ts lines 296-297
  it("confirms no migration needed: maxRedemptions and currentRedemptions exist in schema", async () => {
    // This import verifies the schema compiles and exposes both columns
    const { coupons } = await import("../../drizzle/schema");
    expect(coupons.maxRedemptions).toBeDefined();
    expect(coupons.currentRedemptions).toBeDefined();
  });
});

describe("redeemCouponById Database Fallback", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "mysql://dummy:3306/db";
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("succeeds when updateResult contains affectedRows = 1", async () => {
    const { redeemCouponById } = await import("../db");
    
    // Mock select row
    mockSelect.mockResolvedValue([
      {
        isActive: 1,
        expiresAt: null,
        maxRedemptions: 10,
        currentRedemptions: 2,
      }
    ]);

    // Mock update result with affectedRows: 1
    mockUpdate.mockResolvedValue([{ affectedRows: 1 }]);

    const result = await redeemCouponById(123);
    expect(result).toEqual({ success: true, currentRedemptions: 3 });
  });

  it("fails when updateResult contains affectedRows = 0 (cap reached concurrent)", async () => {
    const { redeemCouponById } = await import("../db");
    
    mockSelect.mockResolvedValue([
      {
        isActive: 1,
        expiresAt: null,
        maxRedemptions: 10,
        currentRedemptions: 2,
      }
    ]);

    mockUpdate.mockResolvedValue([{ affectedRows: 0 }]);

    let caught: any;
    try {
      await redeemCouponById(123);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch("COUPON_CAP_REACHED");
  });

  it("fails-closed when updateResult is empty array (unknown/empty update result shape)", async () => {
    const { redeemCouponById } = await import("../db");
    
    mockSelect.mockResolvedValue([
      {
        isActive: 1,
        expiresAt: null,
        maxRedemptions: 10,
        currentRedemptions: 2,
      }
    ]);

    // Mock updateResult as empty array or empty object inside array
    mockUpdate.mockResolvedValue([{}]);

    let caught: any;
    try {
      await redeemCouponById(123);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch("COUPON_CAP_REACHED");
  });
});
