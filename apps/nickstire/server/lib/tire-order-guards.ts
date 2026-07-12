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
 * One feed row eligible to anchor the expected price. `cost` is the
 * wholesale cost in DOLLARS (feed units); rows with cost <= 0 are
 * ignored (pickWholesaleCost returns 0 when D&K pricing is absent).
 */
export interface ExpectedPriceCandidate {
  brand: string;
  model: string;
  cost: number;
}

/**
 * Server-side expected-price derivation (wave-d-2026-07-12, extracted
 * from placeOrder so the selection policy is unit-tested, not just
 * commented).
 *
 * The feed carries the SAME brand+model in multiple variants (speed
 * rating / load index) at different prices, each sold as its own card —
 * but the order payload carries only brand+model. A first-match pick
 * here once re-derived a possibly DIFFERENT variant's price, so a
 * customer choosing the cheaper variant got a legit order rejected as
 * "Price has changed". Policy: take the MINIMUM cost across ALL
 * matching variants. Security holds — a tampered price must still clear
 * PRICE_TOLERANCE of the CHEAPEST real variant — and no variant the
 * customer actually saw can price below it.
 *
 * Matching semantics (kept exactly as the router always did them):
 * brand is an exact case-insensitive match; model is a case-insensitive
 * SUBSTRING match (`candidate.model.includes(inputModel)`), so callers
 * may pass a prefix-stripped model form. Returns cents, or null when no
 * candidate matches (caller then falls back to the absolute floor).
 * Price math mirrors publicSearch: ceil(cost × (1 + markup/100)) to
 * cents.
 */
export function deriveExpectedPriceCents(
  candidates: ExpectedPriceCandidate[],
  inputBrand: string,
  inputModel: string,
  markupPercent: number,
): number | null {
  const brandUpper = inputBrand.toUpperCase();
  const modelUpper = inputModel.toUpperCase();
  const costs = candidates
    .filter(c =>
      c.brand.toUpperCase() === brandUpper &&
      c.model.toUpperCase().includes(modelUpper) &&
      c.cost > 0)
    .map(c => c.cost);
  if (costs.length === 0) return null;
  const shopPrice = Math.ceil(Math.min(...costs) * (1 + markupPercent / 100) * 100) / 100;
  return Math.round(shopPrice * 100);
}

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
    /** Set when a Stripe Checkout session was ever issued for this order. */
    stripeSessionId?: string | null;
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
  } else if (order.stripeSessionId) {
    // createCheckout blocks NEW sessions for cancelled orders, but an
    // already-issued hosted checkout page stays payable for ~24h — the
    // customer can still pay for this cancelled order unless it's closed.
    text +=
      `\n\n⚠️ An open Stripe checkout link may still be PAYABLE for this cancelled order.\n` +
      `Stripe Dashboard → Payments → search "${order.orderNumber}" → expire the session.`;
  }
  return text;
}
