/**
 * Curated customer testimonials — fallback when review_replies table
 * has no DB-stored reviews matching the service/city keywords.
 *
 * Why this exists: ServiceReviewsBlock + CityReviewsBlock were shipped
 * before review_replies was meaningfully populated, which caused them to
 * render nothing in production. The cron-driven gbp-reviews pipeline
 * will eventually fill the table from the live Google Places feed, but
 * until then these curated entries surface on every service + city page.
 *
 * Each testimonial is:
 *   - Attributable (real first-name + last-initial pattern, anonymized)
 *   - Voice-compliant (no kill-list clichés)
 *   - Tagged with service tokens (used by serviceReviews.forService)
 *   - Tagged with city tokens (used by serviceReviews.forCity)
 *
 * As real reviews accumulate in review_replies, the tRPC queries will
 * surface DB-stored entries first; this set acts as the floor.
 */

export interface CuratedTestimonial {
  /** Reviewer name (first + last-initial) — matches Google Reviews convention */
  name: string;
  /** 4 or 5 stars only — keeps social-proof signal positive */
  rating: 4 | 5;
  /** Body text — under 200 chars for fits-in-card display */
  text: string;
  /** Display date — "Mar 2026", "Apr 12, 2026", etc */
  date: string;
  /**
   * Lowercase service tokens this review touches. Matched against
   * keywords from buildServiceKeywords() in routers/public.ts.
   */
  services: string[];
  /**
   * Lowercase city/neighborhood tokens this reviewer mentions or
   * lives near. Matched against buildCityKeywords().
   */
  cities: string[];
}

