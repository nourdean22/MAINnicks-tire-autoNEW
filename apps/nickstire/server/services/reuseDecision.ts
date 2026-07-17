/**
 * Media reuse decision engine (directive Part VII §26) — "do not generate a
 * new generic tire close-up when a stronger approved one already exists; do
 * not reuse an old asset blindly." Given a candidate need + what the library
 * holds, decide CREATE_NEW / REUSE_* / DO_NOT_REUSE with a persisted reason.
 *
 * Pure decision logic over asset facts (quality, recency, usage, fatigue,
 * rights). The library query lives in mediaRegistry; this decides. The
 * directive's key discipline: reuse saves credits AND prevents fatigue, but
 * only when the asset is relevant, high-quality, in-rights, and not overused.
 */

export type ReuseDecision =
  | "CREATE_NEW"
  | "REUSE_AS_IS"
  | "REUSE_WITH_NEW_CROP"
  | "REUSE_WITH_NEW_EDIT"
  | "REUSE_WITH_REPAIR"
  | "USE_AS_VISUAL_REFERENCE"
  | "DO_NOT_REUSE";

export interface ReuseCandidate {
  assetId: string;
  qualityScore: number;        // 0-100
  usageCount: number;
  daysSinceLastUse: number | null;  // null = never used
  rightsOk: boolean;
  relevance: number;           // 0-1, how well it matches the need
  hasRepairableDefect: boolean;
}

export interface ReuseConfig {
  minQuality: number;          // below -> not worth reusing as-is
  minRelevance: number;        // below -> not a match
  fatigueUsageCap: number;     // used more than this = fatigued
  fatigueRecencyDays: number;  // used more recently than this = too fresh to repeat
  referenceQualityFloor: number; // decent-but-not-great can still guide a new gen
}

export const DEFAULT_REUSE: ReuseConfig = {
  minQuality: 70,
  minRelevance: 0.6,
  fatigueUsageCap: 3,
  fatigueRecencyDays: 14,
  referenceQualityFloor: 50,
};

export interface ReuseVerdict { decision: ReuseDecision; reason: string; assetId?: string }

/** Decide for a single candidate. */
export function decideReuse(c: ReuseCandidate, config: ReuseConfig = DEFAULT_REUSE): ReuseVerdict {
  if (!c.rightsOk) return { decision: "DO_NOT_REUSE", reason: "rights not cleared", assetId: c.assetId };
  if (c.relevance < config.minRelevance) return { decision: "CREATE_NEW", reason: `relevance ${c.relevance.toFixed(2)} < ${config.minRelevance}`, assetId: c.assetId };

  const fatigued = c.usageCount > config.fatigueUsageCap || (c.daysSinceLastUse !== null && c.daysSinceLastUse < config.fatigueRecencyDays);
  if (fatigued) {
    // still usable as a reference for a NEW generation (avoids literal repeat)
    if (c.qualityScore >= config.referenceQualityFloor) return { decision: "USE_AS_VISUAL_REFERENCE", reason: `fatigued (used ${c.usageCount}x, ${c.daysSinceLastUse}d ago) — guide a fresh gen`, assetId: c.assetId };
    return { decision: "CREATE_NEW", reason: "fatigued and not strong enough to reference", assetId: c.assetId };
  }

  if (c.hasRepairableDefect && c.qualityScore >= config.referenceQualityFloor) {
    return { decision: "REUSE_WITH_REPAIR", reason: "strong asset with a fixable defect", assetId: c.assetId };
  }
  if (c.qualityScore >= config.minQuality) {
    return { decision: "REUSE_AS_IS", reason: `quality ${c.qualityScore} >= ${config.minQuality}, in-rights, relevant, not fatigued`, assetId: c.assetId };
  }
  if (c.qualityScore >= config.referenceQualityFloor) {
    return { decision: "USE_AS_VISUAL_REFERENCE", reason: `quality ${c.qualityScore} below reuse bar but usable as reference`, assetId: c.assetId };
  }
  return { decision: "CREATE_NEW", reason: `quality ${c.qualityScore} too low to reuse or reference`, assetId: c.assetId };
}

/**
 * Choose the best action across all library candidates for a need: prefer the
 * highest-quality reusable asset; fall back to CREATE_NEW when nothing
 * qualifies. Returns the winning verdict.
 */
export function chooseReuse(candidates: ReuseCandidate[], config: ReuseConfig = DEFAULT_REUSE): ReuseVerdict {
  if (!candidates.length) return { decision: "CREATE_NEW", reason: "empty library for this need" };
  const RANK: Record<ReuseDecision, number> = {
    REUSE_AS_IS: 5, REUSE_WITH_NEW_CROP: 4, REUSE_WITH_NEW_EDIT: 4, REUSE_WITH_REPAIR: 3,
    USE_AS_VISUAL_REFERENCE: 2, CREATE_NEW: 1, DO_NOT_REUSE: 0,
  };
  const verdicts = candidates
    .map((c) => ({ v: decideReuse(c, config), q: c.qualityScore }))
    .sort((a, b) => RANK[b.v.decision] - RANK[a.v.decision] || b.q - a.q);
  const best = verdicts[0].v;
  // if the best any asset offers is DO_NOT_REUSE, we still make something new
  return best.decision === "DO_NOT_REUSE" ? { decision: "CREATE_NEW", reason: "all candidates blocked (rights/quality) — create new" } : best;
}
