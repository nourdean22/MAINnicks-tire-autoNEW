/**
 * Reciprocal Rank Fusion · v10.0.361
 *
 * Combine multiple ranked lists into a single robust ranking. Per the
 * /hybrid-search-implementation skill, RRF is the production default
 * for combining lanes with incompatible score scales (cosine similarity
 * vs BM25 vs keyword count) because it ignores absolute scores and
 * uses RANK ordering only.
 *
 * Formula: score(d) = Σ (1 / (k + rank_i(d)))
 *   · rank_i(d) is d's 1-indexed position in list i
 *   · k is a constant (60 is the literature default · higher k flattens
 *     the curve, giving more weight to lower-ranked items)
 *
 * Why RRF beats linear weighted fusion:
 *   · Robust to score-scale skew (semantic 0.0-1.0 vs keyword 0-50)
 *   · Doesn't require careful weight tuning across data shifts
 *   · Items appearing in BOTH lanes get strong boosts naturally
 *   · Items in only one lane still rank if they're top-of-lane
 */

export interface RankedItem<T> {
  id: string;
  item: T;
  /** Optional · raw score from the originating method · for debugging only. */
  rawScore?: number;
}

export interface FusionOptions {
  /** RRF constant · default 60 (literature standard · TREC). */
  k?: number;
  /** Per-lane weight · multiplier on each lane's RRF contribution. */
  weights?: number[];
}

/**
 * Reciprocal Rank Fusion. Each list represents one lane (e.g. semantic,
 * keyword, recency-boosted). The same item may appear in multiple lanes
 * with different ranks · RRF rewards consistent appearance.
 *
 * Returns items in fused-rank order, descending by RRF score.
 */
export function reciprocalRankFusion<T>(
  lanes: Array<RankedItem<T>[]>,
  opts: FusionOptions = {},
): Array<{ id: string; item: T; score: number; lanes: number[] }> {
  const k = opts.k ?? 60;
  const weights = opts.weights;

  // Aggregate across lanes
  const scores = new Map<string, { total: number; item: T; lanesHit: number[] }>();

  lanes.forEach((lane, laneIdx) => {
    const w = weights?.[laneIdx] ?? 1;
    lane.forEach((entry, rankIdx) => {
      const rank = rankIdx + 1; // 1-indexed
      const contribution = w / (k + rank);
      const existing = scores.get(entry.id);
      if (existing) {
        existing.total += contribution;
        existing.lanesHit.push(laneIdx);
      } else {
        scores.set(entry.id, {
          total: contribution,
          item: entry.item,
          lanesHit: [laneIdx],
        });
      }
    });
  });

  return Array.from(scores.entries())
    .map(([id, v]) => ({ id, item: v.item, score: v.total, lanes: v.lanesHit }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Convenience · take a list of items, build a rank list per scoring
 * function, and fuse via RRF. Each scorer returns a number; we sort
 * desc by score to produce the rank list, then pass to RRF.
 *
 * Use when you have one set of items and multiple scoring lenses
 * (e.g. one corpus, scored by semantic similarity AND by keyword
 * relevance AND by recency).
 */
export function fuseRankings<T extends { id: string }>(
  items: T[],
  scorers: Array<(item: T) => number>,
  opts: FusionOptions = {},
): Array<{ id: string; item: T; score: number; lanes: number[] }> {
  const built = scorers.map((scorer, idx) => {
    const scored = items.map((item) => ({
      id: item.id,
      item,
      rawScore: scorer(item),
    }));
    // 2026-09-18 · A lane whose every score is IDENTICAL carries no ranking
    // information — but RRF cannot see that, because it deliberately ignores
    // absolute scores and reads POSITION only. The sort below is stable, so a
    // fully-tied lane silently degrades into "input order", and
    // reciprocalRankFusion then pays it out as 1/(k+1), 1/(k+2), ... — a real,
    // monotonically decreasing signal manufactured from nothing.
    //
    // Found by review on PR #2425, where it mattered concretely: with zero
    // topics `keywordScore(m, [])` is 0 for every candidate, and
    // contextual-recall's pool is `orderBy confidence desc` with KNN-only
    // vector hits unioned in AFTERWARD. The phantom lane therefore boosted
    // generic high-confidence memories and penalised the vector hits — exactly
    // the failure that PR was fixing. I had asserted the opposite ("uniform,
    // therefore ranking-neutral"); uniform is neutral only for a score-based
    // fusion, and this one is rank-based.
    const first = scored[0]?.rawScore ?? 0;
    const informative = scored.length > 1 && scored.some((s) => (s.rawScore ?? 0) !== first);
    return {
      lane: scored.sort((a, b) => (b.rawScore ?? 0) - (a.rawScore ?? 0)),
      weight: opts.weights?.[idx] ?? 1,
      informative,
    };
  });

  // Drop uninformative lanes, carrying each surviving lane's weight with it so
  // the weights array cannot shift out of alignment with the lanes it indexes.
  // If EVERY lane is tied there is nothing to rank by; keep them all rather
  // than returning an empty result, which would be a far worse regression than
  // the phantom ordering this guards against.
  const surviving = built.filter((b) => b.informative);
  const use = surviving.length > 0 ? surviving : built;

  return reciprocalRankFusion(
    use.map((b) => b.lane),
    { ...opts, ...(opts.weights ? { weights: use.map((b) => b.weight) } : {}) },
  );
}
