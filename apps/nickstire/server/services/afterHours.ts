/**
 * After-Hours Detection & Auto-Response
 * Detects when leads/bookings come in outside business hours
 * and sends an immediate auto-SMS + Telegram alert to Nour.
 *
 * Business Hours (Eastern Time):
 *   Mon-Sat: 8 AM - 6 PM
 *   Sunday:  9 AM - 4 PM
 */

import { createLogger } from "../lib/logger";
import { sendSms } from "../sms";
import { alertAfterHours } from "./telegram";

import { BUSINESS } from "@shared/business";
import { businessState } from "@shared/shopState";
const log = createLogger("after-hours");

const STORE_PHONE = BUSINESS.phone.display;

/**
 * Check if current time is outside business hours.
 *
 * 2026-09-18 · rewired to `businessState`. This function used to re-type the
 * hours as literals (`day === 0 ? hour < 9 || hour >= 16 : ...`) while
 * importing `BUSINESS` for the phone and timezone — so the shop's hours lived
 * in two places and only one of them was canonical. It was not WRONG when
 * audited, which is exactly why it was dangerous: editing
 * `BUSINESS.hours.structured` would have left this copy silently stale, and the
 * app has already paid for that class of drift (ROS-043, and the
 * "before 6 PM today" SMS template that was false every Sunday).
 *
 * `businessState` is the one reader of `BUSINESS.hours.structured` and handles
 * the before-open, open and after-close arms.
 */
export function isAfterHours(): boolean {
  return businessState(new Date(), BUSINESS.timezone, BUSINESS.hours.structured).state === "closed";
}

/**
 * Next opening time, human-readable.
 *
 * Derived from the same single source. Returns a stable fallback rather than a
 * fabricated time if hours are ever unconfigured — an unknown must not render
 * as a specific promise to a customer.
 */
export function getNextOpenTime(): string {
  const st = businessState(new Date(), BUSINESS.timezone, BUSINESS.hours.structured);
  if (st.state === "open") return "now (we're open)";
  return st.nextChange ?? "our next business day";
}

/**
 * Handle after-hours lead capture.
 * Call this from lead/booking/callback routers when a submission comes in.
 * If it's after hours, sends auto-SMS and Telegram alert.
 * Returns true if after-hours handling was triggered.
 */
export async function handleAfterHoursCapture(params: {
  name: string;
  phone: string;
  type: "lead" | "booking" | "callback";
}): Promise<boolean> {
  if (!isAfterHours()) return false;

  const nextOpen = getNextOpenTime();

  try {
    const { orchestrateSms } = await import("./smsOrchestrator");
    await orchestrateSms({
      type: "after_hours_capture",
      phone: params.phone,
      name: params.name,
      captureType: params.type,
    });
    log.info("After-hours auto-SMS processed via orchestrator", {
      name: params.name,
      type: params.type,
    });
  } catch (err) {
    log.warn("After-hours SMS failed", { err });
  }

  // Alert Nour via Telegram
  await alertAfterHours({
    name: params.name,
    phone: params.phone,
    type: params.type,
  });

  return true;
}
