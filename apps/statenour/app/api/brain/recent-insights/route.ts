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
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface InsightDTO {
  key: string;
  content: string;
  axis: string | null;
  wisdomQuery: string | null;
  confidence: number;
  lastSeen: string;
  enrichedAt: string | null;
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days") ?? 7)));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));

    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await prisma.brainMemory
      .findMany({
        where: {
          category: "task_insight",
          deletedAt: null,
          lastSeen: { gte: since },
        },
        orderBy: { lastSeen: "desc" },
        take: limit,
        select: {
          key: true,
          content: true,
          confidence: true,
          metadata: true,
          lastSeen: true,
        },
      })
      .catch((): Array<{ key: string; content: string; confidence: number; metadata: unknown; lastSeen: Date }> => []);

    const insights: InsightDTO[] = rows.map((r) => {
      const m = (r.metadata ?? null) as {
        axis?: string | null;
        wisdom_query?: string | null;
        enriched_at?: string | null;
      } | null;
      return {
        key: r.key,
        content: r.content,
        axis: m?.axis ?? null,
        wisdomQuery: m?.wisdom_query ?? null,
        confidence: r.confidence,
        lastSeen: r.lastSeen.toISOString(),
        enrichedAt: m?.enriched_at ?? null,
      };
    });

    return { insights, days, count: insights.length };
  },
  { auth: "owner" },
);
