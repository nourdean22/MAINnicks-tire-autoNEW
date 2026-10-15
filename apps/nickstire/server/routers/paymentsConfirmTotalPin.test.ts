/**
 * confirmPayment marks an invoice paid only at the total its amount check used.
 *
 * The total is read, then Stripe is asked whether the payment succeeded (an await), then the claim is
 * written. A total change inside that window (a ShopDriver sync, or an edit that bypasses the lock) must
 * not be marked paid at the new total. The claim pins the total that was read.
 *
 * The database is faked. The fake renders the claim's SQL with drizzle and matches it the way the
 * database would: a paid row never matches, and a pinned total matches only its current value.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { paymentsRouter } from "./payments";

const mocks = vi.hoisted(() => ({
  totalAmount: 10000,
  paymentStatus: "pending" as string,
  beforeStripeAnswer: null as null | (() => void),
  markPaymentPaid: vi.fn(async (_d: unknown, _paymentIntentId: string) => undefined),
}));

vi.mock("../lib/db-helper", () => ({
  db: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 7, totalAmount: mocks.totalAmount, paymentStatus: mocks.paymentStatus }],
        }),
      }),
    }),
    execute: async (query: unknown) => {
      const { sql: text, params } = new MySqlDialect().sqlToQuery(
        query as Parameters<MySqlDialect["sqlToQuery"]>[0],
      );
      const pinsTotal = /totalAmount\s*=\s*\?/.test(text);
      const pinned = pinsTotal ? params.find((p) => typeof p === "number") : undefined;
      const matches = mocks.paymentStatus !== "paid" && (!pinsTotal || pinned === mocks.totalAmount);
      if (matches) mocks.paymentStatus = "paid";
      return [{ affectedRows: matches ? 1 : 0 }];
    },
  }),
}));

vi.mock("../services/payments", () => ({
  getPaymentStatus: async () => {
    mocks.beforeStripeAnswer?.();
    return { status: "succeeded", amountReceived: 10000, invoiceNumber: "INV-20261014-001" };
  },
}));

vi.mock("../services/paymentIntentLock", () => ({
  markPaymentPaid: mocks.markPaymentPaid,
}));

vi.mock("../services/eventBus", () => ({
  emit: { invoicePaid: () => undefined },
}));

const confirm = () =>
  paymentsRouter.createCaller({} as never).confirmPayment({
    invoiceNumber: "INV-20261014-001",
    phone: "2165550101",
    paymentIntentId: "pi_test_pin",
    paymentMethod: "card",
  });

beforeEach(() => {
  mocks.totalAmount = 10000;
  mocks.paymentStatus = "pending";
  mocks.beforeStripeAnswer = null;
  mocks.markPaymentPaid.mockClear();
});

describe("payments.confirmPayment pins the invoice total it checked", () => {
  it("marks the invoice paid when the total is unchanged", async () => {
    expect(await confirm()).toEqual({ success: true });
    expect(mocks.paymentStatus).toBe("paid");
    expect(mocks.markPaymentPaid).toHaveBeenCalledWith(expect.anything(), "pi_test_pin");
  });

  it("refuses to mark paid at a total that moved while Stripe was being asked", async () => {
    mocks.beforeStripeAnswer = () => {
      mocks.totalAmount = 12000;
    };
    const out = await confirm();
    expect(out.success).toBe(false);
    expect(mocks.paymentStatus).toBe("pending");
    expect(mocks.markPaymentPaid).not.toHaveBeenCalled();
  });

  it("still succeeds when the webhook marked the invoice paid during the same window", async () => {
    mocks.beforeStripeAnswer = () => {
      mocks.paymentStatus = "paid";
    };
    expect(await confirm()).toEqual({ success: true });
    expect(mocks.markPaymentPaid).toHaveBeenCalledWith(expect.anything(), "pi_test_pin");
  });
});
