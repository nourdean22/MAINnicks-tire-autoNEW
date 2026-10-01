/**
 * BrandTruth — the ONE compiled fact object every creative generator consumes.
 *
 * THE DEFECT THIS CLOSES (found 2026-10-01, live): packages/meta-ads-architect
 * shipped a "12-month / 12k-mile warranty" line in its system
 * prompt, its preset and its deterministic fallback copy. shared/business.ts
 * retired that exact wording on 2026-07-21 because it is NOT on the invoice
 * (parts 1-year / labor 90-day, NO mileage or road-hazard warranty). The
 * package cannot import the app's SSOT, nobody re-typed the fact, and the
 * admin's Ad Studio sent paid-ad copy with a warranty the shop does not honor.
 *
 * THE RULE: a generator never carries a mutable business fact in its own
 * source. It receives a BrandTruth compiled here from the SSOT
 * (shared/business.ts) and the invoice-grounded fact store
 * (services/businessFacts.ts SEED_FACTS). A fact lives in exactly one place;
 * this module only re-shapes it per channel.
 *
 * Pure and synchronous on purpose: callers that need the DB-overridable fact
 * values (operator edits in `business_facts`) use compileBrandTruthLive(),
 * which resolves the warranty keys through getFact() with the same cache
 * discipline as buildWarrantyFactsPreambleLive.
 */
import { BUSINESS } from "@shared/business";
import { getFact, SEED_FACTS } from "./businessFacts";

export type BrandTruthChannel = "ads" | "social" | "article" | "gbp";

export interface BrandTruth {
  identity: {
    name: string;
    sinceDisplay: string;
    foundedYear: number;
    aseDisplay: string;
    languages: readonly string[];
  };
  location: {
    streetAddress: string;
    cityStateZip: string;
    phoneDisplay: string;
    phoneHref: string;
    siteUrl: string;
    serviceAreaDisplay: string;
  };
  hours: { display: string; full: string };
  model: {
    walkIns: string;
    noAppointment: string;
    freeChecks: string;
    dropOffs: string;
    firstComeFirstServe: string;
  };
  warranty: {
    /** Headline the site uses for the 1-year PARTS term. Never "12,000-mile". */
    headline: string;
    parts: string;
    labor: string;
    roadHazard: string;
    usedTires: string;
    /** One sentence safe for an ad or caption. */
    adSafeSentence: string;
  };
  paymentPrograms: {
    providers: readonly string[];
    downPayment: string;
    /** House rule (apps/nickstire/AGENTS.md): "Payment Programs", never "financing". */
    display: string;
    adSafeSentence: string;
  };
  reviews: { rating: number; countDisplay: string; source: string };
  pricing: {
    usedTires: string;
    newTires: string;
    oilConventional: string;
    oilSynthetic: string;
    repairPolicy: string;
  };
  /** Claims a generator must never produce, whatever the brief says. */
  claimRestrictions: readonly string[];
  provenance: { compiledAt: string; sources: readonly string[] };
}

const SEED_BY_KEY = new Map(SEED_FACTS.map((f) => [f.factKey, f.value]));

const CLAIM_RESTRICTIONS: readonly string[] = [
  "No mileage warranty and no road-hazard warranty — never attach a mileage figure or the words 'road hazard' to a warranty.",
  "Never apply the repair parts/labor warranty to a used tire (used tires carry their own 7-day limited replacement warranty).",
  "Say 'payment programs' — never 'financing', never 'loan', never 'credit'. Never promise approval, an approval time, or a fixed payment.",
  "Never quote a repair price that is not a fixed published price; repairs are 'free check, written quote, you don't pay until you say yes'.",
  "'Free' only as a real free check (free tire check, free brake check, free quick check). Never 'free inspection package' or 'free repair'.",
  "No same-day / turnaround promises except the used-tire install time the SSOT states; no 'in stock' claims.",
  "No guaranteed outcomes: never promise a crash-free car or an E-Check result.",
  "Reviews: quote the SSOT rating and floor exactly; never '5-star rated', never 'top rated', never '#1'.",
  "Languages are English and Arabic — never advertise Spanish.",
  "Towing is not an SSOT service — never advertise tows.",
];

