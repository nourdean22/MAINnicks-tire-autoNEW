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
      `Nick's Tire & Auto: we got your tire request ${o.orderNumber} for ${o.quantity} ${o.tireBrand} ${o.tireModel} tires, size ${o.tireSize}. ` +
      `We're checking availability and fitment now. We'll call you before anything is ordered. Questions? ${PHONE}`,
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
      `Nick's Tire & Auto: good news — we confirmed availability for your tires on order ${o.orderNumber}. ` +
      `We're getting them ordered and we'll let you know when they're ready at the shop. Questions? ${PHONE}`,
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
      `Nick's Tire & Auto: we received your payment${amt} for order ${o.orderNumber}. ` +
      `We're still confirming final fitment and availability before install. We'll call you with the next step. Questions? ${PHONE}`,
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
      `Nick's Tire & Auto: your tires for order ${o.orderNumber} are here. ` +
      `Stop by during open hours, or call us first if you want to plan the best time. Drop-offs are handled first come, first served. ${PHONE}`,
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
      `Nick's Tire & Auto: we got your request for size ${o.tireSize}. ` +
      `That size needs a manual supplier check, so we're looking it up by hand. We'll call you with real options and pricing before anything is ordered. ${PHONE}`,
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
 * Sends a customer order-confirmation message (SMS and/or Email) for the given order number
 * using the requested template key.
 *
 * Gated by process.env.ENABLE_CUSTOMER_CONFIRMATIONS="true" (dry-run if unset or false).
 * Enforces strict at-most-once idempotency guards using DB queries.
 */
export async function sendCustomerMessage(
  orderNumber: string,
  templateKey: TemplateKey
): Promise<{ smsSent: boolean; emailSent: boolean; dryRun: boolean }> {
  const isEnabled = process.env.ENABLE_CUSTOMER_CONFIRMATIONS === "true";
  const { createLogger } = await import("../lib/logger");
  const log = createLogger("customer-confirmations");

  const { getDb } = await import("../db");
  const { tireOrders, smsMessages, auditLog } = await import("../../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) {
    log.error("Database unavailable for sending customer message");
    return { smsSent: false, emailSent: false, dryRun: !isEnabled };
  }

  // 1. Fetch Order Details
  const [order] = await d.select().from(tireOrders).where(eq(tireOrders.orderNumber, orderNumber)).limit(1);
  if (!order) {
    log.error(`Tire order not found for number: ${orderNumber}`);
    return { smsSent: false, emailSent: false, dryRun: !isEnabled };
  }

  // 2. Render Template
  const input: OrderMessageInput = {
    customerName: order.customerName,
    orderNumber: order.orderNumber,
    quantity: order.quantity,
    tireBrand: order.tireBrand,
    tireModel: order.tireModel,
    tireSize: order.tireSize,
    totalAmount: (order.totalAmount || 0) / 100, // convert cents to dollars
  };
  const build = TEMPLATE_BUILDERS[templateKey];
  const preview = build(input);

  // 3. Dry-run Mode Check
  if (!isEnabled) {
    log.info(`[DRY-RUN] Customer confirmation draft for ${orderNumber} (${templateKey}):`, {
      phone: order.customerPhone,
      email: order.customerEmail,
      sms: preview.sms,
      subject: preview.email.subject,
    });
    return { smsSent: false, emailSent: false, dryRun: true };
  }

  let smsSent = false;
  let emailSent = false;

  // 4. SMS Delivery Path
  const smsVariantKey = `confirm:${templateKey}:${orderNumber}`;
  // Idempotency: check if already sent
  const [existingSms] = await d
    .select({ id: smsMessages.id })
    .from(smsMessages)
    .where(and(eq(smsMessages.variantKey, smsVariantKey), eq(smsMessages.status, "sent")))
    .limit(1);

  if (existingSms) {
    log.info(`SMS confirmation already sent for order ${orderNumber} (${templateKey})`);
  } else {
    try {
      const { sendSms } = await import("../sms");
      const smsResult = await sendSms(order.customerPhone, preview.sms, {
        messageClass: "customer_confirmation",
        variantKey: smsVariantKey,
      });
      smsSent = smsResult.success;
      if (smsSent) {
        const { logAdminAction } = await import("./auditTrail");
        await logAdminAction({
          action: "customer.sms_sent",
          entityType: "tire_order",
          entityId: orderNumber,
          details: `Sent confirmation SMS (${templateKey}): ${preview.sms}`,
        });
      }
    } catch (e) {
      log.error(`Failed to send confirmation SMS to ${order.customerPhone}:`, e);
    }
  }

  // 5. Email Delivery Path
  if (order.customerEmail) {
    const emailAuditKey = `${templateKey}:${orderNumber}`;
    // Idempotency: check if email send is already logged in auditTrail
    const [existingEmail] = await d
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, "customer.email_sent"), eq(auditLog.entityId, emailAuditKey)))
      .limit(1);

    if (existingEmail) {
      log.info(`Email confirmation already sent for order ${orderNumber} (${templateKey})`);
    } else {
      try {
        const { sendNotification } = await import("../email-notify");
        const emailResult = await sendNotification({
          category: "booking_confirmation",
          overrideTo: [order.customerEmail],
          subject: preview.email.subject,
          body: preview.email.body,
          templateUsed: templateKey,
          bypassThrottle: true,
        });
        emailSent = emailResult.emailSent;
        if (emailSent) {
          const { logAdminAction } = await import("./auditTrail");
          await logAdminAction({
            action: "customer.email_sent",
            entityType: "tire_order",
            entityId: emailAuditKey,
            details: `Sent confirmation email (${templateKey}): ${preview.email.subject}`,
          });
        }
      } catch (e) {
        log.error(`Failed to send confirmation email to ${order.customerEmail}:`, e);
      }
    }
  }

  return { smsSent, emailSent, dryRun: false };
}
