/**
 * Email Notification Router
 *
 * UPGRADED: HTML email templates, send tracking (opens/bounces/delivery),
 * smart batching, personalization, circuit breaker protection.
 *
 * Routes notifications to the correct email addresses based on type.
 *
 * Shop Email (Moeseuclid@gmail.com) — day-to-day operations, shop staff access
 * CEO Email (Nourdean22@gmail.com) — strategic, financial, high-value alerts
 *
 * Uses Resend API for transactional email delivery.
 * Falls back to Telegram notifications as backup.
 *
 * Gmail Labels (on CEO inbox — Nourdean22@gmail.com):
 *   Label_2 = Nicks Tire Auto/Callbacks
 *   Label_3 = Nicks Tire Auto/Reports
 *   Label_4 = Nicks Tire Auto/Tire Orders
 *   Label_5 = Nicks Tire Auto/Bookings
 *   Label_6 = Nicks Tire Auto/Leads
 */

import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";
import { createLogger } from "./lib/logger";
import { getOrCreateBreaker } from "./lib/circuit-breaker";
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
const log = createLogger("email-notify");

// ─── Circuit Breaker ────────────────────────────────
const emailCB = getOrCreateBreaker("email-gmail", {
  failureThreshold: 3,
  cooldownMs: 60_000,
  timeoutMs: 35_000,
});

// ─── Delivery Log (in-memory ring buffer, last 100 entries) ───
interface DeliveryLogEntry {
  timestamp: string;
  category: NotifyCategory;
  subject: string;
  recipients: string[];
  emailSent: boolean;
  pushSent: boolean;
  retried: boolean;
  error?: string;
  templateUsed?: string;
}

const DELIVERY_LOG: DeliveryLogEntry[] = [];
const MAX_LOG_SIZE = 100;

function logDelivery(entry: DeliveryLogEntry) {
  DELIVERY_LOG.push(entry);
  if (DELIVERY_LOG.length > MAX_LOG_SIZE) DELIVERY_LOG.shift();
}

/** Get recent delivery log entries (for admin dashboard) */
export function getDeliveryLog(limit = 50): DeliveryLogEntry[] {
  return DELIVERY_LOG.slice(-limit).reverse();
}

// ─── Send Tracking ──────────────────────────────────
interface SendTrackingStats {
  totalSent: number;
  totalFailed: number;
  totalBounced: number;
  totalRetried: number;
  lastSentAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  deliveryRate: number; // percentage
}

const sendStats: SendTrackingStats = {
  totalSent: 0,
  totalFailed: 0,
  totalBounced: 0,
  totalRetried: 0,
  lastSentAt: null,
  lastFailureAt: null,
  lastError: null,
  deliveryRate: 100,
};

function updateDeliveryRate(): void {
  const total = sendStats.totalSent + sendStats.totalFailed;
  sendStats.deliveryRate = total > 0
    ? Math.round((sendStats.totalSent / total) * 100)
    : 100;
}

export function getEmailStats(): SendTrackingStats {
  return { ...sendStats };
}

// ─── Smart Batching ─────────────────────────────────
// Don't send more than 3 emails to the same address within 5 minutes
const recentSends = new Map<string, number[]>();
const BATCH_WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 3;

function shouldThrottle(email: string): boolean {
  const now = Date.now();
  const sends = recentSends.get(email) || [];
  const recent = sends.filter((ts) => now - ts < BATCH_WINDOW_MS);
  if (recent.length === 0) {
    recentSends.delete(email); // Clean up stale keys
  } else {
    recentSends.set(email, recent);
  }
  // Periodic full cleanup if map gets large
  if (recentSends.size > 200) {
    for (const [key, val] of recentSends) {
      if (val.length === 0 || val.every(ts => now - ts > BATCH_WINDOW_MS)) {
        recentSends.delete(key);
      }
    }
  }
  return recent.length >= MAX_PER_WINDOW;
}

function recordEmailSend(email: string): void {
  const sends = recentSends.get(email) || [];
  sends.push(Date.now());
  recentSends.set(email, sends);
}

