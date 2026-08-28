/**
 * The concept catalog — rows, not a markdown list.
 *
 * WHY ROWS. A strategy document gets read once and re-argued forever. Rows get
 * queried, ranked, and joined to outcomes. Every concept below carries its
 * franchise, its production type, its estimated credit cost, and a slot for the
 * actuals that only exist after it publishes.
 *
 * WHY NO 100-POINT RUBRIC. One of the source reports ranked these on a weighted
 * 100-point scale. The weights had no stated basis, so the scale manufactured
 * confident orderings out of invented numbers — a ranking that looks measured
 * and is not is worse than an admitted guess. This file ranks on MEASURED
 * performance once `actuals` exist, and until then on production cost ascending,
 * which is a real, checkable quantity. That ordering surfaces the zero-credit
 * real-footage franchises first, which is also what the account's own numbers
 * argue for: it already floods the feed with synthetic content at 0.53%
 * profile-visit conversion.
 */

import type { PackFraming } from "./disclosureGate";

/** How the footage gets made. Drives both cost and the disclosure gate. */
export type ProductionType = "real" | "ai" | "hybrid";

export type ConceptStatus = "backlog" | "scripted" | "filmed" | "published" | "retired";

/** Measured outcome — present only after publication. Never estimated. */
export interface ConceptActuals {
  readonly publishedAt: string;
  readonly views: number;
  readonly interactions: number;
  readonly profileVisits: number;
  readonly saves: number;
  readonly sends: number;
  readonly follows: number;
  readonly websiteTaps: number;
  readonly retention: number | null;
  readonly nonFollowerReach: number | null;
}

export interface Concept {
  readonly id: string;
  readonly franchise: string;
  readonly concept: string;
  readonly productionType: ProductionType;
  /**
   * Estimated generation credits. REAL footage is 0 by definition — it costs
   * the operator's time, which this number deliberately does not launder into
   * a credit figure.
   */
  readonly estCredits: number;
  readonly framing: PackFraming;
  readonly status: ConceptStatus;
  /** Populated on publish. `null` means UNMEASURED, never "performed at zero". */
  readonly actuals: ConceptActuals | null;
}

/** Shorthand for a backlog row — every concept starts unmeasured. */
function c(
  id: string,
  franchise: string,
  concept: string,
  productionType: ProductionType,
  estCredits: number,
  framing: PackFraming,
): Concept {
  return { id, franchise, concept, productionType, estCredits, framing, status: "backlog", actuals: null };
}

