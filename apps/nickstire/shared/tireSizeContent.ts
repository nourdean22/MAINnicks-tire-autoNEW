/**
 * Category-specific buying-guide content for /tires/:size pages
 *
 * Why this exists · the 32 programmatic TireSizePage routes share a
 * single component template. Without unique editorial content per
 * category, Google's algorithm correctly identifies these as
 * templated SEO pages and ranks them lower than competitor pages with
 * differentiated content. This module provides 4 category-specific
 * buying guides that the template renders based on `page.category`.
 *
 * Differentiation strategy (per E-E-A-T doctrine):
 *   - Sedan pages talk fuel-economy + smooth-ride + tread-life
 *   - SUV/Crossover pages talk all-weather + family + winter
 *   - Truck pages talk load rating + towing + work-vehicle durability
 *   - Performance pages talk speed rating + handling + dry-traction
 *
 * Brand voice · canonical Repair Haiku + §11 Eagerness Beat. No fluff,
 * no kill-list words ("expert" / "quality" / "trusted" etc.), no claims
 * we can't back up. Practical buyer-facing copy.
 *
 * Tier S compounding · wave-181.x.
 */

import type { TireSizePage } from "./tireSizes";

export interface BuyingGuide {
  /** Section heading · short and direct */
  heading: string;
  /** ~150-word body · category-specific buyer education */
  body: string;
  /** 3-4 bullets · what to look for on the sidewall */
  sidewallTips: string[];
  /** 2-3 related-service slugs · tire-size-aware internal links */
  relatedServices: Array<{ slug: string; label: string; why: string }>;
}

const SEDAN_GUIDE: BuyingGuide = {
  heading: "Choosing tires for a sedan",
  body:
    "Sedans live or die on three numbers · ride comfort, fuel economy, and tread life. The biggest mistake we see is drivers picking the cheapest tire on the wall and burning through it in 15,000 miles. A mid-tier all-season tire from a name brand will run you about $20 more per tire than the bottom shelf · and it'll outlast the cheap option by 25,000 miles. That's not opinion, that's the treadwear rating on the sidewall doing the math. " +
    "If you commute, look for 'low rolling resistance' on the spec sheet — that translates directly to mpg. If you drive Ohio winters, the tread compound matters more than the brand · ask which compound stays soft below 45°F. " +
    "We stock the popular sedan sizes year-round. If you're not sure what you need, photograph your sidewall and text us · we'll tell you the three closest options at three price points.",
  sidewallTips: [
    "Treadwear number — higher = longer life (300+ for a commuter)",
    "Temperature rating — A or B is fine for daily driving",
    "DOT date code (last 4 digits) — newer than 24 months for new tires",
    "M+S marking if you want any winter capability without dedicated snows",
  ],
  relatedServices: [
    { slug: "alignment", label: "4-wheel alignment", why: "uneven tread wear on a sedan almost always means alignment is off" },
    { slug: "oil-change", label: "synthetic oil change", why: "tire purchase is the right time to check fluids" },
    { slug: "brakes", label: "brake inspection", why: "tire-off is the only time the back side of the rotor is visible · 20-second check" },
  ],
};

const SUV_GUIDE: BuyingGuide = {
  heading: "Choosing tires for an SUV or crossover",
  body:
    "SUV tires carry more weight than sedan tires · period. That extra weight wears the tread faster, makes alignment more important, and makes the wrong tire feel sloppy in turns. The two failure modes we see most on SUVs · drivers buying a 'truck' tire that's overbuilt for the vehicle (rough ride, mpg penalty) or buying a 'highway' tire that can't handle even mild snow. " +
    "For a daily-driven Ohio SUV, look for an 'all-weather' or '3PMSF-rated' tire (three-peak mountain snowflake symbol). That's the new standard for tires that work in real winter without going to dedicated snows. Avoid the cheapest tier · SUV weight shortens the life of bottom-shelf tires fast. " +
    "We stock the popular SUV sizes including the most-asked ones · 225/65R17, 235/65R18, 245/60R20. If you tow a small trailer or boat, mention it before we order · the load rating you need is one number higher than stock for safe towing margin.",
  sidewallTips: [
    "Load index — higher = more weight capacity (104+ for full-size SUVs)",
    "3PMSF symbol (three-peak mountain snowflake) for real winter performance",
    "Speed rating H or V for daily driving (T is acceptable on heavier SUVs)",
    "Sidewall labeling — 'all-terrain' for actual off-road, 'all-season' for paved",
  ],
  relatedServices: [
    { slug: "alignment", label: "4-wheel alignment", why: "SUVs go out of alignment faster than sedans · do it with the tires" },
    { slug: "brakes", label: "brake check", why: "heavier vehicle = harder on pads and rotors" },
    { slug: "diagnostics", label: "tire pressure sensor reset", why: "TPMS often needs a relearn after tire changes · we do it free with installs" },
  ],
};

