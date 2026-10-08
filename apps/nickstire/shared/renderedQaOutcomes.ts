/**
 * Does a rendered-QA finding actually cost viewers? (2026-10-08)
 *
 * The vision critic (server/services/renderedQa.ts) names defects from a
 * registry — PLASTIC_AI_LOOK, GENERIC_STOCK_LOOK, LIGHTING_DRIFT and the rest.
 * A "warn" ships; a "block" is repaired. Which codes belong on which side was
 * decided by taste when the registry was written, and nothing since has asked
 * the audience. This joins each posted Reel's findings (reel_jobs.payload
 * .renderedQa, completed evaluations only) with the skip rate Instagram later
 * reported for it, and asks, per code: do the posts carrying it get skipped
 * more than the posts that do not?
 *
 * The answer is a two-sample permutation test (shared/contentExperiments.ts
 * permutationP), Bonferroni-corrected over the codes tested, so a code is
 * called costly only when the gap is one that relabelling the same posts
 * would rarely produce. Fewer than MIN_PER_SIDE posts on either side is "not
 * tested", never "no cost". Pure: the reader lives in creativeAssistant.ts.
 */
import { permutationP } from "./contentExperiments";

export interface QaOutcomeRow {
  postId: string;
  /** Distinct finding codes the completed critic verdict carried; [] is a clean pass. */
  codes: string[];
  /** Latest snapshot skip rate in percent (ig_metric_snapshots.skip_rate), null when never reported. */
  skipRate: number | null;
}

export interface FindingCost {
  code: string;
  withN: number;
  withoutN: number;
  withMeanSkip: number;
  withoutMeanSkip: number;
  /** Percentage points of skip rate the posts carrying the code lose. Positive = costs viewers. */
  deltaPoints: number;
  /** Raw two-sided permutation p; `alpha` is already divided by the number of codes tested. */
  p: number;
  alpha: number;
  costly: boolean;
}

export const MIN_PER_SIDE = 4;
const ALPHA = 0.05;

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * One FindingCost per code with at least MIN_PER_SIDE measured posts on both
 * sides, costliest first. Posts with no reported skip rate are not evidence
 * either way and are dropped before counting.
 */
export function measureFindingCosts(rows: QaOutcomeRow[]): FindingCost[] {
  const measured = rows.filter((r) => typeof r.skipRate === "number" && Number.isFinite(r.skipRate));
  const codes = new Set<string>();
  for (const r of measured) for (const c of r.codes) codes.add(c);
  const candidates: Array<{ code: string; with: number[]; without: number[] }> = [];
  for (const code of [...codes].sort()) {
    const w: number[] = [];
    const wo: number[] = [];
    for (const r of measured) (r.codes.includes(code) ? w : wo).push(r.skipRate as number);
    if (w.length >= MIN_PER_SIDE && wo.length >= MIN_PER_SIDE) candidates.push({ code, with: w, without: wo });
  }
  if (!candidates.length) return [];
  const alpha = ALPHA / candidates.length;
  return candidates
    .map(({ code, with: w, without: wo }) => {
      const p = permutationP(w, wo);
      const deltaPoints = mean(w) - mean(wo);
      return {
        code, withN: w.length, withoutN: wo.length,
        withMeanSkip: mean(w), withoutMeanSkip: mean(wo), deltaPoints, p, alpha,
        costly: deltaPoints > 0 && p <= alpha,
      };
    })
    .sort((a, b) => Number(b.costly) - Number(a.costly) || b.deltaPoints - a.deltaPoints || a.code.localeCompare(b.code));
}
