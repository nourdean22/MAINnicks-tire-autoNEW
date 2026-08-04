/**
 * Tests for tRPC router procedures.
 *
 * These call REAL procedures against a REAL database, and some of them MUTATE
 * (referrals.submit, bookings, leads). They are gated on TEST_DATABASE_URL —
 * never on DATABASE_URL.
 *
 * WHY: the gate used to be `!!process.env.DATABASE_URL`, and
 * `apps/nickstire/.env` holds the PRODUCTION connection string. Any
 * `pnpm test` run from the main checkout therefore un-skipped these blocks and
 * wrote to prod. It did: 5 of the 6 rows in the production `referrals` table
 * (ids 30001-30005, all "John Doe", 2026-06-11) were written by this file, not
 * by customers — a 6x overstatement of a real acquisition channel.
 *
 * The old gate had exactly two modes: silent no-op in CI (which never sets
 * DATABASE_URL, so all 13 blocks skipped and asserted nothing), or a production
 * write locally. Neither is a test.
 *
 * To run these: start the local DB with `pnpm dev:db` and set TEST_DATABASE_URL
 * to it. The assertion below is a second, independent guard — even if someone
 * points TEST_DATABASE_URL at prod, the suite refuses rather than writing.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * TWO conditions, and the second is the one that actually protects production.
 *
 * `TEST_DATABASE_URL` is the explicit opt-in — a variable production has no
 * reason to set. But these procedures connect through `getDb()`, which reads
 * `DATABASE_URL` (server/db.ts:46) and NOT `TEST_DATABASE_URL`. Gating only on
 * the opt-in would therefore be worse than the original bug: setting it would
 * un-skip the writes while they still landed on whatever `DATABASE_URL` points
 * at — production.
 *
 * So the binding safety property is: the URL these tests will actually write
 * through must resolve to a local host.
 */
function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

const OPTED_IN = !!process.env.TEST_DATABASE_URL;
const WRITES_LOCALLY = isLocalDatabase(process.env.DATABASE_URL);

// Loud, not silent: someone who opted in and is still pointed at a remote host
// has made a mistake that would cost real rows. Tell them instead of skipping.
if (OPTED_IN && !WRITES_LOCALLY) {
  throw new Error(
    "TEST_DATABASE_URL is set, but DATABASE_URL does not point at a local host — " +
    "and these tests write through DATABASE_URL. Refusing to run. " +
    "Start the local DB with `pnpm dev:db` and point DATABASE_URL at it.",
  );
}

const HAS_DB = OPTED_IN && WRITES_LOCALLY;

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

describe.skipIf(!HAS_DB)("callback.submit", () => {
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

describe.skipIf(!HAS_DB)("booking.statusByPhone", () => {
  it("returns empty array for non-existent phone number", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.booking.statusByPhone({ phone: "000-000-0000" });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

describe.skipIf(!HAS_DB)("booking.statusByRef", () => {
  it("returns empty array for non-existent reference number", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.booking.statusByRef({ ref: "NONEXISTENT-REF-123" });
    // getBookingByRef returns an array, not null
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

// ─── COUPONS ──────────────────────────────────────────

describe.skipIf(!HAS_DB)("coupons.active", () => {
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

describe.skipIf(!HAS_DB)("qa.published", () => {
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

describe.skipIf(!HAS_DB)("qa.ask", () => {
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

describe.skipIf(!HAS_DB)("pricing.allServices", () => {
  it("returns a list of all services with pricing", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.pricing.allServices();
    expect(Array.isArray(result)).toBe(true);
    // May be empty if no pricing data seeded, but should not throw
  });
});

describe.skipIf(!HAS_DB)("pricing.estimate", () => {
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

describe.skipIf(!HAS_DB)("referrals.submit", () => {
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

describe.skipIf(!HAS_DB)("loyalty.rewards", () => {
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

describe.skipIf(!HAS_DB)("inspection.byToken", () => {
  it("returns null for non-existent token", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.inspection.byToken({ token: "nonexistent-token-12345" });
    expect(result).toBeNull();
  });
});

// ─── PROTECTED ROUTE GUARDS ──────────────────────────

describe.skipIf(!HAS_DB)("protected route access control", () => {
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

describe.skipIf(!HAS_DB)("reviewRequests", () => {
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

describe.skipIf(!HAS_DB)("scheduleReviewRequest", () => {
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

  it("schedules for valid input, or REJECTS if the write genuinely fails", async () => {
    const { scheduleReviewRequest } = await import("./routers/reviewRequests");
    // bookingId 99999 does not exist and review_requests.bookingId carries an FK
    // to bookings.id (drizzle/schema.ts:676), so createReviewRequest can reject
    // here. That used to be swallowed into { scheduled: false, reason } by the
    // catch; it now propagates, on purpose — it is exactly the failure
    // booking.ts:585 records as a `review_request` integration failure.
    //
    // NOT EXECUTED IN THIS CHANGE: the whole describe is skipIf(!HAS_DB), which
    // needs the operator's local-write opt-in, so this was updated by reading
    // the FK rather than by running it.
    let result: Awaited<ReturnType<typeof scheduleReviewRequest>> | null = null;
    let rejected: unknown = null;
    try {
      result = await scheduleReviewRequest(99999, "Test User", "2165551234", "Brake Repair");
    } catch (err) {
      rejected = err;
    }
    if (rejected) {
      expect(rejected).toBeInstanceOf(Error);
      return;
    }
    // Otherwise: scheduled, or skipped for a BUSINESS reason (disabled / invalid
    // phone / cooldown). Those are still returns, never throws.
    expect(result).toHaveProperty("scheduled");
    if (result && !result.scheduled) {
      expect(result).toHaveProperty("reason");
    }
  });
});
