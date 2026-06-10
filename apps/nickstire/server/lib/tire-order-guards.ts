/**
 * Tire-order money-path guards — pure helpers extracted from the
 * gatewayTire router so the rules that protect revenue are unit-testable
 * in isolation (the router itself pulls in db/email/sheets imports that
 * make direct testing impractical).
 *
 * Consumed by server/routers/gatewayTire.ts (placeOrder + updateOrder).
 */

/**
 * Reject client prices more than 5% below the server-derived expected
 * price — allows legit sale prices + rounding drift while blocking
 * tampered payloads.
 */
export const PRICE_TOLERANCE = 0.95;

/**
 * When no expected price can be derived (Gateway feed down + pipeline
 * cache cold), anything below this is the pay-a-penny exploit class.
 * Real Nick's tires retail $80+ even at budget tier, so $50 blocks
 * attacks without false-rejecting legitimate orders during outages.
 */
export const ABSOLUTE_MIN_TIRE_PRICE_CENTS = 5000;

export type PriceVerdict =
  | { ok: true; basis: "expected" | "floor" }
  | { ok: false; reason: "below-expected" | "below-floor" };

/**
 * Decide whether a client-submitted per-tire price is acceptable.
 * `expectedPriceCents` is the server-derived price (pipeline cache or
 * live Gateway), or null when neither source could produce one.
 */
export function evaluateOrderPrice(
  clientPriceCents: number,
  expectedPriceCents: number | null,
): PriceVerdict {
  if (expectedPriceCents !== null) {
    const minAcceptableCents = Math.floor(expectedPriceCents * PRICE_TOLERANCE);
    if (clientPriceCents < minAcceptableCents) {
      return { ok: false, reason: "below-expected" };
    }
    return { ok: true, basis: "expected" };
  }
  if (clientPriceCents < ABSOLUTE_MIN_TIRE_PRICE_CENTS) {
    return { ok: false, reason: "below-floor" };
  }
  return { ok: true, basis: "floor" };
}

/** Same-submission fingerprint for duplicate detection (L1 map + L2 DB). */
export function getIdempotencyKey(input: {
  customerPhone: string;
  tireBrand: string;
  tireModel: string;
  tireSize: string;
  quantity: number;
}): string {
  return `${input.customerPhone}|${input.tireBrand}|${input.tireModel}|${input.tireSize}|${input.quantity}`;
}

/**
 * TO-YYYYMMDD-NNN. Only ~900 suffixes per day, so the caller MUST be
 * prepared to retry when the insert hits the orderNumber UNIQUE key.
 */
export function generateOrderNumber(now: Date = new Date()): string {
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 900) + 100;
  return `TO-${dateStr}-${rand}`;
}

/**
 * MySQL unique-constraint violation. The only UNIQUE key on tire_orders
 * is orderNumber (id is auto-increment), so any duplicate-entry error on
 * insert is an order-number collision.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Duplicate entry");
}

/**
 * Telegram text for an admin cancellation. When the customer already
 * paid online the alert MUST say a refund is owed — Stripe has their
 * money and nothing else in the system will surface it.
 */
export function buildCancellationAlert(
  order: {
    orderNumber: string;
    customerName: string;
    customerPhone: string;
    quantity: number;
    tireBrand: string;
    tireModel: string;
    tireSize: string;
    /** cents */
    totalAmount: number;
    paymentStatus: string;
  },
  reason?: string,
): string {
  const desc = `${order.quantity}x ${order.tireBrand} ${order.tireModel} (${order.tireSize})`;
  let text =
    `❌ ORDER CANCELLED — ${order.orderNumber}\n` +
    `${desc}\n` +
    `Customer: ${order.customerName} | ${order.customerPhone}\n` +
    (reason ? `Reason: ${reason}` : "");
  if (order.paymentStatus === "paid") {
    text +=
      `\n\n⚠️ CUSTOMER PAID $${(order.totalAmount / 100).toFixed(2)} ONLINE — REFUND REQUIRED.\n` +
      `Stripe Dashboard → Payments → search "${order.orderNumber}" → Refund.`;
  }
  return text;
}
