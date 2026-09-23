/**
 * createInvoice survives an invoice-number collision and says which number it
 * stored (2026-09-23).
 *
 * The number comes from MAX(invoiceNumber)+1 with no lock, so two invoices
 * created at once can ask for the same one. Two defects met there:
 *
 * 1. The collision check read `err.code` and `err.message` off the error it
 *    caught. drizzle-orm 0.45 throws DrizzleQueryError: its `code` is
 *    undefined and its message is the SQL and params, so the check never
 *    matched a real collision and the first one threw instead of retrying.
 *    placeOrder caught that, logged "Invoice creation failed", left the paid
 *    order with no invoice, and returned the number it had asked for, which
 *    is the OTHER customer's invoice number, to the order screen.
 * 2. Had the retry fired, it changed the number only on its own copy.
 *    placeOrder linked the tire order and the Stripe checkout to the number it
 *    had asked for, so the payment marked the other customer's invoice paid.
 *
 * The errors thrown here are the shapes a real query produces: drizzle's
 * DrizzleQueryError wrapping the driver's 1062 (precedent:
 * candidateSlaMissingTable.test.ts).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";

vi.unmock("./db");

const h = vi.hoisted(() => ({
  /** What SELECT MAX(invoiceNumber) returns. */
  maxNum: null as string | null,
  /** Errors thrown by successive inserts; an empty queue means the insert succeeds. */
  insertFailures: [] as unknown[],
  /** Every row handed to insert().values(), copied at the time of the call. */
  inserted: [] as Array<Record<string, unknown>>,
}));

vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({ end: async () => {} }) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => ({
    select: () => ({ from: () => ({ where: async () => [{ maxNum: h.maxNum }] }) }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        h.inserted.push({ ...row });
        if (h.insertFailures.length > 0) throw h.insertFailures.shift();
        return [{ insertId: 42 }];
      },
    }),
  }),
}));

const savedUrl = process.env.DATABASE_URL;
beforeEach(() => {
  process.env.DATABASE_URL = "mysql://test:3306/db";
  h.maxNum = null;
  h.insertFailures = [];
  h.inserted = [];
});
afterAll(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const num = (seq: string) => `INV-${today}-${seq}`;

/** The driver's duplicate-key error, as mysql2 raises it. */
function driverDuplicate(invoiceNumber: string): Error {
  return Object.assign(new Error(`Duplicate entry '${invoiceNumber}' for key 'invoices.invoiceNumber'`), {
    code: "ER_DUP_ENTRY",
    errno: 1062,
  });
}

/** What a real drizzle insert throws: the driver error wrapped, SQL as the message. */
function wrappedDuplicate(invoiceNumber: string): DrizzleQueryError {
  return new DrizzleQueryError(
    "insert into `invoices` (`customerName`, `invoiceNumber`, `totalAmount`) values (?, ?, ?)",
    ["Test Customer", invoiceNumber, 10000],
    driverDuplicate(invoiceNumber),
  );
}

const invoice = (invoiceNumber: string) => ({
  customerName: "Test Customer",
  invoiceNumber,
  totalAmount: 10000,
  paymentStatus: "pending" as const,
});

describe("createInvoice on an invoice-number collision", () => {
  it("stores the invoice under the next free number and returns that number", async () => {
    // Another invoice took -004 between this caller's MAX() read and its insert.
    h.maxNum = num("004");
    h.insertFailures = [wrappedDuplicate(num("004"))];
    const { createInvoice } = await import("./db");

    const result = await createInvoice(invoice(num("004")));

    expect(h.inserted.map((r) => r.invoiceNumber)).toEqual([num("004"), num("005")]);
    expect(result).toEqual({ success: true, id: 42, invoiceNumber: num("005") });
  });

  it("still retries on an unwrapped driver error", async () => {
    h.maxNum = num("004");
    h.insertFailures = [driverDuplicate(num("004"))];
    const { createInvoice } = await import("./db");

    const result = await createInvoice(invoice(num("004")));

    expect(result.invoiceNumber).toBe(num("005"));
  });

  it("returns the requested number when there is no collision", async () => {
    const { createInvoice } = await import("./db");

    const result = await createInvoice(invoice(num("007")));

    expect(h.inserted).toHaveLength(1);
    expect(result).toEqual({ success: true, id: 42, invoiceNumber: num("007") });
  });

  it("does not retry an error that is not a duplicate key", async () => {
    const tooLong = new DrizzleQueryError(
      "insert into `invoices` (`customerName`) values (?)",
      ["x".repeat(300)],
      Object.assign(new Error("Data too long for column 'customerName' at row 1"), { code: "ER_DATA_TOO_LONG", errno: 1406 }),
    );
    h.insertFailures = [tooLong];
    const { createInvoice } = await import("./db");

    await expect(createInvoice(invoice(num("007")))).rejects.toBe(tooLong);
    expect(h.inserted).toHaveLength(1);
  });

  it("gives up after three collisions and throws the last one", async () => {
    h.maxNum = num("004");
    const last = wrappedDuplicate(num("005"));
    h.insertFailures = [wrappedDuplicate(num("004")), wrappedDuplicate(num("005")), last];
    const { createInvoice } = await import("./db");

    await expect(createInvoice(invoice(num("004")))).rejects.toBe(last);
    expect(h.inserted).toHaveLength(3);
  });
});
