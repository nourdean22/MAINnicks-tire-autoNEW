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
 * Nonstop Nick plan registry. Two tiers (2026-05-30):
 *   - "nonstop-nick" ($7.99/mo) — peace-of-mind quick-tire membership (breakage).
 *   - "nonstop-nick-plus" ($9.99/mo) — everything in $7.99 PLUS 15% off any repair
 *     (parts + labor), applied manually by the counter from the lookup card.
 * Each maps to a Stripe Price created in the dashboard + supplied via env. A plan
 * with no env price stays dormant (Join degrades to call/walk-in) — so the $9.99
 * tier can ship in code before its Stripe Price exists.
 */
export const MEMBERSHIP_PLANS = {
  "nonstop-nick": { label: "Nonstop Nick", priceEnv: "STRIPE_NONSTOP_NICK_PRICE_ID" },
  "nonstop-nick-plus": { label: "Nonstop Nick+", priceEnv: "STRIPE_NONSTOP_NICK_PLUS_PRICE_ID" },
} as const;
export type MembershipPlan = keyof typeof MEMBERSHIP_PLANS;

/**
 * Create a Stripe Checkout Session for a Nonstop Nick membership tier.
 *
 * mode: "subscription" — recurring billing, needs a Stripe PRICE object created
 * in the dashboard and supplied via the plan's price env var (see MEMBERSHIP_PLANS).
 * Until that env is set the function returns the call-us fallback, so the page's
 * Join button degrades honestly rather than erroring.
 *
 * On success Stripe fires checkout.session.completed + customer.subscription.created
 * (handled by the Stripe webhook), which inserts/activates the memberships row with
 * the chosen plan. Phone is carried as metadata so the webhook binds the right person.
 */
export async function createMembershipCheckout(params: {
  plan?: MembershipPlan;
  phone: string;
  customerEmail?: string;
  customerName?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string } | { error: string }> {
  const stripe = await getStripe();
  if (!stripe) {
    return { error: "Membership signup isn't online yet — call or text (216) 862-0005, or ask at the counter." };
  }
  const plan: MembershipPlan = params.plan && params.plan in MEMBERSHIP_PLANS ? params.plan : "nonstop-nick";
  const priceId = process.env[MEMBERSHIP_PLANS[plan].priceEnv];
  if (!priceId) {
    // Price object not created yet — degrade honestly to the in-person path.
    return { error: "Membership signup isn't online yet — call or text (216) 862-0005, or ask at the counter." };
  }

  // Phone is the counter's lookup key — carry it (+ the plan) on both the session
  // and the subscription so the webhook can bind the membership row to it.
  const metadata = {
    plan,
    phone: params.phone,
    customerName: params.customerName || "",
    source: "nickstire.org",
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: params.customerEmail || undefined,
      client_reference_id: params.phone,
      metadata,
      subscription_data: { metadata },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      allow_promotion_codes: true,
    });

    if (!session.url) return { error: "Membership signup failed — Stripe returned no checkout URL." };

    log.info(`Nonstop Nick checkout ${session.id} created for ${params.phone}`);
    return { url: session.url, sessionId: session.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Membership checkout creation failed:", { error: msg });
    return { error: `Membership signup failed: ${msg}` };
  }
}

/**
 * Retrieve a Stripe Checkout Session's payment status. Used by the
 * confirm-on-return fallback (gatewayTire.confirmCheckout) so a paid
 * order is never stuck "unpaid" if the webhook is slow or misconfigured.
 */
