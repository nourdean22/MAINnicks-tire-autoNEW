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

// ─── REVIEW REQUESTS ──────────────────────────────────

describe("reviewRequests", () => {
  // Admin-only: list
  describe("reviewRequests.list", () => {
    it("rejects unauthenticated users", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(caller.reviewRequests.list()).rejects.toThrow();
    });

    it("rejects non-admin users", async () => {
      const caller = appRouter.createCaller(createAuthContext("user"));
      await expect(caller.reviewRequests.list()).rejects.toThrow();
    });

    it("returns list for admin users", async () => {
      const caller = appRouter.createCaller(createAuthContext("admin"));
      const result = await caller.reviewRequests.list({ limit: 10 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // Admin-only: stats
  describe("reviewRequests.stats", () => {
    it("rejects unauthenticated users", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(caller.reviewRequests.stats()).rejects.toThrow();
    });

    it("returns stats object for admin", async () => {
      const caller = appRouter.createCaller(createAuthContext("admin"));
      const result = await caller.reviewRequests.stats();
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("sent");
      expect(result).toHaveProperty("clicked");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("pending");
      expect(result).toHaveProperty("clickRate");
      expect(typeof result.total).toBe("number");
      expect(typeof result.clickRate).toBe("number");
    });
  });

  // Admin-only: getSettings
  describe("reviewRequests.getSettings", () => {
    it("rejects non-admin users", async () => {
      const caller = appRouter.createCaller(createAuthContext("user"));
      await expect(caller.reviewRequests.getSettings()).rejects.toThrow();
    });

    it("returns settings with defaults for admin", async () => {
      const caller = appRouter.createCaller(createAuthContext("admin"));
      const result = await caller.reviewRequests.getSettings();
      expect(result).toHaveProperty("enabled");
      expect(result).toHaveProperty("delayMinutes");
      expect(result).toHaveProperty("maxPerDay");
      expect(result).toHaveProperty("cooldownDays");
    });
  });

  // Admin-only: updateSettings
  describe("reviewRequests.updateSettings", () => {
    it("rejects unauthenticated users", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(caller.reviewRequests.updateSettings({ enabled: 0 })).rejects.toThrow();
    });

    it("updates settings for admin", async () => {
      const caller = appRouter.createCaller(createAuthContext("admin"));
      const result = await caller.reviewRequests.updateSettings({ delayMinutes: 60, maxPerDay: 10 });
      expect(result).toHaveProperty("success", true);
    });

    it("validates input constraints", async () => {
      const caller = appRouter.createCaller(createAuthContext("admin"));
      // maxPerDay must be >= 1
      await expect(caller.reviewRequests.updateSettings({ maxPerDay: 0 })).rejects.toThrow();
      // cooldownDays must be >= 1
      await expect(caller.reviewRequests.updateSettings({ cooldownDays: 0 })).rejects.toThrow();
    });
  });

  // Admin-only: processQueue
  describe("reviewRequests.processQueue", () => {
    it("rejects non-admin users", async () => {
      const caller = appRouter.createCaller(createAuthContext("user"));
      await expect(caller.reviewRequests.processQueue()).rejects.toThrow();
    });

    it("processes queue for admin", async () => {
      const caller = appRouter.createCaller(createAuthContext("admin"));
      const result = await caller.reviewRequests.processQueue();
      expect(result).toHaveProperty("processed");
      expect(result).toHaveProperty("sent");
      expect(result).toHaveProperty("failed");
    });
  });

  // Admin-only: backfillPreview
  describe("reviewRequests.backfillPreview", () => {
    it("rejects unauthenticated users", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(caller.reviewRequests.backfillPreview()).rejects.toThrow();
    });

    it("returns preview for admin", async () => {
      const caller = appRouter.createCaller(createAuthContext("admin"));
      const result = await caller.reviewRequests.backfillPreview();
      expect(result).toHaveProperty("count");
      expect(result).toHaveProperty("bookings");
      expect(typeof result.count).toBe("number");
      expect(Array.isArray(result.bookings)).toBe(true);
    });
  });

  // Admin-only: backfillExecute
  describe("reviewRequests.backfillExecute", () => {
    it("rejects non-admin users", async () => {
      const caller = appRouter.createCaller(createAuthContext("user"));
      await expect(caller.reviewRequests.backfillExecute()).rejects.toThrow();
    });

    it("executes backfill for admin", async () => {
      const caller = appRouter.createCaller(createAuthContext("admin"));
      const result = await caller.reviewRequests.backfillExecute();
      expect(result).toHaveProperty("scheduled");
      expect(result).toHaveProperty("skipped");
      expect(result).toHaveProperty("total");
    });
  });

  // Public: trackClick
  describe("reviewRequests.trackClick", () => {
    it("handles invalid token gracefully", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.reviewRequests.trackClick({ token: "nonexistent-token" });
      expect(result).toHaveProperty("redirectUrl");
      expect(result.redirectUrl).toContain("google.com/local/writereview");
    });

    it("validates token length", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const longToken = "a".repeat(65);
      await expect(caller.reviewRequests.trackClick({ token: longToken })).rejects.toThrow();
    });
  });

  // Admin-only: resend
  describe("reviewRequests.resend", () => {
    it("rejects non-admin users", async () => {
      const caller = appRouter.createCaller(createAuthContext("user"));
      await expect(caller.reviewRequests.resend({ id: 1 })).rejects.toThrow();
    });

    it("throws for non-existent request", async () => {
      const caller = appRouter.createCaller(createAuthContext("admin"));
      await expect(caller.reviewRequests.resend({ id: 999999 })).rejects.toThrow();
    });
  });
});

// ─── SCHEDULE REVIEW REQUEST (unit function) ──────────

describe("scheduleReviewRequest", () => {
  it("is exported and callable", async () => {
    const { scheduleReviewRequest } = await import("./routers/reviewRequests");
    expect(typeof scheduleReviewRequest).toBe("function");
  });

  it("rejects invalid phone numbers", async () => {
    const { scheduleReviewRequest } = await import("./routers/reviewRequests");
    const result = await scheduleReviewRequest(1, "Test User", "123", "Oil Change");
    expect(result.scheduled).toBe(false);
    expect(result.reason).toContain("Invalid phone");
  });

  it("schedules for valid input", async () => {
    const { scheduleReviewRequest } = await import("./routers/reviewRequests");
    const result = await scheduleReviewRequest(99999, "Test User", "2165551234", "Brake Repair");
    // Should either schedule or skip due to cooldown — both are valid
    expect(result).toHaveProperty("scheduled");
    if (!result.scheduled) {
      expect(result).toHaveProperty("reason");
    }
  });
});
