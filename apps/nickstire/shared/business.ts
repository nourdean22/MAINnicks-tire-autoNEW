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

const NEW_TIRE_FLOOR_DOLLARS = 89;

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
    // 2026-09-16 · floor bumped 1700 -> 1710: live-checked across 8 pages
    // today, every one that resolved the live query showed 1,710+; /about
    // was the one page still showing the stale 1,700 floor on that pass
    // (a resolveReviewDisplay() fallback, not a per-page bug — see
    // useReviewStats.ts). This is a periodic floor update, not a design
    // change; keep raising it as the live count grows.
    // A FLOOR, so it stays below the live count: on 2026-10-01 the live endpoint
    // (reviews.google) returned totalReviews 1715. Setting the floor to exactly
    // the live number would overstate the moment Google drops one review, and
    // the city pages already say 1,710+.
    count: 1710,
    countDisplay: "1,710+",
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
    "https://www.google.com/maps?cid=913066080091298245",
    "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/",
    "https://www.instagram.com/nicks_tire_euclid/",
    "https://www.facebook.com/nickstireeuclid/",
  ] as readonly string[],

  // ─── TRUST SIGNALS ──────────────────────────────────
  // 2026-07-21: the shop's actual invoice states shop-installed PARTS carry a
  // 1-year limited warranty and shop LABOR a 90-day limited warranty, with NO
  // mileage or road-hazard warranty unless stated in writing. The prior "12
  // months / 12,000 miles, whichever comes first" copy (wave-167) was NOT on the
  // invoice and was corrected site-wide to "12-month parts / 90-day labor".
  // `display` keeps a "12-month" headline for the 1-year PARTS term.
  warranty: {
    months: 12,
    display: "12-month warranty",
    shortDisplay: "12-mo warranty",
    // Invoice legal text (source of truth, owner-supplied 2026-07-21): shop-
    // installed PARTS carry a 1-year limited warranty; shop LABOR carries a
    // 90-day limited warranty; NO road-hazard or mileage warranty unless stated
    // in writing. The "12-month" headline reflects the 1-year PARTS term. Used
    // tires are separate (usedTires.warranty). The prior "12 months / 12,000
    // miles, whichever comes first" wording is NOT on the invoice — flagged for
    // operator review across the SEO/marketing surfaces that still show it.
    partsWarranty: "1-year limited parts warranty (shop-installed parts, unless stated otherwise in writing)",
    laborWarranty: "90-day limited labor warranty (shop labor, unless stated otherwise in writing)",
    roadHazard: "No road-hazard or mileage warranty unless expressly stated in writing on the invoice",
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
    // 2026-10-18 · Kafene added first (operator).
    providers: ["Kafene", "Acima", "Snap", "Koalafi", "American First Finance"] as readonly string[],
    // 2026-10-01 · was "No-credit-check financing available". Koalafi and
    // American First Finance both say they check credit (shared/financing.ts).
    display: "Payment programs from five providers; each decides approval",
    downPayment: "Acima: $10 start in select circumstances",
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
    // feat/home-v2 (2026-07-12): explanation harmonized with typicalBand —
    // the two constants previously disagreed ($60 flat vs $40-80 band),
    // which is exactly the drift the "band MUST travel with the $25" rule
    // exists to prevent. $60 stays as the typical midpoint.
    explanation: "Used tires start at $25 for 12-inch; most standard passenger sizes run $40-80 installed (typically around $60)",
    turnaround: "Under 20 minutes",
    dailyVolume: "50+ per day",
    // Invoice legal text (source of truth, owner-supplied 2026-07-21): used tires
    // carry a SEPARATE, shorter warranty than repairs. Never quote the repair
    // warranty on a used tire.
    warranty: "7-day limited replacement warranty — verified air loss or internal tire failure from a defect present at time of sale ONLY. Does not cover road hazard, punctures, sidewall/impact/bead damage, cosmetic issues, vibration, uneven wear, alignment, or misuse.",
  },
  // ─── FREE INSPECTION (Nour, 2026-10-30: "deponds on situation") ────
  // The free 27-point inspection is real, but it is NOT done on every visit or every oil change,
  // and photos of worn parts depend on the case. Customer copy OFFERS it ("just ask"); it never
  // promises it. Every page reads these lines, so the wording cannot drift between copies.
  // Pinned by client/src/__tests__/no-every-visit-inspection.test.ts.
  freeInspection: {
    /** Full sentence offer, for body copy and FAQ answers. */
    offer: "Ask for a free 27-point check.",
    /** Short badge/relief line. */
    short: "Free 27-point check, just ask.",
    /** Sub-line for the About checklist card. */
    aboutSub: "27 checkpoints: brakes, fluids, belts, suspension, lights, tires. Free, just ask.",
  },

  oilChange: {
    conventionalPrice: "$49",
    syntheticPrice: "$80",
    conventionalExplanation: "Conventional oil change is $49. No appointment needed, just stop by.",
    syntheticExplanation: "Synthetic oil change is $80. No appointment needed, just stop by.",
  },

  // ─── NEW TIRES (floor + positioning) ────────────────
  // wave-183: keep a price FLOOR for SEO (price-in-page is a proven ranking lever —
  // the $49 oil fix drove /oil-change impressions +1149%), standardized to the real
  // NewTiresClevelandPage tier ($89). Positioning line replaces per-size price
  // confusion. No (TM): unregistered, and the shop DOES decline unsafe tires, so the
  // line stays bounded to ordering/selection.
  newTires: {
    // Operator decision 2026-10-01 (#2868): one new-tire floor. The number is
    // what the chat tool quotes; the display is built from it so they agree.
    startingDollars: NEW_TIRE_FLOOR_DOLLARS,
    priceDisplay: `from $${NEW_TIRE_FLOOR_DOLLARS} installed`,
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
    hookAction: "Five payment programs; each provider decides approval.",
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
    defaultDescription: "Honest auto repair and tire service in Cleveland, OH. Free check, written quote, you don't pay until you say yes. Brakes, tires, check-engine light, emissions. Serving Cleveland, Euclid, and Northeast Ohio.",
  },
} as const;

