/**
 * Prompt-evolution cohorts (2026-10-09) -- which seeds each stage of the gate
 * may see.
 *
 * WHY A THIRD SLICE. ghostReplay.splitSeeds cuts failed calls into train and
 * holdout by a hash of the call id, so the split is stable run to run -- the
 * property that keeps a candidate from being graded on what it was optimized
 * against. The same stability means the holdout is RE-USED every week: a loop
 * that keeps proposing candidates and keeps the one that passes is selecting
 * on the holdout, and the winner carries that selection (the winner's curse).
 * The cure is a sealed CONFIRMATION slice, scored once, after the holdout
 * accepted, and then marked consumed so it can never be scored again
 * (promptEvolutionGate.judgeConfirmation).
 *
 * THE SPLIT. Same hash as splitSeeds, copied here byte for byte so this module
 * stays import-free: h = (h * 31 + code) >>> 0 over `for (const ch of id)`
 * with ch.charCodeAt(0), bucket = h % 100. Buckets [0, 40) are the holdout --
 * IDENTICAL membership to splitSeeds(seeds, 0.4), pinned by test, so turning
 * this on does not reshuffle a single holdout seed. Buckets [40, 60) become
 * confirmation and [60, 100) train: the confirmation slice is carved out of
 * what used to be train, so train shrinks by a third.
 *
 * SIZE -- THE CONFIRMATION SLICE IS SMALL (2026-10-09, review finding). The
 * confirm buckets are 20% of the pool, and judgeConfirmation reads
 * "underpowered" below minSeedsForAlpha(alpha) comparable seeds (5 at 0.05,
 * 6 at 0.025 -- and the multiplicity rule divides alpha further). Measured on
 * hashed UUID pools (test-pinned; exact binomial in brackets):
 *   pool 12 (runPromptEvolution's default seedCount) -> 5+ confirm seeds in
 *            7.4% of draws [7.3%]: a perfect candidate fails confirmation
 *            on size alone ~93% of the time;
 *   pool 30 (promptEvolutionWeekly's seedCount)     -> 75.5% [74.5%];
 *   pool 44                                          -> 95.6% [the smallest
 *            pool with >= 95% at alpha 0.05].
 * runPromptEvolution clamps seedCount to 40, so a caller wiring confirmation
 * must draw the confirm slice from a LARGER failed-call pool than the train /
 * holdout sample (the hash makes membership independent of pool size: a seed
 * in the confirm buckets is in them whatever else was loaded), and must
 * treat "underpowered" as "not confirmed yet", never as a refutation.
 *
 * SUCCESS COHORT. selectSuccessCohort picks won calls for the evaluator-only
 * success-regression check by the same hash (full 32-bit value, id as the
 * tie-break), so the cohort is a deterministic function of the pool and does
 * not depend on query order. It is never shown to the optimizer.
 *
 * Pure: no DB, no clock, no imports.
 */

/** The splitSeeds hash, unreduced. Iterates code points, reads the first UTF-16 unit of each -- exactly as splitSeeds does. */
function seedHash(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** The splitSeeds bucket, 0..99. */
export const seedBucket = (id: string): number => seedHash(id) % 100;

export interface ThreeWaySplit<T> {
  train: T[];
  holdout: T[];
  confirm: T[];
}

/**
 * Deterministic three-way split on the seed id. Ratios are shares of the
 * 100 hash buckets: holdout takes [0, holdout*100), confirm the next
 * confirm*100 buckets, train the rest. Input order is preserved in each slice.
 */
export function splitSeedsThreeWay<T extends { id: string }>(
  seeds: ReadonlyArray<T>,
  ratios: { holdout?: number; confirm?: number } = {},
): ThreeWaySplit<T> {
  const holdout = ratios.holdout ?? 0.4;
  const confirm = ratios.confirm ?? 0.2;
  if (!(holdout >= 0 && confirm >= 0 && holdout + confirm <= 1)) {
    throw new Error(`splitSeedsThreeWay: ratios must be >= 0 and sum to <= 1 (holdout ${holdout}, confirm ${confirm})`);
  }
  // Same rounding as splitSeeds, so holdout 0.4 cuts at exactly bucket 40.
  const holdoutCut = Math.round(holdout * 100);
  const confirmCut = holdoutCut + Math.round(confirm * 100);
  const out: ThreeWaySplit<T> = { train: [], holdout: [], confirm: [] };
  for (const s of seeds) {
    const b = seedBucket(s.id);
    (b < holdoutCut ? out.holdout : b < confirmCut ? out.confirm : out.train).push(s);
  }
  return out;
}

/** Drop every seed already spent by a confirmation (or any stage that must not re-read it). */
export function excludeConsumed<T extends { id: string }>(seeds: ReadonlyArray<T>, consumedIds: Iterable<string>): T[] {
  const consumed = new Set(consumedIds);
  return seeds.filter((s) => !consumed.has(s.id));
}

/** The n won calls with the smallest seedHash (id breaks ties) -- the same cohort for the same pool, in any order. */
export function selectSuccessCohort<T extends { id: string }>(seeds: ReadonlyArray<T>, n: number): T[] {
  if (!(n > 0)) return [];
  return seeds
    .map((s) => ({ s, h: seedHash(s.id) }))
    .sort((a, b) => a.h - b.h || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0))
    .slice(0, Math.floor(n))
    .map(({ s }) => s);
}
