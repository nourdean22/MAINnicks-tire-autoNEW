/**
 * Business facts / approved-claims store (NCSOS layer 1+2).
 *
 * THE PROBLEM IT SOLVES
 * Business facts (prices, warranty terms, policies) were hardcoded across prompts,
 * templates and constants — so a used-tire price drifted three ways and no
 * used-tire warranty existed as a fact at all, leaving the AI able to reach only
 * the repair warranty (a false promise on a tire). Worse, the repair warranty in
 * code ("12 months / 12,000 miles") did not match the shop's actual invoice
 * (1-year parts / 90-day labor, no mileage warranty). This store grounds every
 * fact in the invoice legal text and carries its provenance: source, approver,
 * effective + verified dates, and the channels it may be used on.
 *
 * TWO LAYERS, ONE ANSWER
 * - SEED_FACTS is the code source of truth (always available, versioned in git,
 *   price fields linked to the BUSINESS SSOT so they can never re-hardcode).
 * - The `business_facts` table is the operator-editable override: seedBusinessFacts
 *   upserts SEED_FACTS, and getFact reads the DB first, falling back to SEED_FACTS
 *   so a fact is NEVER unavailable. The operator can correct a fact in the DB
 *   without a deploy; the code default keeps the system honest if the DB is empty.
 *
 * SOURCE: the warranty/refund/policy values are transcribed from the shop's
 * printed invoice terms (Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto),
 * owner-supplied 2026-07-21. Do not soften or embellish them.
 */
import { BUSINESS } from "@shared/business";
import { createLogger } from "../lib/logger";

const log = createLogger("business-facts");

export type FactChannel = "sms" | "voice" | "web";
export type FactCategory = "pricing" | "warranty" | "policy" | "hours" | "service" | "legal";

export interface BusinessFact {
  factKey: string;
  category: FactCategory;
  /** The customer-facing statement. */
  value: string;
  /** Where this fact came from. */
  source: string;
  approvedBy: string;
  /** ISO date (YYYY-MM-DD). */
  effectiveDate: string;
  verifiedDate: string;
  channels: FactChannel[];
}

const ALL: FactChannel[] = ["sms", "voice", "web"];
const INVOICE = "Printed invoice terms (Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto), owner-supplied 2026-07-21";
const SSOT = "BUSINESS SSOT (shared/business.ts)";

/**
 * The canonical facts. Price fields interpolate BUSINESS so they can never
 * re-hardcode a stale value; warranty/policy facts are transcribed from the
 * invoice legal text.
 */