const TRUCK_GUIDE: BuyingGuide = {
  heading: "Choosing tires for a truck",
  body:
    "Truck tires are where the wrong choice costs the most money. A tire that's too aggressive (mud-terrain, lifted-truck style) on a daily-driven F-150 will eat 5-8 mpg and roar at highway speed. A tire that's too soft (a light highway tire on a work truck that hauls weekly) will wear out in a year. " +
    "The honest answer for most Cleveland trucks · all-terrain with a load range C or D rating. That's the middle path · enough sidewall stiffness for towing and worksite use, enough tread block flexibility for daily mpg and noise. If you almost never go off pavement, a 'highway terrain' tire will give you 60,000+ miles and 2-3 mpg better than all-terrain. " +
    "What we don't recommend without a real reason · LT (Light Truck) tires on a half-ton you don't tow with. The stiffer sidewall is overkill, the ride suffers, and you pay $40+ more per tire. If you're not sure what your truck's manufacturer spec'd, the door-jamb sticker has the answer.",
  sidewallTips: [
    "Load range (C, D, E) — C for light duty, D for moderate towing, E for heavy work",
    "LT designation only if you actually need it (check door-jamb sticker)",
    "Tread depth — 14/32\" or deeper is standard for new all-terrains",
    "Sidewall plies — 3-ply is plenty for daily driving + light towing",
  ],
  relatedServices: [
    { slug: "alignment", label: "alignment + thrust angle", why: "trucks fall out of alignment fast · especially after curb hits or heavy loads" },
    { slug: "brakes", label: "rotor + pad inspection", why: "truck weight is hard on brakes · catch wear before it becomes a rotor replacement" },
    { slug: "transmission", label: "transmission fluid check", why: "if you tow, tire change is the right moment to check trans temp + fluid color" },
  ],
};

const PERFORMANCE_GUIDE: BuyingGuide = {
  heading: "Choosing tires for a performance car",
  body:
    "Performance tires are about three things · grip, response, and rim protection. If you're driving an M3, an Audi S-anything, a Hellcat, a 911 · the OEM tire on that car was matched to the car at the factory. Going down one tier in tire compound is the fastest way to make an expensive car feel cheap. " +
    "What that doesn't mean · you have to pay $400 a tire. The mid-tier 'max performance summer' from Michelin (Pilot Sport), Continental (ExtremeContact), or Bridgestone (Potenza) gets you 85% of the grip of the top OEM tire at 60% of the price. The honest tradeoff · 15,000-25,000 miles of tread life vs the 35,000-mile touring tire on the same car. " +
    "Ohio drivers · one note. Summer-only performance tires harden below 45°F. If you drive year-round, ask about 'ultra-high-performance all-season' instead · you give up a few percent of dry grip for tires that won't go dangerous in November. We don't recommend snow tires on most performance cars unless you're committed to a second set of wheels.",
  sidewallTips: [
    "Speed rating W (168 mph) or Y (186 mph) for most modern performance cars",
    "Treadwear 300 or below for true performance compound · higher means harder rubber",
    "Sidewall stiffness — ask about 'rim-protector' edge if you have 19\"+ wheels",
    "DOT date code matters more · old performance tires lose grip even unused",
  ],
  relatedServices: [
    { slug: "alignment", label: "performance alignment", why: "track-day cars and aggressive driving need a tighter spec than factory" },
    { slug: "brakes", label: "brake fluid check", why: "performance brake pads boil bad fluid · bleed every 2 years if you drive hard" },
    { slug: "diagnostics", label: "TPMS recalibration", why: "lower-profile tires run different pressures · sensor often needs adjustment" },
  ],
};

const GUIDES: Record<TireSizePage["category"], BuyingGuide> = {
  Sedan: SEDAN_GUIDE,
  "SUV/Crossover": SUV_GUIDE,
  Truck: TRUCK_GUIDE,
  Performance: PERFORMANCE_GUIDE,
};

export function getBuyingGuide(category: TireSizePage["category"]): BuyingGuide {
  return GUIDES[category];
}
