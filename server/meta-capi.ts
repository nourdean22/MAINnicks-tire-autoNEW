/**
 * Meta Conversions API (CAPI) — Server-Side Event Tracking
 * ─────────────────────────────────────────────────────────
 * Sends conversion events directly from the server to Meta's Graph API.
 * This provides redundant tracking that bypasses:
 *   - Ad blockers (30-40% of users)
 *   - iOS 14+ App Tracking Transparency
 *   - Browser cookie restrictions
 *
 * Events are deduplicated with client-side pixel using event_id.
 *
 * Endpoint: POST https://graph.facebook.com/v25.0/{PIXEL_ID}/events
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/
 */

import crypto from "crypto";

// ─── Configuration ────────────────────────────────────
const PIXEL_ID = "1436350367898578";
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
  fbc?: string;     // Click ID cookie (not hashed)
  fbp?: string;     // Browser ID cookie (not hashed)
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
  content_name?: string;
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
  eventId?: string;
  sourceUrl?: string;
  // Raw user data (will be hashed before sending)
  userData: {
    ip?: string;
    userAgent?: string;
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    fbc?: string;
    fbp?: string;
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
    console.warn("[capi:send] META_CAPI_ACCESS_TOKEN not configured — skipping server event");
    return { success: false, error: "No access token configured" };
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
      console.error("[CAPI] Error sending event:", result);
      return { success: false, error: result.error?.message || "Unknown error" };
    }

    console.info(`[capi:send] ${options.eventName} event sent (events_received: ${result.events_received})`);
    return { success: true, eventsReceived: result.events_received };
  } catch (err) {
    console.error("[CAPI] Failed to send event:", err);
    return { success: false, error: String(err) };
  }
}

// ─── Typed Event Helpers ──────────────────────────────

/**
 * Send a Lead event (booking, callback, lead popup, fleet inquiry).
 */
export function sendLeadEvent(params: {
  eventId?: string;
  sourceUrl?: string;
  phone: string;
  email?: string;
  name?: string;
  ip?: string;
  userAgent?: string;
  fbc?: string;
  fbp?: string;
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
  eventId?: string;
  sourceUrl?: string;
  phone: string;
  email?: string;
  name?: string;
  ip?: string;
  userAgent?: string;
  fbc?: string;
  fbp?: string;
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
  eventId?: string;
  sourceUrl?: string;
  ip?: string;
  userAgent?: string;
  fbc?: string;
  fbp?: string;
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
