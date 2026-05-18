/**
 * GET /api/brain/wisdom · v10.0.355
 *
 * Feeds the /brain/wisdom dashboard. Returns ALL wisdom-category brain
 * memories, grouped by origin (skill-ingestion source · "steve-jobs" /
 * "satori" / etc) and by ingestion source (skill_ingestion / consolidation
 * / wisdom-distiller / etc).
 *
 * Why this exists:
 *   The wisdom layer is invisible to the operator unless they query the
 *   DB directly. The dashboard lets Nour SEE every principle Nick is
 *   carrying, where it came from, how often it has fired, and how
 *   confident the system is in it. Teaching surface · not just data.
 *
 * Returns:
 *   {
 *     total: number,
 *     totalRecalls: number,
 *     groupings: {
 *       origin:  { [origin: string]: number },
 *       source:  { [source: string]: number },
 *     },
 *     hottest: WisdomEntry[],   // top 5 most-recalled
 *     freshest: WisdomEntry[],  // 5 newest
 *     entries: WisdomEntry[],   // full catalog · sorted by hybrid
 *                                 (confidence × log(seenCount) × recency)
 *   }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { withTracing } from "@/lib/utils/with-tracing";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface WisdomEntry {
  id: string;
  key: string;
  content: string;
  confidence: number;
  seenCount: number;
  /** Derived from metadata.origin · falls back to inferring from key. */
  origin: string;
  source: string;
  createdAt: string;
  lastSeen: string;
  ageDays: number;
  hotness: number; // 0-1 score
}

export const dynamic = "force-dynamic";

function inferOrigin(key: string, metaOrigin: string | null): string {
  if (metaOrigin) return metaOrigin;
  if (key.startsWith("wisdom_jobs_")) return "steve-jobs";
  if (key.startsWith("wisdom_satori_")) return "satori";
  if (key.startsWith("wisdom_distilled_")) return "distiller";
  if (key.startsWith("wisdom_from_")) return "consolidation";
  if (key.startsWith("nick_advice_")) return "chat-scrape";
  return "uncategorized";
}

async function handler(req: NextRequest): Promise<Response> {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const rows = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.WISDOM, deletedAt: null },
    orderBy: [{ confidence: "desc" }, { seenCount: "desc" }],
    select: {
      id: true,
      key: true,
      content: true,
      confidence: true,
      seenCount: true,
      source: true,
      createdAt: true,
      lastSeen: true,
      metadata: true,
    },
  });

  const now = Date.now();
  const maxSeen = Math.max(1, ...rows.map((r) => r.seenCount));

  const entries: WisdomEntry[] = rows.map((r) => {
    const meta = r.metadata as { origin?: string } | null;
    const origin = inferOrigin(r.key, meta?.origin ?? null);
    const ageDays = Math.round((now - r.createdAt.getTime()) / 86400_000);
    // Hotness: log-scaled recall + confidence kicker.
    const recallScore = Math.log10(1 + r.seenCount) / Math.log10(1 + maxSeen);
    const hotness = Math.min(1, recallScore * 0.7 + r.confidence * 0.3);

    return {
      id: r.id,
      key: r.key,
      content: r.content,
      confidence: r.confidence,
      seenCount: r.seenCount,
      origin,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
      lastSeen: r.lastSeen.toISOString(),
      ageDays,
      hotness,
    };
  });

  const groupingsOrigin: Record<string, number> = {};
  const groupingsSource: Record<string, number> = {};
  let totalRecalls = 0;
  for (const e of entries) {
    groupingsOrigin[e.origin] = (groupingsOrigin[e.origin] ?? 0) + 1;
    groupingsSource[e.source] = (groupingsSource[e.source] ?? 0) + 1;
    totalRecalls += e.seenCount;
  }

  const hottest = [...entries].sort((a, b) => b.seenCount - a.seenCount).slice(0, 5);
  const freshest = [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return NextResponse.json({
    total: entries.length,
    totalRecalls,
    groupings: { origin: groupingsOrigin, source: groupingsSource },
    hottest,
    freshest,
    entries,
  });
}

// v10.0.377 · wrapped with withTracing for observability dashboard.
// Auth: handler() above invokes requireSession on its first line.
export const GET = withTracing(handler, { name: "/api/brain/wisdom" });
