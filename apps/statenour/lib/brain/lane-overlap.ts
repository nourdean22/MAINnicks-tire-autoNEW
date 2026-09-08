/**
 * lib/brain/lane-overlap.ts · 2026-09-08 (Brain plan, Wave 0 instrument)
 *
 * Two recall lanes fire on every chat turn and both feed the same prompt:
 * memory-recall's durable+KNN fusion (the lane the 2026-08-27 baseline
 * measured at 86% hit@5) and contextual-recall's full pipeline (three
 * candidate lanes, RRF, rerank, novelty). Nothing dedupes across them. This
 * measures, per turn, how much of the contextual lane's evidence the hybrid
 * lane already carried — the number the retrieval arbiter (Wave 2) has to beat.
 */
export interface LaneOverlap {
  contextual: number;
  hybrid: number;
  shared: number;
  /** shared / contextual, 0 when the contextual lane returned nothing. */
  ratio: number;
}

export function computeLaneOverlap(contextualIds: readonly string[], hybridIds: readonly string[]): LaneOverlap {
  const c = new Set(contextualIds.map(String));
  const h = new Set(hybridIds.map(String));
  let shared = 0;
  for (const id of c) if (h.has(id)) shared += 1;
  return { contextual: c.size, hybrid: h.size, shared, ratio: c.size === 0 ? 0 : Math.round((shared / c.size) * 1000) / 1000 };
}
