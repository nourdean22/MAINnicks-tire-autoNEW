/**
 * U2 (2026-10-30) · how the chat's Context & Evidence panel ranks and folds recalled memories.
 *
 * Matches under WEAK_MATCH_BELOW are listed as weak and folded away by default. Same number and
 * reason as lib/brain/contextual-recall.ts WISDOM_SLOT_MIN_SIMILARITY: on Nour's own turns the
 * best-match cosine runs p10 0.21 · median 0.27 · p90 0.37, so a 23% "match" is noise. Display
 * only: what recall hands the model is the brain lane's call. A test pins the two numbers equal.
 */
export const WEAK_MATCH_BELOW = 0.35;

/** Strong matches best first (so the order agrees with the % shown), and the weak ones. */
export function splitBySimilarity<T extends { similarity: number }>(hits: T[]): { strong: T[]; weak: T[] } {
  const sorted = [...hits].sort((a, b) => b.similarity - a.similarity);
  return {
    strong: sorted.filter((h) => h.similarity >= WEAK_MATCH_BELOW),
    weak: sorted.filter((h) => h.similarity < WEAK_MATCH_BELOW),
  };
}