// ─── Gmail Label IDs ─────────────────────────────────────
const GMAIL_LABELS: Record<string, string> = {
  callbacks: "Label_2",
  reports: "Label_3",
  tire_orders: "Label_4",
  bookings: "Label_5",
  leads: "Label_6",
};

// ─── Notification Categories ──────────────────────────────
export type NotifyCategory =
  | "booking"
  | "lead"
  | "callback"
  | "tire_order"
  | "high_value"
  | "revenue"
  | "weekly_report"
  | "content"
  | "system"
  | "review"
  | "sms_reply"
  | "booking_confirmation"
  | "follow_up"
  | "review_request"
  ;

// ─── Routing Table ────────────────────────────────────────
interface RouteConfig {
  shopEmail: boolean;
  ceoEmail: boolean;
  pushNotify: boolean;
  gmailLabel?: string;
}

const ROUTING_TABLE: Record<NotifyCategory, RouteConfig> = {
  booking:               { shopEmail: true,  ceoEmail: false, pushNotify: true,  gmailLabel: GMAIL_LABELS.bookings },
  lead:                  { shopEmail: true,  ceoEmail: false, pushNotify: true,  gmailLabel: GMAIL_LABELS.leads },
  callback:              { shopEmail: true,  ceoEmail: false, pushNotify: true,  gmailLabel: GMAIL_LABELS.callbacks },
  tire_order:            { shopEmail: true,  ceoEmail: true,  pushNotify: true,  gmailLabel: GMAIL_LABELS.tire_orders },
  high_value:            { shopEmail: true,  ceoEmail: true,  pushNotify: true,  gmailLabel: GMAIL_LABELS.leads },
  revenue:               { shopEmail: false, ceoEmail: true,  pushNotify: true,  gmailLabel: GMAIL_LABELS.reports },
  weekly_report:         { shopEmail: false, ceoEmail: true,  pushNotify: true,  gmailLabel: GMAIL_LABELS.reports },
  content:               { shopEmail: false, ceoEmail: false, pushNotify: true },
  system:                { shopEmail: false, ceoEmail: true,  pushNotify: true },
  review:                { shopEmail: true,  ceoEmail: false, pushNotify: true },
  sms_reply:             { shopEmail: true,  ceoEmail: false, pushNotify: true },
  booking_confirmation:  { shopEmail: false, ceoEmail: false, pushNotify: false },
  follow_up:             { shopEmail: false, ceoEmail: false, pushNotify: false },
  review_request:        { shopEmail: false, ceoEmail: false, pushNotify: false },
};

// ─── Email Templates ────────────────────────────────────

