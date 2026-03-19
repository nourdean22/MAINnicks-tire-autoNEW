/**
 * Tests for untested tRPC router procedures.
 * Covers: callback, booking status, coupons, QA, pricing, referrals, loyalty, inspection.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── HELPERS ───────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createAuthContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-id",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

// ─── CALLBACK SUBMIT ──────────────────────────────────

describe("callback.submit", () => {
  it("accepts a valid callback request", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.callback.submit({
      name: "John Doe",
      phone: "216-555-1234",
      preferredTime: "morning",
      issue: "Brakes squealing",
    });
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("accepts callback without optional issue", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.callback.submit({
      name: "Jane Smith",
      phone: "216-555-5678",
      preferredTime: "afternoon",
    });
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });
});

// ─── BOOKING STATUS LOOKUP ────────────────────────────

describe("booking.statusByPhone", () => {
  it("returns empty array for non-existent phone number", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.booking.statusByPhone({ phone: "000-000-0000" });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

describe("booking.statusByRef", () => {
  it("returns empty array for non-existent reference number", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.booking.statusByRef({ ref: "NONEXISTENT-REF-12345" });
    // getBookingByRef returns an array, not null
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

// ─── COUPONS ──────────────────────────────────────────

describe("coupons.active", () => {
  it("returns an array of active coupons", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.coupons.active();
    expect(Array.isArray(result)).toBe(true);
    // Each coupon should have required fields
    for (const coupon of result) {
      expect(coupon).toHaveProperty("id");
      expect(coupon).toHaveProperty("title");
      expect(coupon).toHaveProperty("code");
    }
  });
});

// ─── Q&A ──────────────────────────────────────────────

describe("qa.published", () => {
  it("returns an array of published Q&A entries", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.qa.published();
    expect(Array.isArray(result)).toBe(true);
    for (const qa of result) {
      expect(qa).toHaveProperty("id");
      expect(qa).toHaveProperty("question");
      expect(qa).toHaveProperty("answer");
    }
  });
});

describe("qa.ask", () => {
  it("submits a new question successfully", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.qa.ask({
      questionerName: "Test Driver",
      question: "How often should I rotate my tires on a 2020 Honda Civic?",
    });
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });
});

// ─── PRICING ──────────────────────────────────────────

describe("pricing.allServices", () => {
  it("returns a list of all services with pricing", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.pricing.allServices();
    expect(Array.isArray(result)).toBe(true);
    // May be empty if no pricing data seeded, but should not throw
  });
});

describe("pricing.estimate", () => {
  it("returns a price estimate for a valid service", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.pricing.estimate({
      serviceType: "oil-change",
      vehicleCategory: "midsize",
    });
    expect(result).toBeDefined();
    // Result may be null if no pricing data, but should not throw
  });
});

// ─── REFERRALS ────────────────────────────────────────

describe("referrals.submit", () => {
  it("submits a referral successfully", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.referrals.submit({
      referrerName: "John Doe",
      referrerPhone: "216-555-1111",
      refereeName: "Jane Smith",
      refereePhone: "216-555-2222",
    });
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });
});

// ─── LOYALTY ──────────────────────────────────────────

describe("loyalty.rewards", () => {
  it("returns available rewards list", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.loyalty.rewards();
    expect(Array.isArray(result)).toBe(true);
    for (const reward of result) {
      expect(reward).toHaveProperty("id");
      expect(reward).toHaveProperty("title");
      expect(reward).toHaveProperty("pointsCost");
    }
  });
});

// ─── INSPECTION ───────────────────────────────────────

describe("inspection.byToken", () => {
  it("returns null for non-existent token", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.inspection.byToken({ token: "nonexistent-token-12345" });
    expect(result).toBeNull();
  });
});

// ─── PROTECTED ROUTE GUARDS ──────────────────────────

describe("protected route access control", () => {
  it("garage.vehicles rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.garage.vehicles()).rejects.toThrow();
  });

  it("garage.vehicles allows authenticated users", async () => {
    const caller = appRouter.createCaller(createAuthContext("user"));
    const result = await caller.garage.vehicles();
    expect(Array.isArray(result)).toBe(true);
  });

  it("loyalty.summary rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.loyalty.summary()).rejects.toThrow();
  });

  it("loyalty.summary allows authenticated users", async () => {
    const caller = appRouter.createCaller(createAuthContext("user"));
    const result = await caller.loyalty.summary();
    expect(result).toBeDefined();
    // Returns object with loyaltyPoints field (or null if user not found)
    if (result !== null) {
      expect(result).toHaveProperty("loyaltyPoints");
    }
  });

  it("adminDashboard.stats rejects non-admin users", async () => {
    const caller = appRouter.createCaller(createAuthContext("user"));
    await expect(caller.adminDashboard.stats()).rejects.toThrow();
  });
});
