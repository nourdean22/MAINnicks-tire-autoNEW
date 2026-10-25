/**
 * Local SEO rank-tracking target keywords + the report shape.
 *
 * 2026-10-25: the keyword list moved to shared/localRankKeywords.ts so the server read
 * (localGrowth.targetKeywordRanks) and the admin panel share one list; this path
 * re-exports it for existing importers (server/gbp-growth.test.ts).
 */
import { RANK_KEYWORDS, type RankKeyword } from "@shared/localRankKeywords";

export { RANK_KEYWORDS, type RankKeyword };

/** One report row per keyword. rank null = not yet measured (never fake it). */
export interface RankRow {
  keyword: string;
  group: RankKeyword["group"];
  /** Google position from GSC avg or a manual SERP check; null until measured. */
  rank: number | null;
  /** Where the number came from, for honesty. */
  source: "gsc" | "manual" | "unmeasured";
  measuredAt: string | null;
}

export function emptyRankReport(): RankRow[] {
  return RANK_KEYWORDS.map((k) => ({
    keyword: k.keyword, group: k.group, rank: null, source: "unmeasured", measuredAt: null,
  }));
}