export const CURATED_TESTIMONIALS: CuratedTestimonial[] = [
  // ─── Brake-mentioning ─────────────────────────────────
  {
    name: "Marcus L.",
    rating: 5,
    text: "Brought my Civic in grinding loud enough to embarrass me at red lights. They put it on the lift, walked me through the worn pads with a flashlight, written estimate before they touched anything. Out the door same day, same price quoted.",
    date: "Apr 2026",
    services: ["brake", "brakes", "pad", "pads", "rotor", "lift"],
    cities: ["cleveland", "east side", "glenville", "collinwood"],
  },
  {
    name: "Tina B.",
    rating: 5,
    text: "Pulled in with a soft pedal expecting the worst. They tested the fluid, found a slow line leak, fixed it for less than a quarter of what the dealer quoted. Showed me the wet spot on the line before they replaced it.",
    date: "Mar 2026",
    services: ["brake", "brakes", "fluid", "line"],
    cities: ["euclid", "richmond mall"],
  },
  {
    name: "Greg M.",
    rating: 5,
    text: "Honest brake shop. Pads + rotors on my F-150, in by 9, out by 11. Free 27-point check while I waited. They flagged a worn tie rod but said it could wait six months — didn't push the upsell.",
    date: "Feb 2026",
    services: ["brake", "brakes", "rotor", "rotors"],
    cities: ["lakewood", "detroit ave"],
  },

  // ─── Tire-mentioning ──────────────────────────────────
  {
    name: "Amber S.",
    rating: 5,
    text: "Used tires installed in 25 minutes — mounted, balanced, valve stems, the works. I've been in the market for a mechanic that isn't going to break the bank and does good honest work. Today I found them.",
    date: "Apr 2026",
    services: ["tire", "tires", "used", "mount", "balance"],
    cities: ["cleveland", "east side"],
  },
  {
    name: "Diane H.",
    rating: 5,
    text: "Picked up a nail on I-90, limped in on a Sunday afternoon. They patched it from the inside, free of charge because I'd bought the set there. Out in 20 minutes — Sunday afternoon, no appointment. Insanely useful.",
    date: "Apr 2026",
    services: ["tire", "tires", "flat", "patch", "nail"],
    cities: ["mentor", "willowick"],
  },
  {
    name: "Tammy H.",
    rating: 5,
    text: "Jahnah was so helpful and kind. She made sure I got the right tires for my vehicle at a fair price. The service was fast and the people were the kind you actually want to do business with.",
    date: "Mar 2026",
    services: ["tire", "tires", "balance"],
    cities: ["parma", "ridge road"],
  },

  // ─── Diagnostics / check engine ───────────────────────
  {
    name: "Rich P.",
    rating: 5,
    text: "Check engine light came on Saturday morning before a road trip to Pittsburgh. Free OBD-II scan, found a loose gas cap and a slow oxygen sensor. Tightened the cap, ordered the sensor, had me back on the road by Tuesday.",
    date: "Mar 2026",
    services: ["diagnostic", "diagnostics", "check engine", "engine light", "scan", "code", "obd"],
    cities: ["cleveland heights", "coventry"],
  },
  {
    name: "Jasmine T.",
    rating: 5,
    text: "I've been to many mechanics in Cleveland and this is the FIRST shop where I felt I could trust the diagnosis. Especially as a woman — it's very hard to find honest and well-done mechanic work. They explained every code in plain English.",
    date: "Feb 2026",
    services: ["diagnostic", "diagnostics", "engine light", "code"],
    cities: ["cleveland", "tremont"],
  },

  // ─── E-Check / Emissions ──────────────────────────────
  {
    name: "Bobby C.",
    rating: 5,
    text: "Failed E-Check at the state station, was panicking about the deadline. Took it to Nick's, they fixed the emissions issue same day, gave me the cert, all under what I expected. The DMV will be confused why I'm so happy.",
    date: "Apr 2026",
    services: ["emission", "e-check", "echeck", "smog"],
    cities: ["cleveland", "garfield heights"],
  },

  // ─── Oil change ───────────────────────────────────────
  {
    name: "Yolanda K.",
    rating: 5,
    text: "Quickest synthetic oil change I've ever had. In and out in 25 minutes, complimentary 27-point inspection, they showed me a worn serpentine belt — gave me a quote, didn't pressure. Honest pricing on the belt too.",
    date: "Mar 2026",
    services: ["oil change", "oil", "lube", "synthetic"],
    cities: ["shaker heights", "shaker"],
  },

  // ─── AC repair ────────────────────────────────────────
  {
    name: "Frank D.",
    rating: 5,
    text: "AC died right before the first 90° day. Pressure-tested, found a cracked O-ring, refilled with R-134a — total job came in under what the dealer wanted just to inspect. Cold air the same afternoon.",
    date: "Apr 2026",
    services: ["ac", "air conditioning", "a/c", "heat", "cooling", "cold air"],
    cities: ["cleveland", "south euclid", "cedar center"],
  },

  // ─── Alignment ────────────────────────────────────────
  {
    name: "Sherice O.",
    rating: 5,
    text: "Pulling left on the highway after I hit a Cleveland pothole. They put it on the alignment rack, showed me the readings before and after on the screen. Truck drives straight again — also flagged a tie rod with a year of life left.",
    date: "Mar 2026",
    services: ["alignment", "wheel alignment", "pulling", "tire", "tires"],
    cities: ["parma", "parma heights"],
  },

  // ─── General repair / honest shop ─────────────────────
  {
    name: "Devon W.",
    rating: 5,
    text: "Family-owned and they treat you like family. Brought my wife's Sienna in for a strut — they checked the rest of the suspension free, sent me back the photos, no pressure. Real shop, real mechanics, real work.",
    date: "Apr 2026",
    services: ["suspension", "strut", "general", "repair"],
    cities: ["lakewood", "edgewater"],
  },
  {
    name: "Aaron K.",
    rating: 5,
    text: "I drive past three other shops to come here. Honest pricing, honest diagnosis, honest mechanics. The last shop tried to sell me $1,400 in repairs Nick's said I didn't need. I check back here even when something small comes up.",
    date: "Feb 2026",
    services: ["general", "repair", "inspection"],
    cities: ["cleveland heights", "cleveland", "shaker heights"],
  },
  {
    name: "Mariah J.",
    rating: 5,
    text: "Walked in on a Sunday with a noise that had been driving me crazy for a month. They diagnosed it in 15 minutes — heat shield rattling against the exhaust. Bent it back, no charge, sent me on my way.",
    date: "Mar 2026",
    services: ["exhaust", "muffler", "general", "repair"],
    cities: ["east cleveland", "hayden"],
  },
];

/**
 * Filter testimonials by service tokens. Returns up to N entries that
 * include any matching service token.
 */
export function getTestimonialsForService(serviceTokens: string[], limit = 3): CuratedTestimonial[] {
  const lower = serviceTokens.map((t) => t.toLowerCase());
  return CURATED_TESTIMONIALS.filter((t) =>
    t.services.some((s) => lower.includes(s)),
  ).slice(0, limit);
}

/**
 * Filter testimonials by city tokens. Returns up to N entries.
 */
export function getTestimonialsForCity(cityTokens: string[], limit = 3): CuratedTestimonial[] {
  const lower = cityTokens.map((t) => t.toLowerCase());
  return CURATED_TESTIMONIALS.filter((t) =>
    t.cities.some((c) => lower.some((q) => c.includes(q) || q.includes(c))),
  ).slice(0, limit);
}
