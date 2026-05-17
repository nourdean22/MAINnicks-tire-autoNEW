/**
 * Internal Linking Engine — canonical link graph for SEO + UX.
 *
 * Why this file exists: SEO value accumulates when related pages link
 * to each other contextually. Manually curating "related services" on
 * every page is error-prone. This file is the single source of truth
 * for "if a customer is reading X, what else would help them?"
 *
 * Consumed by:
 *   - ServicePage.tsx (bottom "Related services" strip)
 *   - BlogPost.tsx (sidebar + in-body links)
 *   - CityPage / NeighborhoodPage (services the area needs most)
 *   - FAQ.tsx (related guides)
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
  // Tires cluster
  "tires":          ["alignment", "brakes", "oil-change", "general-repair"],
  "alignment":      ["tires", "brakes", "general-repair"],

  // Brakes cluster — usually paired with other inspection work
  "brakes":         ["tires", "alignment", "diagnostics", "general-repair"],

  // Engine / diagnostics cluster
  "diagnostics":    ["emissions", "general-repair", "electrical", "check-engine"],
  "check-engine":   ["diagnostics", "emissions", "electrical"],
  "emissions":      ["diagnostics", "check-engine", "general-repair"],
  "general-repair": ["diagnostics", "brakes", "oil-change", "electrical"],

  // Maintenance cluster
  "oil-change":     ["tires", "brakes", "general-repair"],
  "pre-purchase-inspection": ["diagnostics", "brakes", "oil-change", "tires"],

  // HVAC + cooling cluster
  "ac-repair":      ["cooling", "electrical", "diagnostics"],
  "cooling":        ["ac-repair", "general-repair"],

  // Electrical cluster
  "battery":        ["electrical", "starter-alternator"],
  "starter-alternator": ["battery", "electrical", "diagnostics"],
  "electrical":     ["diagnostics", "battery", "starter-alternator"],

  // Drivetrain cluster
  "transmission":   ["general-repair", "diagnostics"],
  "exhaust":        ["emissions", "general-repair"],
  "belts-hoses":    ["cooling", "general-repair"],
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
 * Get N related service paths for the given current service slug.
 * Returns slugs with leading slash (so components can drop them into <a href>).
 */
export function getRelatedServices(currentSlug: string, limit: number = 4): string[] {
  const cleaned = currentSlug.replace(/^\//, "");
  const related = SERVICE_RELATIONSHIPS[cleaned] ?? [];
  return related.slice(0, limit).map((s) => `/${s}`);
}

/**
 * Given a blog post's tags, return a de-duplicated list of related
 * service paths (max 4).
 */
export function getServicesForBlogTags(tags: string[], limit: number = 4): string[] {
  const services = new Set<string>();
  for (const tag of tags) {
    const matches = BLOG_TAG_TO_SERVICES[tag.toLowerCase()] ?? [];
    matches.forEach((s) => services.add(s));
    if (services.size >= limit) break;
  }
  return Array.from(services).slice(0, limit).map((s) => `/${s}`);
}

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
