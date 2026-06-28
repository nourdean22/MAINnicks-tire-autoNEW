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

function getFirstName(name: unknown): string {
  if (typeof name !== "string") return "there";
  return name.trim().split(/\s+/)[0] || "there";
}

const smsTemplates: Record<string, (d: Record<string, unknown>) => string> = {
  "speed-to-lead": (d) =>
    `NEW LEAD: ${d.name} | ${d.phone} | ${d.service || "General"} | From: ${d.source || "website"}`,
  "booking-confirmation": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, Nick's Tire & Auto here. Got your request for ${d.date}. We're walk-in and first come, first served, but we'll keep an eye out for you. Questions? (216) 862-0005`;
  },
  "appointment-reminder-24h": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, just a reminder from Nick's Tire & Auto: we're expecting you tomorrow (${d.date}). We're first come, first served, so earlier is usually better. Questions? (216) 862-0005`;
  },
  "appointment-reminder-2h": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, just a heads up — we're expecting you soon at 17625 Euclid Ave. Pull up when you're ready. Questions? (216) 862-0005`;
  },
  "review-request": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, hope everything's been good since your visit. If we earned it, a quick Google review helps other Cleveland drivers find a shop they can trust: nickstire.org/review`;
  },
  "retention-90day": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, it's been about 3 months since your visit. Worth a quick check on the ${d.vehicle || "car"} whenever it's easy — free check, written quote, you don't pay until you say yes. (216) 862-0005`;
  },
  "retention-180day": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, six months since we saw you. Free check, written quote, and you don't pay until you say yes. Pull up any day. (216) 862-0005`;
  },
  "retention-365day": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, been about a year since we saw you at Nick's — worth a once-over on the ${d.vehicle || "car"} whenever you're ready. Same shop, same fair pricing. Walk in any day. (216) 862-0005`;
  },
  "vehicle-ready": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, your ${d.vehicle || "vehicle"} is ready for pickup at Nick's Tire & Auto. Pull up any time during business hours (we're open until ${d.closeTime || "6PM"}). Questions? (216) 862-0005`;
  },
  "estimate-ready": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, your estimate for ${d.service || "the work"} is ready at Nick's Tire & Auto. Total is $${d.total}. No pressure — reply YES to approve, or call us at (216) 862-0005 to go over options.`;
  },
  "referral-credit": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, thanks for sending ${d.refereeName} our way! We put a $25 credit on file for you at Nick's Tire & Auto. We'll apply it to your next visit. (216) 862-0005`;
  },
  "welcome": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, welcome to Nick's Tire & Auto. Save our number here: (216) 862-0005. If you ever need tires, brakes, or check engine work, text or call us anytime.`;
  },
  "warranty-expiring": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, the warranty on your ${d.service} from Nick's is coming up on ${d.expiryDate}. If you want us to do a quick check before it runs out, stop by or call (216) 862-0005.`;
  },
  "special-offer": (d) => {
    const fName = getFirstName(d.name);
    return `Hey ${fName}, just wanted to share a deal from Nick's Tire & Auto: ${d.offerText}, good through ${d.expiry}. Stop by or call us at (216) 862-0005.`;
  },
  "status-update": (d) => {
    const fName = getFirstName(d.name);
    return `Quick status update on your ${d.vehicle || "vehicle"} at Nick's: ${d.statusMessage}. If you have any questions, call or text us at (216) 862-0005.`;
  },
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
      await sendSms(params.phone, body, { via: "shop" });
      log.info(`Notification sent: ${params.type}`, { phone: params.phone?.slice(-4) });
    }
  } catch (err) {
    log.error(`Notification failed: ${params.type}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
