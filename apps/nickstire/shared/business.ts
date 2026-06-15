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
 * NOTE · autonicks.com is RETIRED · do not set SITE_URL to it. The
 * Vercel deployment behind autonicks.com is dead. The statenour
 * operator domain is now bdnick.info; nickstire.org remains correct
 * for this customer-facing app.
 */
export const SITE_URL =
  (typeof process !== "undefined" && process.env?.SITE_URL) ||
  "https://nickstire.org";

export const BUSINESS = {
  name: "Nick's Tire & Auto",
  legalName: "Nick's Tire And Auto",
  // wave-182: "Trusted" is on the brand-voice kill list (sounds fake). A plain
  // descriptive line carries the walk-in eagerness beat + is stronger for SEO.
  tagline: "Cleveland's walk-in tire & auto shop",

  // ─── CONTACT ─────────────────────────────────────────
  phone: {
    display: "(216) 862-0005",    // For visible text
    href: "tel:+12168620005",       // For tel: links
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
  // wave-170: REVERTED to Google's GBP-pinned coordinates after
  // wave-167 broadcast incorrect 41.5855/-81.5268 to the schema.org
  // LocalBusiness.geo field on every page. The Google Business Profile
  // pin is canonical for Local Pack ranking + Maps reconciliation, and
  // it points to 41.5525118/-81.5571875 — the same coords baked into
  // GBP_PLACE_URL and GBP_EMBED_URL in shared/const.ts. These MUST stay
  // in sync; a divergent schema.org geo field confuses Google's
  // entity-graph reconciliation. The wave-167 audit agent's claim that
  // "BUSINESS.geo is correct, Contact hardcoded is 3.6km off" was
  // inverted — the hardcoded coords matched Google. Lesson: when audit
  // agents and Google disagree, Google wins.
  geo: {
    lat: 41.5525118,
    lng: -81.5571875,
  },

  // ─── TIMEZONE ─────────────────────────────────────────
  // Single source of truth — replace hardcoded "America/New_York" everywhere.
  timezone: "America/New_York",

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
  // wave-167: reconciled to 12mo/12k. The shop's written warranty on
  // every receipt is "12 months / 12,000 miles, whichever comes first."
  // The FAQ, About body copy, BrakeRepairPage, BookingPage,
  // AutoRepairNearMePage, and BlogPost all state 12mo. LocalBusinessSchema
  // + About SEO meta previously claimed 36mo — broadcasting a false promise
  // to Google's Knowledge Panel + SERP description. Real warranty wins.
  warranty: {
    months: 12,
    display: "12-month warranty",
    shortDisplay: "12-mo warranty",
  },
  founded: {
    year: 2018,
    display: "Since 2018",
  },
  // ─── ASE CERTIFICATION (owner-confirmed trust fact) ──
  // Owner confirmed the shop has ASE-certified technician capability.
  // Precise + defensible wording centralized here so every public surface
  // stays consistent and never overclaims: we say "ASE-certified
  // technicians" — NOT "all technicians are ASE certified" (unproven) and
  // NOT "ASE Master Certified" (unproven). No counts or names are claimed.
  ase: {
    certified: true,
    display: "ASE-certified technicians",
    short: "ASE-certified",
    capability: "ASE-certified service capability",
  },
  languages: ["English", "Arabic"] as readonly string[],
  languageDisplay: "Bilingual (English/Arabic)",

  // ─── OPERATING MODEL ───────────────────────────────
  model: {
    type: "FCFS" as const,
    display: "First come, first serve",
    walkIns: "Walk-ins welcome 7 days a week",
    dropOffs: "Drop-offs preferred — same day service",
    freeInspections: "Free quick checks",
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
  // CANONICAL used-tire pricing for the WEBSITE: "from $25 installed" with the
  // fineprint + typical band below (wave-183, 2026-06). The earlier wave-182
  // comment here claimed "$60 installed" was canonical — that is STALE and was
  // the source of a revert trap; do NOT restore it. Note the unresolved channel
  // split: phone/SMS/IG/voice/AI-validator still quote $60 (see
  // truth_os.md + docs/NEXT-BEST-ACTIONS.md owner decision). This constant is
  // the site's source of truth; align other channels to it, not the reverse.
  usedTires: {
    // wave-183: $25 = advertised floor (12-inch economy rims). The fineprint + band
    // MUST travel with the $25 everywhere it shows (honesty/FTC + protects the
    // 4.9-star moat from "advertised $25, charged double" reviews).
    priceDisplay: "from $25 installed",
    fineprint: "12-inch rims, subject to availability",
    typicalBand: "most sizes $40-80 installed",
    explanation: "Used tires start at $25 for 12-inch, but most standard passenger sizes are $60 installed",
    turnaround: "Under 20 minutes",
    dailyVolume: "50+ per day",
  },

  // ─── NEW TIRES (floor + positioning) ────────────────
  // wave-183: keep a price FLOOR for SEO (price-in-page is a proven ranking lever —
  // the $49 oil fix drove /oil-change impressions +1149%), standardized to the real
  // NewTiresClevelandPage tier ($89). Positioning line replaces per-size price
  // confusion. No (TM): unregistered, and the shop DOES decline unsafe tires, so the
  // line stays bounded to ordering/selection.
  newTires: {
    priceDisplay: "from $89 installed",
    positioning: "Any tire, any brand. Nick never says no.",
  },

  seasonalStorage: {
    priceDisplay: "$125 per season",
    description: "Climate-controlled winter/summer tire hotel services",
  },

  wheelPackages: {
    priceDisplay: "$499 and up",
    description: "Custom wheels and wheel+tire packages",
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
  // Bumped from old $20k floor (set when shop was younger). Now a soft
  // floor — the real "target" used in scoring is computed dynamically from
  // the trailing 90-day average × 1.1 in masterIntelligence.ts. This static
  // number is just a fallback used by older code paths and the progress-bar
  // visual; it's no longer the single goal.
  revenueTarget: {
    monthly: 100_000,
    display: "Run-rate",
  },

  // ─── SEO ─────────────────────────────────────────
  seo: {
    titleSuffix: " | Nick's Tire & Auto — Cleveland, OH",
    defaultDescription: "Honest auto repair and tire service in Cleveland, OH. Free check, written quote, you don't pay until you say yes. Brakes, tires, check-engine light, emissions. Serving Cleveland, Euclid, and Northeast Ohio. $10 down.",
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
