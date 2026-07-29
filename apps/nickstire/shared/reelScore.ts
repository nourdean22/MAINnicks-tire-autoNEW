/**
 * Reel Distribution Score — a business-weighted composite that refuses to
 * pretend. Views alone reward the wrong content for a repair shop; this
 * weights the actions that predict local demand: watch-through, shares,
 * saves, comments, follows, and direct intent.
 *
 * Honesty contract:
 *  - Components the caller cannot measure are passed as null and EXCLUDED;
 *    the remaining weights are renormalized and `coverage` reports how much
 *    of the full formula was actually measured. A score at 55% coverage is
 *    labeled as such — it never impersonates the full number.
 *  - Below MIN_COVERAGE the function returns null: a score built from one
 *    input is noise wearing a number.
 *  - Rate inputs are per-reach fractions (0..1); watchPct is 0..1. Callers
 *    convert; this module does not guess units.
 */

export interface ReelScoreInputs {
  /** Average watch percentage, 0..1 (e.g. 0.42 = 42% of the reel watched on average). */
  watchPct: number | null;
  /** Shares per reached account, 0..1. */
  sharesPerReach: number | null;
  /** Saves per reached account, 0..1. */
  savesPerReach: number | null;
  /** Comments per reached account, 0..1. */
  commentsPerReach: number | null;
  /** Follows per reached account, 0..1. */
  followsPerReach: number | null;
  /** Profile visit / call / directions intent per reached account, 0..1. */
  intentPerReach: number | null;
}

/** Weights per the operating thesis: watch 30, shares 25, saves 20, comments 10, follows 10, intent 5. */
export const REEL_SCORE_WEIGHTS: Record<keyof ReelScoreInputs, number> = {
  watchPct: 0.30,
  sharesPerReach: 0.25,
  savesPerReach: 0.20,
  commentsPerReach: 0.10,
  followsPerReach: 0.10,
  intentPerReach: 0.05,
};

/**
 * Rate normalizers: the per-reach ceilings that count as "excellent" (score
 * 100 for that component). ESTIMATES chosen so strong organic local content
 * saturates them — NOT platform benchmarks; recalibrate from our own snapshot
 * data once the metric-snapshot wave lands, and say so in the UI until then.
 */
export const REEL_SCORE_CEILINGS: Record<keyof ReelScoreInputs, number> = {
  watchPct: 0.9,
  sharesPerReach: 0.02,
  savesPerReach: 0.03,
  commentsPerReach: 0.01,
  followsPerReach: 0.005,
  intentPerReach: 0.01,
};

/** Refuse to score below this fraction of total weight measured. */
export const MIN_COVERAGE = 0.5;

export interface ReelDistributionScore {
  /** 0..100 over the MEASURED components, weights renormalized. */
  score: number;
  /** Fraction (0..1) of the full formula's weight that was actually measured. */
  coverage: number;
  /** Component keys that were missing (null) and therefore excluded. */
  missing: Array<keyof ReelScoreInputs>;
}

export function computeReelDistributionScore(inputs: ReelScoreInputs): ReelDistributionScore | null {
  const keys = Object.keys(REEL_SCORE_WEIGHTS) as Array<keyof ReelScoreInputs>;
  const present = keys.filter((k) => {
    const v = inputs[k];
    return typeof v === "number" && Number.isFinite(v) && v >= 0;
  });
  const missing = keys.filter((k) => !present.includes(k));

  const coverage = present.reduce((sum, k) => sum + REEL_SCORE_WEIGHTS[k], 0);
  if (coverage < MIN_COVERAGE) return null;

  let weighted = 0;
  for (const k of present) {
    const normalized = Math.min(1, (inputs[k] as number) / REEL_SCORE_CEILINGS[k]);
    weighted += normalized * REEL_SCORE_WEIGHTS[k];
  }
  return {
    score: Math.round((weighted / coverage) * 100),
    coverage: Math.round(coverage * 100) / 100,
    missing,
  };
}

/**
 * Convenience for the analytics rows we store today: likes/comments counts +
 * nullable insight fields. Returns null when reach is unknown or zero —
 * per-reach rates without reach are fabrication.
 */
export function scoreFromAnalyticsRow(row: {
  reach: number | null;
  saved: number | null;
  shares: number | null;
  comments: number | null;
}): ReelDistributionScore | null {
  if (row.reach == null || row.reach <= 0) return null;
  const per = (v: number | null) => (v == null ? null : v / row.reach!);
  return computeReelDistributionScore({
    watchPct: null,
    sharesPerReach: per(row.shares),
    savesPerReach: per(row.saved),
    commentsPerReach: per(row.comments),
    followsPerReach: null,
    intentPerReach: null,
  });
}
