import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  cancel: vi.fn(),
  openRows: [] as Array<{ id: number; paymentIntentId: string | null; createdAt: Date }>,
  inserts: [] as unknown[],
  updates: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
}));

vi.mock("./payments", () => ({ cancelPaymentIntent: (...a: unknown[]) => h.cancel(...a) }));

import { lockedTotalPatch, markPaymentPaid, recordPaymentIntent, releaseInvoiceTotal, STALE_INTENT_MS } from "./paymentIntentLock";

// A fake database: select returns the open rows, insert and update record what they were given.
const d = {
  select: () => ({ from: () => ({ where: async () => h.openRows }) }),
  insert: () => ({ values: async (v: unknown) => { h.inserts.push(v); return [{ insertId: 1 }]; } }),
  update: () => ({
    set: (s: Record<string, unknown>) => ({
      where: async (w: unknown) => { h.updates.push({ set: s, where: w }); return [{ affectedRows: 1 }]; },
    }),
  }),
};

const FRESH = new Date();
const TWO_DAYS_AGO = new Date(Date.now() - 2 * STALE_INTENT_MS);

beforeEach(() => {
  h.cancel.mockReset();
  h.openRows = [];
  h.inserts = [];
  h.updates = [];
});

describe("recordPaymentIntent", () => {
  it("records the intent as pending, with the amount it was created for", async () => {
    await recordPaymentIntent(d as never, {
      invoiceId: 7,
      amountCents: 12345,
      customerName: "Pat",
      customerPhone: "2165550100",
      description: "A".repeat(600),
      paymentIntentId: "pi_1",
    });
    expect(h.inserts).toEqual([{
      invoiceId: 7,
      amount: 12345,
      customerName: "Pat",
      customerPhone: "2165550100",
      description: "A".repeat(500),
      stripePaymentIntentId: "pi_1",
      status: "pending",
    }]);
  });
});

describe("releaseInvoiceTotal", () => {
  it("releases at once when no card payment is open", async () => {
    expect(await releaseInvoiceTotal(d as never, 7)).toEqual({ released: true, canceled: 0 });
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("cancels an open intent in Stripe, marks it canceled, and releases when Stripe confirms", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_open", createdAt: FRESH }];
    h.cancel.mockResolvedValue("canceled");
    expect(await releaseInvoiceTotal(d as never, 7)).toEqual({ released: true, canceled: 1 });
    expect(h.cancel).toHaveBeenCalledWith("pi_open");
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]!.set).toEqual({ status: "canceled" });
  });

  it("holds the total when Stripe says the payment just succeeded, and does not mark it canceled", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_done", createdAt: FRESH }];
    h.cancel.mockResolvedValue("succeeded");
    const result = await releaseInvoiceTotal(d as never, 7);
    expect(result.released).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("just succeeded") });
    expect(h.updates).toHaveLength(0);
  });

  it("holds the total while Stripe is still processing the payment", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_proc", createdAt: FRESH }];
    h.cancel.mockResolvedValue("processing");
    expect((await releaseInvoiceTotal(d as never, 7)).released).toBe(false);
  });

  it("holds the total when Stripe cannot confirm the cancel", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_err", createdAt: FRESH }];
    h.cancel.mockResolvedValue("failed");
    const result = await releaseInvoiceTotal(d as never, 7);
    expect(result).toMatchObject({ released: false, reason: expect.stringContaining("could not confirm") });
    expect(h.updates).toHaveLength(0);
  });

  it("holds a fresh intent for the mirror, without touching Stripe", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_fresh", createdAt: FRESH }];
    const result = await releaseInvoiceTotal(d as never, 7, { staleAfterMs: STALE_INTENT_MS });
    expect(result.released).toBe(false);
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("cancels a stale intent for the mirror and releases", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_stale", createdAt: TWO_DAYS_AGO }];
    h.cancel.mockResolvedValue("canceled");
    expect(await releaseInvoiceTotal(d as never, 7, { staleAfterMs: STALE_INTENT_MS })).toEqual({ released: true, canceled: 1 });
    expect(h.cancel).toHaveBeenCalledWith("pi_stale");
  });
});

describe("markPaymentPaid", () => {
  it("marks the intent's payment paid, so it stops holding the total", async () => {
    await markPaymentPaid(d as never, "pi_paid");
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]!.set).toMatchObject({ status: "paid" });
    expect(h.updates[0]!.set.paidAt).toBeInstanceOf(Date);
  });
});

describe("lockedTotalPatch", () => {
  it("returns the new total when no card payment is open", async () => {
    expect(await lockedTotalPatch(d as never, 7, 10000, 10500)).toEqual({ totalAmount: 10500 });
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("returns nothing when the total is unchanged, and cancels nothing", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_same", createdAt: TWO_DAYS_AGO }];
    expect(await lockedTotalPatch(d as never, 7, 10000, 10000)).toEqual({});
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("returns nothing for a non-positive total, and cancels nothing, so a missing ticket total cannot cancel a customer's payment", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_zero", createdAt: TWO_DAYS_AGO }];
    expect(await lockedTotalPatch(d as never, 7, 10000, 0)).toEqual({});
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("holds a changed total while a fresh card payment is open, without touching Stripe", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_fresh", createdAt: FRESH }];
    expect(await lockedTotalPatch(d as never, 7, 10000, 10500)).toEqual({});
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("cancels a stale open intent in Stripe, then returns the changed total", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_stale", createdAt: TWO_DAYS_AGO }];
    h.cancel.mockResolvedValue("canceled");
    expect(await lockedTotalPatch(d as never, 7, 10000, 10500)).toEqual({ totalAmount: 10500 });
    expect(h.cancel).toHaveBeenCalledWith("pi_stale");
  });

  it("holds the total when Stripe says a stale intent just succeeded", async () => {
    h.openRows = [{ id: 3, paymentIntentId: "pi_paid_now", createdAt: TWO_DAYS_AGO }];
    h.cancel.mockResolvedValue("succeeded");
    expect(await lockedTotalPatch(d as never, 7, 10000, 10500)).toEqual({});
  });
});