export const CONCEPTS: readonly Concept[] = [
  // ── Can You Drive On This — operator holds the part, viewer votes ──────────
  c("cydot-01", "Can You Drive On This", "Tire with cords showing through the shoulder", "real", 0, "diagnosis"),
  c("cydot-02", "Can You Drive On This", "Sidewall bubble the size of a golf ball", "real", 0, "diagnosis"),
  c("cydot-03", "Can You Drive On This", "Nail dead-centre in the tread vs one in the shoulder", "real", 0, "diagnosis"),
  c("cydot-04", "Can You Drive On This", "Brake pad worn to the backing plate", "real", 0, "diagnosis"),
  c("cydot-05", "Can You Drive On This", "Serpentine belt with three ribs missing", "real", 0, "diagnosis"),
  c("cydot-06", "Can You Drive On This", "Ball joint with visible play, boot torn", "real", 0, "diagnosis"),
  c("cydot-07", "Can You Drive On This", "Rotor with a lip you can catch a fingernail on", "real", 0, "diagnosis"),
  c("cydot-08", "Can You Drive On This", "Dry-rotted tire with good tread depth", "real", 0, "diagnosis"),
  c("cydot-09", "Can You Drive On This", "Wheel bearing that howls on the lift", "real", 0, "diagnosis"),
  c("cydot-10", "Can You Drive On This", "CV boot split, grease flung across the wheel well", "real", 0, "diagnosis"),
  c("cydot-11", "Can You Drive On This", "Plugged tire that was plugged three times already", "real", 0, "diagnosis"),
  c("cydot-12", "Can You Drive On This", "Coolant that looks like chocolate milk", "real", 0, "diagnosis"),

  // ── What Killed This Tire — forensic, part in hand ────────────────────────
  c("wktt-01", "What Killed This Tire", "Feathered edges: alignment, not the tire", "real", 0, "diagnosis"),
  c("wktt-02", "What Killed This Tire", "Centre-worn from 15 years of overinflation", "real", 0, "diagnosis"),
  c("wktt-03", "What Killed This Tire", "Both shoulders gone, middle fine — chronically flat", "real", 0, "diagnosis"),
  c("wktt-04", "What Killed This Tire", "Cupped tread = dead struts, not a bad tire", "real", 0, "diagnosis"),
  c("wktt-05", "What Killed This Tire", "Run-flat driven flat: the inner liner shredded", "real", 0, "diagnosis"),
  c("wktt-06", "What Killed This Tire", "Curb rash that cracked the bead seat", "real", 0, "diagnosis"),
  c("wktt-07", "What Killed This Tire", "Pothole impact break, sidewall split from inside", "real", 0, "diagnosis"),
  c("wktt-08", "What Killed This Tire", "Mismatched pair cooked one axle", "real", 0, "diagnosis"),
  c("wktt-09", "What Killed This Tire", "Six-year-old tire, 4,000 miles, dead of age", "real", 0, "diagnosis"),
  c("wktt-10", "What Killed This Tire", "Wrong load rating on a loaded van", "real", 0, "diagnosis"),
  c("wktt-11", "What Killed This Tire", "Belt separation you can feel before you see", "real", 0, "diagnosis"),
  c("wktt-12", "What Killed This Tire", "Valve stem rot — a $3 part that stranded a car", "real", 0, "diagnosis"),

  // ── $50 or $1,500 — the cost of waiting, priced ───────────────────────────
  c("cost-01", "$50 or $1,500", "Tire rotation now vs four tires later", "real", 0, "explainer"),
  c("cost-02", "$50 or $1,500", "Brake pads now vs pads, rotors and calipers later", "real", 0, "explainer"),
  c("cost-03", "$50 or $1,500", "Oil change now vs a timing chain later", "real", 0, "explainer"),
  c("cost-04", "$50 or $1,500", "Alignment now vs two tires in six months", "real", 0, "explainer"),
  c("cost-05", "$50 or $1,500", "Coolant flush now vs a head gasket later", "real", 0, "explainer"),
  c("cost-06", "$50 or $1,500", "Battery test now vs a tow at 6am in January", "real", 0, "explainer"),
  c("cost-07", "$50 or $1,500", "Serpentine belt now vs a no-start on I-90", "real", 0, "explainer"),
  c("cost-08", "$50 or $1,500", "Tire patch now vs a blowout at highway speed", "real", 0, "explainer"),
  c("cost-09", "$50 or $1,500", "Wiper blades now vs a body-shop deductible", "real", 0, "explainer"),
  c("cost-10", "$50 or $1,500", "Cabin filter now vs an evaporator later", "real", 0, "explainer"),

  // ── Mechanic Translator — decode what a shop said to you ──────────────────
  c("mt-01", "Mechanic Translator", "\"You need a full brake job\" — what that should include", "real", 0, "explainer"),
  c("mt-02", "Mechanic Translator", "\"Your fluids are dirty\" — which ones actually matter", "real", 0, "explainer"),
  c("mt-03", "Mechanic Translator", "\"It needs an alignment\" — when it genuinely does", "real", 0, "explainer"),
  c("mt-04", "Mechanic Translator", "\"We recommend a flush\" — the three that are real", "real", 0, "explainer"),
  c("mt-05", "Mechanic Translator", "\"That's a dealer-only part\" — usually it is not", "real", 0, "explainer"),
  c("mt-06", "Mechanic Translator", "\"Your tires are at 4/32\" — what the number means", "real", 0, "explainer"),
  c("mt-07", "Mechanic Translator", "\"It's just surface rust\" — when to believe that", "real", 0, "explainer"),
  c("mt-08", "Mechanic Translator", "\"We'll need to diagnose it first\" — why that is fair", "real", 0, "explainer"),
  c("mt-09", "Mechanic Translator", "\"Lifetime warranty\" on brake pads — the catch", "real", 0, "explainer"),
  c("mt-10", "Mechanic Translator", "\"You should replace all four\" — when that is true", "real", 0, "explainer"),

  // ── Cleveland Road Tax — local, specific, unfakeable ──────────────────────
  c("crt-01", "Cleveland Road Tax", "What a Euclid winter does to a wheel bearing", "real", 0, "explainer"),
  c("crt-02", "Cleveland Road Tax", "Road salt and brake line rot: the real timeline", "real", 0, "explainer"),
  c("crt-03", "Cleveland Road Tax", "Pothole season — the three parts that pay for it", "real", 0, "explainer"),
  c("crt-04", "Cleveland Road Tax", "Why alignment goes off faster here than in Columbus", "real", 0, "explainer"),
  c("crt-05", "Cleveland Road Tax", "Lakefront humidity and the tires nobody rotates", "real", 0, "explainer"),
  c("crt-06", "Cleveland Road Tax", "First freeze: the TPMS light everyone ignores", "real", 0, "explainer"),
  c("crt-07", "Cleveland Road Tax", "Salt-belt exhaust: what fails first and when", "real", 0, "explainer"),
  c("crt-08", "Cleveland Road Tax", "The I-271 commute and premature tire wear", "real", 0, "explainer"),

  // ── Shop Floor Real-Time — process footage, no narration required ─────────
  c("sf-01", "Shop Floor Real-Time", "A tire mounted and balanced, uncut, no music", "real", 0, "repair"),
  c("sf-02", "Shop Floor Real-Time", "Torque sequence done properly, torque wrench audible", "real", 0, "repair"),
  c("sf-03", "Shop Floor Real-Time", "Road-force balance vs standard balance, side by side", "real", 0, "test"),
  c("sf-04", "Shop Floor Real-Time", "A patch-plug from the inside, start to finish", "real", 0, "repair"),
  c("sf-05", "Shop Floor Real-Time", "Brake job: old rotor off, new on, nothing skipped", "real", 0, "repair"),
  c("sf-06", "Shop Floor Real-Time", "The alignment rack readout before and after", "real", 0, "before_after"),
  c("sf-07", "Shop Floor Real-Time", "TPMS sensor swap on a wheel most shops charge double for", "real", 0, "repair"),
  c("sf-08", "Shop Floor Real-Time", "What a proper inspection actually checks, in order", "real", 0, "repair"),

  // ── Ask The Bay — inbound question answered on camera ─────────────────────
  c("atb-01", "Ask The Bay", "\"Can I mix tire brands?\" answered in 20 seconds", "real", 0, "explainer"),
  c("atb-02", "Ask The Bay", "\"How long do tires actually last?\"", "real", 0, "explainer"),
  c("atb-03", "Ask The Bay", "\"Is the spare safe on the highway?\"", "real", 0, "explainer"),
  c("atb-04", "Ask The Bay", "\"Do I need winter tires in Cleveland?\"", "real", 0, "explainer"),
  c("atb-05", "Ask The Bay", "\"Why does my steering shake at 65?\"", "real", 0, "explainer"),
  c("atb-06", "Ask The Bay", "\"Used tires — when they're smart and when they're not\"", "real", 0, "explainer"),

  // ── Synthetic B-roll — explainer only, disclosed, never testimony ─────────
  // These carry a credit cost and are framed "explainer" DELIBERATELY: the
  // disclosure gate refuses any of them under a real-evidence framing, which is
  // the whole point of keeping them in the same catalog as the real footage.
  c("syn-01", "Under The Tread", "Cutaway animation: how a belt separation forms", "ai", 12, "explainer"),
  c("syn-02", "Under The Tread", "Animated hydroplaning at four tread depths", "ai", 12, "explainer"),
  c("syn-03", "Under The Tread", "Cross-section: what road salt does to a brake line", "ai", 12, "explainer"),
  c("syn-04", "Under The Tread", "Heat build-up in an underinflated tire, visualised", "ai", 12, "explainer"),
  c("syn-05", "Under The Tread", "Suspension geometry going out of alignment", "ai", 14, "explainer"),
  c("syn-06", "Under The Tread", "How a TPMS sensor talks to the car", "hybrid", 8, "explainer"),
] as const;