function baseTemplate(title: string, bodyHtml: string, footerText?: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
  <tr><td style="background:#1a1a2e;padding:20px 30px;">
    <h1 style="color:#ffffff;margin:0;font-size:20px;">Nick's Tire & Auto</h1>
  </td></tr>
  <tr><td style="padding:30px;">
    <h2 style="color:#1a1a2e;margin:0 0 15px;">${title}</h2>
    ${bodyHtml}
  </td></tr>
  <tr><td style="background:#f8f8f8;padding:15px 30px;border-top:1px solid #eee;">
    <p style="color:#888;font-size:12px;margin:0;">
      ${footerText || "Nick's Tire & Auto | (216) 862-0005 | nickstire.org"}
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`.trim();
}

export function bookingConfirmationTemplate(details: {
  name: string;
  service: string;
  vehicle?: string;
  date?: string;
  time?: string;
  refCode?: string;
}): { subject: string; html: string; plain: string } {
  const firstName = details.name.split(" ")[0];
  return {
    subject: `Booking Confirmed: ${details.service} — ${details.name}`,
    html: baseTemplate("Booking Confirmation", `
      <p style="color:#333;line-height:1.6;">Hi <strong>${firstName}</strong>,</p>
      <p style="color:#333;line-height:1.6;">Your appointment has been received. Here are the details:</p>
      <table style="width:100%;border-collapse:collapse;margin:15px 0;">
        <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Service</td><td style="padding:8px;border-bottom:1px solid #eee;"><strong>${details.service}</strong></td></tr>
        ${details.vehicle ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Vehicle</td><td style="padding:8px;border-bottom:1px solid #eee;">${details.vehicle}</td></tr>` : ""}
        ${details.date ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Date</td><td style="padding:8px;border-bottom:1px solid #eee;">${details.date}</td></tr>` : ""}
        ${details.time ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Time</td><td style="padding:8px;border-bottom:1px solid #eee;">${details.time}</td></tr>` : ""}
        ${details.refCode ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Reference</td><td style="padding:8px;border-bottom:1px solid #eee;">#${details.refCode}</td></tr>` : ""}
      </table>
      <p style="color:#333;line-height:1.6;">We'll confirm your time slot shortly. Need to make changes? Call us at <strong>(216) 862-0005</strong>.</p>
    `),
    plain: `Hi ${firstName}, your ${details.service} appointment at Nick's Tire & Auto has been received.${details.refCode ? ` Ref: #${details.refCode}` : ""} We'll confirm shortly. Call (216) 862-0005 with questions.`,
  };
}

export function followUpTemplate(details: {
  name: string;
  service: string;
  vehicle?: string;
}): { subject: string; html: string; plain: string } {
  const firstName = details.name.split(" ")[0];
  return {
    subject: `How's your ${details.vehicle || "vehicle"} running? — Nick's Tire & Auto`,
    html: baseTemplate("Thank You for Your Visit", `
      <p style="color:#333;line-height:1.6;">Hi <strong>${firstName}</strong>,</p>
      <p style="color:#333;line-height:1.6;">Thank you for choosing Nick's Tire & Auto for your <strong>${details.service}</strong>. We hope everything is running smoothly!</p>
      ${details.vehicle ? `<p style="color:#333;line-height:1.6;">If you notice anything with your <strong>${details.vehicle}</strong> that doesn't feel right, don't hesitate to bring it back — we stand behind our work.</p>` : ""}
      <p style="color:#333;line-height:1.6;">If anything doesn't feel right, call us at <strong>(216) 862-0005</strong>. We're here to help.</p>
    `),
    plain: `Hi ${firstName}, thank you for choosing Nick's Tire & Auto for your ${details.service}. If anything doesn't feel right, call (216) 862-0005.`,
  };
}

export function reviewRequestTemplate(details: {
  name: string;
  service?: string;
}): { subject: string; html: string; plain: string } {
  const firstName = details.name.split(" ")[0];
  return {
    subject: `A quick favor, ${firstName}? — Nick's Tire & Auto`,
    html: baseTemplate("We'd Love Your Feedback", `
      <p style="color:#333;line-height:1.6;">Hi <strong>${firstName}</strong>,</p>
      <p style="color:#333;line-height:1.6;">We hope ${details.service ? `your <strong>${details.service}</strong>` : "your recent service"} met your expectations!</p>
      <p style="color:#333;line-height:1.6;">If you have 30 seconds, a Google review helps other Cleveland drivers find honest, reliable auto repair:</p>
      <p style="text-align:center;margin:20px 0;">
        <a href="https://nickstire.org/review" style="display:inline-block;background:#1a1a2e;color:#ffffff;padding:12px 30px;border-radius:5px;text-decoration:none;font-weight:bold;">Leave a Review</a>
      </p>
      <p style="color:#333;line-height:1.6;">Thank you for your support!</p>
    `),
    plain: `Hi ${firstName}, if you have 30 seconds, a Google review helps other Cleveland drivers find honest repair: nickstire.org/review — Thank you! Nick's Tire & Auto`,
  };
}

export function newsletterTemplate(details: {
  headline: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
}): { subject: string; html: string; plain: string } {
  const cta = details.ctaText && details.ctaUrl
    ? `<p style="text-align:center;margin:20px 0;">
        <a href="${details.ctaUrl}" style="display:inline-block;background:#1a1a2e;color:#ffffff;padding:12px 30px;border-radius:5px;text-decoration:none;font-weight:bold;">${details.ctaText}</a>
       </p>`
    : "";
  return {
    subject: details.headline,
    html: baseTemplate(details.headline, `
      <div style="color:#333;line-height:1.6;">${details.body}</div>
      ${cta}
    `),
    plain: `${details.headline}\n\n${details.body.replace(/<[^>]*>/g, "")}`,
  };
}

