/**
 * Outcome-informed Pattern Lab selection.
 *
 * This closes the loop created by structurePatternId in reel_jobs.payload:
 * published jobs can now be joined to Instagram distribution metrics and used
 * as a PRIOR for future structure selection.
 *
 * Guardrails:
 * - one post is never a rule: a pattern needs >= MIN_POSTS_PER_PATTERN
 * - the learned policy does not turn on until at least two patterns are proven
 *   and the measured sample is large enough
 * - 1 in 4 selections remains exploration, deterministically, even after every
 *   structure is proven; under-sampled challengers get first claim on that slot
 *   so the policy can learn both new entrants and later regime changes
 * - missing metrics stay UNKNOWN via scorePost(); they are never zero-filled
 *
 * This is observational ranking, not causality. It biases generation toward
 * structures that have earned better measured distribution on this account;
 * controlled experiments remain the stronger evidence lane.
 */
import { scorePost, type ThemePerformanceRow } from "./reelPerformancePrior";
import { selectRotationPattern, type RotatablePattern } from "./reelStructureRotation";

export interface PatternPerformanceRow extends ObjectiveMetrics {
  patternId: string;
}

/**
 * Pattern Lab 2.0 (README §N): the objective a ranking is FOR.
 *
 * `blended` is the pre-existing saves 45 / shares 35 / retention 20 score
 * (reelPerformancePrior.scorePost) and remains the default everywhere, so
 * production ranking does not move until a caller passes an objective.
 */
export type PatternObjective = "blended" | "discovery" | "reference" | "conversation" | "conversion";

export type ScoreBasis =
  | "saves" | "shares" | "retention"
  | "watch_ratio" | "comments" | "profile_visits" | "site_actions";

export interface ScoredPattern {
  patternId: string;
  score: number;
  posts: number;
  basis: ScoreBasis[];
}

/**
 * One post's metrics for objective scoring. Extends the distribution row with
 * the fields the non-blended objectives need; every one is optional and a
 * missing one stays UNKNOWN (dropped from the weighting), never zero.
 */
export interface ObjectiveMetrics extends ThemePerformanceRow {
  comments?: number | null;
  /** Profile visits attributed to the post, when the sync captured them. */
  profileVisits?: number | null;
  /** Site / call / directions / booking taps attributed to the post. */
  siteActions?: number | null;
  /** The reel's own length, so watch time can become a ratio. */
  durationSeconds?: number | null;
}

const MIN_POSTS_PER_PATTERN = 3;
const MIN_TOTAL_MEASURED_PATTERN_POSTS = 12;
const EXPLORATION_EVERY_N_SELECTIONS = 4;

/** Normalise a per-reach rate into 0..1 with the same 10% ceiling scorePost uses. */
function perReach(numerator: number | null | undefined, reach: number | null | undefined, ceiling = 0.1): number | null {
  if (numerator == null || reach == null || reach <= 0) return null;
  const r = numerator / reach;
  if (!Number.isFinite(r) || r < 0) return null;
  return Math.min(1, r / ceiling);
}

function weighted(parts: Array<[value: number | null, weight: number, basis: ScoreBasis]>): { score: number; basis: ScoreBasis[] } | null {
  const present = parts.filter((p): p is [number, number, ScoreBasis] => p[0] != null);
  if (!present.length) return null;
  const totalWeight = present.reduce((s, [, w]) => s + w, 0);
  return {
    score: present.reduce((s, [v, w]) => s + v * w, 0) / totalWeight,
    basis: present.map(([, , b]) => b),
  };
}

/**
 * Score ONE post for an objective. Returns null when nothing the objective
 * needs was reported — "unknown", which the ranker drops rather than averages
 * in as a bad post. `blended` delegates to scorePost so the default ranking
 * is byte-identical to before this function existed.
 */
export function scoreForObjective(
  row: ObjectiveMetrics,
  objective: PatternObjective = "blended",
): { score: number; basis: ScoreBasis[] } | null {
  const reach = row.reach ?? row.views;
  switch (objective) {
    case "blended":
      return scorePost(row);
    case "discovery": {
      const survival = row.skipRate != null && Number.isFinite(row.skipRate)
        ? Math.max(0, Math.min(1, 1 - row.skipRate))
        : null;
      const watchRatio = row.avgWatchTimeMs != null && row.durationSeconds != null && row.durationSeconds > 0
        ? Math.max(0, Math.min(1, row.avgWatchTimeMs / (row.durationSeconds * 1000)))
        : null;
      // Reach is the denominator of every rate here, so it is not also a term;
      // non-follower reach would be, and no snapshot stores it.
      return weighted([
        [survival, 0.4, "retention"],
        [watchRatio, 0.2, "watch_ratio"],
        [perReach(row.shares, reach), 0.4, "shares"],
      ]);
    }
    case "reference":
      return weighted([
        [perReach(row.saved, reach), 0.6, "saves"],
        [perReach(row.shares, reach), 0.4, "shares"],
      ]);
    case "conversation":
      return weighted([
        [perReach(row.comments, reach, 0.05), 0.6, "comments"],
        [perReach(row.shares, reach), 0.4, "shares"],
      ]);
    case "conversion":
      // Nothing proxies a conversion: without profile/site actions this is
      // UNKNOWN, and the caller sees an empty ranking rather than a guess.
      return weighted([
        [perReach(row.profileVisits, reach, 0.05), 0.5, "profile_visits"],
        [perReach(row.siteActions, reach, 0.02), 0.5, "site_actions"],
      ]);
  }
}

