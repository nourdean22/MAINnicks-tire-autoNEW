/**
 * Payment-intent lock. A card payment started on an invoice is recorded with the amount it was
 * created for, and that amount holds the invoice total while the payment is open. The amount Stripe
 * charges and the amount the invoice records therefore cannot drift apart.
 *
 *   recordPaymentIntent  when the intent is created, before the customer can pay
 *   releaseInvoiceTotal  before any change to the total: cancels the open intent in Stripe, and
 *                        releases only when Stripe confirms the cancel
 *   markPaymentPaid      when the payment is recorded, so the intent stops holding the total
 *
 * Only intents with a Stripe PaymentIntent id are locked. Payment-link rows have no id and are not
 * part of this lock.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import type { getDb } from "../db";
import { payments } from "../../drizzle/schema";
import { createLogger } from "../lib/logger";
import { cancelPaymentIntent } from "./payments";

const log = createLogger("services:paymentIntentLock");

/** An intent older than this is stale: the ShopDriver mirror cancels it instead of waiting on it. */
export const STALE_INTENT_MS = 24 * 60 * 60 * 1000;

/** The database handle the caller already has. Only select, insert and update are used. */
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type RecordedIntent = {
  invoiceId: number;
  amountCents: number;
  customerName: string | null;
  customerPhone: string | null;
  description: string;
  paymentIntentId: string;
};

export async function recordPaymentIntent(d: Db, intent: RecordedIntent): Promise<void> {
  await d.insert(payments).values({
    invoiceId: intent.invoiceId,
    amount: intent.amountCents,
    customerName: intent.customerName,
    customerPhone: intent.customerPhone,
    description: intent.description.slice(0, 500),
    stripePaymentIntentId: intent.paymentIntentId,
    status: "pending",
  });
}

/** Recorded intents on this invoice that still hold its total: pending, with a Stripe id. */
export async function openIntents(d: Db, invoiceId: number) {
  return d.select({
    id: payments.id,
    paymentIntentId: payments.stripePaymentIntentId,
    createdAt: payments.createdAt,
  })
    .from(payments)
    .where(and(
      eq(payments.invoiceId, invoiceId),
      eq(payments.status, "pending"),
      isNotNull(payments.stripePaymentIntentId),
    ));
}

export type ReleaseResult =
  | { released: true; canceled: number }
  | { released: false; reason: string };

/**
 * Makes an invoice's total changeable. Cancels each open intent in Stripe and releases only when
 * every one is confirmed canceled. With `staleAfterMs`, an intent younger than that holds the total
 * and an older one is canceled.
 */
export async function releaseInvoiceTotal(
  d: Db,
  invoiceId: number,
  opts: { staleAfterMs?: number } = {},
): Promise<ReleaseResult> {
  const open = await openIntents(d, invoiceId);
  if (opts.staleAfterMs !== undefined) {
    const cutoff = Date.now() - opts.staleAfterMs;
    if (open.some((i) => i.createdAt.getTime() > cutoff)) {
      return { released: false, reason: "a card payment started within the last day holds the total" };
    }
  }

  let canceled = 0;
  for (const intent of open) {
    const id = intent.paymentIntentId;
    if (!id) continue;
    const outcome = await cancelPaymentIntent(id);
    if (outcome === "canceled") {
      await d.update(payments).set({ status: "canceled" }).where(eq(payments.id, intent.id));
      canceled++;
      continue;
    }
    log.warn("Invoice total held: an open card payment was not confirmed canceled", { invoiceId, outcome });
    return {
      released: false,
      reason: outcome === "succeeded"
        ? "a card payment just succeeded and is held until its webhook records it"
        : outcome === "processing"
          ? "a card payment is still processing"
          : "Stripe could not confirm the open card payment is canceled",
    };
  }
  return { released: true, canceled };
}

/** Records that the payment for this intent was taken, so it stops holding the invoice total. */
export async function markPaymentPaid(d: Db, paymentIntentId: string): Promise<void> {
  await d.update(payments)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(payments.stripePaymentIntentId, paymentIntentId));
}
