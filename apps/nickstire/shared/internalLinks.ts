/**
 * Internal Linking Engine — canonical link graph for SEO + UX.
 *
 * Why this file exists: SEO value accumulates when related pages link
 * to each other contextually. Manually curating "related services" on
 * every page is error-prone. This file is the single source of truth
 * for "if a customer is reading X, what else would help them?"
 *
 * Consumed by (verified 2026-10-01 — before that date this file had ZERO
 * importers and the "consumers" listed here were aspirational):
 *   - client/src/components/RelatedServices.tsx (SERVICE_RELATIONSHIPS is the source)
 *   - client/src/pages/BlogPost.tsx (service chips validated + tag fallback)
 *   - shared/linkGraph.ts (curated prior for server/services/linkRecommender.ts)
 *
 * Edit policy: when you add a new service page, add it here FIRST,
 * then the service page itself. CI catches missing entries.
 */

/**
 * Service-to-service relationships. Each service lists 3–5 other
 * services a customer on this page is likely to also care about.
 * Hand-tuned for relevance, not alphabetical.
 */
export const SERVICE_RELATIONSHIPS: Record<string, string[]> = {
  // 2026-10-01 (Wave C link layer): this map is now LIVE — RelatedServices.tsx
  // reads it as its source and the link recommender treats it as the curated
  // prior. Entries were only ever APPENDED here so every service renders 4
  // cards ("check-engine" is a relationship target without its own service
  // card, so a 4-entry list that includes it renders 3). Never delete an edge.
  // Tires cluster
  "tires":          ["alignment", "brakes", "oil-change", "general-repair"],
  "alignment":      ["tires", "brakes", "general-repair", "oil-change"],

  // Brakes cluster — usually paired with other inspection work
  "brakes":         ["tires", "alignment", "diagnostics", "general-repair"],

  // Engine / diagnostics cluster
  "diagnostics":    ["emissions", "general-repair", "electrical", "check-engine", "brakes"],
  "check-engine":   ["diagnostics", "emissions", "electrical"],
  "emissions":      ["diagnostics", "check-engine", "general-repair", "exhaust", "oil-change"],
  "general-repair": ["diagnostics", "brakes", "oil-change", "electrical"],

  // Maintenance cluster
  "oil-change":     ["tires", "brakes", "general-repair", "diagnostics"],
  "pre-purchase-inspection": ["diagnostics", "brakes", "oil-change", "tires"],

  // HVAC + cooling cluster
  "ac-repair":      ["cooling", "electrical", "diagnostics", "general-repair"],
  "cooling":        ["ac-repair", "general-repair", "belts-hoses", "diagnostics"],

  // Electrical cluster
  "battery":        ["electrical", "starter-alternator", "diagnostics", "general-repair"],
  "starter-alternator": ["battery", "electrical", "diagnostics", "general-repair"],
  "electrical":     ["diagnostics", "battery", "starter-alternator", "general-repair"],

  // Drivetrain cluster
  "transmission":   ["general-repair", "diagnostics", "oil-change", "electrical"],
  "exhaust":        ["emissions", "general-repair", "diagnostics", "cooling"],
  "belts-hoses":    ["cooling", "general-repair", "diagnostics", "oil-change"],
};

/**
 * Blog tags → recommended services to link after the article.
 * Used by BlogPost.tsx to populate "Solve this problem at Nick's".
 */
export const BLOG_TAG_TO_SERVICES: Record<string, string[]> = {
  brakes: ["brakes", "tires", "diagnostics"],
  engine: ["diagnostics", "check-engine", "general-repair"],
  emissions: ["emissions", "diagnostics"],
  tires: ["tires", "alignment", "brakes"],
  oil: ["oil-change", "general-repair"],
  maintenance: ["oil-change", "brakes", "tires", "general-repair"],
  winter: ["tires", "battery", "oil-change", "cooling"],
  summer: ["ac-repair", "cooling", "tires"],
  financing: ["financing"],
  inspection: ["pre-purchase-inspection", "diagnostics", "brakes"],
  transmission: ["transmission", "general-repair"],
  electrical: ["electrical", "battery", "starter-alternator"],
};

/**
 * Service → city pages where that service is particularly relevant.
 * Lets service pages link out to high-intent local pages.
 */
export const SERVICE_TO_CITIES: Record<string, string[]> = {
  tires: ["cleveland", "euclid", "east-cleveland", "south-euclid"],
  brakes: ["cleveland", "euclid", "cleveland-heights"],
  "oil-change": ["cleveland", "euclid", "parma"],
  emissions: ["cleveland", "cuyahoga-county"],
  diagnostics: ["cleveland", "euclid", "lakewood"],
};

/**
 * Service slugs whose own URL is a 301 alias. `/general-repair` has redirected
 * to `/auto-repair-near-me` since the 2026-07-04 GSC audit
 * (server/_core/redirects.ts) — yet 57 static articles, the site-wide
 * InternalLinks strip and every RelatedServices card still linked the alias,
 * so each click and each crawler hop paid a redirect. Found 2026-10-01 by the
 * chip validator in shared/linkGraph.ts. Keyed by the SERVICES slug (which the
 * cards, the icons and the booking flow still use); the value is the canonical
 * route. `server/linkRecommender.test.ts` asserts every key here is in
 * REDIRECTS and every value is not, so this mirror cannot drift silently.
 */
export const SERVICE_PATH_ALIASES: Record<string, string> = {
  "general-repair": "/auto-repair-near-me",
};

/** Canonical route for a service slug or path ("/general-repair" → "/auto-repair-near-me"). */
export function canonicalServicePath(slugOrPath: string): string {
  const cleaned = slugOrPath.replace(/^\//, "");
  return SERVICE_PATH_ALIASES[cleaned] ?? `/${cleaned}`;
}

// `getRelatedServices` and `getServicesForBlogTags` were removed 2026-10-01:
// no caller ever existed, and the second matched NOTHING in practice (keyed by
// single words, real article tags are phrases). RelatedServices.tsx reads
// SERVICE_RELATIONSHIPS directly; `servicesForTagWords` in shared/linkGraph.ts
// is the word-level replacement.

/**
 * Pretty display name for a service slug. Used for link text + alt text.
 */
export function serviceSlugToName(slug: string): string {
  const map: Record<string, string> = {
    tires: "Tires",
    brakes: "Brake Service",
    alignment: "Wheel Alignment",
    diagnostics: "Diagnostics",
    "check-engine": "Check Engine Light",
    emissions: "E-Check / Emissions",
    "oil-change": "Oil Change",
    "general-repair": "General Repair",
    // canonical target of the /general-repair alias — same card, same label
    "auto-repair-near-me": "General Repair",
    "pre-purchase-inspection": "Pre-Purchase Inspection",
    "ac-repair": "A/C Repair",
    cooling: "Cooling System",
    battery: "Battery Service",
    "starter-alternator": "Starter & Alternator",
    electrical: "Electrical Repair",
    transmission: "Transmission",
    exhaust: "Exhaust Service",
    "belts-hoses": "Belts & Hoses",
    financing: "Financing",
  };
  const cleaned = slug.replace(/^\//, "");
  return map[cleaned] ?? cleaned.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}
