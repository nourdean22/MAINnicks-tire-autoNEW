/**
 * Brand / entity consistency tracker — canonical NAP vs each external
 * platform, for the owner to enforce by hand.
 *
 * 2026-06-10 GBP growth wave. Identity drift across listings (different
 * names/addresses/phones) suppresses local SEO. No code can log into
 * these platforms; this is a structured manual tracker the owner works
 * platform by platform. Nothing here edits any listing.
 *
 * 2026-10-25: the hard-coded "not_checked" status is gone. Whether a platform
 * was verified is the owner's own mark (localGrowth.checklist, slug
 * `entity-<id>`), dated and named, set from the Entity / Brand tab.
 */

export interface CanonicalIdentity {
  name: string;
  address: string;
  phone: string;
  website: string;
  instagram: string;
}

export const CANONICAL_IDENTITY: CanonicalIdentity = {
  name: "Nick's Tire & Auto",
  address: "17625 Euclid Ave, Cleveland, OH 44112",
  phone: "(216) 862-0005",
  website: "nickstire.org",
  instagram: "@nicks_tire_euclid",
};

export interface EntityPlatform {
  /** Stable checklist id (mark slug `entity-<id>`): never rename, a rename orphans the saved mark. */
  id: string;
  platform: string;
  /** What to verify on this platform. */
  checkFields: string[];
  ownerAction: string;
  accessNeeded: string;
  /** Can any automation safely touch this? Always false (external edits). */
  automationSafe: false;
  riskIfIgnored: string;
}

export const ENTITY_PLATFORMS: EntityPlatform[] = [
  { id: "google-business-profile", platform: "Google Business Profile", checkFields: ["name", "address", "phone", "website", "hours", "categories"], ownerAction: "Edit in the GBP manager; remove any old phone numbers or names.", accessNeeded: "Google account that owns the listing", automationSafe: false, riskIfIgnored: "Highest local-SEO impact — drift here directly suppresses map-pack ranking." },
  { id: "facebook", platform: "Facebook", checkFields: ["name", "address", "phone", "website"], ownerAction: "Edit page info; align to canonical NAP.", accessNeeded: "Page admin", automationSafe: false, riskIfIgnored: "Inconsistent NAP weakens the overall citation signal." },
  { id: "instagram", platform: "Instagram", checkFields: ["handle", "bio phone", "website link"], ownerAction: "Confirm @nicks_tire_euclid + correct phone/link in bio.", accessNeeded: "@nicks_tire_euclid login", automationSafe: false, riskIfIgnored: "Customers lose the trail between social and the shop." },
  { id: "yelp", platform: "Yelp", checkFields: ["name", "address", "phone", "website", "hours"], ownerAction: "Claim the listing if unclaimed; align NAP.", accessNeeded: "Yelp for Business login", automationSafe: false, riskIfIgnored: "Yelp is a strong citation source; drift here is widely scraped." },
  { id: "carfax", platform: "CARFAX", checkFields: ["name", "address", "phone"], ownerAction: "Correct shop NAP in the CARFAX shop portal.", accessNeeded: "CARFAX shop portal login", automationSafe: false, riskIfIgnored: "Service-history listings show a wrong identity to buyers." },
  { id: "bbb", platform: "BBB", checkFields: ["name", "address", "website"], ownerAction: "Update business profile in the BBB portal.", accessNeeded: "BBB business portal login", automationSafe: false, riskIfIgnored: "Trust-signal source with a wrong identity." },
  { id: "acima", platform: "Acima (merchant locator)", checkFields: ["store name", "address", "phone"], ownerAction: "Ask the Acima rep to correct the store entry.", accessNeeded: "Merchant account / rep", automationSafe: false, riskIfIgnored: "Payment-program customers can't find the right store." },
  { id: "mapquest", platform: "MapQuest / Maptons", checkFields: ["name", "address", "phone"], ownerAction: "Claim/edit the listing.", accessNeeded: "Email verification", automationSafe: false, riskIfIgnored: "Aggregator drift feeds other directories." },
  { id: "old-google-sites", platform: "Old Google Sites remnants", checkFields: ["any old branding/phone pages"], ownerAction: "Delete or redirect stale *.google.site pages.", accessNeeded: "Owning Google account", automationSafe: false, riskIfIgnored: "Old pages compete with nickstire.org and confuse customers." },
  { id: "other-directories", platform: "Other directories (discovered later)", checkFields: ["NAP consistency"], ownerAction: "Edit or request correction as found.", accessNeeded: "Varies", automationSafe: false, riskIfIgnored: "Long-tail citation noise." },
];

/** Recommended order of attack, highest local-SEO value first. */
export const ENTITY_FIX_ORDER = [
  "Google Business Profile", "Yelp", "Facebook", "BBB", "CARFAX",
  "Acima (merchant locator)", "MapQuest / Maptons", "Old Google Sites remnants",
];
