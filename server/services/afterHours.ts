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

const log = createLogger("after-hours");

const STORE_PHONE = "(216) 862-0005";

/** Check if current time is outside business hours (Eastern Time) */
export function isAfterHours(): boolean {
  const now = new Date();
  const hour = parseInt(
    now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }),
    10
  );
  const day = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  ).getDay(); // 0=Sun

  if (day === 0) return hour < 9 || hour >= 16; // Sunday 9-4
  if (day >= 1 && day <= 6) return hour < 8 || hour >= 18; // Mon-Sat 8-6
  return true;
}

/** Get next opening time as a human-readable string */
export function getNextOpenTime(): string {
  const now = new Date();
  const et = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const day = et.getDay();
  const hour = et.getHours();

  if (day === 0) {
    if (hour < 9) return "9:00 AM today";
    return "8:00 AM tomorrow (Monday)";
  }
  if (day === 6) {
    if (hour < 8) return "8:00 AM today";
    return "9:00 AM Sunday";
  }
  // Mon-Fri
  if (hour < 8) return "8:00 AM today";
  if (day === 5) return "8:00 AM Saturday";
  return "8:00 AM tomorrow";
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

  // Send auto-SMS to customer (gated by feature flag)
  try {
    const { isEnabled } = await import("./featureFlags");
    if (!(await isEnabled("smart_sms_auto_reply"))) {
      log.info("After-hours auto-SMS skipped — smart_sms_auto_reply disabled");
    } else {
      await sendSms(
        params.phone,
        `Hi ${params.name}! Thanks for reaching out to Nick's Tire & Auto. ` +
          `We're currently closed but we got your message! ` +
          `We'll call you back first thing when we open at ${nextOpen}. ` +
          `For emergencies, call ${STORE_PHONE}. — Nour`
      );
      log.info("After-hours auto-SMS sent", {
        name: params.name,
        type: params.type,
      });
    }
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
