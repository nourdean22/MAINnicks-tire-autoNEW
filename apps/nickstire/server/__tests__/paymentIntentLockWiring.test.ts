/**
 * The payment-intent lock is only as good as its callers. Each path that starts a card payment, that
 * records one as paid, or that changes an invoice total must reach the lock. A source scan keeps a
 * refactor from quietly dropping one of those calls.
 *
 * This is a canary for the call shape, not for behaviour: the behaviour is in paymentIntentLock.test.ts.
 * A new total writer must be added below, or it is not checked.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SERVER = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(SERVER, rel), "utf8");

describe("the payment-intent lock is wired into every path that moves money or a total", () => {
  it("starting a card payment records the intent under the invoice lock, and a refused record cancels it", () => {
    const router = read("routers/payments.ts");
    expect(router).toContain("recordPaymentIntentLocked(d, {");
    expect(router).toContain("cancelPaymentIntent(result.paymentIntentId)");
  });

  it("a payment recorded by the customer confirm path stops holding the total", () => {
    const src = read("routers/payments.ts");
    expect(src).toContain("markPaymentPaid(tx, input.paymentIntentId)");
    // The claim and the intent update commit in one transaction.
    expect(src).toContain("claimed = await d.transaction(");
  });

  it("a payment recorded by the Stripe webhook stops holding the total, and its status comes from one mapping", () => {
    const src = read("_core/index.ts");
    expect(src).toContain("markPaymentPaid(payDb, String(intent.id))");
    expect(src).toContain("webhookStatusForClaim(claim.kind) === 500");
  });

  it("an admin change to an invoice total releases the lock inside the invoice lock", () => {
    const src = read("routers/advanced/invoices.ts");
    expect(src).toContain("withInvoiceLock(d, id, async (tx, row) => {");
    expect(src).toContain("releaseInvoiceTotal(tx, id)");
  });

  it("an ALG mirror change to an invoice total is decided under the invoice lock", () => {
    const src = read("services/shopDriverMirror.ts");
    expect(src).toContain("withInvoiceLock(d, ex.id, async (tx, row) => {");
    expect(src).toContain("lockedTotalPatch(tx, ex.id, row.totalAmount, ri.totalAmount)");
  });

  it("the mirror's race-lost upsert writes its total under the invoice lock", () => {
    const src = read("services/shopDriverMirror.ts");
    expect(src).toContain("withInvoiceLock(d, raced.id, async (tx, row) => {");
    expect(src).toContain("lockedTotalPatch(tx, raced.id, row.totalAmount, ri.totalAmount)");
  });

  it("a ShopDriver sync total write, existing row and race-lost row, goes through the invoice lock", () => {
    const src = read("routers/shopdriver.ts");
    expect(src).toContain("withInvoiceLock(d, existing[0].id, async (tx, row) => {");
    expect(src).toContain("lockedTotalPatch(tx, existing[0].id, row.totalAmount, amount)");
    expect(src).toContain("withInvoiceLock(d, raced.id, async (tx, row) => {");
    expect(src).toContain("lockedTotalPatch(tx, raced.id, row.totalAmount, amount)");
  });

  it("the bridge invoice ingest writes an existing invoice's total under the invoice lock", () => {
    const src = read("services/reportIngestion.ts");
    expect(src).toContain("withInvoiceLock(db, existing[0].id, async (tx, row) => {");
    expect(src).toContain("lockedTotalPatch(tx, existing[0].id, row.totalAmount, inv.totalCents)");
  });

  it("a held total keeps its cost breakdown: the ingest and the mirror withhold labor, parts and tax with it", () => {
    expect(read("services/reportIngestion.ts")).toContain("const withheld = inv.totalCents > 0 && inv.totalCents !== row.totalAmount");
    expect(read("services/shopDriverMirror.ts")).toContain("delete all.laborCost;");
  });

  it("a tire-order payment checks for an open card payment under the invoice lock, and cancels nothing", () => {
    const src = read("services/payments.ts");
    expect(src).toContain("withInvoiceLock(d, invoice.id, async (tx) => {");
    expect(src).toContain("hasOpenCardPayment(tx, invoice.id)");
    expect(src).not.toContain("releaseInvoiceTotal(tx, invoice.id)");
  });
});