/**
 * Ranking. Measured performance wins wherever it exists; everything unmeasured
 * falls back to production cost ascending, which surfaces the zero-credit real
 * footage first. The two populations are never mixed into one score — an
 * estimate and a measurement are different kinds of fact.
 */
export function rankConcepts(concepts: readonly Concept[] = CONCEPTS): Concept[] {
  const measured = concepts.filter((x) => x.actuals !== null);
  const unmeasured = concepts.filter((x) => x.actuals === null);

  measured.sort((a, b) => {
    // Profile visits per view — the metric the account is actually failing on.
    const rateOf = (x: Concept) =>
      x.actuals && x.actuals.views > 0 ? x.actuals.profileVisits / x.actuals.views : 0;
    return rateOf(b) - rateOf(a);
  });

  unmeasured.sort((a, b) =>
    a.estCredits !== b.estCredits ? a.estCredits - b.estCredits : a.id.localeCompare(b.id),
  );

  return [...measured, ...unmeasured];
}

/** Catalog shape, computed — never a number typed into prose. */
export function catalogSummary(concepts: readonly Concept[] = CONCEPTS) {
  const byType = { real: 0, ai: 0, hybrid: 0 } as Record<ProductionType, number>;
  const franchises = new Set<string>();
  let credits = 0;
  for (const x of concepts) {
    byType[x.productionType] += 1;
    franchises.add(x.franchise);
    credits += x.estCredits;
  }
  return {
    total: concepts.length,
    franchises: franchises.size,
    byType,
    totalEstCredits: credits,
    zeroCreditShare: concepts.length > 0 ? byType.real / concepts.length : 0,
    measured: concepts.filter((x) => x.actuals !== null).length,
  };
}
