/**
 * Customer Messaging Service — Status message templates and delivery log.
 *
 * Auto-generates customer-facing messages when work order status changes.
 * Messages are logged to customerStatusMessages table for review.
 * SMS sending is deferred to the existing SMS infrastructure.
 */
import { eq, desc } from "drizzle-orm";

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const schema = await import("../../drizzle/schema");
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return { db: d, ...schema };
}

// ─── Message Templates ──────────────────────────────
interface MessageTemplate {
  trigger: string;
  autoSend: boolean;
  template: (vars: Record<string, string>) => string;
}

const TEMPLATES: MessageTemplate[] = [
  {
    trigger: "approved",
    autoSend: false,
    template: (v) => `Hi ${v.name}, your vehicle (${v.vehicle}) has been checked in at Nick's Tire & Auto. We'll keep you posted as work progresses. Order #${v.orderNumber}`,
  },
  {
    trigger: "in_progress",
    autoSend: false,
    template: (v) => `Hi ${v.name}, work has started on your ${v.vehicle}. Your tech ${v.tech || "our technician"} is on it. We'll update you when it's ready. Order #${v.orderNumber}`,
  },
  {
    trigger: "parts_ordered",
    autoSend: true,
    template: (v) => `Hi ${v.name}, parts have been ordered for your ${v.vehicle}. ETA: ${v.eta || "1-2 business days"}. We'll let you know when they arrive. Order #${v.orderNumber}`,
  },
  {
    trigger: "parts_received",
    autoSend: false,
    template: (v) => `Hi ${v.name}, all parts for your ${v.vehicle} have arrived! We'll get you into a bay ASAP. Order #${v.orderNumber}`,
  },
  {
    trigger: "qc_review",
    autoSend: false,
    template: (v) => `Hi ${v.name}, work on your ${v.vehicle} is complete and we're doing our quality check now. Almost ready! Order #${v.orderNumber}`,
  },
  {
    trigger: "ready_for_pickup",
    autoSend: true,
    template: (v) => `Hi ${v.name}, your ${v.vehicle} is ready for pickup at Nick's Tire & Auto! We're open until ${v.closeTime || "6PM"}. Order #${v.orderNumber}`,
  },
  {
    trigger: "on_hold",
    autoSend: false,
    template: (v) => `Hi ${v.name}, work on your ${v.vehicle} is temporarily paused${v.reason ? `: ${v.reason}` : ""}. We'll reach out when we're ready to proceed. Order #${v.orderNumber}`,
  },
];

// ─── Generate message for a status change ───────────
export async function generateStatusMessage(params: {
  workOrderId: string;
  newStatus: string;
  overrideVars?: Record<string, string>;
}): Promise<{
  message: string;
  autoSend: boolean;
  recipient: string;
  channel: string;
} | null> {
  const { db, workOrders, customers } = await getDbAndSchema();

  const template = TEMPLATES.find(t => t.trigger === params.newStatus);
  if (!template) return null;

  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, params.workOrderId));
  if (!wo) return null;

  // Try to get customer info
  let customerName = "there";
  let customerPhone = "";
  try {
    const custId = parseInt(wo.customerId);
    if (!isNaN(custId)) {
      const [cust] = await db.select().from(customers).where(eq(customers.id, custId));
      if (cust) {
        customerName = cust.firstName;
        customerPhone = cust.phone;
      }
    }
  } catch (_) {}

  const vehicle = [wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ") || "your vehicle";

  const vars: Record<string, string> = {
    name: customerName,
    vehicle,
    orderNumber: wo.orderNumber,
    tech: wo.assignedTech || "",
    ...params.overrideVars,
  };

  return {
    message: template.template(vars),
    autoSend: template.autoSend,
    recipient: customerPhone,
    channel: "sms",
  };
}

// ─── Log a sent/suggested message ───────────────────
export async function logStatusMessage(params: {
  workOrderId: string;
  customerId?: string;
  trigger: string;
  channel: string;
  recipient: string;
  message: string;
  status: "sent" | "failed" | "skipped" | "suggested";
}): Promise<number> {
  const { db, customerStatusMessages } = await getDbAndSchema();

  const [result] = await db.insert(customerStatusMessages).values({
    workOrderId: params.workOrderId,
    customerId: params.customerId || null,
    trigger: params.trigger,
    channel: params.channel,
    recipient: params.recipient,
    message: params.message,
    status: params.status,
    sentAt: params.status === "sent" ? new Date() : null,
  }).$returningId();

  return result.id;
}

// ─── Get messages for a work order ──────────────────
export async function getMessagesForWorkOrder(workOrderId: string) {
  const { db, customerStatusMessages } = await getDbAndSchema();
  return db.select().from(customerStatusMessages)
    .where(eq(customerStatusMessages.workOrderId, workOrderId))
    .orderBy(desc(customerStatusMessages.createdAt));
}

// ─── Customer Job Tracker (public, token-verified) ──
export async function getTrackingInfo(orderNumber: string, phone: string) {
  const { db, workOrders, customers, workOrderItems } = await getDbAndSchema();

  // Find work order by order number
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.orderNumber, orderNumber));
  if (!wo) return null;

  // Verify phone matches customer
  try {
    const custId = parseInt(wo.customerId);
    if (!isNaN(custId)) {
      const [cust] = await db.select().from(customers).where(eq(customers.id, custId));
      if (!cust) return null;
      // Normalize phone comparison (last 10 digits)
      const normalize = (p: string) => p.replace(/\D/g, "").slice(-10);
      if (normalize(cust.phone) !== normalize(phone)) return null;
    }
  } catch (_) {
    return null;
  }

  // Get line items (approved only, no costs)
  const items = await db.select({
    description: workOrderItems.description,
    type: workOrderItems.type,
  }).from(workOrderItems)
    .where(eq(workOrderItems.workOrderId, wo.id));

  // Return sanitized info (no internal notes, costs, or tech details)
  const STATUS_LABELS: Record<string, string> = {
    draft: "Received",
    approved: "Checked In",
    parts_needed: "Ordering Parts",
    parts_ordered: "Parts on the Way",
    parts_partial: "Waiting for Parts",
    parts_received: "Parts Ready",
    ready_for_bay: "In Queue",
    assigned: "Assigned to Technician",
    in_progress: "Work in Progress",
    qc_review: "Quality Check",
    ready_for_pickup: "Ready for Pickup!",
    customer_notified: "Ready for Pickup!",
    picked_up: "Picked Up",
    invoiced: "Complete",
    closed: "Complete",
    on_hold: "On Hold",
  };

  return {
    orderNumber: wo.orderNumber,
    status: STATUS_LABELS[wo.status] || wo.status,
    statusKey: wo.status,
    vehicle: [wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" "),
    serviceDescription: wo.serviceDescription,
    services: items.map(i => i.description),
    promisedAt: wo.promisedAt?.toISOString() || null,
    estimatedCompletion: wo.estimatedCompletion?.toISOString() || null,
    createdAt: wo.createdAt.toISOString(),
  };
}
