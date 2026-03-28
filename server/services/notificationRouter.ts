/**
 * Notification Router — Central dispatch for all customer/admin notifications
 * Decides WHAT to send and WHERE based on notification type.
 * Integrates with SMS (Twilio), email, and real-time (SSE).
 */

import { createLogger } from "../lib/logger";
import { sendSms } from "../sms";
import { emitNewLead, emitNewBooking, emitNewReview, emitAlert } from "./realtime";

const log = createLogger("notifications");

const STORE_PHONE = "(216) 862-0005";
const OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || "";

interface NotifyParams {
  type: NotificationType;
  customerId?: string;
  orderId?: string;
  leadId?: string;
  phone?: string;
  email?: string;
  name?: string;
  data?: Record<string, unknown>;
}

type NotificationType =
  | "speed-to-lead"
  | "booking-confirmation"
  | "appointment-reminder-24h"
  | "appointment-reminder-2h"
  | "review-request"
  | "retention-90day"
  | "retention-180day"
  | "retention-365day"
  | "referral-credit"
  | "status-update"
  | "estimate-ready"
  | "vehicle-ready"
  | "welcome"
  | "warranty-expiring"
  | "special-offer";

const smsTemplates: Record<string, (d: Record<string, unknown>) => string> = {
  "speed-to-lead": (d) =>
    `NEW LEAD: ${d.name} | ${d.phone} | ${d.service || "General"} | From: ${d.source || "website"}`,
  "booking-confirmation": (d) =>
    `Hi ${d.name}! Your appointment at Nick's Tire & Auto is confirmed for ${d.date}. We're at 17625 Euclid Ave, Euclid. Call ${STORE_PHONE} with questions!`,
  "appointment-reminder-24h": (d) =>
    `Reminder: Your appointment at Nick's Tire & Auto is tomorrow, ${d.date}. 17625 Euclid Ave. Need to reschedule? Call ${STORE_PHONE}`,
  "appointment-reminder-2h": (d) =>
    `Your appointment at Nick's Tire & Auto is in 2 hours. We're ready for you at 17625 Euclid Ave. See you soon!`,
  "review-request": (d) =>
    `Hi ${d.name}! Thanks for choosing Nick's Tire & Auto. If we earned it, a Google review means the world: nickstire.org/review — Nick & the team`,
  "retention-90day": (d) =>
    `Hi ${d.name}, it's been a while! Your ${d.vehicle || "vehicle"} may be due for maintenance. Book: nickstire.org or call ${STORE_PHONE}. — Nick's Tire & Auto`,
  "retention-180day": (d) =>
    `${d.name}, 6 months since we saw your ${d.vehicle || "vehicle"}. Time for a checkup? ${STORE_PHONE} — Nick's Tire & Auto`,
  "retention-365day": (d) =>
    `Hey ${d.name}! A year has passed. Your ${d.vehicle || "vehicle"} needs love. Come back to Nick's — ${STORE_PHONE}. First-time-back discount!`,
  "vehicle-ready": (d) =>
    `Great news, ${d.name}! Your ${d.vehicle || "vehicle"} is ready for pickup at Nick's Tire & Auto. We're open until ${d.closeTime || "6PM"}.`,
  "estimate-ready": (d) =>
    `Hi ${d.name}, your estimate for ${d.service || "the requested service"} is ready. Total: $${d.total}. Reply YES to approve or call ${STORE_PHONE}.`,
  "referral-credit": (d) =>
    `Thanks ${d.name}! Your referral of ${d.refereeName} earned you a $25 credit at Nick's Tire & Auto. Applied to your next visit!`,
  "welcome": (d) =>
    `Welcome to Nick's Tire & Auto, ${d.name}! Save our number: ${STORE_PHONE}. Your referral code: ${d.referralCode} — share it & earn $25!`,
  "warranty-expiring": (d) =>
    `Hi ${d.name}, your warranty on ${d.service} from Nick's expires on ${d.expiryDate}. Schedule a check: ${STORE_PHONE}`,
  "special-offer": (d) =>
    `${d.name}, exclusive deal from Nick's: ${d.offerText}. Valid through ${d.expiry}. Book: nickstire.org or call ${STORE_PHONE}`,
  "status-update": (d) =>
    `Update on your ${d.vehicle || "vehicle"} at Nick's: ${d.statusMessage}. Questions? ${STORE_PHONE}`,
};

/**
 * Send a notification via the appropriate channel(s).
 * Speed-to-lead goes to owner. Everything else goes to customer.
 */
export async function notify(params: NotifyParams): Promise<void> {
  const template = smsTemplates[params.type];
  if (!template) {
    log.error(`No template for notification type: ${params.type}`);
    return;
  }

  const templateData: Record<string, unknown> = { ...params.data, name: params.name };

  try {
    // Speed-to-lead → send to owner, not customer
    if (params.type === "speed-to-lead") {
      if (OWNER_PHONE) {
        await sendSms(OWNER_PHONE, template(templateData));
      }
      emitNewLead({
        name: params.name,
        phone: params.phone,
        service: params.data?.service as string,
        source: params.data?.source as string,
        score: params.data?.score as number,
      });
      return;
    }

    // Booking confirmation → also emit real-time
    if (params.type === "booking-confirmation") {
      emitNewBooking({
        name: params.name,
        service: params.data?.service as string,
        date: params.data?.date as string,
      });
    }

    // Send SMS to customer
    if (params.phone) {
      // Check opt-out for marketing message types
      const marketingTypes: NotificationType[] = [
        "review-request", "retention-90day", "retention-180day", "retention-365day",
        "referral-credit", "special-offer", "warranty-expiring", "welcome",
      ];
      if (marketingTypes.includes(params.type)) {
        try {
          const { getDb } = await import("../db");
          const { customers } = await import("../../drizzle/schema");
          const { like } = await import("drizzle-orm");
          const d = await getDb();
          if (d) {
            const normalized = params.phone.replace(/\D/g, "").slice(-10);
            const [cust] = await d.select({ smsOptOut: customers.smsOptOut })
              .from(customers).where(like(customers.phone, `%${normalized}`)).limit(1);
            if (cust?.smsOptOut) {
              log.info(`Skipped ${params.type} — customer opted out`, { phone: params.phone?.slice(-4) });
              return;
            }
          }
        } catch (err) {
          log.error("Opt-out check failed, skipping send as precaution", { error: String(err) });
          return;
        }
      }

      const body = template(templateData);
      await sendSms(params.phone, body);
      log.info(`Notification sent: ${params.type}`, { phone: params.phone?.slice(-4) });
    }
  } catch (err) {
    log.error(`Notification failed: ${params.type}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
