/**
 * Tests for the tire-order money path (2026-06-10 checkout-hardening wave).
 *
 * Covers the pure guard layer extracted to lib/tire-order-guards (price
 * tamper rejection, the $50 floor, idempotency keys, order-number
 * format, collision detection, cancellation alerts), the rebuilt
 * "Tire Orders" sheet row, and the admin next-action algorithm.
 *
 * Context: the placeOrder price guard shipped after the pay-a-penny
 * audit finding (#151) and sat UNTESTED while live Stripe payments ran
 * against it. These tests pin the rules so a refactor can't silently
 * reopen the exploit.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateOrderPrice,
  getIdempotencyKey,
  generateOrderNumber,
  isDuplicateKeyError,
  buildCancellationAlert,
  ABSOLUTE_MIN_TIRE_PRICE_CENTS,
} from "./lib/tire-order-guards";
import { tireOrderRow } from "./sheets-sync";
import { nextActionForOrder } from "@shared/tireOrderNextAction";

// ─── Price guard ─────────────────────────────────────────────
describe("evaluateOrderPrice", () => {
  it("accepts the exact expected price", () => {
    expect(evaluateOrderPrice(20000, 20000)).toEqual({ ok: true, basis: "expected" });
  });

  it("accepts a legit sale price within 5% below expected", () => {
    // floor(20000 * 0.95) = 19000 — exactly at the boundary is accepted
    expect(evaluateOrderPrice(19000, 20000)).toEqual({ ok: true, basis: "expected" });
  });

  it("rejects a tampered price more than 5% below expected", () => {
    expect(evaluateOrderPrice(18999, 20000)).toEqual({ ok: false, reason: "below-expected" });
  });

  it("rejects the pay-a-penny exploit when expected is known", () => {
    expect(evaluateOrderPrice(100, 20000)).toEqual({ ok: false, reason: "below-expected" });
  });

  it("rejects a zero price when expected is known", () => {
    expect(evaluateOrderPrice(0, 20000)).toEqual({ ok: false, reason: "below-expected" });
  });

  it("accepts a price above expected (no upper bound by design)", () => {
    expect(evaluateOrderPrice(30000, 20000)).toEqual({ ok: true, basis: "expected" });
  });

  it("falls back to the $50 absolute floor when no expected price could be derived", () => {
    expect(evaluateOrderPrice(ABSOLUTE_MIN_TIRE_PRICE_CENTS, null)).toEqual({ ok: true, basis: "floor" });
    expect(evaluateOrderPrice(ABSOLUTE_MIN_TIRE_PRICE_CENTS - 1, null)).toEqual({ ok: false, reason: "below-floor" });
  });

  it("rejects a zero price on the floor path", () => {
    expect(evaluateOrderPrice(0, null)).toEqual({ ok: false, reason: "below-floor" });
  });
});

// ─── Idempotency + order numbers ─────────────────────────────
describe("getIdempotencyKey", () => {
  const base = { customerPhone: "2165551234", tireBrand: "NEXEN", tireModel: "N'Priz AH5", tireSize: "215/60R16", quantity: 4 };

  it("is stable for the same submission", () => {
    expect(getIdempotencyKey(base)).toBe(getIdempotencyKey({ ...base }));
  });

  it("differs when any component differs", () => {
    expect(getIdempotencyKey({ ...base, quantity: 2 })).not.toBe(getIdempotencyKey(base));
    expect(getIdempotencyKey({ ...base, customerPhone: "2165550000" })).not.toBe(getIdempotencyKey(base));
    expect(getIdempotencyKey({ ...base, tireSize: "225/60R16" })).not.toBe(getIdempotencyKey(base));
  });
});

describe("generateOrderNumber", () => {
  it("matches TO-YYYYMMDD-NNN for an injected date", () => {
    const n = generateOrderNumber(new Date("2026-06-10T15:00:00Z"));
    expect(n).toMatch(/^TO-20260610-[1-9]\d{2}$/);
  });

  it("suffix stays in the 100-999 range", () => {
    for (let i = 0; i < 50; i++) {
      const suffix = Number(generateOrderNumber().split("-")[2]);
      expect(suffix).toBeGreaterThanOrEqual(100);
      expect(suffix).toBeLessThanOrEqual(999);
    }
  });
});

describe("isDuplicateKeyError", () => {
  it("detects the MySQL duplicate-entry error", () => {
    expect(isDuplicateKeyError(new Error("Duplicate entry 'TO-20260610-123' for key 'tire_orders.tire_orders_orderNumber_unique'"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isDuplicateKeyError(new Error("Connection lost"))).toBe(false);
    expect(isDuplicateKeyError("random string")).toBe(false);
  });
});

// ─── Cancellation alert ──────────────────────────────────────
describe("buildCancellationAlert", () => {
  const order = {
    orderNumber: "TO-20260610-123",
    customerName: "Jane Doe",
    customerPhone: "2165551234",
    quantity: 4,
    tireBrand: "NEXEN",
    tireModel: "N'Priz AH5",
    tireSize: "215/60R16",
    totalAmount: 54400, // cents
    paymentStatus: "unpaid",
  };

  it("plain cancellation for an unpaid order", () => {
    const text = buildCancellationAlert(order, "customer changed mind");
    expect(text).toContain("ORDER CANCELLED — TO-20260610-123");
    expect(text).toContain("Reason: customer changed mind");
    expect(text).not.toContain("REFUND");
  });

  it("screams REFUND REQUIRED when the customer paid online", () => {
    const text = buildCancellationAlert({ ...order, paymentStatus: "paid" });
    expect(text).toContain("CUSTOMER PAID $544.00 ONLINE — REFUND REQUIRED");
    expect(text).toContain("Stripe Dashboard");
    expect(text).toContain("TO-20260610-123");
  });
});

// ─── Sheets row ──────────────────────────────────────────────
describe("tireOrderRow", () => {
  const order = {
    orderNumber: "TO-20260610-123",
    customerName: "Jane Doe",
    customerPhone: "2165551234",
    customerEmail: "jane@example.com",
    vehicleInfo: "2019 Honda CR-V",
    tireBrand: "NEXEN",
    tireModel: "N'Priz AH5",
    tireSize: "215/60R16",
    quantity: 4,
    pricePerTire: 136.0,
    totalAmount: 544.0,
    customerNotes: "morning drop-off",
    status: "received",
    paymentStatus: "unpaid",
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "tires-june",
    landingPage: "https://nickstire.org/tires?utm_source=google",
    referrer: "https://www.google.com/",
  };

  it("keeps the original 18-column A-R layout, then payment status + 5-cell attribution tail", () => {
    const row = tireOrderRow(order, "06/10/2026, 11:00 AM");
    expect(row).toHaveLength(24); // 18 original + paymentStatus + 5 attribution
    expect(row.slice(0, 18)).toEqual([
      "TO-20260610-123",
      "06/10/2026, 11:00 AM",
      "Received",
      "Jane Doe",
      "2165551234",
      "jane@example.com",
      "2019 Honda CR-V",
      "NEXEN",
      "N'Priz AH5",
      "215/60R16",
      "4",
      "$136.00",
      "$0.00 (Included)",
      "$544.00",
      "morning drop-off",
      "", // Gateway Ref — staff fills
      "", // Expected Delivery
      "", // Installation Date
    ]);
    expect(row[18]).toBe("unpaid");
    // attribution tail: source, medium, campaign, pathname-normalized landing page, referrer
    expect(row[19]).toBe("google");
    expect(row[20]).toBe("cpc");
    expect(row[21]).toBe("tires-june");
    expect(row[22]).toBe("/tires");
    expect(row[23]).toBe("https://www.google.com/");
  });

  it("writes honest blanks when attribution and optional fields are missing", () => {
    const row = tireOrderRow({
      ...order,
      customerEmail: null,
      vehicleInfo: null,
      customerNotes: null,
      paymentStatus: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      landingPage: null,
      referrer: null,
    }, "06/10/2026, 11:00 AM");
    expect(row).toHaveLength(24);
    expect(row[5]).toBe("");
    expect(row[18]).toBe("unpaid"); // defaults rather than fabricates a paid state
    expect(row.slice(19)).toEqual(["", "", "", "", ""]);
  });
});

// ─── Admin next action ───────────────────────────────────────
describe("nextActionForOrder", () => {
  it("paid + received outranks everything fulfillment-wise", () => {
    const a = nextActionForOrder({ status: "received", paymentStatus: "paid" });
    expect(a.priority).toBe(1);
    expect(a.tone).toBe("crit");
    expect(a.label).toContain("PAID");
  });

  it("unpaid received asks staff to contact the customer", () => {
    const a = nextActionForOrder({ status: "received", paymentStatus: "unpaid" });
    expect(a.priority).toBe(2);
    expect(a.label).toContain("call customer");
  });

  it("cancelled-but-paid demands a refund at top priority", () => {
    const a = nextActionForOrder({ status: "cancelled", paymentStatus: "paid" });
    expect(a.priority).toBe(1);
    expect(a.label).toContain("refund");
  });

  it("plain cancelled sinks to the bottom", () => {
    expect(nextActionForOrder({ status: "cancelled", paymentStatus: "unpaid" }).priority).toBe(8);
  });

  it("delivered prompts scheduling the install", () => {
    const a = nextActionForOrder({ status: "delivered", paymentStatus: "paid" });
    expect(a.label).toContain("schedule install");
  });

  it("installed + unpaid reminds staff to collect", () => {
    const a = nextActionForOrder({ status: "installed", paymentStatus: "unpaid" });
    expect(a.label).toContain("collect balance");
  });

  it("installed + paid is done", () => {
    expect(nextActionForOrder({ status: "installed", paymentStatus: "paid" }).tone).toBe("ok");
  });

  it("ordered without an ETA nudges staff to set one", () => {
    expect(nextActionForOrder({ status: "ordered", paymentStatus: "paid", expectedDelivery: null }).label).toContain("set ETA");
    expect(nextActionForOrder({ status: "ordered", paymentStatus: "paid", expectedDelivery: "2026-06-12" }).label).toBe("Awaiting delivery");
  });

  it("unknown status falls back to a review prompt", () => {
    expect(nextActionForOrder({ status: "weird", paymentStatus: null }).priority).toBe(9);
  });
});
