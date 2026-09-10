/**
 * Competitor & Nick's Tire & Auto profiles for the comparison page system.
 *
 * Honesty principle: every competitor's strengths are real and acknowledged.
 * Common complaints come from Yelp/Google review patterns. Don't write
 * hatchet jobs — comparison pages that feel honest rank and convert; pages
 * that feel like ads tank both.
 *
 * Source of truth — pricing, hours, locations are all updated via this file.
 * Update once, propagates to every comparison page that pulls from it.
 */

export type CompetitorTier = "national-chain" | "regional-chain" | "tires-only" | "manufacturer-direct";

export interface CompetitorProfile {
  /** URL-safe slug used for routing + filenames */
  slug: string;
  /** Display name */
  name: string;
  /** Short label for tables/lists */
  shortName: string;
  /** Primary brand domain (no protocol) */
  website: string;
  /** Tagline / what they say about themselves */
  tagline: string;
  /** Year founded */
  founded: number;
  /** Headquarters city/state */
  headquarters: string;
  /** Owner/parent company if relevant */
  ownership?: string;

  /** Positioning */
  tier: CompetitorTier;
  /** Approximate Cleveland-area location count */
  clevelandLocations: number | "many" | "national";
  /** Sunday hours availability */
  openSunday: boolean;
  /** Walk-in or appointment-only? */
  walkInPolicy: "walk-in" | "appointment-required" | "appointment-preferred" | "limited-walk-in";
  /** Sells used tires? */
  usedTires: boolean;
  /** Full-service mechanical repair (brakes, oil, alignment, etc.)? */
  fullServiceMechanical: boolean;
  /** Drop-off + Uber/Lyft pickup model? */
  dropoffWithRideshare: boolean;

  /** Strengths — be honest, acknowledge real value */
  strengths: string[];
  /** Weaknesses — what real customers complain about */
  weaknesses: string[];
  /** Best-fit customers (we recommend them for these cases) */
  bestFor: string[];
  /** Not-ideal-for (steer wrong-fit customers elsewhere) */
  notIdealFor: string[];
  /** Common complaints aggregated from public reviews — paraphrased themes, not quotes */
  commonComplaints: string[];

  /** Approximate pricing notes (qualitative, not exact $ — varies by location) */
  pricingNotes: string;
  /** Approximate used tire $ if they sell them, else null */
  usedTireFloor: number | null;
}

