/**
 * BUSINESS CONSTANTS — Single Source of Truth
 * All business information for Nick's Tire & Auto.
 * Every page and component should import from here instead of hardcoding values.
 * When any business detail changes, update ONLY this file.
 */

/**
 * SITE_URL — Configurable domain for the entire site.
 * Set SITE_URL env var on Railway to switch domains instantly.
 * Defaults to nickstire.org (primary domain).
 * For autonicks.com backup: set SITE_URL=https://autonicks.com on Railway.
 */
export const SITE_URL =
  (typeof process !== "undefined" && process.env?.SITE_URL) ||
  "https://nickstire.org";

export const BUSINESS = {
  name: "Nick's Tire & Auto",
  legalName: "Nick's Tire And Auto",
  tagline: "Cleveland's Trusted Shop",

  // ─── CONTACT ─────────────────────────────────────────
  phone: {
    display: "(216) 862-0005",    // For visible text
    href: "tel:2168620005",       // For tel: links
    raw: "2168620005",            // For data attributes / tracking
    dashed: "216-862-0005",       // Alternative display format
    placeholder: "(216) 555-0000", // For form input placeholders
  },

  // ─── LOCATION ────────────────────────────────────────
  address: {
    street: "17625 Euclid Ave",
    city: "Cleveland",
    state: "OH",
    zip: "44112",
    full: "17625 Euclid Ave, Cleveland, OH 44112",
    neighborhood: "Euclid",
    region: "Northeast Ohio",
  },

  // ─── COORDINATES ─────────────────────────────────────
  geo: {
    lat: 41.5855,
    lng: -81.5268,
  },

  // ─── HOURS ───────────────────────────────────────────
  hours: {
    display: "7 days — Mon–Sat 8AM–6PM, Sun 9AM–4PM",
    shortDisplay: "7 days · 8AM start",
    fullDisplay: "Monday–Saturday: 8:00 AM–6:00 PM | Sunday: 9:00 AM–4:00 PM",
    sunday: "Sun 9AM–4PM",
    structured: {
      monday: "08:00-18:00",
      tuesday: "08:00-18:00",
      wednesday: "08:00-18:00",
      thursday: "08:00-18:00",
      friday: "08:00-18:00",
      saturday: "08:00-18:00",
      sunday: "09:00-16:00",
    },
  },

  // ─── REVIEWS ─────────────────────────────────────────
  reviews: {
    rating: 4.9,
    count: 1700,
    countDisplay: "1,700+",
    source: "Google",
    url: "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid",
  },

  // ─── URLS ────────────────────────────────────────────
  urls: {
    website: SITE_URL,
    googleMaps: "https://maps.google.com/?q=17625+Euclid+Ave+Cleveland+OH+44112",
    googleMapsDirections: "https://www.google.com/maps/dir/?api=1&destination=17625+Euclid+Ave+Cleveland+OH+44112",
    googleMapsDirectionsNamed: "https://www.google.com/maps/dir//Nick's+Tire+And+Auto+Euclid,+17625+Euclid+Ave,+Cleveland,+OH+44112",
    googleBusiness: "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid",
  },

  // ─── SERVICE AREAS ───────────────────────────────────
  serviceAreas: [
    "Cleveland", "Euclid", "East Cleveland", "South Euclid",
    "Cleveland Heights", "Shaker Heights", "Garfield Heights",
    "Lakewood", "Parma", "Mentor", "Strongsville",
    "Lyndhurst", "Richmond Heights", "Willoughby",
  ],

   // ─── SOCIAL / SAME-AS (GBP + GSC linking) ──────
  sameAs: [
    "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/",
    "https://www.instagram.com/nicks_tire_euclid/",
    "https://www.facebook.com/nickstireeuclid/",
  ] as readonly string[],

  // ─── TRUST SIGNALS ──────────────────────────────────
  warranty: {
    months: 36,
    display: "36-month warranty",
    shortDisplay: "36-mo warranty",
  },
  founded: {
    year: 2018,
    display: "Since 2018",
  },
  languages: ["English", "Arabic"] as readonly string[],
  languageDisplay: "Bilingual (English/Arabic)",

  // ─── OPERATING MODEL ───────────────────────────────
  model: {
    type: "FCFS" as const,
    display: "First come, first serve",
    walkIns: "Walk-ins welcome 7 days a week",
    dropOffs: "Drop-offs preferred — same day service",
    freeInspections: "Free quick inspections",
    noAppointment: "No appointment needed",
  },

  // ─── FINANCING ─────────────────────────────────────
  financing: {
    providers: ["Acima", "Snap", "Koalafi", "American First Finance"] as readonly string[],
    display: "No-credit-check financing available",
    downPayment: "$10 down",
  },

  // ─── STARTING PRICES (internal reference only — not displayed publicly) ─────
  prices: {
    oilChange: "",
    brakes: "",
    alignment: "",
    diagnostic: "Free with repair",
    tireMount: "",
    tireRotation: "",
    acService: "",
    emissions: "",
  },

  // ─── USED TIRES (the "too good to be true" hook) ────
  usedTires: {
    priceDisplay: "from $60",
    turnaround: "Under 20 minutes",
    dailyVolume: "50+ per day",
  },

  // ─── BRAND TAGLINES ─────────────────────────────────
  taglines: {
    meme: "Nick's got you rolling.",
    memeShort: "Keep it rolling.",
    memeCleveland: "We keep Cleveland rolling.",
    hookAction: "$10 down, drive today.",
    hookSince: "Since 2018.",
  },

  // ─── REVENUE TARGETS ────────────────────────────────
  revenueTarget: {
    monthly: 20_000,
    display: "$20,000",
  },

  // ─── SEO ─────────────────────────────────────────
  seo: {
    titleSuffix: " | Nick's Tire & Auto — Cleveland, OH",
    defaultDescription: "Honest auto repair and tire service in Cleveland, OH. Check engine light diagnostics, brake repair, tires, emissions, and more. Serving Cleveland, Euclid, and Northeast Ohio. $10 down, drive today.",
  },
} as const;

export type Business = typeof BUSINESS;

/** Inputs for unified review count (GBP live + admin override + marketing floor). */
export type ReviewDisplayInputs = {
  /** Google Places `user_ratings_total` when API returned a positive value */
  googleCount?: number | null;
  /** `shop_settings.reviewCount` when admin set a positive override */
  adminCount?: number | null;
};

/**
 * Single rule for public review totals: **max(marketing floor, live Google, admin override)**.
 * - Floor is `BUSINESS.reviews.count` so GBP lag never shows below the canonical marketing line.
 * - When Google or admin is higher, the UI reflects the higher number.
 */
export function resolveReviewDisplay(inputs: ReviewDisplayInputs): {
  numeric: number;
  /** e.g. "1,723+" — includes trailing + for trust/marketing copy */
  countDisplay: string;
  provenance: "business" | "google" | "admin";
} {
  const floor = BUSINESS.reviews.count as number;
  const g =
    typeof inputs.googleCount === "number" && inputs.googleCount > 0
      ? inputs.googleCount
      : null;
  const a =
    typeof inputs.adminCount === "number" && inputs.adminCount > 0
      ? inputs.adminCount
      : null;

  let numeric = floor;
  let provenance: "business" | "google" | "admin" = "business";

  if (g !== null && g > numeric) {
    numeric = g;
    provenance = "google";
  }
  if (a !== null && a > numeric) {
    numeric = a;
    provenance = "admin";
  }

  return {
    numeric,
    countDisplay: `${numeric.toLocaleString("en-US")}+`,
    provenance,
  };
}