export const SEED_FACTS: BusinessFact[] = [
  // ─── Pricing (SSOT-linked) ──────────────────────────────────────────────
  {
    factKey: "used_tire.price", category: "pricing",
    value: `Used tires ${BUSINESS.usedTires.priceDisplay} (${BUSINESS.usedTires.fineprint}); ${BUSINESS.usedTires.typicalBand}.`,
    source: SSOT, approvedBy: "Nour", effectiveDate: "2026-07-12", verifiedDate: "2026-07-21", channels: ALL,
  },
  {
    factKey: "new_tire.price", category: "pricing",
    value: `New tires ${BUSINESS.newTires.priceDisplay}. ${BUSINESS.newTires.positioning}`,
    source: SSOT, approvedBy: "Nour", effectiveDate: "2026-07-12", verifiedDate: "2026-07-21", channels: ALL,
  },
  {
    factKey: "oil.conventional.price", category: "pricing",
    value: BUSINESS.oilChange.conventionalExplanation,
    source: SSOT, approvedBy: "Nour", effectiveDate: "2026-06-01", verifiedDate: "2026-07-21", channels: ALL,
  },
  {
    factKey: "oil.synthetic.price", category: "pricing",
    value: BUSINESS.oilChange.syntheticExplanation,
    source: SSOT, approvedBy: "Nour", effectiveDate: "2026-06-01", verifiedDate: "2026-07-21", channels: ALL,
  },
  {
    factKey: "repair.pricing_policy", category: "policy",
    value: "For any repair beyond the fixed prices, never quote a number blind — free check, written quote, you don't pay until you say yes.",
    source: "BUSINESS operating model + brand voice", approvedBy: "Nour", effectiveDate: "2026-06-01", verifiedDate: "2026-07-21", channels: ALL,
  },

  // ─── Warranty (invoice legal text) ──────────────────────────────────────
  {
    factKey: "used_tire.warranty", category: "warranty",
    value: "Used tires include a 7-day limited replacement warranty against verified loss of air or internal tire failure due solely to a defect present at the time of sale. It does NOT cover punctures, nails/screws, sidewall/impact/bead damage, run-flat damage, cosmetic issues, vibration, uneven wear, alignment issues, improper inflation, overloading, or misuse. No road-hazard or mileage warranty.",
    source: INVOICE, approvedBy: "Nour", effectiveDate: "2026-07-21", verifiedDate: "2026-07-21", channels: ALL,
  },
  {
    factKey: "repair.parts_warranty", category: "warranty",
    value: "Shop-installed parts include a 1-year limited parts warranty unless otherwise stated in writing on the invoice.",
    source: INVOICE, approvedBy: "Nour", effectiveDate: "2026-07-21", verifiedDate: "2026-07-21", channels: ALL,
  },
  {
    factKey: "repair.labor_warranty", category: "warranty",
    value: "Shop labor includes a 90-day limited labor warranty unless otherwise stated in writing on the invoice.",
    source: INVOICE, approvedBy: "Nour", effectiveDate: "2026-07-21", verifiedDate: "2026-07-21", channels: ALL,
  },
  {
    factKey: "new_tire.warranty", category: "warranty",
    value: "New tires are covered only by the applicable manufacturer's written limited warranty unless an additional shop warranty is expressly stated in writing on the invoice.",
    source: INVOICE, approvedBy: "Nour", effectiveDate: "2026-07-21", verifiedDate: "2026-07-21", channels: ALL,
  },
  {
    factKey: "road_hazard.policy", category: "warranty",
    value: "No road-hazard warranty or mileage warranty is provided by the shop unless expressly stated in writing on the invoice.",
    source: INVOICE, approvedBy: "Nour", effectiveDate: "2026-07-21", verifiedDate: "2026-07-21", channels: ALL,
  },
  {
    factKey: "alignment.warranty", category: "warranty",
    value: "Alignments are a setting service only and are not a guarantee against future tire wear, pulling, vibration, or noise caused by pre-existing vehicle conditions. A lug-torque re-check within 24 hours or 25-50 miles may be required.",
    source: INVOICE, approvedBy: "Nour", effectiveDate: "2026-07-21", verifiedDate: "2026-07-21", channels: ALL,
  },

  // ─── Refund / storage / legal (invoice legal text) ──────────────────────
  {
    factKey: "refund.policy", category: "policy",
    value: "No cash refunds. All sales are final except for approved warranty claims or as required by law. Approved warranty claims are limited solely to repair or replacement, at shop option, of defective covered parts or labor verified by the shop.",
    source: INVOICE, approvedBy: "Nour", effectiveDate: "2026-07-21", verifiedDate: "2026-07-21", channels: ["voice", "web"],
  },
  {
    factKey: "storage.policy", category: "policy",
    value: "Vehicles left after completion, notice of completion, declined repairs, refused pickup, or non-payment may incur a storage charge of $25.00 per day.",
    source: INVOICE, approvedBy: "Nour", effectiveDate: "2026-07-21", verifiedDate: "2026-07-21", channels: ["voice", "web"],
  },
  {
    factKey: "legal.entity", category: "legal",
    value: "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005, moeseuclid@gmail.com",
    source: INVOICE, approvedBy: "Nour", effectiveDate: "2026-07-21", verifiedDate: "2026-07-21", channels: ["web"],
  },
];

const SEED_BY_KEY = new Map(SEED_FACTS.map((f) => [f.factKey, f]));

/** The active fact for a key: DB override first, SEED_FACTS fallback. */
export async function getFact(factKey: string): Promise<BusinessFact | null> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const [rows] = await db.execute(sql`
        SELECT factKey, category, value, source, approvedBy,
               DATE_FORMAT(effectiveDate,'%Y-%m-%d') AS effectiveDate,
               DATE_FORMAT(verifiedDate,'%Y-%m-%d') AS verifiedDate, channels
        FROM business_facts WHERE factKey = ${factKey} AND active = 1 LIMIT 1
      `);
      const row = (rows as Array<Record<string, string>>)[0];
      if (row) return rowToFact(row);
    }
  } catch (err) {
    log.warn("getFact DB read failed; using seed fallback", { factKey, error: err instanceof Error ? err.message : String(err) });
  }
  return SEED_BY_KEY.get(factKey) ?? null;
}

/** Active facts allowed on a channel: DB overrides merged over the seed. */
export async function getFactsForChannel(channel: FactChannel): Promise<BusinessFact[]> {
  const merged = new Map<string, BusinessFact>();
  for (const f of SEED_FACTS) if (f.channels.includes(channel)) merged.set(f.factKey, f);
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const [rows] = await db.execute(sql`
        SELECT factKey, category, value, source, approvedBy,
               DATE_FORMAT(effectiveDate,'%Y-%m-%d') AS effectiveDate,
               DATE_FORMAT(verifiedDate,'%Y-%m-%d') AS verifiedDate, channels
        FROM business_facts WHERE active = 1
      `);
      for (const r of rows as Array<Record<string, string>>) {
        const fact = rowToFact(r);
        if (fact.channels.includes(channel)) merged.set(fact.factKey, fact);
      }
    }
  } catch (err) {
    log.warn("getFactsForChannel DB read failed; using seed only", { channel, error: err instanceof Error ? err.message : String(err) });
  }
  return [...merged.values()];
}

