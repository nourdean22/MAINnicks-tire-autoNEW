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
    log.error("Payment intent creation failed:", msg);
    return { error: `Payment setup failed: ${msg}` };
  }
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
  } catch {
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
