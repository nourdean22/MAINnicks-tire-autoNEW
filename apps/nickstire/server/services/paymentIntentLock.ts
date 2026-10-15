/**
 * Payment-intent lock. A card payment started on an invoice is recorded with the amount it was
 * created for, and that amount holds the invoice total while the payment is open. The amount Stripe
 * charges and the amount the invoice records therefore cannot drift apart.
 *
 *   withInvoiceLock            every total change and every intent record runs under the invoice's row lock
 *   recordPaymentIntentLocked  when the intent is created: refused if the total moved or the invoice is paid
 *   releaseInvoiceTotal        before any change to the total: cancels open intents in Stripe, releases only
 *                              when Stripe confirms each cancel
 *   lockedTotalPatch           the total a writer may set, decided under the lock
 *   markPaymentPaid            when the payment is recorded: the intent stops holding the total, and any other
 *                              open card payment on the now-paid invoice is canceled
 *
 * Only intents with a Stripe PaymentIntent id are locked. Payment-link rows have no id and are not part
 * of this lock. Intents created before this lock deployed are not locked.
 */
import { createHash } from "node:crypto";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import type { getDb } from "../db";
import { invoices, payments } from "../../drizzle/schema";
import { createLogger } from "../lib/logger";
import { cancelPaymentIntent } from "./payments";

const log = createLogger("services:paymentIntentLock");

/** A log-safe reference to an invoice: the same pseudonym stripeWebhook.ts uses for an invoice number. */
const invoiceRef = (invoiceId: number): string => createHash("sha256").update(`invoice:${invoiceId}`).digest("hex").slice(0, 12);

/** An intent older than this is stale: the ShopDriver mirror cancels it instead of waiting on it. */
export const STALE_INTENT_MS = 24 * 60 * 60 * 1000;

/** The database handle, or a transaction on it. Both run the same queries. */
export type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

type InvoiceLockRow = { totalAmount: number; paymentStatus: string | null };

/**
 * Runs `body` in one transaction with the invoice row locked (SELECT ... FOR UPDATE). Every total change
 * and every intent record for an invoice goes through here, so the two serialize: an intent recorded after
 * a total change is refused, and a total change after an intent is recorded sees that intent and holds.
 * Returns null when the invoice does not exist. Stripe calls made inside `body` hold the row lock.
 */
export async function withInvoiceLock<T>(
  d: Db,
  invoiceId: number,
  body: (tx: Db, row: InvoiceLockRow) => Promise<T>,
): Promise<T | null> {
  return d.transaction(async (tx: Db) => {
    const [row] = await tx.select({ totalAmount: invoices.totalAmount, paymentStatus: invoices.paymentStatus })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1)
      .for("update");
    if (!row) return null;
    return body(tx, row);
  });
}

export type RecordedIntent = {
  invoiceId: number;
  amountCents: number;
  customerName: string | null;
  customerPhone: string | null;
  description: string;
  paymentIntentId: string;
};

async function recordPaymentIntent(d: Db, intent: RecordedIntent): Promise<void> {
  // The columns are narrower than the invoice's (customer_name 200, customer_phone 20). A longer value is
  // cut here: the database would refuse the row after Stripe already holds the intent.
  await d.insert(payments).values({
    invoiceId: intent.invoiceId,
    amount: intent.amountCents,
    customerName: intent.customerName?.slice(0, 200) ?? null,
    customerPhone: intent.customerPhone?.slice(0, 20) ?? null,
    description: intent.description.slice(0, 500),
    stripePaymentIntentId: intent.paymentIntentId,
    status: "pending",
  });
}

type LockedRecord = "recorded" | "total_changed" | "paid" | "not_found";

/**
 * Records an intent under the invoice lock. Refused when the invoice is already paid, or when its total is
 * no longer the amount the intent was created for. The caller cancels the Stripe intent on any refusal.
 */
export async function recordPaymentIntentLocked(d: Db, intent: RecordedIntent): Promise<LockedRecord> {
  const outcome = await withInvoiceLock(d, intent.invoiceId, async (tx, row): Promise<LockedRecord> => {
    if (row.paymentStatus === "paid") return "paid";
    if (row.totalAmount !== intent.amountCents) return "total_changed";
    await recordPaymentIntent(tx, intent);
    return "recorded";
  });
  return outcome ?? "not_found";
}

export type OpenIntent = { id: number; paymentIntentId: string | null; createdAt: Date };