export const COMPETITORS: Record<string, CompetitorProfile> = {
  conrads: {
    slug: "conrads",
    name: "Conrad's Tire Express & Total Car Care",
    shortName: "Conrad's",
    website: "conradstire.com",
    tagline: "Cleveland's hometown tire store since 1934",
    founded: 1934,
    headquarters: "Akron, OH",
    ownership: "Independently owned regional chain",
    tier: "regional-chain",
    clevelandLocations: 37,
    openSunday: false,
    walkInPolicy: "appointment-preferred",
    usedTires: false,
    fullServiceMechanical: true,
    dropoffWithRideshare: false,
    strengths: [
      "Long-standing Cleveland-area presence — the chain most Greater Cleveland drivers grew up with",
      "Roughly 37 locations across Northeast Ohio means there's almost always one near you",
      "Full-service: tires, brakes, alignment, oil changes, mechanical repair under one roof",
      "Established financing partnerships and tire price-match programs",
    ],
    weaknesses: [
      "Closed Sundays — if your tire blows on Saturday night, you're waiting until Monday",
      "Appointment-preferred model means longer waits as a walk-in",
      "Chain-pricing structure — labor rates and shop fees set by corporate, not the bay",
      "Reviews mention surprise add-ons appearing on final invoice (TPMS service, valve stems, disposal fees)",
      "Doesn't sell used tires — new only, even when a $25 used tire would solve the problem",
    ],
    bestFor: [
      "Drivers who want chain-brand reassurance and don't mind waiting",
      "Customers using Conrad's tire price-match program with a competing quote in hand",
      "Fleet accounts and businesses needing established invoicing relationships",
      "People who already have a relationship with a specific Conrad's location",
    ],
    notIdealFor: [
      "Anyone who needs Sunday service",
      "Drivers who want a clear written estimate before any wrench moves",
      "Shoppers looking for used tires from $25 installed",
      "Customers who can't sit in a waiting room for 2-3 hours",
    ],
    commonComplaints: [
      "Surprise charges on final invoice that weren't on the verbal quote",
      "Wait times longer than the appointment promised",
      "Aggressive recommendations for additional work beyond the original ask",
      "Closed Sunday — biggest pain point for working drivers with weekday jobs",
    ],
    pricingNotes:
      "Chain pricing: tire prices competitive but watch for shop fees, TPMS service, valve stems, and disposal charges added at checkout.",
    usedTireFloor: null,
  },

  mavis: {
    slug: "mavis",
    name: "Mavis Discount Tire",
    shortName: "Mavis",
    website: "mavis.com",
    tagline: "Tires for less. Period.",
    founded: 1972,
    headquarters: "Millwood, NY",
    ownership: "Mavis Tire Supply (acquired NTB in 2021)",
    tier: "national-chain",
    clevelandLocations: 15,
    openSunday: false,
    walkInPolicy: "appointment-preferred",
    usedTires: false,
    fullServiceMechanical: true,
    dropoffWithRideshare: false,
    strengths: [
      "Aggressive low-price tire marketing — they win on advertised tire-only prices",
      "Online appointment booking with most locations confirming same/next day",
      "Now ~15 Ohio locations after acquiring NTB — convenient if you're near one",
      "Wide tire inventory across budget and premium brands",
    ],
    weaknesses: [
      "Closed Sundays — same weekend gap as the rest of the chains",
      "Yelp + Google reviews repeatedly call out labor charges and parts add-ons appearing at checkout",
      "Quality varies dramatically store-to-store post-acquisition — your last good visit doesn't predict your next one",
      "Appointment-required for most service, walk-ins routinely turned away",
      "New tires only",
    ],
    bestFor: [
      "Drivers buying a specific advertised tire and nothing else",
      "Customers who can lock in a same-day appointment online",
      "Folks who don't need mechanical work that day",
    ],
    notIdealFor: [
      "Anyone needing Sunday service",
      "Walk-ins without an appointment",
      "Drivers wanting transparent labor pricing before work begins",
      "Used tire shoppers",
    ],
    commonComplaints: [
      "Final invoice noticeably higher than the advertised tire price after labor and parts",
      "Inconsistent service quality across locations (especially post-NTB acquisition)",
      "Long waits even with confirmed appointments",
      "Pressure to add brake or alignment work to a tire-only visit",
    ],
    pricingNotes:
      "Tire prices are real but expect labor, valve stems, TPMS, and disposal to add 20-40% at checkout.",
    usedTireFloor: null,
  },

  "discount-tire": {
    slug: "discount-tire",
    name: "Discount Tire",
    shortName: "Discount Tire",
    website: "discounttire.com",
    tagline: "America's largest independent tire dealer.",
    founded: 1960,
    headquarters: "Scottsdale, AZ",
    ownership: "Privately held",
    tier: "tires-only",
    clevelandLocations: 8,
    openSunday: false,
    walkInPolicy: "limited-walk-in",
    usedTires: false,
    fullServiceMechanical: false,
    dropoffWithRideshare: false,
    strengths: [
      "Free flat repair, free balance, free rotation for the lifetime of the tire — genuinely valuable if you stay loyal",
      "Tire-focused expertise — they only do tires, and they do them well",
      "Clean stores, no-pressure tire-only sales experience",
      "Strong tire warranty programs",
    ],
    weaknesses: [
      "Tires only. Period. They cannot do brakes, oil changes, alignment (most stores), or any mechanical repair",
      "If you have a tire problem AND a brake problem, that's two trips to two places",
      "Closed Sundays at most Cleveland-area locations",
      "Walk-ins handled but waits can be long during busy season",
    ],
    bestFor: [
      "Drivers buying new tires with no other car needs",
      "Customers who want lifetime free flat repair + balance + rotation",
      "Folks who don't mind a separate trip for any mechanical work",
    ],
    notIdealFor: [
      "Anyone who needs brakes, oil, alignment, or any mechanical repair done at the same visit",
      "Used tire shoppers",
      "Drivers needing Sunday service",
      "People who want a one-stop shop",
    ],
    commonComplaints: [
      "Pleasant tire experience but you still need to find a separate shop for mechanical work",
      "Long waits during snow/weather events when everyone needs tires at once",
      "Limited Cleveland-area locations compared to chains like Mavis or Conrad's",
    ],
    pricingNotes:
      "Tire pricing competitive. Free lifetime services on purchased tires offset upfront cost over time IF you stay with them.",
    usedTireFloor: null,
  },

  firestone: {
    slug: "firestone",
    name: "Firestone Complete Auto Care",
    shortName: "Firestone",
    website: "firestonecompleteautocare.com",
    tagline: "Tires, oil, batteries, brakes — and so much more.",
    founded: 1926,
    headquarters: "Nashville, TN",
    ownership: "Owned by Bridgestone Americas",
    tier: "manufacturer-direct",
    clevelandLocations: 10,
    openSunday: false,
    walkInPolicy: "appointment-required",
    usedTires: false,
    fullServiceMechanical: true,
    dropoffWithRideshare: false,
    strengths: [
      "Manufacturer-backed — they know Bridgestone and Firestone tires inside and out",
      "Lifetime alignment program (~$170-200 one-time) is a genuine deal if you keep the car 5+ years",
      "Full-service: tires, brakes, oil, suspension, electrical",
      "Established credit programs and financing options",
    ],
    weaknesses: [
      "Premium chain pricing — labor rates and shop fees on the higher end of the Cleveland market",
      "Appointment-required model with limited walk-in capacity",
      "Closed Sundays at most Cleveland-area locations",
      "Reviews repeatedly mention dealer-style upsell pressure (recommended services beyond the original ask)",
      "Bridgestone/Firestone tire focus means non-house brands sometimes get slower restock",
    ],
    bestFor: [
      "Bridgestone or Firestone tire loyalists",
      "Customers buying the lifetime alignment program who plan to keep the car long-term",
      "Drivers who want corporate/credit-card-style invoicing relationships",
    ],
    notIdealFor: [
      "Budget-conscious drivers comparing labor rates",
      "Walk-ins without an appointment",
      "Anyone needing weekend service",
      "Customers wanting a clear written estimate before any wrench moves",
    ],
    commonComplaints: [
      "High estimates compared to independent shops",
      "Recommended services that turned out to be optional, not urgent",
      "Long waits despite scheduled appointments",
      "Pressure to use Firestone credit card",
    ],
    pricingNotes:
      "Premium chain pricing. Lifetime alignment is the genuine value play; tire pricing is rarely the cheapest in town.",
    usedTireFloor: null,
  },

  monro: {
    slug: "monro",
    name: "Monro Auto Service & Tire (incl. Mr. Tire, Tread Quarters)",
    shortName: "Monro / Mr. Tire",
    website: "monro.com",
    tagline: "Trusted auto service for over 60 years.",
    founded: 1957,
    headquarters: "Rochester, NY",
    ownership: "Monro Inc. — operates Monro, Mr. Tire, Tread Quarters, Car-X brands",
    tier: "national-chain",
    clevelandLocations: 25,
    openSunday: false,
    walkInPolicy: "appointment-preferred",
    usedTires: false,
    fullServiceMechanical: true,
    dropoffWithRideshare: false,
    strengths: [
      "Many Greater Cleveland locations across multiple brand banners (Monro, Mr. Tire, Tread Quarters)",
      "Full-service: tires, brakes, oil, exhaust, mufflers, suspension",
      "Frequent coupon and email promotion programs",
    ],
    weaknesses: [
      "Quality varies wildly store-to-store — same brand sign, very different experiences",
      "Closed Sundays at most locations",
      "Reviews are bimodal: a chunk of customers love their specific manager, another chunk report aggressive upsell",
      "Coupon-driven pricing means the 'real' price often differs from the advertised one",
    ],
    bestFor: [
      "Customers who already have a positive relationship with a specific Monro / Mr. Tire location",
      "Drivers using a current coupon or promo for a specific service",
      "Convenience-driven choices when other shops are too far",
    ],
    notIdealFor: [
      "Anyone wanting predictable, consistent service quality",
      "Sunday service seekers",
      "Customers who want transparent pricing without a coupon",
    ],
    commonComplaints: [
      "Same-brand stores deliver wildly different experiences under different managers",
      "Recommended services that didn't match the customer's actual symptom",
      "Coupon prices that quietly inflate at checkout",
    ],
    pricingNotes:
      "Coupon-driven. Without a coupon, pricing trends higher than independent shops.",
    usedTireFloor: null,
  },

  "big-o": {
    slug: "big-o",
    name: "Big O Tires",
    shortName: "Big O Tires",
    website: "bigotires.com",
    tagline: "The Team You Trust.",
    founded: 1962,
    headquarters: "Palm Beach Gardens, FL",
    ownership: "TBC Corporation (Sumitomo)",
    tier: "national-chain",
    clevelandLocations: 3,
    openSunday: false,
    walkInPolicy: "appointment-preferred",
    usedTires: false,
    fullServiceMechanical: true,
    dropoffWithRideshare: false,
    strengths: [
      "Big O brand-name tire warranties (Big Foot, Legacy lines)",
      "Tire road hazard warranty programs",
      "Some locations offer extended hours during weekday peaks",
    ],
    weaknesses: [
      "Limited Cleveland-area presence — only a handful of locations in Northeast Ohio",
      "Closed Sundays",
      "Pricing skews higher than independent shops",
      "Brand recall is weaker in Cleveland than chains like Conrad's or Mavis",
    ],
    bestFor: [
      "Customers using Big O house-brand tires with road hazard warranty",
      "Drivers near one of the few Cleveland-area locations",
    ],
    notIdealFor: [
      "Anyone outside the immediate footprint of a Cleveland-area Big O store",
      "Sunday service seekers",
      "Budget-focused tire shoppers",
    ],
    commonComplaints: [
      "Limited locations make scheduling friction-heavy",
      "Tire pricing higher than nearby competitors",
    ],
    pricingNotes:
      "House-brand warranty is the value play; otherwise pricing is mid-to-premium.",
    usedTireFloor: null,
  },

  ntb: {
    slug: "ntb",
    name: "NTB (National Tire & Battery)",
    shortName: "NTB",
    website: "ntb.com",
    tagline: "Get more for your money.",
    founded: 1960,
    headquarters: "Millwood, NY (post-Mavis acquisition)",
    ownership: "Mavis Tire Supply (acquired NTB in 2021)",
    tier: "national-chain",
    clevelandLocations: 6,
    openSunday: false,
    walkInPolicy: "appointment-preferred",
    usedTires: false,
    fullServiceMechanical: true,
    dropoffWithRideshare: false,
    strengths: [
      "Recognizable national tire-and-battery brand with established locations",
      "Full-service: tires, brakes, batteries, oil, alignment",
      "Online appointment scheduling",
    ],
    weaknesses: [
      "Now functionally part of Mavis post-2021 acquisition — same store-to-store quality variance",
      "Closed Sundays",
      "Reviews mention same labor + parts add-ons at checkout pattern as Mavis",
      "Brand identity has been fading as Mavis converts NTB stores to the Mavis banner",
    ],
    bestFor: [
      "Customers near a remaining NTB location with a positive history at that specific store",
      "Drivers using NTB-specific promo codes still honored post-acquisition",
    ],
    notIdealFor: [
      "Customers expecting pre-2021 NTB service quality",
      "Sunday service seekers",
      "Walk-ins",
    ],
    commonComplaints: [
      "Service quality drift after Mavis acquisition",
      "Same surprise-at-checkout pattern as Mavis",
      "Confusion about whether the location is still NTB or now branded Mavis",
    ],
    pricingNotes:
      "Effectively Mavis pricing — tire prices look low, full ticket lands higher.",
    usedTireFloor: null,
  },
};