export async function getCheckoutSessionStatus(sessionId: string): Promise<{
  paid: boolean;
  amountTotalCents: number;
  status: string | null;
  url: string | null;
}> {
  const stripe = await getStripe();
  if (!stripe) return { paid: false, amountTotalCents: 0, status: null, url: null };
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return {
      paid: session.payment_status === "paid",
      amountTotalCents: session.amount_total || 0,
      status: session.status || null,
      url: session.url || null,
    };
  } catch (err) {
    log.warn("Checkout session retrieve failed:", err);
    return { paid: false, amountTotalCents: 0, status: null, url: null };
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
  const { eq, sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) return;

  const [order] = await d.select().from(tireOrders)
    .where(eq(tireOrders.orderNumber, params.tireOrderNumber)).limit(1);
  if (!order || order.paymentStatus === "paid") return; // fast path

  // Atomic claim. finalizeTireOrderPayment runs up to 3x per payment
  // (checkout.session.completed + payment_intent.succeeded webhooks +
  // confirmCheckout). A SELECT-then-UPDATE check is a TOCTOU race that
  // lets all three fire the shop hand-off. This conditional UPDATE is the
  // real guard — only the caller that flips the row proceeds; the rest
  // bail. Matches the claim pattern in cron/jobs/crudAutomation.ts.
  const [claim] = await d.execute(sql`
    UPDATE tire_orders
    SET paymentStatus = 'paid',
        paidAt = NOW(),
        status = CASE WHEN status = 'received' THEN 'confirmed' ELSE status END
    WHERE orderNumber = ${params.tireOrderNumber} AND paymentStatus <> 'paid'
  `);
  if (((claim as unknown as { affectedRows?: number }).affectedRows ?? 0) === 0) {
    return; // another concurrent caller already claimed + handled this order
  }

  const invNum = params.invoiceNumber || order.invoiceNumber || undefined;
  if (invNum) {
    // Align the invoice total to what Stripe actually collected (tires +
    // tax + card fee) — the placement-time invoice didn't know the fee.
    await d.update(invoices)
      .set({ paymentStatus: "paid", paymentMethod: "card", totalAmount: params.amountCents })
      .where(eq(invoices.invoiceNumber, invNum));
  }

  const amountPaid = params.amountCents / 100;
  log.info(`Tire order ${params.tireOrderNumber} marked PAID — $${amountPaid.toFixed(2)}`);

  // Trigger customer confirmation messaging asynchronously
  import("./customerMessageTemplates").then(({ sendCustomerMessage }) =>
    sendCustomerMessage(order.orderNumber, "paymentReceived")
  ).catch(e => log.warn("[payments:paid-notify] customer message failed:", e));

  // Shop hand-off email — awaited + checked. This is load-bearing (no
  // admin UI for these orders), so a delivery failure is a loud error,
  // never a silent warn. notifyTireOrderPaid bypasses the notification
  // throttle so a burst of orders can't drop it.
  //
  // 2026-05-23 · track both channels' success states and, if BOTH fail,
  // write a payment_alert_backlog row so the operator can surface this
  // paid-but-unfulfillable order on the Today dashboard.
  let emailSent = false;
  let telegramSent = false;
  try {
    const { notifyTireOrderPaid } = await import("../email-notify");
    const res = await notifyTireOrderPaid({
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
    });
    if (!res || !res.emailSent) {
      log.error(`Tire order ${params.tireOrderNumber} is PAID but the shop hand-off email did NOT send — fulfil it manually`, { throttled: res?.throttled ?? false });
    } else {
      emailSent = true;
    }
  } catch (e) {
    log.error(`Tire order ${params.tireOrderNumber} is PAID but the shop hand-off email threw — fulfil it manually:`, e);
  }

  try {
    const { sendTelegram } = await import("./telegram");
    await sendTelegram(
      `TIRE ORDER PAID — ${params.tireOrderNumber}\n` +
      `${order.quantity}x ${order.tireBrand} ${order.tireModel} (${order.tireSize})\n` +
      `${order.customerName} · ${order.customerPhone}\n` +
      `$${amountPaid.toFixed(2)} paid online\n\n` +
      `Check moeseuclid@gmail.com — enter in ShopDriver + order from Gateway.`
    );
    telegramSent = true;
  } catch (e) {
    log.warn("tire-order paid telegram failed:", e);
  }

  // Dual-fail recovery surface. If BOTH channels failed, the operator
  // currently has no signal a paid tire order exists in the DB. Write
  // a backlog row so the Today dashboard can render an alert.
  if (!emailSent || !telegramSent) {
    try {
      const { paymentAlertBacklog } = await import("../../drizzle/schema");
      const reason = !emailSent && !telegramSent
        ? "both_failed"
        : !emailSent ? "email_failed" : "telegram_failed";
      await d.insert(paymentAlertBacklog).values({
        tireOrderNumber: params.tireOrderNumber,
        invoiceNumber: invNum || null,
        amountCents: params.amountCents,
        summary: `${order.quantity}x ${order.tireBrand} ${order.tireModel} (${order.tireSize}) · ${order.customerName} · ${order.customerPhone} · $${amountPaid.toFixed(2)}`,
        failureReason: reason,
      });
      log.warn(`payment_alert_backlog row written for ${params.tireOrderNumber} (${reason})`);
    } catch (e) {
      log.error(`CRITICAL: failed to write payment_alert_backlog for ${params.tireOrderNumber} — order is paid but no recovery signal:`, e);
    }
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

/**
 * Pure classification of the Stripe env wiring — booleans only, never
 * key material. `halfConfigured` is the dangerous state: charges succeed
 * at Stripe but webhook events are signature-rejected (the handler
 * returns 500 so they pile up in Stripe's retry queue) — paid orders
 * then depend entirely on the customer's return-page confirm.
 *
 * 2026-06-10 checkout-protection wave. Before this, half-configuration
 * was only a runtime log line inside the webhook handler — visible to
 * nobody. payments.health + the admin Tire Orders tab surface it.
 */
export function classifyStripeHealth(env: {
  secretKey?: string | null;
  webhookSecret?: string | null;
  publishableKey?: string | null;
}): {
  secretKeySet: boolean;
  webhookSecretSet: boolean;
  publishableKeySet: boolean;
  halfConfigured: boolean;
  fullyConfigured: boolean;
} {
  const secretKeySet = !!env.secretKey;
  const webhookSecretSet = !!env.webhookSecret;
  const publishableKeySet = !!env.publishableKey;
  return {
    secretKeySet,
    webhookSecretSet,
    publishableKeySet,
    halfConfigured: secretKeySet && !webhookSecretSet,
    fullyConfigured: secretKeySet && webhookSecretSet && publishableKeySet,
  };
}

/** classifyStripeHealth over the live process env. */
export function getStripeHealth() {
  return classifyStripeHealth({
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    publishableKey: getStripePublishableKey(),
  });
}

/**
 * Refund a paid tire order.
 * Idempotent: passes an idempotency key to Stripe based on the order number.
 * Updates paymentStatus to 'refunded' in both tire_orders and invoices tables,
 * and appends an admin note about the refund.
 */
export async function refundTireOrderPayment(params: {
  orderNumber: string;
  reason: string;
  actorEmail: string;
}): Promise<{ success: boolean; error?: string; refundId?: string }> {
  const { getDb } = await import("../db");
  const { tireOrders, invoices } = await import("../../drizzle/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { logAdminAction } = await import("./auditTrail");

  const d = await getDb();
  if (!d) return { success: false, error: "Database unavailable" };

  // 1. Look up the order
  const [order] = await d.select().from(tireOrders)
    .where(eq(tireOrders.orderNumber, params.orderNumber)).limit(1);

  if (!order) {
    return { success: false, error: `Order ${params.orderNumber} not found` };
  }

  if (order.paymentStatus === "refunded") {
    return { success: true }; // Already refunded (idempotent success)
  }

  if (order.paymentStatus !== "paid") {
    return { success: false, error: `Order ${params.orderNumber} is not paid (status: ${order.paymentStatus})` };
  }

  if (!order.stripeSessionId) {
    return { success: false, error: `No Stripe session ID associated with order ${params.orderNumber}` };
  }

  const stripe = await getStripe();
  if (!stripe) {
    return { success: false, error: "Stripe is not configured" };
  }

  let refundId = "";
  try {
    // 2. Retrieve checkout session to get PaymentIntent ID
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent as any)?.id;

    if (!paymentIntentId) {
      throw new Error("No payment intent found for this order session");
    }

    // 3. Create the Stripe refund with idempotency key
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
      metadata: {
        orderNumber: order.orderNumber,
        refundReason: params.reason,
        actor: params.actorEmail,
      }
    }, {
      idempotencyKey: `refund-${order.orderNumber}`,
    });

    refundId = refund.id;

    // 4. Update the database atomically
    const [claim] = await d.execute(sql`
      UPDATE tire_orders
      SET paymentStatus = 'refunded',
          updatedAt = NOW()
      WHERE orderNumber = ${order.orderNumber} AND paymentStatus = 'paid'
    `);

    // Only append note if the claim succeeded (meaning this invocation flipped it)
    if (((claim as unknown as { affectedRows?: number }).affectedRows ?? 0) > 0) {
      const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      const newNote = `[Refund - ${timestamp} by ${params.actorEmail}] Reason: ${params.reason}. Stripe Refund: ${refund.id}`;
      const updatedNotes = order.adminNotes
        ? `${order.adminNotes}\n\n${newNote}`
        : newNote;

      await d.update(tireOrders)
        .set({ adminNotes: updatedNotes })
        .where(eq(tireOrders.orderNumber, order.orderNumber));

      if (order.invoiceNumber) {
        await d.update(invoices)
          .set({ paymentStatus: "refunded" })
          .where(eq(invoices.invoiceNumber, order.invoiceNumber));
      }
    }

    // 5. Log the action
    await logAdminAction({
      action: "tireorder.refunded" as any,
      entityType: "tire_orders",
      entityId: order.id,
      details: `Refunded $${(order.totalAmount / 100).toFixed(2)} for order ${order.orderNumber}. Reason: ${params.reason}. Stripe Refund: ${refund.id}`,
      actor: params.actorEmail,
      previousValue: "paid",
      newValue: "refunded",
      metadata: {
        stripeRefundId: refund.id,
        amountCents: order.totalAmount,
        reason: params.reason,
      }
    });

    log.info(`Tire order ${params.orderNumber} refunded successfully — $${(order.totalAmount / 100).toFixed(2)}`);
    return { success: true, refundId };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`Refund failed for order ${params.orderNumber}:`, err);

    await logAdminAction({
      action: "tireorder.refund_failed" as any,
      entityType: "tire_orders",
      entityId: order.id,
      details: `Refund failed for order ${order.orderNumber}. Reason: ${params.reason}. Error: ${errorMsg}`,
      actor: params.actorEmail,
      previousValue: "paid",
      newValue: "paid",
      metadata: {
        error: errorMsg,
        amountCents: order.totalAmount,
        reason: params.reason,
      }
    });

    return { success: false, error: errorMsg };
  }
}
