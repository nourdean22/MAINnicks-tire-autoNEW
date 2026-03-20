/**
 * UTM Parameter Capture & Source Attribution
 * 
 * Captures UTM parameters from the URL on first visit and persists them
 * in sessionStorage so they survive page navigation. Every form submission
 * and phone click includes these params for attribution.
 */

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
const STORAGE_KEY = "nta_utm";
const LANDING_KEY = "nta_landing";
const REFERRER_KEY = "nta_referrer";

export interface UtmData {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  landingPage?: string;
  referrer?: string;
}

/**
 * Call once on app mount. Reads UTM params from URL and stores them.
 * Only captures on first page load (doesn't overwrite existing session data
 * unless new UTM params are present).
 */
export function captureUtmParams(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const hasUtm = UTM_KEYS.some((k) => params.has(k));

    // Always capture landing page and referrer on first visit
    if (!sessionStorage.getItem(LANDING_KEY)) {
      sessionStorage.setItem(LANDING_KEY, window.location.href);
    }
    if (!sessionStorage.getItem(REFERRER_KEY) && document.referrer) {
      sessionStorage.setItem(REFERRER_KEY, document.referrer);
    }

    // Only update UTM data if URL has UTM params (new campaign click)
    if (hasUtm) {
      const utmData: Record<string, string> = {};
      for (const key of UTM_KEYS) {
        const val = params.get(key);
        if (val) utmData[key] = val;
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(utmData));
    }
  } catch {
    // sessionStorage may be blocked in private browsing
  }
}

/**
 * Returns the captured UTM data for inclusion in form submissions.
 * Returns empty object if no UTM data was captured.
 */
export function getUtmData(): UtmData {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const landing = sessionStorage.getItem(LANDING_KEY);
    const referrer = sessionStorage.getItem(REFERRER_KEY);

    const parsed = raw ? JSON.parse(raw) : {};

    return {
      utmSource: parsed.utm_source,
      utmMedium: parsed.utm_medium,
      utmCampaign: parsed.utm_campaign,
      utmTerm: parsed.utm_term,
      utmContent: parsed.utm_content,
      landingPage: landing || undefined,
      referrer: referrer || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Returns a human-readable source label for display purposes.
 * e.g. "Google Ads", "Facebook", "Direct", "Organic"
 */
export function getSourceLabel(): string {
  const data = getUtmData();
  if (data.utmSource) {
    const src = data.utmSource.toLowerCase();
    if (src === "google" && data.utmMedium === "cpc") return "Google Ads";
    if (src === "facebook" || src === "fb" || src === "meta") return "Facebook Ads";
    if (src === "instagram" || src === "ig") return "Instagram";
    if (src === "bing" && data.utmMedium === "cpc") return "Bing Ads";
    if (src === "nextdoor") return "Nextdoor";
    return data.utmSource;
  }
  if (data.referrer) {
    try {
      const host = new URL(data.referrer).hostname;
      if (host.includes("google")) return "Google Organic";
      if (host.includes("facebook") || host.includes("fb.com")) return "Facebook";
      if (host.includes("bing")) return "Bing Organic";
      if (host.includes("yelp")) return "Yelp";
      return host;
    } catch {
      return "Referral";
    }
  }
  return "Direct";
}
