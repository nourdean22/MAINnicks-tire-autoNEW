/**
 * Meta Conversions API (CAPI) — Server-Side Event Tracking
 * ─────────────────────────────────────────────────────────
 * RESTORED (attribution-holds wave 2026-06) from the pre-stub implementation
 * at commit 37c8093, modernized: repo logger (no console.*), env-overridable
 * pixel id, sendPurchaseEvent export parity with the interim stub.
 *
 * DORMANT BY CONSTRUCTION: until META_CAPI_ACCESS_TOKEN is set in Railway,
 * every send is a quiet no-op (debug log + {success:false}) — identical
 * runtime behavior to the stub this replaces. The moment the operator sets
 * the token (Meta Events Manager > Settings > Conversions API), server-side
 * events flow with NO further code change.
 *
 * Why this matters: the browser pixel is blocked by ad blockers (30-40%)
 * and iOS ATT; CAPI recovers those conversions server-side. Events carry
 * the client-generated event_id (lead.submit/booking.submit already pass
 * pixelEventId) so Meta dedupes pixel+CAPI pairs instead of double-counting.
 *
 * PII handling per Meta spec: email/phone/name are SHA-256 hashed before
 * sending; fbc/fbp cookies pass through unhashed (Meta requirement).
 *
 * Endpoint: POST https://graph.facebook.com/v25.0/{PIXEL_ID}/events
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/
 */

import crypto from "crypto";
import { createLogger } from "./lib/logger";

const log = createLogger("meta-capi");

// ─── Configuration ────────────────────────────────────
// 2026-06-10 fix: the old default 1436…8578 (16-digit Meta APP id) is the Meta APP id ("nour os"
// app), not a pixel - events POSTs to it always fail (subcode 33). Real dataset id
// verified via Graph (last_fired_time present): 958472373260171.
const PIXEL_ID = process.env.META_CAPI_PIXEL_ID || "958472373260171";
const API_VERSION = "v25.0";
const GRAPH_API_URL = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;

// Access token from environment (generated in Events Manager > Settings)
function getAccessToken(): string | null {
  return process.env.META_CAPI_ACCESS_TOKEN || null;
}

