interface Attribution {
  source: string;
  medium: string;
  campaign: string;
  referrer: string;
  landingPage: string;
  timestamp: string;
}

/**
 * Capture attribution data on first visit.
 * Stored in localStorage so it persists across pages.
 */
export function captureAttribution(): void {
  // Don't overwrite existing attribution
  if (localStorage.getItem("nick_attribution")) return;

  const params = new URLSearchParams(window.location.search);
  const referrer = document.referrer;

  let source = params.get("utm_source") || "";
  let medium = params.get("utm_medium") || "";
  const campaign = params.get("utm_campaign") || "";

  // Auto-detect source from referrer
  if (!source && referrer) {
    try {
      const refHost = new URL(referrer).hostname;
      if (refHost.includes("google")) { source = "google"; medium = medium || "organic"; }
      else if (refHost.includes("facebook") || refHost.includes("fb.")) { source = "facebook"; medium = medium || "social"; }
      else if (refHost.includes("yelp")) { source = "yelp"; medium = medium || "referral"; }
      else if (refHost.includes("instagram")) { source = "instagram"; medium = medium || "social"; }
      else { source = refHost; medium = medium || "referral"; }
    } catch {
      source = "unknown";
    }
  }

  if (!source) {
    source = "direct";
    medium = "none";
  }

  const attribution: Attribution = {
    source,
    medium,
    campaign,
    referrer: referrer || "",
    landingPage: window.location.pathname,
    timestamp: new Date().toISOString(),
  };

  localStorage.setItem("nick_attribution", JSON.stringify(attribution));
}

/**
 * Get stored attribution data.
 */
export function getAttribution(): Attribution | null {
  try {
    const raw = localStorage.getItem("nick_attribution");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Get attribution source string for quote/lead submissions.
 * Format: "source/medium" e.g., "google/organic", "facebook/ads"
 */
export function getAttributionSource(): string {
  const attr = getAttribution();
  if (!attr) return "website";
  return `${attr.source}/${attr.medium}`;
}