export function rankPatternsByDistribution(
  rows: PatternPerformanceRow[],
  objective: PatternObjective = "blended",
): ScoredPattern[] {
  const acc = new Map<string, { total: number; posts: number; basis: Set<ScoreBasis> }>();

  for (const row of rows) {
    const id = String(row.patternId ?? "").trim();
    if (!id) continue;
    const scored = scoreForObjective(row, objective);
    if (!scored) continue;
    const cur = acc.get(id) ?? { total: 0, posts: 0, basis: new Set<ScoreBasis>() };
    cur.total += scored.score;
    cur.posts += 1;
    for (const b of scored.basis) cur.basis.add(b);
    acc.set(id, cur);
  }

  return [...acc.entries()]
    .map(([patternId, v]) => ({
      patternId,
      score: v.total / v.posts,
      posts: v.posts,
      basis: [...v.basis],
    }))
    .sort((a, b) => b.score - a.score || b.posts - a.posts || a.patternId.localeCompare(b.patternId));
}

export interface LearnedPatternDecision {
  pattern: RotatablePattern | null;
  mode: "rotation" | "learned_exploit" | "learned_explore";
  evidence: ScoredPattern[];
}

/**
 * Pick the next pattern from measured outcomes while preserving exploration.
 *
 * The cadence is based on persisted timesUsed, not randomness, so retries on an
 * unchanged database make the same decision. recordStructureUse increments only
 * after a brief survives preflight, which advances this cadence only when the
 * choice actually produced usable work.
 */
export function selectLearnedPattern(
  patterns: RotatablePattern[],
  outcomes: ScoredPattern[],
  opts: { excludeHookTypes?: string[] } = {},
): LearnedPatternDecision {
  if (patterns.length === 0) return { pattern: null, mode: "rotation", evidence: outcomes };

  const excluded = new Set((opts.excludeHookTypes ?? []).map((x) => x.toLowerCase()));
  const eligible = patterns.filter((p) => !excluded.has(String(p.hookType).toLowerCase()));
  const pool = eligible.length ? eligible : patterns;

  const scoreById = new Map(outcomes.map((o) => [o.patternId, o]));
  const proven = pool
    .map((pattern) => ({ pattern, score: scoreById.get(pattern.id) }))
    .filter((x): x is { pattern: RotatablePattern; score: ScoredPattern } =>
      Boolean(x.score && x.score.posts >= MIN_POSTS_PER_PATTERN));

  const poolIds = new Set(pool.map((p) => p.id));
  const totalMeasured = outcomes
    .filter((o) => poolIds.has(o.patternId))
    .reduce((sum, o) => sum + o.posts, 0);
  if (proven.length < 2 || totalMeasured < MIN_TOTAL_MEASURED_PATTERN_POSTS) {
    return { pattern: selectRotationPattern(patterns, opts), mode: "rotation", evidence: outcomes };
  }

  const totalUses = pool.reduce((sum, p) => sum + Math.max(0, p.timesUsed), 0);
  const underSampled = pool.filter((p) => (scoreById.get(p.id)?.posts ?? 0) < MIN_POSTS_PER_PATTERN);

  if (totalUses % EXPLORATION_EVERY_N_SELECTIONS === 0) {
    // Exploration never disappears. New / weakly sampled structures get the
    // exploration slot first; once every structure is proven, fair rotation
    // still revisits alternatives so a historical winner cannot lock the policy
    // forever after the audience or distribution regime changes.
    const explorationPool = underSampled.length > 0 ? underSampled : pool;
    return {
      pattern: selectRotationPattern(explorationPool, opts),
      mode: "learned_explore",
      evidence: outcomes,
    };
  }

  const best = proven
    .slice()
    .sort((a, b) =>
      b.score.score - a.score.score
      || b.score.posts - a.score.posts
      || a.pattern.timesUsed - b.pattern.timesUsed
      || (a.pattern.lastUsedAt?.getTime() ?? -1) - (b.pattern.lastUsedAt?.getTime() ?? -1)
      || a.pattern.id.localeCompare(b.pattern.id))[0];

  return { pattern: best?.pattern ?? selectRotationPattern(patterns, opts), mode: "learned_exploit", evidence: outcomes };
}
