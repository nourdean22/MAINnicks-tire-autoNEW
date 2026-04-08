/**
 * Drop-Off SMS Flow — Automated SMS sequence for drop-off customers.
 *
 * Sends status-driven messages throughout the repair lifecycle:
 *   checked_in/approved  → sendDropOffConfirmation
 *   in_progress          → sendInProgressUpdate
 *   completed/ready      → sendReadyForPickup
 *
 * Gated behind `drop_off_sms_flow` feature flag.
 * All messages identify as Nick's Tire & Auto with store phone.
 */

import { eq } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const log = createLogger("drop-off-flow");

const STORE_PHONE_DISPLAY = "(216) 862-0005";
const GOOGLE_MAPS_LINK = "https://maps.google.com/?q=17625+Euclid+Ave+Cleveland+OH+44112";

// ─── Helpers ────────────────────────────────────────────

async function getWorkOrderContext(workOrderId: string) {
  const { getDb } = await import("../db");
  const { workOrders, customers } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [wo] = await db
    .select()
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .limit(1);

  if (!wo) throw new Error(`Work order ${workOrderId} not found`);

  let customer: { firstName: string; phone: string } | null = null;
  if (wo.customerId) {
    const parsed = parseInt(wo.customerId, 10);
    if (!isNaN(parsed)) {
      const [cust] = await db
        .select({
          firstName: customers.firstName,
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.id, parsed))
        .limit(1);
      customer = cust || null;
    }
  }

  if (!customer?.phone) {
    throw new Error(`No phone number for work order ${workOrderId}`);
  }

  const vehicle = [wo.vehicleYear, wo.vehicleMake, wo.vehicleModel]
    .filter(Boolean)
    .join(" ") || "your vehicle";

  const total = wo.total && parseFloat(String(wo.total)) > 0
    ? `$${parseFloat(String(wo.total)).toFixed(2)}`
    : null;

  const estimatedTime = wo.estimatedCompletion
    ? new Date(wo.estimatedCompletion).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : null;

  return {
    wo,
    customer,
    vehicle,
    total,
    estimatedTime,
    name: customer.firstName || "there",
    phone: customer.phone,
  };
}

function getClosingTime(): string {
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
  return day === "Sunday" ? "4PM" : "6PM";
}

async function isDropOffFlowEnabled(): Promise<boolean> {
  try {
    const { isEnabled } = await import("./featureFlags");
    return isEnabled("drop_off_sms_flow");
  } catch (e) {
    console.warn("[services/dropOffFlow] operation failed:", e);
    return false;
  }
}

// ─── SMS Messages ───────────────────────────────────────

/**
 * Send when work order status changes to "approved" or "checked_in" equivalent.
 * "Your car is checked in, here is what to expect."
 */
export async function sendDropOffConfirmation(workOrderId: string): Promise<void> {
  if (!(await isDropOffFlowEnabled())) {
    log.debug("drop_off_sms_flow disabled, skipping confirmation", { workOrderId });
    return;
  }

  try {
    const ctx = await getWorkOrderContext(workOrderId);
    const { sendSms } = await import("../sms");

    const timeNote = ctx.estimatedTime
      ? `Estimated completion: ${ctx.estimatedTime}.`
      : "We'll text you with a time estimate shortly.";

    const message = [
      `Hi ${ctx.name}! Your car is checked in at Nick's.`,
      `By dropping off your vehicle, you authorize inspection and approved repairs.`,
      `We'll text you updates as we work on ${ctx.vehicle}.`,
      timeNote,
      `Need a ride? Uber/Lyft from our location: ${GOOGLE_MAPS_LINK}`,
      `Questions? ${STORE_PHONE_DISPLAY}`,
    ].join(" ");

    await sendSms(ctx.phone, message);
    log.info("Drop-off confirmation sent", { workOrderId, phone: ctx.phone.slice(-4) });
  } catch (err) {
    log.error("Failed to send drop-off confirmation", {
      workOrderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Send when work order status changes to "in_progress".
 * "Your vehicle is now being worked on."
 */
export async function sendInProgressUpdate(workOrderId: string): Promise<void> {
  if (!(await isDropOffFlowEnabled())) {
    log.debug("drop_off_sms_flow disabled, skipping in-progress", { workOrderId });
    return;
  }

  try {
    const ctx = await getWorkOrderContext(workOrderId);
    const { sendSms } = await import("../sms");

    const timeNote = ctx.estimatedTime
      ? `Estimated completion: ${ctx.estimatedTime}.`
      : "";

    const message = [
      `Update: Your ${ctx.vehicle} is now being worked on.`,
      timeNote,
      `We'll text you when it's ready. ${STORE_PHONE_DISPLAY}`,
    ].filter(Boolean).join(" ");

    await sendSms(ctx.phone, message);
    log.info("In-progress update sent", { workOrderId, phone: ctx.phone.slice(-4) });
  } catch (err) {
    log.error("Failed to send in-progress update", {
      workOrderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Send when work order status changes to "ready_for_pickup" or "completed".
 * "Your vehicle is ready!"
 */
export async function sendReadyForPickup(workOrderId: string): Promise<void> {
  if (!(await isDropOffFlowEnabled())) {
    log.debug("drop_off_sms_flow disabled, skipping ready-for-pickup", { workOrderId });
    return;
  }

  try {
    const ctx = await getWorkOrderContext(workOrderId);
    const { sendSms } = await import("../sms");

    const closingTime = getClosingTime();
    const totalNote = ctx.total ? ` Total: ${ctx.total}.` : "";

    const message = [
      `Great news! Your ${ctx.vehicle} is ready for pickup at Nick's Tire & Auto.`,
      totalNote,
      `We're open until ${closingTime} today.`,
      STORE_PHONE_DISPLAY,
    ].filter(Boolean).join(" ");

    await sendSms(ctx.phone, message);
    log.info("Ready-for-pickup SMS sent", { workOrderId, phone: ctx.phone.slice(-4) });
  } catch (err) {
    log.error("Failed to send ready-for-pickup SMS", {
      workOrderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