/** Recorded intents on this invoice that still hold its total: pending, with a Stripe id. */
async function openIntents(d: Db, invoiceId: number): Promise<OpenIntent[]> {
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

function holdReason(outcome: "succeeded" | "processing" | "failed"): string {
  if (outcome === "succeeded") return "a card payment just succeeded and is held until its webhook records it";
  if (outcome === "processing") return "a card payment is still processing";
  return "Stripe could not confirm the open card payment is canceled";
}

/** Cancels each intent in Stripe and marks it canceled. Stops at the first one Stripe will not confirm. */
async function cancelOpenIntents(d: Db, invoiceId: number, intents: OpenIntent[]): Promise<{ canceled: number; reason?: string }> {
  let canceled = 0;
  for (const intent of intents) {
    if (!intent.paymentIntentId) continue;
    const outcome = await cancelPaymentIntent(intent.paymentIntentId);
    if (outcome !== "canceled") {
      log.warn("Invoice total held: an open card payment was not confirmed canceled", { invoiceRef: invoiceRef(invoiceId), outcome });
      return { canceled, reason: holdReason(outcome) };
    }
    await d.update(payments).set({ status: "canceled" }).where(eq(payments.id, intent.id));
    canceled++;
  }
  return { canceled };
}

/**
 * Makes an invoice's total changeable. Cancels each open intent in Stripe and releases only when every
 * one is confirmed canceled. With `staleAfterMs`, an intent younger than that holds the total; an older
 * one is canceled even while a younger one holds, because a stale intent is dead either way.
 */
export async function releaseInvoiceTotal(
  d: Db,
  invoiceId: number,
  opts: { staleAfterMs?: number } = {},
): Promise<ReleaseResult> {
  const open = await openIntents(d, invoiceId);
  const cutoff = opts.staleAfterMs === undefined ? null : Date.now() - opts.staleAfterMs;
  const fresh = cutoff === null ? [] : open.filter((i) => i.createdAt.getTime() > cutoff);
  const toCancel = cutoff === null ? open : open.filter((i) => i.createdAt.getTime() <= cutoff);

  const { canceled, reason } = await cancelOpenIntents(d, invoiceId, toCancel);
  if (reason) return { released: false, reason };
  if (fresh.length > 0) {
    return { released: false, reason: "a card payment started within the last day holds the total" };
  }
  return { released: true, canceled };
}

/**
 * Records that the payment for this intent was taken. The invoice is paid now, so any other open card
 * payment on it is canceled too: a second charge for a paid invoice must not go through. A retry keeps
 * the first paidAt.
 */
export async function markPaymentPaid(d: Db, paymentIntentId: string): Promise<void> {
  const [row] = await d.select({ invoiceId: payments.invoiceId })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, paymentIntentId))
    .limit(1);
  await d.update(payments)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(payments.stripePaymentIntentId, paymentIntentId), ne(payments.status, "paid")));
  if (!row) return;
  const siblings = await releaseInvoiceTotal(d, row.invoiceId);
  if (!siblings.released) {
    log.error("Another open card payment on a paid invoice could not be canceled. Check Stripe before it is charged.", {
      invoiceRef: invoiceRef(row.invoiceId),
      paymentIntentId,
      reason: siblings.reason,
    });
  }
}

/**
 * True while a card payment started on this invoice is still open and holds its total. Read-only: nothing
 * is canceled, so the caller decides what an open payment means for it.
 */
export async function hasOpenCardPayment(d: Db, invoiceId: number): Promise<boolean> {
  return (await openIntents(d, invoiceId)).length > 0;
}

/**
 * The total column a writer may set, decided under the invoice lock: pass the row that withInvoiceLock
 * read, so `currentCents` is the total as the lock sees it. It is `{ totalAmount }` only when no card payment
 * holds the total. It is `{}` when nothing changes, when the new total is not positive (a missing ticket total
 * must not cancel a customer's open payment), or when a payment holds it.
 */
export async function lockedTotalPatch(
  d: Db,
  invoiceId: number,
  currentCents: number,
  nextCents: number,
): Promise<{ totalAmount?: number }> {
  if (nextCents <= 0 || nextCents === currentCents) return {};
  const held = await releaseInvoiceTotal(d, invoiceId, { staleAfterMs: STALE_INTENT_MS });
  if (held.released) return { totalAmount: nextCents };
  log.info("Invoice total held: a card payment holds it", { invoiceRef: invoiceRef(invoiceId), reason: held.reason });
  return {};
}
