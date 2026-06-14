/**
 * Customer order-confirmation message templates — PREVIEW ONLY.
 *
 * 2026-06-10 danger-zone-safe-build wave. Customers currently receive NO
 * automatic order-confirmation messages; this module exists so the owner
 * can review exact copy (and admin can preview it) BEFORE any provider,
 * cost, or send path is approved.
 *
 * SAFETY MODEL
 * - Pure string builders: no provider import, no Twilio/SendGrid call,
 *   no cron, no env read, no side effects.
 * - The send path does not exist: sendCustomerMessage() ALWAYS throws.
 *   Enabling real sends requires a dedicated, owner-approved PR that
 *   replaces that function — it cannot be flipped on by env var.
 * - Copy obeys the shop's claim-safety rules: no "reserved", no
 *   guaranteed stock, staff confirms availability, payment != supplier
 *   reservation.
 */

export interface OrderMessageInput {
  customerName: string;
  orderNumber: string;
  quantity: number;
  tireBrand: string;
  tireModel: string;
  tireSize: string;
  /** dollars */
  totalAmount?: number;
}

export interface MessagePreview {
  /** <=320 chars target; single SMS-friendly where possible. */
  sms: string;
  email: { subject: string; body: string };
}

const SHOP = "Nick's Tire & Auto";
const PHONE = "(216) 862-0005";
const ADDRESS = "17625 Euclid Ave, Cleveland";

function tireLine(o: OrderMessageInput): string {
  return `${o.quantity}x ${o.tireBrand} ${o.tireModel} (${o.tireSize})`;
}

/** 1. Tire request received (immediately after placeOrder). */
export function requestReceived(o: OrderMessageInput): MessagePreview {
  return {
    sms:
      `${SHOP}: got your tire request ${o.orderNumber} — ${tireLine(o)}. ` +
      `We'll confirm availability and call you. Availability can change until staff confirms. Questions? ${PHONE}`,
    email: {
      subject: `Tire request received — ${o.orderNumber}`,
      body:
        `Hi ${o.customerName},\n\n` +
        `We received your tire request ${o.orderNumber}: ${tireLine(o)}.\n\n` +
        `Next step: our staff confirms availability and fitment, then calls you. ` +
        `No supplier reservation is guaranteed until staff confirms availability.\n\n` +
        `${SHOP} · ${ADDRESS} · ${PHONE}`,
    },
  };
}

/** 2. Staff confirmed availability. */
export function availabilityConfirmed(o: OrderMessageInput): MessagePreview {
  return {
    sms:
      `${SHOP}: good news — your tires for ${o.orderNumber} are confirmed available. ` +
      `We'll order them and let you know when they arrive. ${PHONE}`,
    email: {
      subject: `Tires confirmed — ${o.orderNumber}`,
      body:
        `Hi ${o.customerName},\n\n` +
        `Staff confirmed availability for ${tireLine(o)} (order ${o.orderNumber}). ` +
        `We're ordering them from our supplier and will contact you when they arrive at the shop.\n\n` +
        `${SHOP} · ${ADDRESS} · ${PHONE}`,
    },
  };
}

/** 3. Payment received (after Stripe confirms — never before). */
export function paymentReceived(o: OrderMessageInput): MessagePreview {
  const amt = o.totalAmount != null ? ` of $${o.totalAmount.toFixed(2)}` : "";
  return {
    sms:
      `${SHOP}: payment${amt} received for ${o.orderNumber}. ` +
      `Staff still confirms availability and fitment before install. ${PHONE}`,
    email: {
      subject: `Payment received — ${o.orderNumber}`,
      body:
        `Hi ${o.customerName},\n\n` +
        `We received your payment${amt} for order ${o.orderNumber} (${tireLine(o)}).\n\n` +
        `Paying online does not reserve supplier stock — staff confirms availability ` +
        `and fitment with you before install. We'll be in touch.\n\n` +
        `${SHOP} · ${ADDRESS} · ${PHONE}`,
    },
  };
}

/** 4. Tires arrived / ready to schedule install. */
export function orderReady(o: OrderMessageInput): MessagePreview {
  return {
    sms:
      `${SHOP}: your tires for ${o.orderNumber} arrived! Walk in any open hours or call ${PHONE} ` +
      `to set a time. Drop-offs worked first come, first serve.`,
    email: {
      subject: `Your tires arrived — ${o.orderNumber}`,
      body:
        `Hi ${o.customerName},\n\n` +
        `${tireLine(o)} arrived at the shop for order ${o.orderNumber}. ` +
        `Walk in any time we're open, or call ${PHONE} to plan your visit — ` +
        `drop-offs are worked first come, first serve.\n\n` +
        `${SHOP} · ${ADDRESS} · ${PHONE}`,
    },
  };
}

/** 5. No-results manual lookup received (uncommon size path). */
export function manualLookupReceived(o: OrderMessageInput): MessagePreview {
  return {
    sms:
      `${SHOP}: we got your request for ${o.tireSize} — that size needs a manual supplier lookup. ` +
      `We'll call you with options and pricing. ${PHONE}`,
    email: {
      subject: `We're looking up your tire size — ${o.orderNumber}`,
      body:
        `Hi ${o.customerName},\n\n` +
        `${o.tireSize} isn't in our common stock, so we're checking our supplier by hand. ` +
        `We'll call you with real options and pricing — nothing is ordered or charged yet.\n\n` +
        `${SHOP} · ${ADDRESS} · ${PHONE}`,
    },
  };
}

export const TEMPLATE_BUILDERS = {
  requestReceived,
  availabilityConfirmed,
  paymentReceived,
  orderReady,
  manualLookupReceived,
} as const;

export type TemplateKey = keyof typeof TEMPLATE_BUILDERS;

/**
 * THE SEND PATH DOES NOT EXIST. This function always throws, regardless
 * of arguments or environment. Real sending requires a dedicated PR
 * (provider choice, cost approval, opt-out handling, throttles) that
 * the owner has explicitly approved — by design there is no flag that
 * can switch this on.
 */
export function sendCustomerMessage(): never {
  throw new Error(
    "Customer message sending is disabled by design (preview-only module). " +
    "Enabling sends requires a dedicated owner-approved PR — see " +
    "docs/customer-confirmation-notifications.md",
  );
}
