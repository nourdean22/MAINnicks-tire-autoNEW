/**
 * Stripe webhook decisions, pulled out of _core/index.ts so they run without
 * booting Express. Stripe retries a non-2xx answer for its retry window and then
 * drops the event, so the status each branch returns is part of the contract.
 */
import { and, eq, ne } from "drizzle-orm";
import { invoices } from "../../drizzle/schema";
import { createLogger } from "./logger";

const log = createLogger("stripe-webhook");

/** Same tolerance payments.confirmPayment applies: Stripe rounds processing fees. */
const AMOUNT_TOLERANCE_CENTS = 50;

type StripeWebhookPreflight =
  | { ok: true; webhookSecret: string; secretKey: string }
  | { ok: false; status: 200 | 500 };

/**
 * Decides whether a webhook request can be verified, and what to answer if not.
 * A secret without a key answers 500: the key can be fixed, so Stripe must retry.
 */
export function stripeWebhookPreflight(env: { webhookSecret?: string; secretKey?: string }): StripeWebhookPreflight {
  if (!env.webhookSecret) {
    if (env.secretKey) {
      // Audit #113: real payments reach Stripe here and would be dropped silently.
      log.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET is missing but STRIPE_SECRET_KEY is set. Stripe is half-configured and real payment events are being DROPPED. Set STRIPE_WEBHOOK_SECRET on Railway or events will continue to fail.");
      return { ok: false, status: 500 };
    }
    // Stripe not configured at all: no events are expected, so stay quiet.
    return { ok: false, status: 200 };
  }
  if (!env.secretKey) {
    log.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET is set but STRIPE_SECRET_KEY is missing. Answering 500 so Stripe retries until the key is set.");
    return { ok: false, status: 500 };
  }
  return { ok: true, webhookSecret: env.webhookSecret, secretKey: env.secretKey };
}

type InvoicePaidOutcome =
  | { kind: "db_unavailable" }
  | { kind: "not_found"; invoiceNumber: string }
  | { kind: "amount_mismatch"; invoiceNumber: string; expectedCents: number; receivedCents: number }
  | { kind: "not_claimed"; invoiceNumber: string }
  // The total moved between the read and the claim (or the row vanished): not recorded.
  | { kind: "total_changed"; invoiceNumber: string }
  | { kind: "claimed"; invoiceNumber: string };

/**
 * Marks an invoice paid from a succeeded PaymentIntent. Reads the row, refuses an
 * amount that does not match it, then claims it with a conditional UPDATE that pins
 * the total it read. Only the first delivery flips the row.
 */
export async function markInvoicePaid(input: {
  invoiceNumber: string;
  receivedCents: number;
  paymentIntentId: string;
}): Promise<InvoicePaidOutcome> {
  const { invoiceNumber, receivedCents, paymentIntentId } = input;
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) {
    log.error("[Stripe Webhook] Database unavailable. Invoice not marked paid; Stripe will retry.", { invoiceNumber, paymentIntentId });
    return { kind: "db_unavailable" };
  }

  // A handle that is set but unreachable throws from these statements. Answer
  // db_unavailable so Stripe retries; a bare throw reaches the route as a 400.
  try {
    const [inv] = await d.select({ totalAmount: invoices.totalAmount })
      .from(invoices)
      .where(eq(invoices.invoiceNumber, invoiceNumber))
      .limit(1);
    if (!inv) {
      log.error("[Stripe Webhook] Paid intent names an invoice that does not exist. Nothing marked.", { invoiceNumber, paymentIntentId });
      return { kind: "not_found", invoiceNumber };
    }

    if (Math.abs(receivedCents - inv.totalAmount) > AMOUNT_TOLERANCE_CENTS) {
      log.error("[Stripe Webhook] Amount mismatch. Invoice NOT marked paid; a retry cannot change the amount.", {
        invoiceNumber,
        paymentIntentId,
        expectedCents: inv.totalAmount,
        receivedCents,
      });
      return { kind: "amount_mismatch", invoiceNumber, expectedCents: inv.totalAmount, receivedCents };
    }

    // Idempotency (2026-05-23): only the first delivery flips the row, so a Stripe
    // retry never re-emits invoicePaid. The claim also pins the total checked above,
    // so an edit made between the read and this write cannot pass.
    // An UPDATE with no selected fields returns the mysql2 tuple [ResultSetHeader, fields],
    // not the header itself (drizzle-orm 0.45 mysql2 session, execute()). Read it at [0].
    const [header] = await d.update(invoices)
      .set({ paymentStatus: "paid", paymentMethod: "card" })
      .where(and(
        eq(invoices.invoiceNumber, invoiceNumber),
        ne(invoices.paymentStatus, "paid"),
        eq(invoices.totalAmount, inv.totalAmount),
      ));
    const affected = header?.affectedRows ?? 0;
    if (affected === 1) return { kind: "claimed", invoiceNumber };

    // The claim matched no row: already paid, or the total moved after the read.
    // Re-read the row to tell the two apart.
    const [after] = await d.select({ totalAmount: invoices.totalAmount })
      .from(invoices)
      .where(eq(invoices.invoiceNumber, invoiceNumber))
      .limit(1);
    if (after?.totalAmount !== inv.totalAmount) {
      log.error("[Stripe Webhook] Invoice total changed during the claim, or the invoice vanished. Invoice NOT marked paid.", {
        invoiceNumber,
        paymentIntentId,
        expectedCents: inv.totalAmount,
        currentCents: after?.totalAmount ?? null,
        receivedCents,
      });
      return { kind: "total_changed", invoiceNumber };
    }

    log.info("[Stripe Webhook] Invoice already paid. Skipping fan-out.", { invoiceNumber, paymentIntentId, affected });
    return { kind: "not_claimed", invoiceNumber };
  } catch (err) {
    log.error("[Stripe Webhook] Database error while recording the payment. Invoice not marked paid; Stripe will retry.", {
      invoiceNumber,
      paymentIntentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: "db_unavailable" };
  }
}
