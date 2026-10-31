/**
 * U2 (2026-10-30) · which recalled memories the chat's Context & Evidence panel folds away.
 *
 * Recall's own order is kept: it fuses a dense (cosine) lane with a lexical (ts_rank_cd) lane by
 * rank, and the two score scales are not comparable, so re-sorting by the % shown would be wrong.
 * The first KEEP_TOP_HITS always show (a top literal match can carry a low score). Below them, a
 * hit under WEAK_MATCH_BELOW folds behind a count. 0.35 is lib/brain/contextual-recall.ts
 * WISDOM_SLOT_MIN_SIMILARITY, chosen on Nour's own turns (best-match cosine p10 0.21 · median 0.27
 * · p90 0.37); a test pins the two equal. Display only: what recall hands the model is unchanged.
 */
export const WEAK_MATCH_BELOW = 0.35;
export const KEEP_TOP_HITS = 3;

export function splitWeakTail<T extends { similarity: number }>(hits: T[]): { strong: T[]; weak: T[] } {
  const strong: T[] = [];
  const weak: T[] = [];
  hits.forEach((h, i) => (i < KEEP_TOP_HITS || h.similarity >= WEAK_MATCH_BELOW ? strong : weak).push(h));
  return { strong, weak };
}