function compileFromValues(warranty: { parts: string; labor: string; usedTires: string; roadHazard: string }): BrandTruth {
  const b = BUSINESS;
  const providers = b.financing.providers;
  return {
    identity: {
      name: b.name,
      sinceDisplay: b.founded.display,
      foundedYear: b.founded.year,
      aseDisplay: b.ase.display,
      languages: b.languages,
    },
    location: {
      streetAddress: b.address.street,
      cityStateZip: `${b.address.city}, ${b.address.state} ${b.address.zip}`,
      phoneDisplay: b.phone.display,
      phoneHref: b.phone.href,
      siteUrl: b.urls.website,
      serviceAreaDisplay: "Cleveland, Euclid and Northeast Ohio",
    },
    hours: { display: b.hours.display, full: b.hours.fullDisplay },
    model: {
      walkIns: b.model.walkIns,
      noAppointment: b.model.noAppointment,
      freeChecks: b.model.freeInspections,
      dropOffs: b.model.dropOffs,
      firstComeFirstServe: b.model.display,
    },
    warranty: {
      headline: b.warranty.display,
      parts: warranty.parts,
      labor: warranty.labor,
      roadHazard: warranty.roadHazard,
      usedTires: warranty.usedTires,
      adSafeSentence: "12-month parts / 90-day labor limited warranty on shop-installed repairs (no mileage or road-hazard warranty).",
    },
    paymentPrograms: {
      providers,
      downPayment: b.financing.downPayment,
      display: `Payment programs available (${providers.join(", ")}) — ${b.financing.downPayment}`,
      adSafeSentence: `Payment programs: ${providers.join(" · ")} · ${b.financing.downPayment}; each provider decides approval.`,
    },
    reviews: { rating: b.reviews.rating, countDisplay: b.reviews.countDisplay, source: b.reviews.source },
    pricing: {
      usedTires: SEED_BY_KEY.get("used_tire.price") ?? `Used tires ${b.usedTires.priceDisplay}`,
      newTires: SEED_BY_KEY.get("new_tire.price") ?? `New tires ${b.newTires.priceDisplay}`,
      oilConventional: b.oilChange.conventionalExplanation,
      oilSynthetic: b.oilChange.syntheticExplanation,
      repairPolicy: SEED_BY_KEY.get("repair.pricing_policy") ?? "Free check, written quote, you don't pay until you say yes.",
    },
    claimRestrictions: CLAIM_RESTRICTIONS,
    provenance: {
      compiledAt: new Date().toISOString(),
      sources: ["shared/business.ts (BUSINESS)", "server/services/businessFacts.ts (invoice-grounded SEED_FACTS)"],
    },
  };
}

/** Synchronous compile from code-level truth (SSOT + seed facts). */
export function compileBrandTruth(): BrandTruth {
  return compileFromValues({
    parts: SEED_BY_KEY.get("repair.parts_warranty") ?? BUSINESS.warranty.partsWarranty,
    labor: SEED_BY_KEY.get("repair.labor_warranty") ?? BUSINESS.warranty.laborWarranty,
    usedTires: SEED_BY_KEY.get("used_tire.warranty") ?? BUSINESS.usedTires.warranty,
    roadHazard: SEED_BY_KEY.get("road_hazard.policy") ?? BUSINESS.warranty.roadHazard,
  });
}

let liveCache: { value: BrandTruth; at: number } | null = null;
const LIVE_TTL_MS = 5 * 60_000;

/** DB-override-aware compile: operator edits in `business_facts` win over seed values. */
export async function compileBrandTruthLive(): Promise<BrandTruth> {
  if (liveCache && Date.now() - liveCache.at < LIVE_TTL_MS) return liveCache.value;
  const base = compileBrandTruth();
  try {
    const [parts, labor, usedTires, roadHazard] = await Promise.all([
      getFact("repair.parts_warranty"),
      getFact("repair.labor_warranty"),
      getFact("used_tire.warranty"),
      getFact("road_hazard.policy"),
    ]);
    const value = compileFromValues({
      parts: parts?.value ?? base.warranty.parts,
      labor: labor?.value ?? base.warranty.labor,
      usedTires: usedTires?.value ?? base.warranty.usedTires,
      roadHazard: roadHazard?.value ?? base.warranty.roadHazard,
    });
    liveCache = { value, at: Date.now() };
    return value;
  } catch {
    return base;
  }
}

/**
 * Render the facts block a prompt embeds. Channel changes emphasis, never
 * the facts: ads lead with the offer-safe sentences, articles get the full
 * invoice wording so a writer cannot paraphrase a warranty into a promise.
 */