// ─── Hashing Utility ──────────────────────────────────
// Meta requires SHA-256 hashing for PII fields
function sha256Hash(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

function hashPhone(phone: string): string {
  // Strip all non-digit characters, then hash
  const digits = phone.replace(/\D/g, "");
  // Add country code if not present (US default)
  const normalized = digits.length === 10 ? `1${digits}` : digits;
  return sha256Hash(normalized);
}

function hashEmail(email: string): string {
  return sha256Hash(email.trim().toLowerCase());
}

// ─── Types ────────────────────────────────────────────
interface CAPIUserData {
  client_ip_address?: string;
  client_user_agent?: string;
  em?: string[];    // SHA-256 hashed emails
  ph?: string[];    // SHA-256 hashed phones
  fbc?: string | null;     // Click ID cookie (not hashed)
  fbp?: string | null;     // Browser ID cookie (not hashed)
  fn?: string[];    // SHA-256 hashed first names
  ln?: string[];    // SHA-256 hashed last names
  ct?: string[];    // SHA-256 hashed cities
  st?: string[];    // SHA-256 hashed states
  zp?: string[];    // SHA-256 hashed zip codes
  country?: string[];  // SHA-256 hashed country codes
}

interface CAPICustomData {
  value?: number;
  currency?: string;
  content_name?: string | null;
  content_category?: string;
  content_ids?: string[];
  content_type?: string;
  search_string?: string;
  status?: string;
  [key: string]: unknown;
}

interface CAPIEvent {
  event_name: string;
  event_time: number;
  event_id?: string;
  event_source_url?: string;
  action_source: "website";
  user_data: CAPIUserData;
  custom_data?: CAPICustomData;
  opt_out?: boolean;
}

interface SendEventOptions {
  eventName: string;
  eventId?: string | null;
  sourceUrl?: string;
  // Raw user data (will be hashed before sending)
  userData: {
    ip?: string | null;
    userAgent?: string | null;
    email?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    fbc?: string | null;
    fbp?: string | null;
  };
  customData?: CAPICustomData;
}

// ─── Core Send Function ───────────────────────────────
export async function sendCAPIEvent(options: SendEventOptions): Promise<{
  success: boolean;
  eventsReceived?: number;
  error?: string;
}> {
  const accessToken = getAccessToken();
  if (!accessToken) {
    // DORMANT path — same quiet behavior as the interim stub. Becomes a
    // live send the moment META_CAPI_ACCESS_TOKEN is configured.
    log.debug(`Meta CAPI disabled — ${options.eventName} event not sent (META_CAPI_ACCESS_TOKEN not configured)`);
    return { success: false, error: "META_CAPI_ACCESS_TOKEN not configured" };
  }

  try {
    // Build user_data with hashed PII
    const userData: CAPIUserData = {};

    if (options.userData.ip) {
      userData.client_ip_address = options.userData.ip;
    }
    if (options.userData.userAgent) {
      userData.client_user_agent = options.userData.userAgent;
    }
    if (options.userData.email) {
      userData.em = [hashEmail(options.userData.email)];
    }
    if (options.userData.phone) {
      userData.ph = [hashPhone(options.userData.phone)];
    }
    if (options.userData.firstName) {
      userData.fn = [sha256Hash(options.userData.firstName)];
    }
    if (options.userData.lastName) {
      userData.ln = [sha256Hash(options.userData.lastName)];
    }
    if (options.userData.fbc) {
      userData.fbc = options.userData.fbc;
    }
    if (options.userData.fbp) {
      userData.fbp = options.userData.fbp;
    }

    // Always include Cleveland, OH, US for local business matching
    userData.ct = [sha256Hash("cleveland")];
    userData.st = [sha256Hash("oh")];
    userData.country = [sha256Hash("us")];

    const event: CAPIEvent = {
      event_name: options.eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      user_data: userData,
    };

    if (options.eventId) {
      event.event_id = options.eventId;
    }
    if (options.sourceUrl) {
      event.event_source_url = options.sourceUrl;
    }
    if (options.customData) {
      event.custom_data = options.customData;
    }

    const response = await fetch(`${GRAPH_API_URL}?access_token=${accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
      signal: AbortSignal.timeout(10000),
    });

    const result = await response.json();

    if (!response.ok) {
      log.error("[CAPI] Error sending event:", result);
      return { success: false, error: result.error?.message || "Unknown error" };
    }

    log.info(`[capi:send] ${options.eventName} event sent (events_received: ${result.events_received})`);
    return { success: true, eventsReceived: result.events_received };
  } catch (err) {
    log.error("[CAPI] Failed to send event:", err);
    return { success: false, error: String(err) };
  }
}

// ─── Typed Event Helpers ──────────────────────────────

/**
 * Send a Lead event (booking, callback, lead popup, fleet inquiry).
 */
export function sendLeadEvent(params: {
  eventId?: string | null;
  sourceUrl?: string;
  phone: string;
  email?: string | null;
  name?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  contentName: string;
  contentCategory: string;
}): Promise<{ success: boolean; error?: string }> {
  const nameParts = (params.name || "").split(" ");
  return sendCAPIEvent({
    eventName: "Lead",
    eventId: params.eventId,
    sourceUrl: params.sourceUrl,
    userData: {
      ip: params.ip,
      userAgent: params.userAgent,
      email: params.email,
      phone: params.phone,
      firstName: nameParts[0] || undefined,
      lastName: nameParts.slice(1).join(" ") || undefined,
      fbc: params.fbc,
      fbp: params.fbp,
    },
    customData: {
      content_name: params.contentName,
      content_category: params.contentCategory,
      value: 0,
      currency: "USD",
    },
  });
}

/**
 * Send a Schedule event (booking confirmation).
 */
export function sendScheduleEvent(params: {
  eventId?: string | null;
  sourceUrl?: string;
  phone: string;
  email?: string | null;
  name?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  service: string;
  vehicle?: string;
}): Promise<{ success: boolean; error?: string }> {
  const nameParts = (params.name || "").split(" ");
  return sendCAPIEvent({
    eventName: "Schedule",
    eventId: params.eventId,
    sourceUrl: params.sourceUrl,
    userData: {
      ip: params.ip,
      userAgent: params.userAgent,
      email: params.email,
      phone: params.phone,
      firstName: nameParts[0] || undefined,
      lastName: nameParts.slice(1).join(" ") || undefined,
      fbc: params.fbc,
      fbp: params.fbp,
    },
    customData: {
      content_name: params.service,
      content_category: "Appointment",
      content_type: params.vehicle || "vehicle",
    },
  });
}

/**
 * Send a Contact event (phone call, directions click).
 */
export function sendContactEvent(params: {
  eventId?: string | null;
  sourceUrl?: string;
  ip?: string | null;
  userAgent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  contentName: string;
  contentCategory: string;
}): Promise<{ success: boolean; error?: string }> {
  return sendCAPIEvent({
    eventName: "Contact",
    eventId: params.eventId,
    sourceUrl: params.sourceUrl,
    userData: {
      ip: params.ip,
      userAgent: params.userAgent,
      fbc: params.fbc,
      fbp: params.fbp,
    },
    customData: {
      content_name: params.contentName,
      content_category: params.contentCategory,
    },
  });
}

/**
 * Send a Purchase event (kept for export parity with the interim stub —
 * no current callers; wire from the invoice/payment path when that
 * attribution wave is approved).
 */
export function sendPurchaseEvent(params: {
  eventId?: string | null;
  sourceUrl?: string;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  value: number;
  currency?: string;
  contentName?: string;
}): Promise<{ success: boolean; error?: string }> {
  const nameParts = (params.name || "").split(" ");
  return sendCAPIEvent({
    eventName: "Purchase",
    eventId: params.eventId,
    sourceUrl: params.sourceUrl,
    userData: {
      ip: params.ip,
      userAgent: params.userAgent,
      email: params.email,
      phone: params.phone,
      firstName: nameParts[0] || undefined,
      lastName: nameParts.slice(1).join(" ") || undefined,
      fbc: params.fbc,
      fbp: params.fbp,
    },
    customData: {
      value: params.value,
      currency: params.currency || "USD",
      content_name: params.contentName,
    },
  });
}
