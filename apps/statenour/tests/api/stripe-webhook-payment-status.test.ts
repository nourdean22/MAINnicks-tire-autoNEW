/**
 * Task 12 follow-up: the Stripe webhook must not record an unpaid checkout as paid.
 *
 * `checkout.session.completed` fires when the customer finishes Checkout. For a
 * delayed method (ACH, SEPA, ...) the session's `payment_status` is still
 * "unpaid" at that point; the money settles later with
 * `checkout.session.async_payment_succeeded` or `..._failed`. The route wrote
 * every completed session as `paid`.
 *
 * Now: completed + paid -> "paid"; completed + anything else -> "pending";
 * async_payment_succeeded -> pending flips to "paid"; async_payment_failed ->
 * pending flips to "failed". Each flip is a compare-and-swap from "pending",
 * so a replayed event changes nothing. An async event for an order not yet
 * recorded answers 409 so Stripe redelivers it.
 *
 * Signature verification is stubbed (it has its own tests in
 * tests/security/webhook-replay-and-redirect-ssrf.test.ts); Prisma is faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Order = { id: string; stripeSessionId: string; status: string };
const { orders } = vi.hoisted(() => ({ orders: new Map<string, Order>() }));

vi.mock("@/lib/utils/http", () => ({ apiHandler: (h: (req: Request) => Promise<unknown>) => h }));
vi.mock("@/lib/security/stripe-signature", () => ({ verifyStripeSignature: () => true }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { upsert: async () => ({ id: "contact_1" }) },
    product: { findUnique: async () => ({ id: "prod_1" }) },
    order: {
      create: async ({ data }: { data: Order }) => {
        if (orders.has(data.stripeSessionId)) throw Object.assign(new Error("dup"), { code: "P2002" });
        const row = { ...data, id: `ord_${orders.size + 1}` };
        orders.set(data.stripeSessionId, row);
        return row;
      },
      findUnique: async ({ where }: { where: { stripeSessionId: string } }) => orders.get(where.stripeSessionId) ?? null,
      updateMany: async ({ where, data }: { where: { stripeSessionId: string; status: string }; data: { status: string } }) => {
        const row = orders.get(where.stripeSessionId);
        if (!row || row.status !== where.status) return { count: 0 };
        row.status = data.status;
        return { count: 1 };
      },
    },
  },
}));

import { POST } from "@/app/api/webhooks/stripe/route";

const handler = POST as unknown as (req: Request) => Promise<unknown>;

function send(type: string, session: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${Math.random()}`, type, data: { object: { id: "cs_test_1", ...session } } });
  return handler(new Request("http://x/api/webhooks/stripe", { method: "POST", body, headers: { "stripe-signature": "t=1,v1=stub" } }));
}

const completed = (payment_status: string) =>
  send("checkout.session.completed", {
    payment_status,
    amount_total: 4900,
    currency: "usd",
    customer_details: { email: "buyer@example.com", name: "Buyer" },
  });

beforeEach(() => {
  orders.clear();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_only");
});

describe("stripe webhook: the Order is paid only when the money is", () => {
  it("records a completed-but-unpaid session (async method) as pending, not paid", async () => {
    await completed("unpaid");
    expect(orders.get("cs_test_1")?.status).toBe("pending");
  });

  it("records a completed and paid session as paid", async () => {
    await completed("paid");
    expect(orders.get("cs_test_1")?.status).toBe("paid");
  });

  it("async_payment_succeeded flips pending to paid, and a replay changes nothing", async () => {
    await completed("unpaid");
    await send("checkout.session.async_payment_succeeded", { payment_status: "paid" });
    expect(orders.get("cs_test_1")?.status).toBe("paid");

    await expect(send("checkout.session.async_payment_succeeded", { payment_status: "paid" })).resolves.toEqual({ received: true });
    expect(orders.get("cs_test_1")?.status).toBe("paid");
  });

  it("async_payment_failed flips pending to failed and never to paid afterwards", async () => {
    await completed("unpaid");
    await send("checkout.session.async_payment_failed", { payment_status: "unpaid" });
    expect(orders.get("cs_test_1")?.status).toBe("failed");

    await send("checkout.session.async_payment_succeeded", { payment_status: "paid" });
    expect(orders.get("cs_test_1")?.status).toBe("failed");
  });

  it("an async event for an order not recorded yet answers 409 so Stripe redelivers", async () => {
    await expect(send("checkout.session.async_payment_succeeded", { payment_status: "paid" })).rejects.toMatchObject({ status: 409 });
    expect(orders.size).toBe(0);
  });
});
