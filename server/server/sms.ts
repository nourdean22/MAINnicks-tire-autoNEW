/**
 * Twilio SMS Integration for Nick's Tire & Auto
 *
 * Handles all outbound SMS messaging:
 * - Status update notifications (stage changes)
 * - 24-hour thank-you follow-ups
 * - 7-day review request follow-ups
 * - Callback request confirmations
 * - Booking confirmations
 *
 * All messages identify as Nick's Tire & Auto and include
 * the store phone number (216) 862-0005 for callbacks.
 */
import twilio from "twilio";
import { STORE_PHONE, STORE_NAME } from "@shared/const";

// ─── Communication log helper (fire-and-forget) ──────
async function logCommunication(phone: string, type: string, direction: string, body: string, sid?: string) {
  try {
    const { getDb } = await import("./db");
    const { communicationLog } = await import("../drizzle/schema");
    const db = await getDb();
    if (!db) return;
    await db.insert(communicationLog).values({
      customerPhone: phone,
      type,
      direction,
      body: body.slice(0, 5000),
      metadata: sid ? { twilioSid: sid } : undefined,
    });
  } catch {
    // Don't let logging failures break SMS sends
  }
}

// ─── TWILIO CLIENT ─────────────────────────────────────

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.warn("[SMS] Twilio credentials not configured");
    return null;
  }

  return twilio(accountSid, authToken);
}

function getFromNumber(): string {
  return process.env.TWILIO_PHONE_NUMBER || "";
}

// ─── CORE SEND FUNCTION ────────────────────────────────

export interface SmsResult {
  success: boolean;
  sid?: string;
  error?: string;
}

/**
 * Send an SMS message via Twilio.
 * Returns success/failure with Twilio message SID.
 */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const client = getTwilioClient();
  const from = getFromNumber();

  if (!client || !from) {
    console.warn("[SMS] Twilio not configured, skipping SMS to", to);
    return { success: false, error: "Twilio not configured" };
  }

  // Normalize phone to E.164 (US numbers)
  const normalized = normalizePhone(to);
  if (!normalized) {
    return { success: false, error: `Invalid phone number: ${to}` };
  }

  try {
    const message = await client.messages.create({
      body,
      from,
      to: normalized,
    });

    // Log to communication_log
    logCommunication(normalized, "sms", "outbound", body, message.sid);

    return { success: true, sid: message.sid };
  } catch (error: any) {
    console.error(`[SMS] Failed to send to ${normalized}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Normalize a phone number to E.164 format for US numbers.
 * Accepts: (216) 862-0005, 216-862-0005, 2168620005, +12168620005
 */
function normalizePhone(phone: string): string | null {
  // Strip everything except digits and leading +
  const digits = phone.replace(/[^\d+]/g, "");

  // Already E.164
  if (digits.startsWith("+1") && digits.length === 12) return digits;
  if (digits.startsWith("+") && digits.length >= 11) return digits;

  // 10-digit US number
  const justDigits = digits.replace(/\D/g, "");
  if (justDigits.length === 10) return `+1${justDigits}`;
  if (justDigits.length === 11 && justDigits.startsWith("1")) return `+${justDigits}`;

  return null;
}

// ─── MESSAGE TEMPLATES ─────────────────────────────────

/**
 * Booking confirmation SMS
 */
export function bookingConfirmationSms(name: string, service: string, refCode?: string): string {
  const firstName = name.split(" ")[0];
  const ref = refCode ? ` Ref: #${refCode}` : "";
  return `Hi ${firstName}, your ${service.toLowerCase()} appointment at ${STORE_NAME} has been received. We'll confirm your time slot shortly.${ref}\n\nQuestions? Call ${STORE_PHONE}`;
}

/**
 * Status update SMS — sent when admin changes job stage
 */
export function statusUpdateSms(name: string, stage: string, refCode?: string): string {
  const firstName = name.split(" ")[0];
  const ref = refCode ? ` (Ref: #${refCode})` : "";

  const stageMessages: Record<string, string> = {
    received: `your vehicle has been received and is in our queue`,
    inspecting: `our technicians are now inspecting your vehicle`,
    "waiting-parts": `we're waiting for parts to arrive for your repair. We'll update you as soon as they're in`,
    "in-progress": `your vehicle is actively being repaired`,
    "quality-check": `your repair is done and going through our quality check`,
    ready: `your vehicle is READY FOR PICKUP! Come by anytime during business hours (Mon-Sat 9AM-6PM)`,
  };

  const statusMsg = stageMessages[stage] || "your vehicle status has been updated";
  const pickup = stage === "ready" ? "" : `\n\nTrack status: autonicks.com/status`;

  return `Hi ${firstName}, ${statusMsg}.${ref}${pickup}\n\n${STORE_NAME} — ${STORE_PHONE}`;
}

/**
 * 24-hour thank-you SMS
 */
export function thankYouSms(name: string, service: string): string {
  const firstName = name.split(" ")[0];
  return `Hi ${firstName}, thank you for choosing ${STORE_NAME} for your ${service.toLowerCase()}. We appreciate your business! If anything doesn't feel right, call us at ${STORE_PHONE}. — Nick's Team`;
}

/**
 * 7-day review request SMS
 * Optimized: uses short autonicks.com/review URL (189 chars, 2 segments)
 */
export function reviewRequestSms(name: string): string {
  const firstName = name.split(" ")[0];
  return `Hi ${firstName}, hope your vehicle is running great! If you have 30 seconds, a Google review helps other Cleveland drivers find honest repair:\n\nautonicks.com/review\n\nThank you! — ${STORE_NAME}`;
}

/**
 * Callback confirmation SMS — sent when customer requests a callback
 */
export function callbackConfirmationSms(name: string): string {
  const firstName = name.split(" ")[0];
  return `Hi ${firstName}, we received your callback request at ${STORE_NAME}. One of our team members will call you back shortly during business hours (Mon-Sat 9AM-6PM). — ${STORE_PHONE}`;
}

/**
 * Maintenance reminder SMS
 */
export function maintenanceReminderSms(name: string, service: string, mileageNote?: string): string {
  const firstName = name.split(" ")[0];
  const mileage = mileageNote ? ` ${mileageNote}` : "";
  return `Hi ${firstName}, it may be time for your next ${service.toLowerCase()}.${mileage} Call ${STORE_PHONE} or book online at autonicks.com to schedule.\n\n— ${STORE_NAME}`;
}

/**
 * Lead submission confirmation SMS
 */
export function leadConfirmationSms(name: string): string {
  const firstName = name.split(" ")[0];
  return `Thanks for contacting ${STORE_NAME}! We received your request and will call you shortly. Questions? Call us at ${STORE_PHONE}`;
}
// ─── EXPORTS ───────────────────────────────────────────

export { normalizePhone, STORE_PHONE, STORE_NAME };
