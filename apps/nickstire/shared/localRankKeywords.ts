/**
 * Local search target keywords: the list the admin Local Growth rank panel tracks.
 *
 * 2026-06-10 GBP growth wave started the curated 15. 2026-10-25: moved here from
 * client/src/lib so the server read (server/pipelines/targetKeywordRanks.ts) and the
 * client share one list, and extended with the service queries Search Console already
 * shows the shop for (keywords selected from GSC, the SEOTesting watchlist pattern).
 * Matching is exact after lowercasing, so every entry must stay unique in lowercase.
 * No scraping and no fabricated ranks: a position exists only where Google recorded
 * an impression.
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
  // Observed service queries (search_performance, 28 days to 2026-10-23, 333-845 impressions each).
  { keyword: "tires cleveland", group: "tires" },
  { keyword: "used tires near me", group: "tires" },
  { keyword: "tire shops near me", group: "tires" },
  { keyword: "tire shop near me", group: "tires" },
  { keyword: "tire shops cleveland", group: "tires" },
  { keyword: "brakes near me", group: "brakes" },
  { keyword: "brake repair near me", group: "brakes" },
  { keyword: "brake shop near me", group: "brakes" },
];