// ─── DISCOUNT PROGRAMS ───────────────────────────────
// 2026-10-29 · Nour's terms, verbatim: "do 20 percent off but with all that
// and up to 250" (20% off labor, up to $250, with the proof and no-stacking
// fine print below). The counter honors these, so every page, its JSON-LD and
// the tests read them from here; no page types its own figure
// (canonical-business-truth.test.ts).
// The LGBTQ+ group is a welcome with no price: a price tied to sexual
// orientation is the protected-class risk under Cleveland's public
// accommodations chapter (667). Members still get any discount they qualify
// for through another group.
const DISCOUNT_PERCENT_OFF_LABOR = 20;
const DISCOUNT_MAX_DOLLARS_OFF = 250;

export const DISCOUNT_PROGRAMS = {
  status: "confirmed-2026-10-29" as const,
  offer: {
    percentOffLabor: DISCOUNT_PERCENT_OFF_LABOR,
    maxDollarsOff: DISCOUNT_MAX_DOLLARS_OFF,
    display: `${DISCOUNT_PERCENT_OFF_LABOR}% off labor, up to $${DISCOUNT_MAX_DOLLARS_OFF} off`,
    finePrint: [
      "Show a valid ID or proof at the counter before the work is written up.",
      "One discount per visit.",
      "Not combined with other offers, coupons or specials.",
      "Not on tires already on sale.",
    ],
  },
  groups: [
    {
      id: "military",
      label: "Military and veterans",
      qualifies: "Active duty, Guard, Reserve, retirees and veterans",
      proof: ["Military ID", "VA health card", "DD-214", "Ohio driver license or ID with the veteran mark"],
      offer: true,
    },
    {
      id: "first-responders",
      label: "Police, fire, EMS and 911 dispatch",
      qualifies: "Police officers, firefighters (career and volunteer), EMTs, paramedics and 911 dispatchers",
      proof: ["Department or agency ID", "Ohio EMS certification card with a photo ID"],
      offer: true,
    },
    {
      id: "students",
      label: "College students",
      qualifies: "Students enrolled at any college, university or trade school",
      proof: ["Current student ID"],
      offer: true,
    },
    {
      id: "seniors",
      label: "Seniors",
      qualifies: "Drivers 60 and older",
      proof: ["Any photo ID with your date of birth"],
      offer: true,
    },
    {
      id: "gig-drivers",
      label: "Rideshare and delivery drivers",
      qualifies: "Drivers who drive for DoorDash, Uber, Lyft, Grubhub, Instacart or Amazon Flex",
      proof: ["Your driver profile open in the app on your phone"],
      offer: true,
    },
    {
      id: "teachers",
      label: "Teachers and school staff",
      qualifies: "Teachers, aides and staff at any K-12 school",
      proof: ["School ID badge", "A recent pay stub from the school or district"],
      offer: true,
    },
    {
      id: "healthcare",
      label: "Healthcare workers",
      qualifies: "Nurses, aides, techs, doctors and staff at hospitals, clinics, nursing homes and home health agencies",
      proof: ["Hospital, clinic or agency ID badge", "Your nursing or professional license card"],
      offer: true,
    },
    {
      id: "dancers",
      label: "Dancers and performers",
      qualifies: "Working dancers and performers: studio, stage, company and club",
      proof: ["Studio, company or venue ID", "A booking or pay record from the last 60 days"],
      offer: true,
    },
    {
      id: "fighters",
      label: "Fighters and combat-sports athletes",
      qualifies: "Boxers, MMA fighters, wrestlers, and Muay Thai, kickboxing and jiu-jitsu athletes",
      proof: ["Gym membership card or app", "A fighter license or federation card"],
      offer: true,
    },
    {
      id: "lgbtq",
      label: "LGBTQ+ drivers",
      qualifies: "Everyone: same fair price, same respect",
      proof: [] as readonly string[],
      offer: false,
    },
  ] as const satisfies readonly { id: string; label: string; qualifies: string; proof: readonly string[]; offer: boolean }[],
} as const;

