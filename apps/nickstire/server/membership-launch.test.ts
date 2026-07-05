/**
 * Nonstop Nick membership — launch-readiness tests (2026-06-11).
 *
 * Covers the money-adjacent decision layer the same way the tire-order
 * wave covered its checkout (server/tire-order-checkout.test.ts):
 *   - lib/membership-guards: phone normalization, Stripe-status mapping,
 *     plan filter, counter-lookup ordering
 *   - services/payments: MEMBERSHIP_PLANS registry pins + the
 *     createMembershipCheckout contract (honest fallback when unconfigured,
 *     per-plan price selection, metadata, subscription mode — Stripe mocked)
 *   - routers/memberships.startCheckout via the real appRouter caller
 *     (validation + honest degrade paths, no DB needed)
 *   - read-only DB paths (lookupByPhone miss, bindVehicle NOT_FOUND) — only
 *     where DATABASE_URL is present; these never write membership rows.
 *
 * Webhook row idempotency (upsert by unique stripeSubscriptionId) is
 * structural — enforced by uq_membership_stripe_sub + update-first logic in
 * _core/index.ts — and is exercised in Stripe test mode per the manual plan
 * in the launch report, not by mutating a shared DB from this suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeMembershipPhone,
  mapSubscriptionEventToStatus,
  isKnownMembershipPlan,
  sortMembersActiveFirst,
} from "./lib/membership-guards";
import { MEMBERSHIP_PLANS } from "./services/payments";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const HAS_DB = !!process.env.DATABASE_URL;

// ─── Stripe mock (shared by the createMembershipCheckout describes) ──
const mocks = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
}));
vi.mock("stripe", () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mocks.sessionsCreate } };
  },
}));

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_NONSTOP_NICK_PRICE_ID",
  "STRIPE_NONSTOP_NICK_PLUS_PRICE_ID",
  "SITE_URL",
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  mocks.sessionsCreate.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ─── Phone normalization ─────────────────────────────────────
describe("normalizeMembershipPhone", () => {
  it("accepts a clean 10-digit phone", () => {
    expect(normalizeMembershipPhone("2165550123")).toBe("2165550123");
  });

  it("strips formatting", () => {
    expect(normalizeMembershipPhone("(216) 555-0123")).toBe("2165550123");
  });

  it("drops a leading country code (keeps the last 10 digits)", () => {
    expect(normalizeMembershipPhone("+1 216 555 0123")).toBe("2165550123");
  });

  it("rejects short numbers instead of storing junk lookup keys", () => {
    expect(normalizeMembershipPhone("555-0123")).toBeNull();
  });

  it("rejects empty/null/undefined", () => {
    expect(normalizeMembershipPhone("")).toBeNull();
    expect(normalizeMembershipPhone(null)).toBeNull();
    expect(normalizeMembershipPhone(undefined)).toBeNull();
  });

  it("rejects letters-only input", () => {
    expect(normalizeMembershipPhone("call me maybe")).toBeNull();
  });
});

// ─── Stripe subscription status mapping ──────────────────────
describe("mapSubscriptionEventToStatus", () => {
  it("deleted event always maps to canceled (even if snapshot says active)", () => {
    expect(mapSubscriptionEventToStatus("customer.subscription.deleted", "active")).toBe("canceled");
  });

  it("active and trialing map to active", () => {
    expect(mapSubscriptionEventToStatus("customer.subscription.updated", "active")).toBe("active");
    expect(mapSubscriptionEventToStatus("customer.subscription.created", "trialing")).toBe("active");
  });

  it("past_due and unpaid map to past_due (failed-payment grace)", () => {
    expect(mapSubscriptionEventToStatus("customer.subscription.updated", "past_due")).toBe("past_due");
    expect(mapSubscriptionEventToStatus("customer.subscription.updated", "unpaid")).toBe("past_due");
  });

  it("canceled status maps to canceled", () => {
    expect(mapSubscriptionEventToStatus("customer.subscription.updated", "canceled")).toBe("canceled");
  });

  it("incomplete states map to incomplete (member not yet in good standing)", () => {
    expect(mapSubscriptionEventToStatus("customer.subscription.created", "incomplete")).toBe("incomplete");
    expect(mapSubscriptionEventToStatus("customer.subscription.updated", "incomplete_expired")).toBe("incomplete");
    expect(mapSubscriptionEventToStatus("customer.subscription.updated", "paused")).toBe("incomplete");
  });
});

// ─── Plan filter ─────────────────────────────────────────────
describe("isKnownMembershipPlan", () => {
  it("accepts both Nonstop Nick tiers", () => {
    expect(isKnownMembershipPlan("nonstop-nick")).toBe(true);
    expect(isKnownMembershipPlan("nonstop-nick-plus")).toBe(true);
  });

  it("rejects unknown/empty plans so foreign subscriptions never create memberships", () => {
    expect(isKnownMembershipPlan("")).toBe(false);
    expect(isKnownMembershipPlan("tire-order")).toBe(false);
    expect(isKnownMembershipPlan("nonstop-nick-pro")).toBe(false);
  });
});

// ─── Counter lookup ordering ─────────────────────────────────
describe("sortMembersActiveFirst", () => {
  const rows = [
    { id: 1, status: "canceled", createdAt: new Date("2026-06-01") },
    { id: 2, status: "active", createdAt: new Date("2026-01-15") },
    { id: 3, status: "past_due", createdAt: new Date("2026-05-01") },
    { id: 4, status: "active", createdAt: new Date("2026-03-20") },
  ];

  it("puts active members first, newest first within each group", () => {
    expect(sortMembersActiveFirst(rows).map(r => r.id)).toEqual([4, 2, 1, 3]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    sortMembersActiveFirst(rows);
    expect(rows).toEqual(copy);
  });

  it("handles null createdAt without throwing", () => {
    const out = sortMembersActiveFirst([
      { id: 1, status: "active", createdAt: null },
      { id: 2, status: "active", createdAt: new Date("2026-06-01") },
    ]);
    expect(out.map(r => r.id)).toEqual([2, 1]);
  });
});

// ─── Plan registry pins ──────────────────────────────────────
describe("MEMBERSHIP_PLANS", () => {
  it("pins the env var name per tier (webhook + checkout + Railway must agree)", () => {
    expect(MEMBERSHIP_PLANS["nonstop-nick"].priceEnv).toBe("STRIPE_NONSTOP_NICK_PRICE_ID");
    expect(MEMBERSHIP_PLANS["nonstop-nick-plus"].priceEnv).toBe("STRIPE_NONSTOP_NICK_PLUS_PRICE_ID");
  });

  it("pins the customer-facing labels", () => {
    expect(MEMBERSHIP_PLANS["nonstop-nick"].label).toBe("Nonstop Nick");
    expect(MEMBERSHIP_PLANS["nonstop-nick-plus"].label).toBe("Nonstop Nick+");
  });
});

// ─── createMembershipCheckout contract ───────────────────────
describe("createMembershipCheckout", () => {
  const params = {
    phone: "2165550123",
    successUrl: "https://nickstire.org/nonstop-nick?joined=1",
    cancelUrl: "https://nickstire.org/nonstop-nick",
  };

  /** Fresh payments module so the cached Stripe instance can't leak between tests. */
  async function freshPayments() {
    vi.resetModules();
    return import("./services/payments");
  }

  it("falls back honestly when STRIPE_SECRET_KEY is missing — never fakes success", async () => {
    const { createMembershipCheckout } = await freshPayments();
    const res = await createMembershipCheckout(params);
    expect("error" in res && res.error).toMatch(/call or text \(216\) 862-0005/);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("falls back honestly when the plan's price env is missing", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const { createMembershipCheckout } = await freshPayments();
    const res = await createMembershipCheckout(params);
    expect("error" in res && res.error).toMatch(/call or text/);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("plus tier stays dormant independently of the base tier", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_NONSTOP_NICK_PRICE_ID = "price_base_123";
    const { createMembershipCheckout } = await freshPayments();
    const res = await createMembershipCheckout({ ...params, plan: "nonstop-nick-plus" });
    expect("error" in res && res.error).toMatch(/call or text/);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a subscription-mode session with the BASE price + full metadata", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_NONSTOP_NICK_PRICE_ID = "price_base_123";
    mocks.sessionsCreate.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const { createMembershipCheckout } = await freshPayments();

    const res = await createMembershipCheckout({ ...params, customerName: "Jane", customerEmail: "jane@example.com", source: "tires_page" });
    expect(res).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1", sessionId: "cs_test_1" });

    const arg = mocks.sessionsCreate.mock.calls[0][0];
    expect(arg.mode).toBe("subscription");
    expect(arg.line_items).toEqual([{ price: "price_base_123", quantity: 1 }]);
    expect(arg.metadata).toEqual({ plan: "nonstop-nick", phone: "2165550123", customerName: "Jane", source: "nickstire.org", signup_source: "tires_page" });
    // Metadata mirrored onto the subscription so webhook events can bind the row.
    expect(arg.subscription_data.metadata).toEqual(arg.metadata);
    expect(arg.customer_email).toBe("jane@example.com");
    expect(arg.client_reference_id).toBe("2165550123");
    expect(arg.success_url).toBe("https://nickstire.org/nonstop-nick?joined=1");
    expect(arg.cancel_url).toBe("https://nickstire.org/nonstop-nick");
  });

  it("selects the PLUS price for the plus plan", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_NONSTOP_NICK_PRICE_ID = "price_base_123";
    process.env.STRIPE_NONSTOP_NICK_PLUS_PRICE_ID = "price_plus_456";
    mocks.sessionsCreate.mockResolvedValue({ id: "cs_test_2", url: "https://checkout.stripe.com/c/pay/cs_test_2" });
    const { createMembershipCheckout } = await freshPayments();

    await createMembershipCheckout({ ...params, plan: "nonstop-nick-plus" });
    const arg = mocks.sessionsCreate.mock.calls[0][0];
    expect(arg.line_items).toEqual([{ price: "price_plus_456", quantity: 1 }]);
    expect(arg.metadata.plan).toBe("nonstop-nick-plus");
  });

  it("omitted source still yields the signup_source key (empty, never undefined)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_NONSTOP_NICK_PRICE_ID = "price_base_123";
    mocks.sessionsCreate.mockResolvedValue({ id: "cs_test_5", url: "https://checkout.stripe.com/c/pay/cs_test_5" });
    const { createMembershipCheckout } = await freshPayments();

    await createMembershipCheckout(params);
    const arg = mocks.sessionsCreate.mock.calls[0][0];
    // Stripe metadata values must be strings — an absent source degrades to "".
    expect(arg.metadata.signup_source).toBe("");
  });

  it("an unrecognized plan value falls back to the base tier (no client-driven price injection)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_NONSTOP_NICK_PRICE_ID = "price_base_123";
    mocks.sessionsCreate.mockResolvedValue({ id: "cs_test_3", url: "https://checkout.stripe.com/c/pay/cs_test_3" });
    const { createMembershipCheckout } = await freshPayments();

    await createMembershipCheckout({ ...params, plan: "totally-made-up" as never });
    const arg = mocks.sessionsCreate.mock.calls[0][0];
    expect(arg.line_items).toEqual([{ price: "price_base_123", quantity: 1 }]);
    expect(arg.metadata.plan).toBe("nonstop-nick");
  });

  it("returns a clean error when Stripe throws (never a fake URL)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_NONSTOP_NICK_PRICE_ID = "price_base_123";
    mocks.sessionsCreate.mockRejectedValue(new Error("rate limited"));
    const { createMembershipCheckout } = await freshPayments();

    const res = await createMembershipCheckout(params);
    expect("error" in res && res.error).toMatch(/Membership signup failed/);
  });

  it("returns an error when Stripe yields a session without a URL", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_NONSTOP_NICK_PRICE_ID = "price_base_123";
    mocks.sessionsCreate.mockResolvedValue({ id: "cs_test_4", url: null });
    const { createMembershipCheckout } = await freshPayments();

    const res = await createMembershipCheckout(params);
    expect("error" in res && res.error).toMatch(/no checkout URL/);
  });
});

