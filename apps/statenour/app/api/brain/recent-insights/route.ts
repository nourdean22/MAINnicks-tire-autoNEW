/**
 * GET /api/brain/recent-insights · Wave 23 (v10.0.529.79) · #4
 *
 * Returns the last N days of BrainMemory(task_insight) rows, grouped
 * by metadata.axis. Feeds <RecentInsightsPanel> on /trends.
 *
 * Each insight carries:
 *   · content (regex-extracted title OR LLM-enriched lesson)
 *   · axis tag (from LLM enrichment · null for un-enriched)
 *   · wisdom_query (the suggested next thread, when present)
 *   · createdAt + lastSeen
 *
 * Query params:
 *   · days · lookback window (default 7, max 30)
 *   · limit · max rows (default 50, max 200)
 */

import { apiHandler } from "@/lib/utils/http";
import { buildRecentInsights } from "@/lib/services/brain-domain";

export const dynamic = "force-dynamic";

// Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
// the inline query + metadata projection moved to
// `lib/services/brain-domain.buildRecentInsights` so this route AND the
// new `trpc.brain.recentInsights` procedure call the same function ·
// drift impossible.
export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const days = Math.min(
      30,
      Math.max(1, Number(url.searchParams.get("days") ?? 7)),
    );
    const limit = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("limit") ?? 50)),
    );
    return buildRecentInsights({ days, limit });
  },
  { auth: "owner" },
);
