/**
 * RECOMMENDATION NOVELTY -- 2026-09-10.
 *
 * Audit finding: "Huberman, Naval, Goggins, Daily Stoic showed up three
 * separate times in one session" -- each time presented as fresh.
 *
 * The fix the audit asked for is "query memory for prior instances of
 * the same category FIRST". This module is the pure half of that: given
 * the names in a draft reply and the names already recommended, decide
 * what is genuinely new and what is a re-serve.
 *
 * WHY THIS IS NOT AN LLM CALL. "Have I said this before?" is a set
 * intersection. Asking a model to notice repetition across sessions is
 * strictly worse than a lookup: it is slower, it costs a call, it
 * cannot see beyond its context window, and it will confabulate a
 * confident "as I mentioned earlier" for things it never said. This is
 * the clearest case in the whole system where deterministic software
 * beats another model call.
 *
 * IT REUSES THE EXTRACTOR. Names come from `detectNamedSources`, the
 * same function the receipt gate uses -- so a name that is checked for
 * fabrication is the same string that is checked for repetition. Two
 * extractors would drift, and the one that drifted would fail silently.
 */

import { detectNamedSources, normalizeName } from "./named-source-claims";

/** One previously-surfaced recommendation. */
export interface PriorRecommendation {
  /** Name as originally written. */
  name: string;
  /** When it was last surfaced. */
  lastSurfacedAt: Date;
  /** How many times it has been surfaced. */
  timesSurfaced: number;
}

export interface NoveltyReport {
  /** Names in this draft that have never been surfaced before. */
  fresh: string[];
  /** Names being re-served, with how stale the repeat is. */
  repeats: Array<{
    name: string;
    timesSurfaced: number;
    daysSinceLast: number;
  }>;
  /**
   * True when EVERY name in the draft is a repeat. This is the case the
   * audit caught: a list presented as new that contains nothing new.
   */
  allRepeats: boolean;
  /** Total names considered. 0 means this turn made no recommendations. */
  considered: number;
}

/**
 * Compare a draft's named resources against what has already been
 * surfaced. Pure.
 */
export function checkNovelty(
  draft: string,
  priors: readonly PriorRecommendation[],
  now: Date = new Date(),
): NoveltyReport {
  const names = detectNamedSources(draft).map((c) => c.name);
  const priorByKey = new Map<string, PriorRecommendation>();
  for (const p of priors) {
    const k = normalizeName(p.name);
    if (!k) continue;
    // Keep the most-surfaced record if the same name arrives twice.
    const existing = priorByKey.get(k);
    if (!existing || p.timesSurfaced > existing.timesSurfaced) priorByKey.set(k, p);
  }

  const fresh: string[] = [];
  const repeats: NoveltyReport["repeats"] = [];

  for (const name of names) {
    const key = normalizeName(name);
    if (!key) continue;
    const prior = priorByKey.get(key);
    if (!prior) {
      fresh.push(name);
      continue;
    }
    repeats.push({
      name,
      timesSurfaced: prior.timesSurfaced,
      daysSinceLast: Math.max(
        0,
        Math.floor((now.getTime() - prior.lastSurfacedAt.getTime()) / 86_400_000),
      ),
    });
  }

  return {
    fresh,
    repeats,
    // An empty draft has no repeats -- guard against `every()` on [].
    allRepeats: names.length > 0 && repeats.length === names.length && fresh.length === 0,
    considered: names.length,
  };
}

/**
 * PRE-generation form: what has already been recommended, listed before
 * the model writes anything.
 *
 * `checkNovelty` above is the post-hoc check -- useful for scoring and
 * for the evidence panel, but it can only ever DELETE a repeat after the
 * fact, which loses the answer rather than improving it. The audit asked
 * for the other order: "query memory for prior instances of the same
 * category FIRST". This is that. Told up front, the model writes
 * "you've already got Huberman -- here's what's new"; told afterwards,
 * the best available action is deletion.
 *
 * Capped at 12 names: this rides in the system prompt on every
 * recommendation turn, and an unbounded list would grow without limit
 * and quietly eat the context budget it shares with actual memory.
 */
export function buildPriorRecommendationsBlock(
  priors: readonly PriorRecommendation[],
  now: Date = new Date(),
): string {
  if (priors.length === 0) return "";

  const ranked = [...priors]
    .sort((a, b) => {
      // Most-repeated first, then most-recent: the ones most likely to
      // be re-served again are the ones worth spending prompt on.
      if (b.timesSurfaced !== a.timesSurfaced) return b.timesSurfaced - a.timesSurfaced;
      return b.lastSurfacedAt.getTime() - a.lastSurfacedAt.getTime();
    })
    .slice(0, 12);

  const listed = ranked
    .map((p) => {
      const days = Math.max(
        0,
        Math.floor((now.getTime() - p.lastSurfacedAt.getTime()) / 86_400_000),
      );
      return p.timesSurfaced > 1 ? `${p.name} (${p.timesSurfaced}x)` : `${p.name} (${days}d ago)`;
    })
    .join("; ");

  return [
    `ALREADY RECOMMENDED to Nour: ${listed}.`,
    "Do not present any of these as a fresh find. If one is still the right answer, name it AS a repeat and lead with what is actually new. If you have nothing new, say so and offer to search rather than re-serving the same stack.",
  ].join("\n");
}

/**
 * The instruction injected before generation when priors exist.
 *
 * Note it is PRE-generation guidance, not a post-hoc rewrite. Telling
 * the model up front what it has already said produces "you've had
 * Huberman -- here's what's new"; catching it afterwards can only
 * delete, which loses the answer rather than improving it.
 */
export function buildNoveltyBlock(report: NoveltyReport): string {
  if (report.repeats.length === 0) return "";

  const named = report.repeats
    .slice(0, 6)
    .map((r) => `${r.name} (${r.timesSurfaced}x, last ${r.daysSinceLast}d ago)`)
    .join("; ");

  const lines = [
    `ALREADY RECOMMENDED -- do not re-present these as new: ${named}.`,
    "If one of them is still the right answer, say so explicitly as a repeat (\"you've already got X\") and lead with what is actually new.",
  ];

  if (report.allRepeats) {
    lines.push(
      "EVERY item you were about to name has been given before. Say that plainly rather than re-serving the same stack; if you have nothing new, offer to search instead of padding the list.",
    );
  }

  return lines.join("\n");
}