// ─── startCheckout through the real router ───────────────────
function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-admin",
      email: "admin@example.com",
      name: "Test Admin",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("memberships.startCheckout (router)", () => {
  it("rejects an invalid phone with a clean, human error", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const res = await caller.memberships.startCheckout({ phone: "555-0123" });
    expect(res.url).toBeNull();
    expect(res.error).toBe("Please enter a valid 10-digit phone number.");
  });

  it("degrades honestly when Stripe is not configured (no fake checkout URL)", async () => {
    // beforeEach cleared the Stripe env — this is the dormant-plan state.
    // `source` here also pins the input schema accepting the attribution field.
    const caller = appRouter.createCaller(createPublicContext());
    const res = await caller.memberships.startCheckout({ phone: "(216) 555-0123", source: "booking_page" });
    expect(res.url).toBeNull();
    expect(res.error).toMatch(/call or text \(216\) 862-0005/);
  });

  it("rejects an over-long source (metadata stays short and reportable)", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(
      caller.memberships.startCheckout({ phone: "(216) 555-0123", source: "x".repeat(41) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── Read-only DB paths (skipped without DATABASE_URL) ───────
// These never insert/update membership rows: lookup misses and bindVehicle
// throws NOT_FOUND before any write.
describe.skipIf(!HAS_DB)("memberships admin surface (read-only, DB required)", () => {
  it("lookupByPhone returns found:false for a number that can't exist", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const res = await caller.memberships.lookupByPhone({ phone: "0000000000" });
    expect(res.found).toBe(false);
  });

  it("bindVehicle on a non-existent membership throws NOT_FOUND (honest failure)", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(
      caller.memberships.bindVehicle({ membershipId: 2147483647, vehiclePlate: "abc123" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