function rowToFact(row: Record<string, string>): BusinessFact {
  return {
    factKey: row.factKey,
    category: row.category as FactCategory,
    value: row.value,
    source: row.source,
    approvedBy: row.approvedBy,
    effectiveDate: row.effectiveDate,
    verifiedDate: row.verifiedDate,
    channels: (row.channels || "").split(",").map((c) => c.trim()).filter(Boolean) as FactChannel[],
  };
}

/**
 * Idempotently upsert SEED_FACTS into the DB so the operator has editable rows.
 * INSERT ... ON DUPLICATE KEY UPDATE keeps one active row per factKey.
 */
export async function seedBusinessFacts(): Promise<{ seeded: number } | null> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;
    let seeded = 0;
    for (const f of SEED_FACTS) {
      await db.execute(sql`
        INSERT INTO business_facts (factKey, category, value, source, approvedBy, effectiveDate, verifiedDate, channels, active)
        VALUES (${f.factKey}, ${f.category}, ${f.value}, ${f.source}, ${f.approvedBy}, ${f.effectiveDate}, ${f.verifiedDate}, ${f.channels.join(",")}, 1)
        ON DUPLICATE KEY UPDATE
          category = VALUES(category), value = VALUES(value), source = VALUES(source),
          approvedBy = VALUES(approvedBy), effectiveDate = VALUES(effectiveDate),
          verifiedDate = VALUES(verifiedDate), channels = VALUES(channels), active = 1
      `);
      seeded++;
    }
    log.info(`Seeded ${seeded} business facts`);
    return { seeded };
  } catch (err) {
    log.warn("seedBusinessFacts failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * A concise WARRANTY grounding block appended to the drafter's prompt. Prices are
 * already in the base persona; the gap the store closes is warranty — so the AI
 * answers a warranty question correctly and NEVER quotes the repair warranty on a
 * used tire. Pure and synchronous (reads SEED_FACTS) so it never blocks a reply on
 * a DB round-trip; operator DB overrides flow into the retrieval APIs (getFact).
 */
export function buildWarrantyFactsPreamble(): string {
  const usedTire = SEED_BY_KEY.get("used_tire.warranty")?.value;
  const parts = SEED_BY_KEY.get("repair.parts_warranty")?.value;
  const labor = SEED_BY_KEY.get("repair.labor_warranty")?.value;
  const newTire = SEED_BY_KEY.get("new_tire.warranty")?.value;
  if (!usedTire && !parts && !labor) return "";
  const lines = [usedTire, parts, labor, newTire].filter(Boolean);
  return `\n\n[Warranty facts (authoritative, from the shop invoice — quote only if asked, never invent or soften): ${lines.join(" ")} NEVER apply the parts/labor repair warranty to a used tire, and never promise road-hazard coverage. If the customer needs specifics beyond this, offer to have the shop confirm.]`;
}

// ROS-058: the sync preamble above reads the in-code SEED map, so an operator
// updating a warranty fact in the DATABASE changed nothing about what NickGPT
// actually said — the whole point of the override store was defeated on the
// one live conversational surface. This async variant resolves each fact
// through getFact() (DB override first, seed fallback) with a short cache so
// the drafter is not paying a DB round-trip per message.
let livePreambleCache: { value: string; at: number } | null = null;
const LIVE_PREAMBLE_TTL_MS = 5 * 60_000;

export async function buildWarrantyFactsPreambleLive(): Promise<string> {
  if (livePreambleCache && Date.now() - livePreambleCache.at < LIVE_PREAMBLE_TTL_MS) {
    return livePreambleCache.value;
  }
  try {
    const [usedTire, parts, labor, newTire] = await Promise.all([
      getFact("used_tire.warranty"),
      getFact("repair.parts_warranty"),
      getFact("repair.labor_warranty"),
      getFact("new_tire.warranty"),
    ]);
    const lines = [usedTire?.value, parts?.value, labor?.value, newTire?.value].filter(Boolean);
    const value = lines.length === 0
      ? ""
      : `\n\n[Warranty facts (authoritative, from the shop invoice — quote only if asked, never invent or soften): ${lines.join(" ")} NEVER apply the parts/labor repair warranty to a used tire, and never promise road-hazard coverage. If the customer needs specifics beyond this, offer to have the shop confirm.]`;
    livePreambleCache = { value, at: Date.now() };
    return value;
  } catch {
    // DB unreachable — the seed facts are still invoice-true; never let a
    // transient outage strip the warranty grounding from the prompt.
    return buildWarrantyFactsPreamble();
  }
}