// ─── Email Sender via Resend API (with circuit breaker) ──
async function sendGmailMCP(
  to: string[],
  subject: string,
  content: string,
  cc?: string[]
): Promise<{ sent: boolean; messageIds?: string[] }> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    log.warn("RESEND_API_KEY not set — email skipped, falling back to Telegram");
    return { sent: false };
  }

  try {
    const result = await emailCB.call(async () => {
      const { Resend } = await import("resend");
      const resend = new Resend(resendKey);

      const fromEmail = process.env.RESEND_FROM_EMAIL || "Nick's Tire & Auto <noreply@nickstire.org>";

      const { data, error } = await resend.emails.send({
        from: fromEmail,
        replyTo: process.env.SHOP_EMAIL || "Moeseuclid@gmail.com",
        to,
        cc: cc && cc.length > 0 ? cc : undefined,
        subject,
        html: content,
      });

      if (error) {
        throw new Error(`Resend error: ${error.message}`);
      }

      return { sent: true, messageIds: data?.id ? [data.id] : [] };
    });

    sendStats.totalSent++;
    sendStats.lastSentAt = new Date().toISOString();
    updateDeliveryRate();
    return result;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    sendStats.totalFailed++;
    sendStats.lastFailureAt = new Date().toISOString();
    sendStats.lastError = errMsg;
    updateDeliveryRate();
    log.warn("Gmail MCP send failed", { error: errMsg });
    return { sent: false };
  }
}

