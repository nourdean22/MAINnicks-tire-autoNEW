/**
 * Local SEO rank-tracking target keywords + the report shape.
 *
 * 2026-06-10 GBP growth wave. There is GSC-based rank shift detection
 * server-side, but no curated target-keyword list with a read surface.
 * This is the canonical target set + a manual/future-API report row
 * shape. No scraping, no fabricated ranks — a row's rank is null until
 * a real source (GSC position or manual SERP check) fills it.
 */

export interface RankKeyword {
  keyword: string;
  /** intent grouping for the report. */
  group: "auto-repair" | "tires" | "brakes" | "diagnostics" | "emissions" | "oil" | "suspension" | "local-euclid";
}

export const RANK_KEYWORDS: RankKeyword[] = [
  { keyword: "Cleveland auto repair", group: "auto-repair" },
  { keyword: "auto repair near me", group: "auto-repair" },
  { keyword: "mechanic Cleveland", group: "auto-repair" },
  { keyword: "tire shop Cleveland", group: "tires" },
  { keyword: "used tires Cleveland", group: "tires" },
  { keyword: "tire repair Cleveland", group: "tires" },
  { keyword: "tires Euclid Ave", group: "tires" },
  { keyword: "brake repair Cleveland", group: "brakes" },
  { keyword: "brake shop Euclid", group: "brakes" },
  { keyword: "check engine light repair Cleveland", group: "diagnostics" },
  { keyword: "Ohio E-Check repair", group: "emissions" },
  { keyword: "emissions repair Cleveland", group: "emissions" },
  { keyword: "oil change Cleveland", group: "oil" },
  { keyword: "suspension repair Cleveland", group: "suspension" },
  { keyword: "auto repair Euclid", group: "local-euclid" },
];

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
