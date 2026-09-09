/**
 * One place that scores a reel brief WITH its memory.
 *
 * `calculateReelQualityScore` takes an optional `recent` context and, without
 * it, scores the distinctiveness part zero and labels it "not checked". That is
 * the honest thing for a pure function to do - but it means the check only
 * actually runs where a caller remembered to pass the context, and on
 * 2026-09-09 exactly ONE of seven call sites did. The other six were re-scoring
 * live briefs with the originality check permanently dark, and paying five
 * points for the privilege, which quietly demanded a perfect score on every
 * other part.
 *
 * The check is not optional in any lane that decides whether a reel is worth
 * making, so the fetch lives here rather than in seven places that can each
 * forget it. `getRecentReelSignals` degrades to `available: false` rather than
 * throwing, and the scorer treats that as "not checked" instead of "distinct",
 * so a database outage costs points but never invents originality.
 *
 * Callers scoring MANY briefs at once must not use this - it reads the history
 * per call. Fetch `getRecentReelSignals()` once and pass `{ recent }` straight
 * to `calculateReelQualityScore`.
 */
import type { ReelBrief, QualityScoreResult } from "../../client/src/lib/facelessReelStudio";

export async function scoreReelBriefWithMemory(
  brief: ReelBrief,
  minScore?: number,
): Promise<QualityScoreResult> {
  const { calculateReelQualityScore } = await import("../../client/src/lib/facelessReelStudio");
  const { getRecentReelSignals } = await import("./reelRepetitionHistory");
  const recent = await getRecentReelSignals();
  return calculateReelQualityScore(brief, minScore, { recent });
}
