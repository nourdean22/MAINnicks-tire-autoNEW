/**
 * Thread arc trend · journal-advancement item E (2026-06-10).
 *
 * Pure, dependency-free so it unit-tests without prisma/provider imports.
 * COMPUTED from real join recency — never AI-generated, never overclaimed:
 *
 *   stale         · dormant (30d+ quiet, cron-managed status)
 *   fading        · active thread but no joins in 14+ days
 *   strengthening · ≥2 joins this week AND more than the prior week
 *   steady        · alive (joined within 14d) but not accelerating
 *
 * The strengthening bar is deliberately strict (2+ AND accelerating) so a
 * single stray entry can't be oversold as a compounding arc.
 */
export type ThreadTrend = "strengthening" | "steady" | "fading" | "stale";

export function computeThreadTrend(args: {
  status: string;
  daysSinceJoin: number;
  joins7d: number;
  joinsPrior7d: number;
}): ThreadTrend {
  if (args.status === "dormant") return "stale";
  if (args.daysSinceJoin >= 14) return "fading";
  if (args.joins7d >= 2 && args.joins7d > args.joinsPrior7d) return "strengthening";
  return "steady";
}