// ─── Competitor review figures ──────────────────────────────────────

/**
 * A competitor's published review figures, hand-researched.
 *
 * These are the ONLY numbers on a comparison page that are legitimately
 * frozen: they describe someone else's storefront and can only be refreshed
 * by a person going and looking. Nick's own side of every comparison is live
 * (see `useReviewStats`), so the derived claims — the star gap, the review
 * depth multiple — must be COMPUTED from the two rather than typed as prose.
 * A hand-typed "6.7× the review depth" was true the week it was written and
 * quietly decays into a false public claim about a named competitor.
 */
export interface CompetitorReviewSnapshot {
  /** Star rating as published by the source, omitted where the claim is count-only. */
  rating?: number;
  /** Number of reviews behind that rating. */
  count: number;
  /** Exactly what was counted — the scope matters to the claim's honesty. */
  source: string;
  /** ISO date a human last verified this. Re-check before citing it again. */
  sourcedAt: string;
}

export const COMPETITOR_REVIEWS: Record<"firestone" | "conrads" | "mavis", CompetitorReviewSnapshot> = {
  firestone: {
    rating: 4.0,
    count: 250,
    source: "Google — Firestone's largest Cleveland location, Downtown at 3917 Prospect Ave",
    sourcedAt: "2026-05-01",
  },
  conrads: {
    count: 137,
    source: "Trustpilot — the entire 38-store Northeast Ohio chain combined",
    sourcedAt: "2026-05-01",
  },
  mavis: {
    rating: 3.9,
    count: 209,
    source: "third-party aggregators for Mavis Pearl Rd, Middleburg Heights (vs 4.6 self-reported on mavis.com)",
    sourcedAt: "2026-05-01",
  },
};