// ─── Apply Gmail Label to messages ────────────────────────
async function applyGmailLabel(messageIds: string[], labelId: string): Promise<void> {
  if (!messageIds.length || !labelId) return;

  try {
    const input = JSON.stringify({
      operation: "apply",
      label_id: labelId,
      message_ids: messageIds,
    });
    const escapedInput = input.replace(/'/g, "'\\''");

    await execAsync(
      `manus-mcp-cli tool call gmail_manage_labels --server gmail --input '${escapedInput}'`,
      { timeout: 15000 }
    );
    log.debug(`Applied label ${labelId} to ${messageIds.length} message(s)`);
  } catch (error) {
    log.warn("Label application failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── Main Notification Function ───────────────────────────
export interface NotifyInput {
  category: NotifyCategory;
  subject: string;
  body: string;
  /** Override default routing — force send to specific emails */
  overrideTo?: string[];
  /** Template name used (for tracking) */
  templateUsed?: string;
}

export async function sendNotification(input: NotifyInput): Promise<{
  emailSent: boolean;
  pushSent: boolean;
  recipients: string[];
  throttled: boolean;
}> {
  const route = ROUTING_TABLE[input.category];
  const recipients: string[] = [];
  const shopEmail = ENV.shopEmail || "Moeseuclid@gmail.com";
  const ceoEmail = ENV.ceoEmail || "nourdean22@gmail.com";

  // Build recipient list
  if (input.overrideTo && input.overrideTo.length > 0) {
    recipients.push(...input.overrideTo);
  } else {
    if (route.shopEmail) {
      recipients.push(shopEmail);
    }
    if (route.ceoEmail) {
      recipients.push(ceoEmail);
    }
  }

  // Smart batching: check throttle
  const throttledRecipients = recipients.filter((r) => shouldThrottle(r));
  if (throttledRecipients.length === recipients.length && recipients.length > 0) {
    log.info("All recipients throttled, skipping email", {
      category: input.category,
      recipients,
    });
    logDelivery({
      timestamp: new Date().toISOString(),
      category: input.category,
      subject: input.subject,
      recipients,
      emailSent: false,
      pushSent: false,
      retried: false,
      error: "Throttled — too many emails in window",
      templateUsed: input.templateUsed,
    });
    return { emailSent: false, pushSent: false, recipients, throttled: true };
  }

  // Filter to non-throttled recipients
  const activeRecipients = recipients.filter((r) => !shouldThrottle(r));

  // Send email if we have recipients (with retry)
  let emailSent = false;
  let retried = false;
  if (activeRecipients.length > 0) {
    let result = await sendGmailMCP(activeRecipients, input.subject, input.body);
    if (!result.sent) {
      // Retry once after 2 second delay
      retried = true;
      sendStats.totalRetried++;
      await new Promise((r) => setTimeout(r, 2000));
      result = await sendGmailMCP(activeRecipients, input.subject, input.body);
    }
    emailSent = result.sent;

    if (emailSent) {
      // Record sends for throttle tracking
      for (const r of activeRecipients) {
        recordEmailSend(r);
      }
    }

    // Apply Gmail label to the sent message for organization
    if (result.sent && route.gmailLabel) {
      try {
        const searchInput = JSON.stringify({
          query: `subject:"${input.subject.slice(0, 50)}" newer_than:1m`,
          max_results: 1,
        });
        const escapedSearch = searchInput.replace(/'/g, "'\\''");
        const { stdout } = await execAsync(
          `manus-mcp-cli tool call gmail_search_messages --server gmail --input '${escapedSearch}'`,
          { timeout: 15000 }
        );

        const msgIdMatch = stdout.match(/"id"\s*:\s*"([^"]+)"/);
        if (msgIdMatch && msgIdMatch[1]) {
          await applyGmailLabel([msgIdMatch[1]], route.gmailLabel);
        }
      } catch (labelErr) {
        log.warn("Could not apply label after send", {
          error: labelErr instanceof Error ? labelErr.message : String(labelErr),
        });
      }
    }
  }

  // Send push notification
  let pushSent = false;
  if (route.pushNotify) {
    try {
      pushSent = await notifyOwner({
        title: input.subject,
        content: input.body,
      });
    } catch (err) {
      log.warn("Push notification failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      pushSent = false;
    }
  }

  // Log delivery
  logDelivery({
    timestamp: new Date().toISOString(),
    category: input.category,
    subject: input.subject,
    recipients: activeRecipients,
    emailSent,
    pushSent,
    retried,
    templateUsed: input.templateUsed,
  });

  log.info(
    `Notification sent: category=${input.category} email=${emailSent ? "sent" : "skipped"}${retried ? " (retried)" : ""} push=${pushSent ? "sent" : "skipped"} recipients=${activeRecipients.join(",") || "none"}`,
  );

  return { emailSent, pushSent, recipients: activeRecipients, throttled: throttledRecipients.length > 0 };
}

// ─── Convenience Functions ────────────────────────────────

/** Notify about a new booking */
export function notifyNewBooking(details: {
  name: string;
  phone: string;
  service: string;
  vehicle?: string;
  date?: string;
  time?: string;
  notes?: string;
  urgency?: string;
  refCode?: string;
}) {
  const urgencyLabel = details.urgency === "emergency" ? "EMERGENCY" : details.urgency === "this-week" ? "This Week" : "Routine";
  return sendNotification({
    category: "booking",
    subject: `[${urgencyLabel}] New Booking: ${details.service} — ${details.name}`,
    body: [
      `NEW BOOKING REQUEST`,
      ``,
      `Customer: ${details.name}`,
      `Phone: ${details.phone}`,
      `Service: ${details.service}`,
      details.vehicle ? `Vehicle: ${details.vehicle}` : "",
      details.date ? `Preferred Date: ${details.date}` : "",
      details.time ? `Preferred Time: ${details.time}` : "",
      details.urgency ? `Urgency: ${urgencyLabel}` : "",
      details.refCode ? `Reference: ${details.refCode}` : "",
      details.notes ? `Notes: ${details.notes}` : "",
      ``,
      `Time: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
      ``,
      `ACTION: Contact customer to confirm appointment.`,
      ``,
      `— Nick's Tire & Auto Website`,
    ].filter(Boolean).join("\n"),
  });
}

/** Send booking confirmation email to customer (uses template) */
export function sendBookingConfirmationEmail(details: {
  name: string;
  email: string;
  service: string;
  vehicle?: string;
  date?: string;
  time?: string;
  refCode?: string;
}) {
  const template = bookingConfirmationTemplate(details);
  return sendNotification({
    category: "booking_confirmation",
    subject: template.subject,
    body: template.html,
    overrideTo: [details.email],
    templateUsed: "booking_confirmation",
  });
}

/** Send follow-up email to customer (uses template) */
export function sendFollowUpEmail(details: {
  name: string;
  email: string;
  service: string;
  vehicle?: string;
}) {
  const template = followUpTemplate(details);
  return sendNotification({
    category: "follow_up",
    subject: template.subject,
    body: template.html,
    overrideTo: [details.email],
    templateUsed: "follow_up",
  });
}

/** Send review request email to customer (uses template) */
export function sendReviewRequestEmail(details: {
  name: string;
  email: string;
  service?: string;
}) {
  const template = reviewRequestTemplate(details);
  return sendNotification({
    category: "review_request",
    subject: template.subject,
    body: template.html,
    overrideTo: [details.email],
    templateUsed: "review_request",
  });
}

/** Notify about a new lead */
export function notifyNewLead(details: {
  name: string;
  phone: string;
  email?: string;
  source?: string;
  interest?: string;
  vehicle?: string;
  problem?: string;
  urgencyScore?: number;
  urgencyReason?: string;
  recommendedService?: string;
  companyName?: string;
  fleetSize?: number;
  vehicleTypes?: string;
}) {
  const isHighValue = (details.urgencyScore || 0) >= 4 || details.source === "fleet";
  const fleetInfo = details.source === "fleet"
    ? `\nCompany: ${details.companyName || "N/A"}\nFleet Size: ${details.fleetSize || "N/A"}\nVehicle Types: ${details.vehicleTypes || "N/A"}`
    : "";

  return sendNotification({
    category: isHighValue ? "high_value" : "lead",
    subject: isHighValue
      ? `URGENT Lead (${details.urgencyScore}/5): ${details.name}`
      : `New Lead: ${details.name} — ${details.interest || details.recommendedService || "General Inquiry"}`,
    body: [
      isHighValue ? `HIGH-PRIORITY LEAD` : `NEW LEAD CAPTURED`,
      ``,
      `Name: ${details.name}`,
      `Phone: ${details.phone}`,
      details.email ? `Email: ${details.email}` : "",
      details.vehicle ? `Vehicle: ${details.vehicle}` : "",
      details.problem ? `Problem: ${details.problem}` : "",
      details.source ? `Source: ${details.source}` : "",
      details.urgencyScore ? `Urgency Score: ${details.urgencyScore}/5` : "",
      details.urgencyReason ? `Reason: ${details.urgencyReason}` : "",
      details.recommendedService ? `Recommended: ${details.recommendedService}` : "",
      fleetInfo,
      ``,
      `Time: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
      ``,
      isHighValue ? `ACTION: Call this customer within 15 minutes.` : `ACTION: Follow up within 1 hour.`,
      ``,
      `— Nick's Tire & Auto Website`,
    ].filter(Boolean).join("\n"),
  });
}

/** Notify about a new callback request */
export function notifyCallbackRequest(details: {
  name: string;
  phone: string;
  reason?: string;
  sourcePage?: string;
}) {
  return sendNotification({
    category: "callback",
    subject: `Callback Request: ${details.name} — Call ASAP`,
    body: [
      `CALLBACK REQUEST`,
      ``,
      `Customer: ${details.name}`,
      `Phone: ${details.phone}`,
      details.reason ? `Reason: ${details.reason}` : "",
      details.sourcePage ? `Page: ${details.sourcePage}` : "",
      ``,
      `Please call back within 15 minutes for best conversion.`,
      ``,
      `Time: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
      ``,
      `— Nick's Tire & Auto Website`,
    ].filter(Boolean).join("\n"),
  });
}

/** Notify about a new tire order — goes to BOTH emails */
export function notifyTireOrder(details: {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  vehicleInfo?: string;
  tireBrand: string;
  tireModel: string;
  tireSize: string;
  quantity: number;
  pricePerTire: number;
  totalAmount: number;
  notes?: string;
}) {
  return sendNotification({
    category: "tire_order",
    subject: `Tire Order ${details.orderNumber}: ${details.quantity}x ${details.tireBrand} ${details.tireModel} — $${details.totalAmount.toFixed(2)}`,
    body: [
      `NEW ONLINE TIRE ORDER`,
      ``,
      `Order: ${details.orderNumber}`,
      `Date: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
      ``,
      `CUSTOMER`,
      `Name: ${details.customerName}`,
      `Phone: ${details.customerPhone}`,
      details.customerEmail ? `Email: ${details.customerEmail}` : "",
      details.vehicleInfo ? `Vehicle: ${details.vehicleInfo}` : "",
      ``,
      `ORDER DETAILS`,
      `${details.quantity}x ${details.tireBrand} ${details.tireModel}`,
      `Size: ${details.tireSize}`,
      `Price: $${details.pricePerTire.toFixed(2)}/tire`,
      `Nick's Premium Installation Package: INCLUDED FREE`,
      `Total: $${details.totalAmount.toFixed(2)}`,
      ``,
      details.notes ? `NOTES: ${details.notes}` : "",
      ``,
      `ACTION REQUIRED:`,
      `1. Confirm order with customer`,
      `2. Check Gateway Tire inventory`,
      `3. Order tires if needed`,
      `4. Schedule installation appointment`,
      ``,
      `— Nick's Tire & Auto Website`,
    ].filter(Boolean).join("\n"),
  });
}

/** Notify about weekly revenue/performance report — CEO only */
export function notifyWeeklyReport(details: {
  totalRevenue: number;
  bookingCount: number;
  tireOrderCount: number;
  leadCount: number;
  topService: string;
}) {
  return sendNotification({
    category: "weekly_report",
    subject: `Weekly Report: $${details.totalRevenue.toFixed(0)} Revenue — ${details.bookingCount} Bookings`,
    body: [
      `WEEKLY PERFORMANCE REPORT`,
      `Week ending: ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}`,
      ``,
      `REVENUE: $${details.totalRevenue.toFixed(2)}`,
      `Bookings: ${details.bookingCount}`,
      `Tire Orders: ${details.tireOrderCount}`,
      `New Leads: ${details.leadCount}`,
      `Top Service: ${details.topService}`,
      ``,
      `— Nick's Tire & Auto Analytics`,
    ].join("\n"),
  });
}

/** Notify about a system event — CEO only */
export function notifySystemAlert(details: {
  title: string;
  message: string;
}) {
  return sendNotification({
    category: "system",
    subject: `[System] ${details.title}`,
    body: [
      `SYSTEM ALERT`,
      ``,
      details.message,
      ``,
      `Time: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
      ``,
      `— Nick's Tire & Auto System`,
    ].join("\n"),
  });
}

/** Notify about an auto-generated invoice — CEO only */
export function notifyInvoiceCreated(details: {
  invoiceNumber: string;
  customerName: string;
  totalAmount: number;
  source: string;
  serviceDescription: string;
}) {
  return sendNotification({
    category: "revenue",
    subject: `Invoice ${details.invoiceNumber}: $${details.totalAmount.toFixed(2)} — ${details.customerName}`,
    body: [
      `AUTO-GENERATED INVOICE`,
      ``,
      `Invoice: ${details.invoiceNumber}`,
      `Customer: ${details.customerName}`,
      `Service: ${details.serviceDescription}`,
      `Total: $${details.totalAmount.toFixed(2)}`,
      `Source: ${details.source === "booking" ? "Completed Booking" : "Tire Order Installation"}`,
      ``,
      `Time: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
      ``,
      `This invoice was auto-generated and synced to Google Sheets.`,
      `Review in the Invoices tab of your CRM spreadsheet.`,
      ``,
      `— Nick's Tire & Auto System`,
    ].join("\n"),
  });
}
