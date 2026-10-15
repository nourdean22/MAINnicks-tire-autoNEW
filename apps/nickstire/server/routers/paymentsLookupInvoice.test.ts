/**
 * payments.lookupInvoice returns only the fields the pay page renders.
 *
 * The procedure is public: anyone who knows an invoice number and the phone on it
 * gets the bill back. Until customer auth exists, the response is kept to what
 * client/src/pages/PayInvoice.tsx reads. Columns that page never reads (the row id,
 * the payment method, the invoice date) are not selected at all.
 *
 * The database is faked, and the fake honours the column projection it is handed,
 * so the assertion is on what the procedure actually asks the database for and
 * returns to the caller.
 */
import { describe, expect, it, vi } from "vitest";
import { paymentsRouter } from "./payments";

const FULL_ROW: Record<string, unknown> = {
  id: 7,
  invoiceNumber: "INV-20261014-001",
  customerName: "Pat Example",
  customerPhone: "2165550101",
  totalAmount: 12345,
  partsCost: 2000,
  laborCost: 8000,
  taxAmount: 2345,
  serviceDescription: "Front brake pads and rotors",
  vehicleInfo: "2016 Honda Civic",
  paymentStatus: "pending",
  paymentMethod: "card",
  invoiceDate: new Date("2026-10-14T12:00:00Z"),
};

vi.mock("../lib/db-helper", () => ({
  db: async () => ({
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          limit: async () => [Object.fromEntries(Object.keys(fields).map((k) => [k, FULL_ROW[k]]))],
        }),
      }),
    }),
  }),
}));

// Exactly the fields client/src/pages/PayInvoice.tsx renders, plus canPay.
const RENDERED = [
  "canPay",
  "customerName",
  "invoiceNumber",
  "laborCost",
  "partsCost",
  "paymentStatus",
  "serviceDescription",
  "taxAmount",
  "totalAmount",
  "vehicleInfo",
].sort();

describe("payments.lookupInvoice response", () => {
  it("returns only the fields the pay page renders", async () => {
    const out = await paymentsRouter
      .createCaller({} as never)
      .lookupInvoice({ invoiceNumber: "INV-20261014-001", phone: "2165550101" });
    expect(out).not.toBeNull();
    expect(Object.keys(out ?? {}).sort()).toEqual(RENDERED);
  });

  it("still returns the rendered values, converted from cents to dollars", async () => {
    const out = await paymentsRouter
      .createCaller({} as never)
      .lookupInvoice({ invoiceNumber: "INV-20261014-001", phone: "2165550101" });
    expect(out).toMatchObject({
      invoiceNumber: "INV-20261014-001",
      customerName: "Pat Example",
      totalAmount: 123.45,
      laborCost: 80,
      paymentStatus: "pending",
      canPay: true,
    });
  });
});
