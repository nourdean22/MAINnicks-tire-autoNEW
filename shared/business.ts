/**
 * BUSINESS CONSTANTS — Single Source of Truth
 * All business information for Nick's Tire & Auto.
 * Every page and component should import from here instead of hardcoding values.
 * When any business detail changes, update ONLY this file.
 */

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
    display: "Mon–Sat 8AM–6PM",
    shortDisplay: "Mon–Sat 8–6",
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
    count: 1685,
    countDisplay: "1,685+",
    source: "Google",
    url: "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid",
  },

  // ─── URLS ────────────────────────────────────────────
  urls: {
    website: "https://nickstire.org",
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

  // ─── BRAND TAGLINES ─────────────────────────────────
  taglines: {
    meme: "Nick's got you rolling.",
    memeShort: "Keep it rolling.",
    memeCleveland: "We keep Cleveland rolling.",
    hookAction: "$10 down, drive today.",
  },

  // ─── SEO ─────────────────────────────────────────
  seo: {
    titleSuffix: " | Nick's Tire & Auto — Cleveland, OH",
    defaultDescription: "Honest auto repair and tire service in Cleveland, OH. Check engine light diagnostics, brake repair, tires, emissions, and more. Serving Cleveland, Euclid, and Northeast Ohio. $10 down, drive today.",
  },
} as const;

export type Business = typeof BUSINESS;
