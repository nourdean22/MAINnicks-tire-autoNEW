/**
 * Reel concepts as DATA, not markdown prose.
 *
 * WHY ROWS. The backlog lived as ~70 numbered bullets inside a document whose
 * own heading said 56. A list that cannot be counted, filtered, or joined to
 * outcomes is not a backlog, it is an essay - and it produced seven scheduler
 * reports asking a human to read it.
 *
 * WHY THERE IS NO SCORING RUBRIC HERE. A 100-point weighted rubric was proposed
 * and is deliberately NOT implemented: its weights had no stated basis, and a
 * weighted sum over invented weights manufactures a confident ranking out of
 * nothing. Ranking is therefore:
 *   1. measured performance, once a concept has actuals; otherwise
 *   2. production cost ASCENDING - cheapest first, so zero-credit real-footage
 *      concepts surface ahead of anything that needs generation.
 * Cost is an observed property of the pack, not a judgement call.
 *
 * THE UNKNOWN RULE. Every concept that cannot publish must say WHY, in the row.
 * `blockReason` is non-null for every non-publishable status, and that invariant
 * is asserted by the canary - an instrument that cannot report its own state is
 * the defect this file exists to remove.
 */

export type ProductionType =
  /** Footage already shot at the shop. Zero credits. */
  | "real-footage"
  /** Stills + captions, no motion generation. Zero credits. */
  | "stills"
  /** Requires a generative video model. Costs credits AND needs disclosure. */
  | "generated"
  /** Nothing in the pack says which. Always a block reason, never silent. */
  | "undetermined";

export type PackStatus = "publishable" | "needs-work" | "dead";

/** Ascending = cheaper. Used for the default ranking. */
export const PRODUCTION_COST: Record<ProductionType, number> = {
  "real-footage": 0,
  stills: 1,
  generated: 2,
  undetermined: 3,
};

export interface ConceptActuals {
  igPostId: string;
  views: number;
  interactions: number;
  profileVisits: number;
  publishedAt: string;
}

export interface ConceptRow {
  /** Pack directory name, e.g. "2026-08-17-plug-vs-patch". */
  id: string;
  /** Topic family, derived from the pack id - lets us spot over-covered themes. */
  franchise: string;
  productionType: ProductionType;
  /** PRODUCTION_COST[productionType]. Stored so a row is self-describing. */
  cost: number;
  status: PackStatus;
  /** REQUIRED whenever status !== "publishable". Never null in that case. */
  blockReason: string | null;
  /** Populated only after a real publish. Null means "not measured", not "zero". */
  actuals: ConceptActuals | null;
}

/** Topic family from a dated pack id: "2026-08-17-plug-vs-patch" -> "plug-vs-patch". */
export function franchiseOf(packId: string): string {
  return packId.replace(/^\d{4}-\d{2}-\d{2}-/, "") || packId;
}

export interface PackFacts {
  id: string;
  /** Pack declares real shop footage is available. */
  hasRealFootage?: boolean;
  hasCaptions?: boolean;
  hasBrief?: boolean;
  needsGeneratedVideo?: boolean;
  /** Pack text declared an explicit hard block (e.g. NO MOTION ROUTE). */
  declaredBlock?: string | null;
  /** Operator retired the concept. */
  retired?: boolean;
}

export function productionTypeOf(f: PackFacts): ProductionType {
  if (f.hasRealFootage) return "real-footage";
  if (f.needsGeneratedVideo) return "generated";
  if (f.hasCaptions || f.hasBrief) return "stills";
  return "undetermined";
}

/**
 * Classify one pack. ALWAYS returns a blockReason when the pack cannot publish -
 * this is the function that makes "UNKNOWN" impossible.
 */
export function classifyPack(f: PackFacts): { status: PackStatus; blockReason: string | null } {
  if (f.retired) {
    return { status: "dead", blockReason: "retired by the operator" };
  }
  if (f.declaredBlock) {
    return { status: "dead", blockReason: f.declaredBlock };
  }
  const type = productionTypeOf(f);
  if (type === "undetermined") {
    return {
      status: "needs-work",
      blockReason:
        "production route undetermined: the pack declares no real footage, no captions and no brief, " +
        "so nothing can be assembled from it. Add a brief or attach footage.",
    };
  }
  if (!f.hasCaptions) {
    return { status: "needs-work", blockReason: "no captions.srt - the reel cannot be assembled without them" };
  }
  if (type === "generated") {
    return {
      status: "needs-work",
      blockReason:
        "requires generated video: costs credits, and publishing needs Meta's is_ai_generated=true " +
        "plus a caption that makes no real-evidence claim (see reelDisclosure).",
    };
  }
  return { status: "publishable", blockReason: null };
}

export function toRow(f: PackFacts, actuals: ConceptActuals | null = null): ConceptRow {
  const productionType = productionTypeOf(f);
  const { status, blockReason } = classifyPack(f);
  return { id: f.id, franchise: franchiseOf(f.id), productionType, cost: PRODUCTION_COST[productionType], status, blockReason, actuals };
}

/**
 * Default ranking: measured winners first (by profile visits, the step that is
 * actually broken), then unmeasured by cost ascending. No weighted score.
 */
export function rankConcepts(rows: ConceptRow[]): ConceptRow[] {
  return [...rows].sort((a, b) => {
    const am = a.actuals, bm = b.actuals;
    if (am && !bm) return -1;
    if (bm && !am) return 1;
    if (am && bm) return bm.profileVisits - am.profileVisits;
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.id.localeCompare(b.id);
  });
}
