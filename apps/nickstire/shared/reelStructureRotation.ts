/**
 * Which captured pattern should the next reel be built on.
 *
 * PATTERN LAB WAS WRITE-ONLY. `social_reel_patterns` (migration 0107) captures
 * the STRUCTURE of short-form references an operator judged worth stealing —
 * hook type, pacing, loop mechanics — as data, never content. The table carries
 * `timesUsed` and `lastUsedAt`, which only make sense for rotation. Nothing ever
 * incremented them: as of 2026-08-16 the only file referencing the table was
 * `server/routers/instagramAdmin.ts`, i.e. list / save / delete. Patterns went
 * in and never came out.
 *
 * WHY ROTATION AND NOT RANKING. Ranking would need a pattern -> outcome link,
 * and there isn't one — the schema comment says the typed columns exist "for
 * future cohort joins (pattern x trial results)" and that join was never built.
 * Selecting by least-used is the honest policy while that data does not exist,
 * AND it is what creates the data: every selection is recorded on the brief, so
 * a later pass can join pattern against the metrics in ig_metric_snapshots and
 * finally rank. Ranking on nothing would be fabrication; rotating and recording
 * earns the right to rank later.
 *
 * Pure: no database. The IO half is server/services/reelStructurePrior.ts.
 */

export interface RotatablePattern {
  id: string;
  label: string;
  hookType: string;
  loopType: string;
  timesUsed: number;
  lastUsedAt: Date | null;
}

/**
 * Least-used first; ties broken by oldest use, then by id for determinism.
 *
 * `null` lastUsedAt (never used) sorts BEFORE any date — an uncaptured pattern
 * should get its first airing before a used one repeats. Determinism matters:
 * two runs on identical data must pick identically, or the "which pattern
 * produced this" record becomes unreproducible.
 */
export function selectRotationPattern(
  patterns: RotatablePattern[],
  opts: { excludeHookTypes?: string[] } = {},
): RotatablePattern | null {
  const exclude = new Set((opts.excludeHookTypes ?? []).map((h) => h.toLowerCase()));
  const eligible = patterns.filter((p) => !exclude.has(String(p.hookType).toLowerCase()));
  // Falling back to the full set when the exclusion empties it is deliberate:
  // repeating a hook type is a smaller failure than shipping no structure at
  // all, and the caller cannot tell the difference from a null return.
  const pool = eligible.length > 0 ? eligible : patterns;
  if (pool.length === 0) return null;

  return [...pool].sort((a, b) => {
    if (a.timesUsed !== b.timesUsed) return a.timesUsed - b.timesUsed;
    const at = a.lastUsedAt ? a.lastUsedAt.getTime() : -1;
    const bt = b.lastUsedAt ? b.lastUsedAt.getTime() : -1;
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}
