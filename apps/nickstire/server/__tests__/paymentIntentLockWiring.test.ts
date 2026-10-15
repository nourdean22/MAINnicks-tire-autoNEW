/**
 * The payment-intent lock is only as good as its callers. Each path that starts a card payment, that
 * records one as paid, or that changes an invoice total must reach the lock. A source scan keeps a
 * refactor from quietly dropping one of those calls.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SERVER = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(SERVER, rel), "utf8");

describe("the payment-intent lock is wired into every path that moves money or a total", () => {
  it("starting a card payment records the intent, and a failed record cancels it", () => {
    const router = read("routers/payments.ts");
    expect(router).toContain("recordPaymentIntent(");
    expect(router).toContain("cancelPaymentIntent(result.paymentIntentId)");
  });

  it("a payment recorded by the customer confirm path stops holding the total", () => {
    expect(read("routers/payments.ts")).toContain("markPaymentPaid(d, input.paymentIntentId)");
  });

  it("a payment recorded by the Stripe webhook stops holding the total", () => {
    expect(read("_core/index.ts")).toContain("markPaymentPaid(payDb, String(intent.id))");
  });

  it("an admin change to an invoice total releases the lock first", () => {
    expect(read("routers/advanced/invoices.ts")).toContain("releaseInvoiceTotal(d, id)");
  });

  it("an ALG mirror change to an invoice total is held by the lock", () => {
    expect(read("services/shopDriverMirror.ts")).toContain("releaseInvoiceTotal(d, ex.id, { staleAfterMs: STALE_INTENT_MS })");
  });
});
