/**
 * Source Attribution — Captures UTM params and session data
 * for lead/booking/callback form submissions.
 *
 * Stores first-touch UTM params in sessionStorage.
 * getAttribution() returns the full attribution object to include in form data.
 */

export interface Attribution {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  referrer: string;
  landing_page: string;
  session_id: string;
}

function getOrCreateSessionId(): string {
  let sid = sessionStorage.getItem("nta_session");
  if (!sid) {
    sid = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem("nta_session", sid);
    sessionStorage.setItem("nta_landing", window.location.pathname + window.location.search);
  }

  // Store UTMs on first visit (first-touch attribution)
  const params = new URLSearchParams(window.location.search);
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];
  for (const key of utmKeys) {
    const val = params.get(key);
    if (val && !sessionStorage.getItem(`nta_${key}`)) {
      sessionStorage.setItem(`nta_${key}`, val);
    }
  }

  return sid;
}

/**
 * Get the full attribution object for form submissions.
 * Call this when submitting any form (lead, booking, callback, quote).
 */
export function getAttribution(): Attribution {
  const sid = getOrCreateSessionId();

  return {
    utm_source: sessionStorage.getItem("nta_utm_source") || "",
    utm_medium: sessionStorage.getItem("nta_utm_medium") || "",
    utm_campaign: sessionStorage.getItem("nta_utm_campaign") || "",
    utm_content: sessionStorage.getItem("nta_utm_content") || "",
    referrer: document.referrer || "",
    landing_page: sessionStorage.getItem("nta_landing") || window.location.pathname,
    session_id: sid,
  };
}

/**
 * Initialize attribution tracking on page load.
 * Call this once in main.tsx or App.tsx.
 */
export function initAttribution(): void {
  getOrCreateSessionId();
}
