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
 * - 1 in 4 selections remains exploration, deterministically, so new/under-
 *   sampled structures can still earn enough observations to challenge winners
 * - missing metrics stay UNKNOWN via scorePost(); they are never zero-filled
 *
 * This is observational ranking, not causality. It biases generation toward
 * structures that have earned better measured distribution on this account;
 * controlled experiments remain the stronger evidence lane.
 */
import { scorePost, type ThemePerformanceRow } from "./reelPerformancePrior";
import { selectRotationPattern, type RotatablePattern } from "./reelStructureRotation";

export interface PatternPerformanceRow extends ThemePerformanceRow {
  patternId: string;
}

export interface ScoredPattern {
  patternId: string;
  score: number;
  posts: number;
  basis: Array<"saves" | "shares" | "retention">;
}

export const MIN_POSTS_PER_PATTERN = 3;
export const MIN_TOTAL_MEASURED_PATTERN_POSTS = 12;
export const EXPLORATION_EVERY_N_SELECTIONS = 4;

export function rankPatternsByDistribution(rows: PatternPerformanceRow[]): ScoredPattern[] {
  const acc = new Map<string, { total: number; posts: number; basis: Set<string> }>();

  for (const row of rows) {
    const id = String(row.patternId ?? "").trim();
    if (!id) continue;
    const scored = scorePost(row);
    if (!scored) continue;
    const cur = acc.get(id) ?? { total: 0, posts: 0, basis: new Set<string>() };
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
      basis: [...v.basis] as ScoredPattern["basis"],
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

  const totalMeasured = outcomes.reduce((sum, o) => sum + o.posts, 0);
  if (proven.length < 2 || totalMeasured < MIN_TOTAL_MEASURED_PATTERN_POSTS) {
    return { pattern: selectRotationPattern(patterns, opts), mode: "rotation", evidence: outcomes };
  }

  const totalUses = pool.reduce((sum, p) => sum + Math.max(0, p.timesUsed), 0);
  const underSampled = pool.filter((p) => (scoreById.get(p.id)?.posts ?? 0) < MIN_POSTS_PER_PATTERN);

  if (underSampled.length > 0 && totalUses % EXPLORATION_EVERY_N_SELECTIONS === 0) {
    return {
      pattern: selectRotationPattern(underSampled, opts),
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