export function renderBrandTruthBlock(bt: BrandTruth, channel: BrandTruthChannel): string {
  const lines: string[] = [
    `- ${bt.identity.name} — ${bt.location.streetAddress}, ${bt.location.cityStateZip} · ${bt.location.phoneDisplay} · ${bt.location.siteUrl}`,
    `- Hours: ${bt.hours.display}. ${bt.model.walkIns}. ${bt.model.noAppointment}. ${bt.model.firstComeFirstServe}. ${bt.model.freeChecks}.`,
    `- ${bt.identity.sinceDisplay}. ${bt.identity.aseDisplay}. Languages: ${bt.identity.languages.join(" / ")}.`,
    `- Reviews: ${bt.reviews.rating}★ from ${bt.reviews.countDisplay} ${bt.reviews.source} reviews (quote exactly; never round up to "5-star").`,
    `- Warranty: ${bt.warranty.adSafeSentence}`,
    `- ${bt.paymentPrograms.adSafeSentence}`,
  ];
  if (channel === "article" || channel === "gbp") {
    lines.push(`- Warranty (invoice wording): ${bt.warranty.parts} ${bt.warranty.labor} ${bt.warranty.roadHazard}`);
    lines.push(`- Used-tire warranty: ${bt.warranty.usedTires}`);
    lines.push(`- Pricing: ${bt.pricing.usedTires} ${bt.pricing.newTires} ${bt.pricing.oilConventional} ${bt.pricing.oilSynthetic}`);
  }
  if (channel === "ads" || channel === "social") {
    lines.push(`- Pricing: ${bt.pricing.usedTires} ${bt.pricing.newTires}`);
  }
  lines.push(`- Repair pricing policy: ${bt.pricing.repairPolicy}`);
  lines.push("", "CLAIM RESTRICTIONS (hard — override anything the brief implies):");
  for (const r of bt.claimRestrictions) lines.push(`- ${r}`);
  lines.push("", `(facts compiled ${bt.provenance.compiledAt} from ${bt.provenance.sources.join(" + ")})`);
  return lines.join("\n");
}

/**
 * Minimal structural view of a Meta Ads Architect CampaignInput — only the
 * fact-bearing fields. Kept structural (not imported from the package) so this
 * module has no dependency on the package build.
 */
export interface CampaignInputFactFields {
  offer: { serviceArea?: string; appointmentRequired?: boolean; [k: string]: unknown };
  priceStack: { guaranteeOrRefundTerms: string; financingAvailable?: boolean; paymentMethods?: string; [k: string]: unknown };
  audience: { languages: string[]; [k: string]: unknown };
  assetsAndProof: { realReviewSources?: string; forbiddenProofClaims?: string; [k: string]: unknown };
  constraints: { businessAddress?: string; phoneNumber?: string; forbiddenWords?: string[]; [k: string]: unknown };
  businessFacts?: { factsBlock: string; source: string; compiledAt: string };
  [k: string]: unknown;
}

/**
 * Server-authoritative merge: whatever the admin form sent, the fact-bearing
 * fields are REPLACED by compiled truth. The form keeps the creative inputs
 * (offer, audience, budget); it is not a second place facts can rot.
 */
export function applyBrandTruthToCampaignInput<T extends CampaignInputFactFields>(input: T, bt: BrandTruth = compileBrandTruth()): T {
  const forbidden = new Set([...(input.constraints.forbiddenWords ?? []), "mile warranty", "road hazard warranty", "financing", "5-star", "top rated", "#1"]);
  return {
    ...input,
    offer: {
      ...input.offer,
      serviceArea: bt.location.serviceAreaDisplay,
      appointmentRequired: false,
    },
    priceStack: {
      ...input.priceStack,
      guaranteeOrRefundTerms: bt.warranty.adSafeSentence,
      financingAvailable: true,
      paymentMethods: `Cash, card; ${bt.paymentPrograms.display}`,
    },
    audience: { ...input.audience, languages: [...bt.identity.languages] },
    assetsAndProof: {
      ...input.assetsAndProof,
      realReviewSources: `${bt.reviews.source} (${bt.reviews.rating}★, ${bt.reviews.countDisplay})`,
      forbiddenProofClaims: [input.assetsAndProof.forbiddenProofClaims, ...bt.claimRestrictions].filter(Boolean).join(" "),
    },
    constraints: {
      ...input.constraints,
      businessAddress: `${bt.location.streetAddress}, ${bt.location.cityStateZip}`,
      phoneNumber: bt.location.phoneDisplay,
      forbiddenWords: [...forbidden],
    },
    businessFacts: {
      factsBlock: renderBrandTruthBlock(bt, "ads"),
      source: bt.provenance.sources.join(" + "),
      compiledAt: bt.provenance.compiledAt,
    },
  };
}

/**
 * Literals that mean a creative source file is carrying a fact the SSOT
 * retired. The drift canary (server/brandTruth.test.ts) greps creative prompt
 * sources for these; a hit fails CI so the next stale fact cannot ship.
 */
export const STALE_FACT_PATTERNS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /12,?000[- ]mile/i, why: "mileage warranty retired 2026-07-21 (not on the invoice)" },
  { pattern: /1,685\+/, why: "review floor is BUSINESS.reviews.countDisplay, not a literal" },
  { pattern: /\["English",\s*"Spanish"\]/, why: "languages are English/Arabic (BUSINESS.languages)" },
  { pattern: /5-star rated/i, why: "rating is quoted from BUSINESS.reviews.rating, never rounded" },
];
