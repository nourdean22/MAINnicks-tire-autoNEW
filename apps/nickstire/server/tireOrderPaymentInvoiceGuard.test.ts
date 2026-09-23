/**
 * A tire-order payment never marks another customer's invoice paid (2026-09-23).
 *
 * finalizeTireOrderPayment found the invoice to mark paid by NUMBER alone and
 * overwrote its totalAmount with what Stripe collected. Invoice numbers come
 * from MAX()+1 with no lock, so a stale number (a checkout opened before #2592,
 * or any future regression in placeOrder) names someone else's invoice: that
 * row was marked paid with this customer's amount, and this customer's own
 * invoice stayed unpaid.
 *
 * The fix reads the invoice first and updates it (by id) only when placeOrder
 * created it for this order: its description carries "Order: <orderNumber>" or
 * its phone matches the order's. These tests drive the real function against a
 * fake DB and assert which rows it writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoiceBelongsToTireOrder } from "./lib/tire-order-guards";

const h = vi.hoisted(() => ({
  order: null as Record<string, unknown> | null,
  invoice: null as Record<string, unknown> | null,
  invoiceUpdates: [] as Array<Record<string, unknown>>,
  notified: [] as Array<Record<string, unknown>>,
}));

vi.mock("./db", () => ({
  getDb: async () => ({
    // select() → the tire order; select({ ... }) → the invoice lookup.
    select: (fields?: unknown) => ({
      from: () => ({
        where: () => ({ limit: async () => (fields ? (h.invoice ? [h.invoice] : []) : h.order ? [h.order] : []) }),
      }),
    }),
    execute: async () => [{ affectedRows: 1 }],
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { h.invoiceUpdates.push({ ...values }); return [{ affectedRows: 1 }]; },
      }),
    }),
    insert: () => ({ values: async () => [{ insertId: 1 }] }),
  }),
}));
vi.mock("./services/customerMessageTemplates", () => ({ sendCustomerMessage: async () => undefined }));
vi.mock("./email-notify", () => ({
  notifyTireOrderPaid: async (args: Record<string, unknown>) => { h.notified.push(args); return { emailSent: true }; },
}));
vi.mock("./services/telegram", () => ({ sendTelegram: async () => undefined }));

const ORDER = {
  orderNumber: "TO-20260923-417",
  customerName: "Pat Buyer",
  customerPhone: "(216) 555-0101",
  paymentStatus: "pending",
  invoiceNumber: "INV-20260923-004",
  quantity: 4,
  tireBrand: "KENDA",
  tireModel: "KR217",
  tireSize: "205/55R16",
};

async function pay(invoiceNumber = "INV-20260923-004") {
  const { finalizeTireOrderPayment } = await import("./services/payments");
  await finalizeTireOrderPayment({ tireOrderNumber: ORDER.orderNumber, invoiceNumber, amountCents: 51234 });
}

beforeEach(() => {
  h.order = { ...ORDER };
  h.invoice = null;
  h.invoiceUpdates = [];
  h.notified = [];
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("finalizeTireOrderPayment invoice guard", () => {
  it("leaves another customer's invoice untouched when the number is stale", async () => {
    h.invoice = {
      id: 7,
      customerPhone: "(440) 555-0199",
      serviceDescription: "Tire Order & Install — 2x MICHELIN X (225/60R17)\nOrder: TO-20260923-388",
    };
    await pay();
    expect(h.invoiceUpdates).toEqual([]);
    // The shop hand-off still fires (the order IS paid) but never names the wrong invoice.
    expect(h.notified).toHaveLength(1);
    expect(h.notified[0].invoiceNumber).toBeUndefined();
  });

  it("writes nothing when the linked invoice number does not exist", async () => {
    h.invoice = null;
    await pay();
    expect(h.invoiceUpdates).toEqual([]);
    expect(h.notified[0].invoiceNumber).toBeUndefined();
  });

  it("marks its own invoice paid at the amount Stripe collected", async () => {
    h.invoice = {
      id: 9,
      customerPhone: ORDER.customerPhone,
      serviceDescription: `Tire Order & Install — 4x KENDA KR217 (205/55R16)\nOrder: ${ORDER.orderNumber}`,
    };
    await pay();
    expect(h.invoiceUpdates).toEqual([{ paymentStatus: "paid", paymentMethod: "card", totalAmount: 51234 }]);
    expect(h.notified[0].invoiceNumber).toBe("INV-20260923-004");
  });

  it("still pays its own invoice after an admin rewrote the description (phone matches)", async () => {
    h.invoice = { id: 9, customerPhone: "216-555-0101", serviceDescription: "4 tires mounted" };
    await pay();
    expect(h.invoiceUpdates).toHaveLength(1);
  });
});

describe("invoiceBelongsToTireOrder", () => {
  const order = { orderNumber: "TO-20260923-417", customerPhone: "+1 (216) 555-0101" };

  it("matches on the order reference placeOrder writes", () => {
    expect(invoiceBelongsToTireOrder({ customerPhone: null, serviceDescription: "x\nOrder: TO-20260923-417" }, order)).toBe(true);
  });
  it("matches on the phone, ignoring formatting and a leading country code", () => {
    expect(invoiceBelongsToTireOrder({ customerPhone: "2165550101", serviceDescription: null }, order)).toBe(true);
  });
  it("rejects a different order reference with a different phone", () => {
    expect(invoiceBelongsToTireOrder({ customerPhone: "4405550199", serviceDescription: "Order: TO-20260923-388" }, order)).toBe(false);
  });
  it("never matches two empty or short phones to each other", () => {
    expect(invoiceBelongsToTireOrder({ customerPhone: "", serviceDescription: null }, { orderNumber: "TO-1", customerPhone: "" })).toBe(false);
    expect(invoiceBelongsToTireOrder({ customerPhone: "555", serviceDescription: null }, { orderNumber: "TO-1", customerPhone: "555" })).toBe(false);
  });
});
