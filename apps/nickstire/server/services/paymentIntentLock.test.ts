import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { invoices } from "../../drizzle/schema";

const h = vi.hoisted(() => ({
  cancel: vi.fn(),
  openRows: [] as Array<{ id: number; paymentIntentId: string | null; createdAt: Date }>,
  intentRow: { invoiceId: 7 } as { invoiceId: number } | null,
  invoiceRow: { totalAmount: 10000, paymentStatus: "pending" } as { totalAmount: number; paymentStatus: string | null } | null,
  inserts: [] as unknown[],
  updates: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
  selects: [] as Array<{ table: unknown; where: unknown; limit: boolean; forUpdate: boolean }>,
}));

// Only cancelPaymentIntent is replaced; every other export of ./payments stays real, so a later test in the
// same serial run that imports it still gets the full module.
vi.mock("./payments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./payments")>()),
  cancelPaymentIntent: (...a: unknown[]) => h.cancel(...a),
}));

import {
  lockedTotalPatch,
  markPaymentPaid,
  recordPaymentIntentLocked,
  releaseInvoiceTotal,
  STALE_INTENT_MS,
  withInvoiceLock,
} from "./paymentIntentLock";

// A fake database. A select returns the invoice row for the invoices table, the intent row for a limited
// payments lookup, and the open rows otherwise. Each select records its WHERE, which the dialect renders below.
function select() {
  const rec = { table: undefined as unknown, where: undefined as unknown, limit: false, forUpdate: false };
  h.selects.push(rec);
  const chain = {
    from(t: unknown) { rec.table = t; return chain; },
    where(w: unknown) { rec.where = w; return chain; },
    limit() { rec.limit = true; return chain; },
    for() { rec.forUpdate = true; return chain; },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      const rows = rec.table === invoices
        ? (h.invoiceRow ? [h.invoiceRow] : [])
        : rec.limit
          ? (h.intentRow ? [h.intentRow] : [])
          : h.openRows;
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
  return chain;
}

const d = {
  select: () => select(),
  insert: () => ({ values: async (v: unknown) => { h.inserts.push(v); return [{ insertId: 1 }]; } }),
  update: () => ({
    set: (s: Record<string, unknown>) => ({
      where: async (w: unknown) => { h.updates.push({ set: s, where: w }); return [{ affectedRows: 1 }]; },
    }),
  }),
  transaction: async (fn: (tx: unknown) => unknown) => fn(d),
};

const dialect = new MySqlDialect();
const render = (where: unknown) => dialect.sqlToQuery(where as SQL);

const FRESH = new Date();
const TWO_DAYS_AGO = new Date(Date.now() - 2 * STALE_INTENT_MS);

beforeEach(() => {
  h.cancel.mockReset();
  h.openRows = [];
  h.intentRow = { invoiceId: 7 };
  h.invoiceRow = { totalAmount: 10000, paymentStatus: "pending" };
  h.inserts = [];
  h.updates = [];
  h.selects = [];
});

describe("withInvoiceLock", () => {
  it("reads the invoice row with FOR UPDATE, inside a transaction", async () => {
    const total = await withInvoiceLock(d as never, 7, async (_tx, row) => row.totalAmount);
    expect(total).toBe(10000);
    expect(h.selects[0]).toMatchObject({ table: invoices, forUpdate: true });
  });

  it("returns null for a missing invoice, and writes nothing", async () => {
    h.invoiceRow = null;
    expect(await withInvoiceLock(d as never, 7, async () => "ran")).toBeNull();
    expect(h.updates).toHaveLength(0);
  });
});

describe("recordPaymentIntentLocked", () => {
  const intent = {
    invoiceId: 7,
    amountCents: 10000,
    customerName: "Pat",
    customerPhone: "2165550100",
    description: "Invoice 7",
    paymentIntentId: "pi_new",
  };

  it("records when the total is still the amount the intent was created for, as pending", async () => {
    expect(await recordPaymentIntentLocked(d as never, intent)).toBe("recorded");
    expect(h.inserts).toEqual([{
      invoiceId: 7,
      amount: 10000,
      customerName: "Pat",
      customerPhone: "2165550100",
      description: "Invoice 7",
      stripePaymentIntentId: "pi_new",
      status: "pending",
    }]);
  });

  it("truncates a long description to the column's 500 characters", async () => {
    await recordPaymentIntentLocked(d as never, { ...intent, description: "A".repeat(600) });
    expect((h.inserts[0] as { description: string }).description).toHaveLength(500);
  });

  it("cuts a name and phone to their payment columns, so a longer invoice value cannot refuse the row", async () => {
    await recordPaymentIntentLocked(d as never, { ...intent, customerName: "N".repeat(255), customerPhone: "1".repeat(30) });
    const row = h.inserts[0] as { customerName: string; customerPhone: string };
    expect(row.customerName).toHaveLength(200);
    expect(row.customerPhone).toHaveLength(20);
  });

  it("refuses when the total moved after the intent was created at the old amount", async () => {
    h.invoiceRow = { totalAmount: 10500, paymentStatus: "pending" };
    expect(await recordPaymentIntentLocked(d as never, intent)).toBe("total_changed");
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses an invoice that is already paid", async () => {
    h.invoiceRow = { totalAmount: 10000, paymentStatus: "paid" };
    expect(await recordPaymentIntentLocked(d as never, intent)).toBe("paid");
    expect(h.inserts).toHaveLength(0);
  });

  it("reports not_found for a missing invoice", async () => {
    h.invoiceRow = null;
    expect(await recordPaymentIntentLocked(d as never, intent)).toBe("not_found");
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

  it("cancels a stale intent even while a fresh one holds the total, then still holds", async () => {
    h.openRows = [
      { id: 3, paymentIntentId: "pi_stale", createdAt: TWO_DAYS_AGO },
      { id: 4, paymentIntentId: "pi_fresh", createdAt: FRESH },
    ];
    h.cancel.mockResolvedValue("canceled");
    const result = await releaseInvoiceTotal(d as never, 7, { staleAfterMs: STALE_INTENT_MS });
    expect(result.released).toBe(false);
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.cancel).toHaveBeenCalledWith("pi_stale");
    expect(h.updates).toHaveLength(1);
  });

  it("reads only pending rows with a Stripe id on this invoice", async () => {
    await releaseInvoiceTotal(d as never, 7);
    const open = h.selects.find((s) => !s.limit);
    const q = render(open!.where);
    expect(q.params).toEqual(expect.arrayContaining([7, "pending"]));
    expect(q.sql).toMatch(/is not null/i);
  });
});

describe("markPaymentPaid", () => {
  it("marks the intent's payment paid, so it stops holding the total", async () => {
    await markPaymentPaid(d as never, "pi_paid");
    const paid = h.updates.find((u) => u.set.status === "paid");
    expect(paid).toBeDefined();
    expect(paid!.set.paidAt).toBeInstanceOf(Date);
  });

  it("only touches rows not already paid, so a retry keeps the first paidAt", async () => {
    await markPaymentPaid(d as never, "pi_paid");
    const paid = h.updates.find((u) => u.set.status === "paid")!;
    expect(render(paid.where).params).toEqual(expect.arrayContaining(["pi_paid", "paid"]));
  });

  it("cancels the other open card payments on the now-paid invoice", async () => {
    h.openRows = [{ id: 9, paymentIntentId: "pi_other", createdAt: FRESH }];
    h.cancel.mockResolvedValue("canceled");
    await markPaymentPaid(d as never, "pi_paid");
    expect(h.cancel).toHaveBeenCalledWith("pi_other");
    expect(h.updates.some((u) => u.set.status === "canceled")).toBe(true);
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
