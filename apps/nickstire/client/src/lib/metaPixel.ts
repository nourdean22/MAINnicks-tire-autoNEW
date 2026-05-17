/**
 * Meta Pixel Client-Side Tracking Utility
 * ─────────────────────────────────────────
 * Provides typed wrappers around fbq() for all conversion events.
 * Generates unique event_id for server-side deduplication via CAPI.
 *
 * Pixel ID: 1436350367898578 (already loaded in index.html)
 *
 * Standard Events used:
 * - Lead: form submissions (booking, callback, lead popup, fleet inquiry)
 * - Contact: phone call clicks, email clicks
 * - Schedule: booking form completions
 * - ViewContent: service page views
 * - Search: tire search, AI diagnostic search
 * - CustomEvent: chat interactions, coupon claims
 */

// ─── Types ────────────────────────────────────────────
declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

type StandardEvent =
  | "Lead"
  | "Contact"
  | "Schedule"
  | "ViewContent"
  | "Search"
  | "CompleteRegistration"
  | "InitiateCheckout"
  | "Purchase";

interface EventParams {
  content_name?: string;
  content_category?: string;
  content_ids?: string[];
  content_type?: string;
  value?: number;
  currency?: string;
  search_string?: string;
  status?: string;
  [key: string]: unknown;
}

// ─── Event ID Generation ──────────────────────────────
// Generates a unique event_id for deduplication between
// client-side pixel and server-side Conversions API
function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `evt_${timestamp}_${random}`;
}

// ─── Core Tracking Function ───────────────────────────
function trackEvent(
  eventName: StandardEvent | string,
  params: EventParams = {},
  eventId?: string
): string {
  const id = eventId || generateEventId();

  if (typeof window !== "undefined" && window.fbq) {
    window.fbq("track", eventName, params, { eventID: id });
  }

  return id;
}

function trackCustomEvent(
  eventName: string,
  params: EventParams = {},
  eventId?: string
): string {
  const id = eventId || generateEventId();

  if (typeof window !== "undefined" && window.fbq) {
    window.fbq("trackCustom", eventName, params, { eventID: id });
  }

  return id;
}

// ─── Typed Event Wrappers ─────────────────────────────

/**
 * Track a booking form submission.
 * Fires both Lead and Schedule events.
 */
export function trackBookingSubmission(data: {
  service: string;
  vehicle?: string;
  source?: string;
}): { leadEventId: string; scheduleEventId: string } {
  const leadEventId = trackEvent("Lead", {
    content_name: "Booking Form Submission",
    content_category: data.service,
    value: 0,
    currency: "USD",
  });

  const scheduleEventId = trackEvent("Schedule", {
    content_name: data.service,
    content_category: "Appointment",
    content_type: data.vehicle || "vehicle",
  });

  return { leadEventId, scheduleEventId };
}

/**
 * Track a lead popup form submission.
 */
export function trackLeadSubmission(data: {
  source: string;
  problem?: string;
}): string {
  return trackEvent("Lead", {
    content_name: "Lead Form Submission",
    content_category: data.source,
    value: 0,
    currency: "USD",
  });
}

/**
 * Track a callback request submission.
 */
export function trackCallbackRequest(data: {
  sourcePage?: string;
}): string {
  return trackEvent("Lead", {
    content_name: "Callback Request",
    content_category: data.sourcePage || "website",
    value: 0,
    currency: "USD",
  });
}

/**
 * Track a phone call click (tel: link).
 */
export function trackPhoneCall(data: {
  sourcePage?: string;
}): string {
  return trackEvent("Contact", {
    content_name: "Phone Call Click",
    content_category: data.sourcePage || "website",
  });
}

/**
 * Track a service page view (ViewContent).
 */
export function trackServicePageView(data: {
  serviceName: string;
  pageUrl: string;
}): string {
  return trackEvent("ViewContent", {
    content_name: data.serviceName,
    content_category: "Service Page",
    content_type: "service",
    content_ids: [data.pageUrl],
  });
}

/**
 * Track a tire search.
 */
export function trackTireSearch(data: {
  searchQuery: string;
}): string {
  return trackEvent("Search", {
    search_string: data.searchQuery,
    content_category: "Tire Search",
  });
}

/**
 * Track AI diagnostic tool usage.
 */
export function trackDiagnosticSearch(data: {
  symptom: string;
}): string {
  return trackEvent("Search", {
    search_string: data.symptom,
    content_category: "AI Diagnostic",
  });
}

/**
 * Track a chat interaction start.
 */
export function trackChatStart(): string {
  return trackCustomEvent("ChatStarted", {
    content_name: "AI Chat Interaction",
    content_category: "Chat",
  });
}

/**
 * Track a coupon claim.
 */
export function trackCouponClaim(data: {
  couponName: string;
}): string {
  return trackCustomEvent("CouponClaimed", {
    content_name: data.couponName,
    content_category: "Coupon",
  });
}

/**
 * Track a fleet inquiry submission.
 */
export function trackFleetInquiry(): string {
  return trackEvent("Lead", {
    content_name: "Fleet Inquiry",
    content_category: "Fleet",
    value: 0,
    currency: "USD",
  });
}

/**
 * Track a referral submission.
 */
export function trackReferralSubmission(): string {
  return trackCustomEvent("ReferralSubmitted", {
    content_name: "Referral Program",
    content_category: "Referral",
  });
}

/**
 * Track directions click (Google Maps).
 */
export function trackDirectionsClick(): string {
  return trackEvent("Contact", {
    content_name: "Get Directions Click",
    content_category: "Directions",
  });
}

/**
 * Track a review page visit.
 */
export function trackReviewPageVisit(): string {
  return trackCustomEvent("ReviewPageVisit", {
    content_name: "Review Page",
    content_category: "Reviews",
  });
}

// ─── Utility: Get user data for CAPI matching ─────────
/**
 * Collects hashed user data from the browser for
 * server-side event matching. Returns the raw values
 * that the server will hash before sending to Meta.
 */
export function getUserDataForCAPI(): {
  client_user_agent: string;
  client_ip_address?: string;
  fbc?: string;
  fbp?: string;
} {
  const data: {
    client_user_agent: string;
    client_ip_address?: string;
    fbc?: string;
    fbp?: string;
  } = {
    client_user_agent: navigator.userAgent,
  };

  // Extract _fbc and _fbp cookies for advanced matching
  if (typeof document !== "undefined") {
    const cookies = document.cookie.split(";").reduce(
      (acc, c) => {
        const [key, val] = c.trim().split("=");
        if (key && val) acc[key] = val;
        return acc;
      },
      {} as Record<string, string>
    );

    if (cookies["_fbc"]) data.fbc = cookies["_fbc"];
    if (cookies["_fbp"]) data.fbp = cookies["_fbp"];
  }

  return data;
}
