/**
 * TIRE BRAND DATA — single source for /[brand]-tires-cleveland silos.
 *
 * Each entry powers a dedicated landing page targeting brand+geo
 * queries like "michelin tires cleveland", "goodyear tires near me".
 * Pages share the same template (TireBrandPage.tsx) — only the data
 * changes per brand. Add a brand: add an entry here + register the
 * route in App.tsx and shared/routes.ts.
 */

export interface TireBrand {
  /** Route segment, e.g. "michelin" → /michelin-tires-cleveland */
  slug: string;
  /** Brand display name */
  name: string;
  /** One-line elevator description */
  tagline: string;
  /** Brand strengths in our own words (3-5 bullets) */
  strengths: string[];
  /** Popular tire lines we install most often (model + use) */
  popularLines: { model: string; use: string }[];
  /** "Best for" framing — what kind of driver this brand serves best */
  bestFor: string;
  /** Honest tradeoff — every brand has one, building trust by saying it */
  tradeoff: string;
  /** Logo URL (CloudFront-hosted vendor logos already in TireFinder) */
  logoUrl: string;
}

const CDN = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV";

export const TIRE_BRANDS: TireBrand[] = [
  {
    slug: "michelin",
    name: "Michelin",
    tagline: "Premium tread life and quiet ride. The longest-lasting tier.",
    strengths: [
      "Industry-leading tread-life warranties (60,000-90,000 miles on most all-season models)",
      "Quietest highway ride at speed — measurable cabin noise reduction vs budget brands",
      "Best wet-weather grip in independent testing (Defender, Premier A/S)",
      "Strong resale value if you trade the car — Michelins read as a maintained vehicle",
    ],
    popularLines: [
      { model: "Defender 2 / Defender LTX M/S", use: "Daily passenger + truck/SUV — the flagship long-life all-season" },
      { model: "Premier A/S", use: "Wet-weather priority drivers — best-in-class wet grip" },
      { model: "Pilot Sport 4S / 5", use: "Performance / sports car — track-capable summer tires" },
      { model: "X-Ice / Latitude X-Ice", use: "Dedicated winter — Cleveland snow and ice" },
    ],
    bestFor: "The driver who keeps a car 5+ years and wants to set + forget tires for 60K+ miles. Higher upfront cost, lower per-mile cost.",
    tradeoff: "Michelin runs $40-100 more per tire vs comparable budget brands. The math works if you actually keep the car long enough to use the extra mileage.",
    logoUrl: `${CDN}/michelin_f5739757.png`,
  },
  {
    slug: "goodyear",
    name: "Goodyear",
    tagline: "Cleveland-rooted brand. Strong all-around with deep model lineup.",
    strengths: [
      "Wide model range — there's a Goodyear for every budget and use case",
      "Akron-based brand (Ohio HQ) — local pride for some buyers, plus solid distribution",
      "Assurance line offers excellent wet/dry balance for daily commuters",
      "Strong winter / all-weather options (WeatherReady, WinterCommand)",
    ],
    popularLines: [
      { model: "Assurance MaxLife / WeatherReady", use: "Daily commuter — long tread life or all-weather snowflake-rated" },
      { model: "Eagle Sport / Eagle F1", use: "Performance car — sporty grip + steering response" },
      { model: "Wrangler All-Terrain Adventure", use: "Truck / SUV mixed pavement and light off-road" },
      { model: "WinterCommand", use: "Dedicated winter — Cleveland snow specialist" },
    ],
    bestFor: "The driver who wants a recognizable brand with options across price tiers — a known quantity that's been on millions of cars.",
    tradeoff: "Goodyear's mid-tier (Assurance) is excellent. Their lower-tier (Reliant) is just-okay — if you're going Goodyear, spend up to the Assurance line.",
    logoUrl: `${CDN}/goodyear_03e6b30e.png`,
  },
  {
    slug: "bridgestone",
    name: "Bridgestone",
    tagline: "Premium build quality + technical innovation. The engineer's tire.",
    strengths: [
      "Top-tier OEM partner — fitted on many Toyota, Honda, Lexus, BMW from factory",
      "Turanza line is among the quietest premium all-seasons available",
      "Blizzak winter tires set the bar for ice/snow grip — multiple Tire Rack tests",
      "Solid wet-weather grip; tread compounds engineered for compound longevity",
    ],
    popularLines: [
      { model: "Turanza QuietTrack / Turanza EL Series", use: "Premium daily commuter — quietest highway ride in segment" },
      { model: "Dueler H/L Alenza Plus", use: "SUV / truck — pavement-priority with light off-road capability" },
      { model: "Potenza S007 / RE980 AS+", use: "Performance car — summer or all-season ultra-high performance" },
      { model: "Blizzak WS90 / DM-V2", use: "Dedicated winter — best-in-class snow/ice grip per Tire Rack" },
    ],
    bestFor: "Drivers who already own a car that came from the factory on Bridgestones — sticking with the OEM tire keeps ride characteristics consistent.",
    tradeoff: "Bridgestone pricing is full premium tier. Their budget options (Ecopia line) are decent but not the brand's strength — go premium or pick a different brand.",
    logoUrl: `${CDN}/bridgestone_3a002c89.jpg`,
  },
  {
    slug: "firestone",
    name: "Firestone",
    tagline: "Mid-tier brand with strong value plays. Owned by Bridgestone, made to a price.",
    strengths: [
      "All-Season touring tires (Champion Fuel Fighter) hit a price/performance sweet spot",
      "Owned by Bridgestone — quality control and engineering DNA shared",
      "Destination line is well-regarded for trucks and SUVs",
      "Often the smart pick when the budget says \"used or budget-new\" — Firestone slots in between",
    ],
    popularLines: [
      { model: "Champion Fuel Fighter", use: "Budget-conscious daily commuter — long tread life at an accessible price" },
      { model: "WeatherGrip", use: "All-weather (snowflake-rated) for drivers who want one tire that handles winter" },
      { model: "Destination LE3 / X/T", use: "SUV / truck / light off-road — strong sidewall, versatile tread" },
      { model: "Firehawk Indy 500", use: "Performance — affordable summer/all-season for sport sedans" },
    ],
    bestFor: "Drivers who want a recognizable name without paying premium-tier prices — get 80% of the performance for 60-70% of the cost.",
    tradeoff: "Firestone won't out-perform top-tier Michelin or Bridgestone in head-to-head testing. If you want best-in-class, spend up. If you want \"good and reliable,\" Firestone delivers.",
    logoUrl: `${CDN}/firestone_c2804191.png`,
  },
  {
    slug: "continental",
    name: "Continental",
    tagline: "European engineering. Strong wet grip and quiet ride.",
    strengths: [
      "Industry-leading wet-weather braking distance (TrueContact, ExtremeContact lines)",
      "OEM on many European cars (BMW, Mercedes, Audi, VW) — perfect fit for those vehicles",
      "Quiet, comfortable ride — engineered for premium-feel cars",
      "Strong all-weather options for Cleveland's mixed conditions",
    ],
    popularLines: [
      { model: "TrueContact Tour", use: "Daily passenger — long-life all-season, excellent wet grip" },
      { model: "ExtremeContact DWS06 Plus", use: "Performance / all-season — sporty grip year-round" },
      { model: "TerrainContact A/T / H/T", use: "SUV / truck — pavement-priority all-terrain or highway" },
      { model: "VikingContact 7", use: "Dedicated winter — strong ice + snow performance" },
    ],
    bestFor: "European-car owners (BMW, Mercedes, Audi, VW) and drivers who prioritize wet-weather safety — Continental tests well in both.",
    tradeoff: "Premium-tier pricing. Tread life is good but Michelin Defender typically out-wears equivalent Continental in the same use case.",
    logoUrl: `${CDN}/continental_8f6621dd.png`,
  },
];

export const TIRE_BRAND_SLUGS = TIRE_BRANDS.map((b) => b.slug);

export function getTireBrand(slug: string): TireBrand | undefined {
  return TIRE_BRANDS.find((b) => b.slug === slug);
}
