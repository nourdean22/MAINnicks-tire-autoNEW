/**
 * Acima Lease-to-Own Constants — Single Source of Truth
 * All Acima-related text, disclosures, and tracking for Nick's Tire & Auto.
 * Every component should import from here instead of hardcoding values.
 *
 * COMPLIANCE: Acima is lease-to-own, NOT financing/credit/loan.
 * FTC Regulation M requires disclosure near every "$10" trigger term.
 */

/** Update annually — never hardcode the year in prose text */
export const ACIMA_PROMO_YEAR = 2026;

/** Required near every "$10" mention (FTC Regulation M) */
export const ACIMA_COMPACT_DISCLOSURE =
  "$10 initial payment. Lease terms and total cost vary by item and payment schedule. 90-day early purchase option available. Not a loan or credit.";

/** Social proof — use on CTAs and hero sections. Individual results vary. */
export const ACIMA_SOCIAL_PROOF = "Trusted by hundreds of Nick's customers";

/** Acima direct apply URL */
export const ACIMA_APPLY_URL =
  "https://apply.acima.com/?app_id=lo&location_guid=loca-436877bd-bae3-482b-8d6c-21430690117f&utm_medium=merchant&utm_source=web";

/** Acima web banner */
export const ACIMA_BANNER = {
  href: "https://ams.acima.com/discover/new?location_guid=loca-436877bd-bae3-482b-8d6c-21430690117f&utm_source=web-banner&utm_medium=merchant&utm_campaign=mktg-lp&utm_content=rven1300X250",
  imgSrc: "https://s3.us-west-2.amazonaws.com/marketing.acimacredit.com/Acima-Web-Banners/RV-EN1/RVEN1300X250.png",
  alt: "Acima Leasing - No Credit Needed",
};

/** States where Acima is not available */
export const ACIMA_STATES_EXCLUDED = "MN, NJ, WI, WY";

/** Full legal disclaimer for bottom of Financing page and legal contexts */
export const ACIMA_FULL_DISCLAIMER =
  `Acima is a lease-to-own program. It is not a loan, credit, or financing. You will not own the merchandise until you make all payments under the lease agreement or exercise an early purchase option. Lease payments may be higher than the cash price of the merchandise. Not available in ${ACIMA_STATES_EXCLUDED}. See lease for details.`;

/**
 * Build Acima apply URL with UTM tracking parameters.
 * Every external Acima link should use this to ensure consistent attribution.
 */
export function buildAcimaUrl(source: string): string {
  return `https://apply.acima.com/?app_id=lo&location_guid=loca-436877bd-bae3-482b-8d6c-21430690117f&utm_medium=merchant&utm_source=web&utm_content=${source}`;
}

/**
 * Track Acima CTA clicks via GA4
 * Follows existing trackPhoneClick pattern from ga4.ts
 */
export function trackAcimaClick(source: string) {
  if (typeof window === "undefined" || !window.gtag) return;

  window.gtag("event", "acima_cta_click", {
    event_category: "engagement",
    event_label: source,
    source,
    page: window.location.pathname,
    timestamp: new Date().toISOString(),
  });
}