export type DiscountGroup = (typeof DISCOUNT_PROGRAMS.groups)[number];

export type Business = typeof BUSINESS;

/** Inputs for unified review count (GBP live + admin override + marketing floor). */
export type ReviewDisplayInputs = {
  /** Google Places `user_ratings_total` when API returned a positive value */
  googleCount?: number | null;
  /** `shop_settings.reviewCount` when admin set a positive override */
  adminCount?: number | null;
};

/**
 * Single rule for public review totals: **prefer real data over the static baseline,
 * never clamp a real number back up to it.**
 *
 * Precedence: admin override (a human explicitly set this) > live Google count (fetched
 * this session) > `BUSINESS.reviews.count`, used ONLY as a last-resort default when
 * neither of the above is available (API not configured, request failed, etc).
 *
 * 2026-09-09 fix: this used to be `max(floor, live, admin)`, so a real decrease in the
 * live Google count (a review purge, a policy removal) could never surface — the
 * display would silently keep showing the old, higher, now-inaccurate number forever.
 * That inverted the whole point of fetching live data. A verified-live count, even a
 * lower one, is more truthful than a static marketing baseline and must win outright.
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

  if (g !== null) {
    numeric = g;
    provenance = "google";
  }
  if (a !== null) {
    numeric = a;
    provenance = "admin";
  }

  return {
    numeric,
    countDisplay: `${numeric.toLocaleString("en-US")}+`,
    provenance,
  };
}
