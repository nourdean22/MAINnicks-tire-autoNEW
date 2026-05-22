/**
 * Payment Service — Stripe + Snap Finance Integration
 *
 * Handles:
 * 1. Stripe Payment Intents for direct CC payments
 * 2. Invoice payment processing
 * 3. Payment status tracking
 *
 * Snap Finance flow:
 *   Customer applies → Snap issues virtual CC → customer enters CC here → Stripe processes it
 *   (Snap virtual cards work like regular credit cards through Stripe)
 */

import { createLogger } from "../lib/logger";

const log = createLogger("payments");

let stripeInstance: any = null;

async function getStripe() {
  if (stripeInstance) return stripeInstance;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const { default: Stripe } = await import("stripe");
  stripeInstance = new Stripe(key);
  return stripeInstance;
}

/**
 * Create a Stripe Payment Intent for an invoice
 */
export async function createPaymentIntent(params: {
  amountCents: number;
  invoiceNumber: string;
  customerName: string;
  customerEmail?: string;
  description: string;
}): Promise<{ clientSecret: string; paymentIntentId: string } | { error: string }> {
  const stripe = await getStripe();
  if (!stripe) {
    return { error: "Payment processing not configured. Please call (216) 862-0005 to pay." };
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount: params.amountCents,
      currency: "usd",
      metadata: {
        invoiceNumber: params.invoiceNumber,
        customerName: params.customerName,
        source: "nickstire.org",
      },
      description: params.description,
      receipt_email: params.customerEmail,
      automatic_payment_methods: { enabled: true },
    });

    log.info(`Payment intent created: ${intent.id} for ${params.invoiceNumber} — $${(params.amountCents / 100).toFixed(2)}`);

    return {
      clientSecret: intent.client_secret!,
      paymentIntentId: intent.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Payment intent creation failed:", { error: msg });
    return { error: `Payment setup failed: ${msg}` };
  }
}

/**
 * Create a Stripe Checkout Session (hosted payment page) for a tire order.
 *
 * The customer is redirected to Stripe's own checkout page — card details
 * are entered there and never touch nickstire's servers. On success Stripe
 * fires `checkout.session.completed` (handled in the webhook), which marks
 * the invoice + tire order paid and triggers the shop hand-off emails.
 */
export async function createTireOrderCheckout(params: {
  lineItems: Array<{ name: string; amountCents: number }>;
  tireOrderNumber: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail?: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string } | { error: string }> {
  const stripe = await getStripe();
  if (!stripe) {
    return { error: "Payment processing not configured. Please call (216) 862-0005 to pay." };
  }

  // Stripe metadata values must be strings — mirror this onto both the
  // Checkout Session and its PaymentIntent so either webhook event resolves.
  const metadata = {
    tireOrderNumber: params.tireOrderNumber,
    invoiceNumber: params.invoiceNumber,
    customerName: params.customerName,
    source: "nickstire.org",
  };

  // Each charge component (tires, sales tax, card fee) is its own Stripe
  // line item so the customer sees a fully itemised breakdown at checkout.
  const lineItems = params.lineItems
    .filter((li) => li.amountCents > 0)
    .map((li) => ({
      quantity: 1,
      price_data: {
        currency: "usd" as const,
        unit_amount: li.amountCents,
        product_data: { name: li.name },
      },
    }));
  const totalCents = params.lineItems.reduce((sum, li) => sum + li.amountCents, 0);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      customer_email: params.customerEmail || undefined,
      client_reference_id: params.tireOrderNumber,
      metadata,
      payment_intent_data: { metadata, description: params.description },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });

    if (!session.url) return { error: "Payment setup failed — Stripe returned no checkout URL." };

    log.info(`Checkout session ${session.id} created for tire order ${params.tireOrderNumber} — $${(totalCents / 100).toFixed(2)}`);
    return { url: session.url, sessionId: session.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Checkout session creation failed:", { error: msg });
    return { error: `Payment setup failed: ${msg}` };
  }
}

/**
 * Finalise a paid tire order — idempotent. Called from the Stripe webhook
 * on BOTH checkout.session.completed and payment_intent.succeeded, so the
 * order completes regardless of which events the endpoint is subscribed
 * to. Marks the order + invoice paid and fires the shop hand-off.
 */
export async function finalizeTireOrderPayment(params: {
  tireOrderNumber: string;
  invoiceNumber?: string;
  amountCents: number;
}): Promise<void> {
  const { getDb } = await import("../db");
  const { tireOrders, invoices } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) return;

  const [order] = await d.select().from(tireOrders)
    .where(eq(tireOrders.orderNumber, params.tireOrderNumber)).limit(1);
  // Idempotent — Stripe can redeliver webhooks, and both events fire for
  // a single Checkout Session.
  if (!order || order.paymentStatus === "paid") return;

  await d.update(tireOrders).set({
    paymentStatus: "paid",
    paidAt: new Date(),
    status: order.status === "received" ? "confirmed" : order.status,
  }).where(eq(tireOrders.orderNumber, params.tireOrderNumber));

  const invNum = params.invoiceNumber || order.invoiceNumber || undefined;
  if (invNum) {
    await d.update(invoices).set({ paymentStatus: "paid", paymentMethod: "card" })
      .where(eq(invoices.invoiceNumber, invNum));
  }

  const amountPaid = params.amountCents / 100;
  log.info(`Tire order ${params.tireOrderNumber} marked PAID — $${amountPaid.toFixed(2)}`);

  // Shop hand-off — ShopDriver entry + Gateway order email to the shop.
  import("../email-notify").then(({ notifyTireOrderPaid }) =>
    notifyTireOrderPaid({
      orderNumber: order.orderNumber,
      invoiceNumber: invNum,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail || undefined,
      vehicleInfo: order.vehicleInfo || undefined,
      tireBrand: order.tireBrand,
      tireModel: order.tireModel,
      tireSize: order.tireSize,
      quantity: order.quantity,
      amountPaid,
      customerNotes: order.customerNotes || undefined,
    })
  ).catch((e) => log.warn("tire-order paid email failed:", e));

  import("./telegram").then(({ sendTelegram }) =>
    sendTelegram(
      `TIRE ORDER PAID — ${params.tireOrderNumber}\n` +
      `${order.quantity}x ${order.tireBrand} ${order.tireModel} (${order.tireSize})\n` +
      `${order.customerName} · ${order.customerPhone}\n` +
      `$${amountPaid.toFixed(2)} paid online\n\n` +
      `Check moeseuclid@gmail.com — enter in ShopDriver + order from Gateway.`
    )
  ).catch((e) => log.warn("tire-order paid telegram failed:", e));
}

/**
 * Confirm a payment was completed (webhook or polling)
 */
export async function getPaymentStatus(paymentIntentId: string): Promise<{
  status: "succeeded" | "processing" | "requires_payment_method" | "requires_action" | "canceled" | "unknown";
  amountReceived: number;
}> {
  const stripe = await getStripe();
  if (!stripe) return { status: "unknown", amountReceived: 0 };

  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      status: intent.status as any,
      amountReceived: intent.amount_received || 0,
    };
  } catch (e) {
    log.warn("[services/payments] operation failed:", e);
    return { status: "unknown", amountReceived: 0 };
  }
}

/**
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Get the publishable key for the client
 */
export function getStripePublishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || null;
}
