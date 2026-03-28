/**
 * Email Notification Router
 * Routes notifications to the correct email addresses based on type.
 *
 * Shop Email (Moeseuclid@gmail.com) — day-to-day operations, shop staff access
 * CEO Email (Nourdean22@gmail.com) — strategic, financial, high-value alerts
 *
 * Uses Gmail MCP via the sandbox CLI for sending.
 * Falls back to notifyOwner() push notifications as backup.
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
  | "booking"        // New booking → shop + CEO label
  | "lead"           // New lead → shop + CEO label
  | "callback"       // Callback request → shop + CEO label
  | "tire_order"     // Tire order → shop + CEO (both get email)
  | "high_value"     // High-value lead/order → shop + CEO
  | "revenue"        // Revenue/financial → CEO only
  | "weekly_report"  // Weekly report → CEO only
  | "content"        // Content generated → push only
  | "system"         // System alerts → CEO only
  | "review"         // New review → shop
  | "sms_reply"      // SMS reply from customer → shop
  ;

// ─── Routing Table ────────────────────────────────────────
interface RouteConfig {
  shopEmail: boolean;
  ceoEmail: boolean;
  pushNotify: boolean;
  gmailLabel?: string; // Label to apply to sent email in CEO inbox
}

const ROUTING_TABLE: Record<NotifyCategory, RouteConfig> = {
  booking:       { shopEmail: true,  ceoEmail: false, pushNotify: true,  gmailLabel: GMAIL_LABELS.bookings },
  lead:          { shopEmail: true,  ceoEmail: false, pushNotify: true,  gmailLabel: GMAIL_LABELS.leads },
  callback:      { shopEmail: true,  ceoEmail: false, pushNotify: true,  gmailLabel: GMAIL_LABELS.callbacks },
  tire_order:    { shopEmail: true,  ceoEmail: true,  pushNotify: true,  gmailLabel: GMAIL_LABELS.tire_orders },
  high_value:    { shopEmail: true,  ceoEmail: true,  pushNotify: true,  gmailLabel: GMAIL_LABELS.leads },
  revenue:       { shopEmail: false, ceoEmail: true,  pushNotify: true,  gmailLabel: GMAIL_LABELS.reports },
  weekly_report: { shopEmail: false, ceoEmail: true,  pushNotify: true,  gmailLabel: GMAIL_LABELS.reports },
  content:       { shopEmail: false, ceoEmail: false, pushNotify: true },
  system:        { shopEmail: false, ceoEmail: true,  pushNotify: true },
  review:        { shopEmail: true,  ceoEmail: false, pushNotify: true },
  sms_reply:     { shopEmail: true,  ceoEmail: false, pushNotify: true },
};

// ─── Email Sender via Resend ──────────────────────────────
let _resend: any = null;

async function getResend() {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return null;
    const { Resend } = await import("resend");
    _resend = new Resend(apiKey);
  }
  return _resend;
}

async function sendEmailResend(
  to: string[],
  subject: string,
  content: string,
): Promise<{ sent: boolean }> {
  try {
    const resend = await getResend();
    if (!resend) {
      console.warn("[Email] Resend not configured (missing RESEND_API_KEY)");
      return { sent: false };
    }

    const fromAddress = process.env.EMAIL_FROM || "Nick's Tire & Auto <noreply@nickstire.org>";

    await resend.emails.send({
      from: fromAddress,
      to,
      subject,
      text: content,
    });

    console.log(`[Email] Sent via Resend: "${subject}" → ${to.length} recipient(s)`);
    return { sent: true };
  } catch (error) {
    console.warn("[Email] Resend send failed:", error);
    return { sent: false };
  }
}

// ─── Main Notification Function ───────────────────────────
export interface NotifyInput {
  category: NotifyCategory;
  subject: string;
  body: string;
  /** Override default routing — force send to specific emails */
  overrideTo?: string[];
}

export async function sendNotification(input: NotifyInput): Promise<{
  emailSent: boolean;
  pushSent: boolean;
  recipients: string[];
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

  // Send email if we have recipients (with retry)
  let emailSent = false;
  let retried = false;
  if (recipients.length > 0) {
    let result = await sendEmailResend(recipients, input.subject, input.body);
    if (!result.sent) {
      retried = true;
      await new Promise(r => setTimeout(r, 2000));
      result = await sendEmailResend(recipients, input.subject, input.body);
    }
    emailSent = result.sent;
  }

  // Send push notification (Manus notification service)
  let pushSent = false;
  if (route.pushNotify) {
    try {
      pushSent = await notifyOwner({
        title: input.subject,
        content: input.body,
      });
    } catch {
      pushSent = false;
    }
  }

  // Log delivery
  logDelivery({
    timestamp: new Date().toISOString(),
    category: input.category,
    subject: input.subject,
    recipients,
    emailSent,
    pushSent,
    retried,
  });

  // Log to persistent communication_log (fire-and-forget)
  try {
    const { getDb } = await import("./db");
    const { communicationLog } = await import("../drizzle/schema");
    const db = await getDb();
    if (db) {
      await db.insert(communicationLog).values({
        type: "email",
        direction: "outbound",
        subject: input.subject,
        body: input.body.slice(0, 5000),
        metadata: { category: input.category, recipients, emailSent, pushSent },
      });
    }
  } catch {
    // Don't let logging failures break notifications
  }

  return { emailSent, pushSent, recipients };
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