/**
 * Format a ratio for copy: 6.8 → "6.8", 12.0 → "12".
 * One decimal is enough precision to stay honest without reading as spurious.
 */
export function formatMultiple(value: number): string {
  return String(Number(value.toFixed(1)));
}

/**
 * Format a star rating for copy: 4.0 → "4.0", 3.9 → "3.9".
 *
 * Ratings keep the trailing decimal where multiples drop it. Interpolating the
 * raw number renders 4.0 as "4", and on a page whose whole argument is a
 * precision comparison — "4 stars on 250 reviews" against "4.9 stars" — the
 * unpadded form reads sloppy and undersells the gap. Caught in the browser on
 * /firestone-alternative-cleveland.
 */
export function formatRating(value: number): string {
  return value.toFixed(1);
}

// ─── Nick's Tire & Auto profile ─────────────────────────────────────

/**
 * Nick's own profile. A FUNCTION, not a const, because one of its strengths
 * quotes the live Google rating — a module-level constant is evaluated at
 * import time and can never see a hook's value.
 *
 * Takes the DISPLAY string, not the number: the value is only ever
 * interpolated into a bullet, and interpolating the raw number renders a
 * round 4.0 as "4". See useReviewStats' ratingDisplay.
 */
export function buildNicksTire(reviewRatingDisplay: string): CompetitorProfile {
  return {
    slug: "nicks-tire",
    name: "Nick's Tire & Auto",
    shortName: "Nick's",
    website: "nickstire.org",
    tagline: "Pull up for tires. Drop off for repairs.",
    founded: 2018,
    headquarters: "17625 Euclid Ave, Cleveland, OH 44112",
    ownership: "Independently owned and operated by Nick — mechanic + family",
    tier: "regional-chain",
    clevelandLocations: 1,
    openSunday: true,
    walkInPolicy: "walk-in",
    usedTires: true,
    fullServiceMechanical: true,
    dropoffWithRideshare: true,
    strengths: [
      "First-come-first-served — no appointment needed, walk in any day we're awake",
      "Open Sundays 9am-4pm — the chains close, we don't",
      "Drop-off + Uber/Lyft pickup model — leave the car, get a ride back to work, return when it's done",
      "Used tires from $25 installed — when a $25 used tire solves it, we don't push you to a $200 new one",
      "Written estimate before any wrench moves — no surprise shop fees at checkout",
      "Mechanic-owned — the person quoting you the work is the person doing it",
      `${reviewRatingDisplay}★ Google rating from real Cleveland drivers`,
      "Transparent pricing — labor, parts, and disposal fees disclosed up front",
    ],
    weaknesses: [
      "Single location at 17625 Euclid Ave — if you're 30+ miles away, the chains are closer",
      "Smaller crew than national chains — peak hours can mean a wait (we'd rather be honest about that than over-book like the chains do)",
      "Not a fleet contract shop yet — primarily individual/family customer focus",
      "No nationwide warranty network — what we install, we stand behind here",
    ],
    bestFor: [
      "Cleveland-area drivers tired of chain upsell and surprise fees",
      "Anyone whose tire blows on a Sunday or after-hours when the chains are closed",
      "Drivers who can drop the car off and grab a ride to work",
      "Used-tire shoppers — chains won't sell them; we will, and we'll inspect them honestly",
      "Customers who want to see the worn part before authorizing the repair",
    ],
    notIdealFor: [
      "Customers more than 30 miles from Euclid Ave (geography wins)",
      "Drivers needing a specific national-chain warranty for a corporate fleet account",
      "People who genuinely prefer the chain experience and want a waiting room with a coffee machine",
    ],
    commonComplaints: [
      "Single location means peak Saturday afternoons can be busy — the trade-off for never overpromising on appointment slots",
      "Some customers wish we had a second location closer to the West Side",
    ],
    pricingNotes:
      "Used tires from $25 installed (mount, balance, valve stems, TPMS reset, alignment check — all free). New tires at competitive market rates. Labor disclosed in writing before the wrench moves. Open 7 days.",
    usedTireFloor: 25,
  };
}

/** Helper for templates: get profile by slug, falls back to Nick's */
export function getCompetitor(slug: string): CompetitorProfile | null {
  return COMPETITORS[slug] ?? null;
}

/** All competitor slugs in priority order (most-searched first) */
export const COMPETITOR_SLUGS_PRIORITIZED = [
  "conrads",
  "mavis",
  "discount-tire",
  "firestone",
  "monro",
  "big-o",
  "ntb",
] as const;
