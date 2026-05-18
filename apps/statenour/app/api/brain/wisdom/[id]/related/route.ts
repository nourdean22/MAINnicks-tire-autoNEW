/**
 * GET /api/brain/wisdom/[id]/related · v10.0.402
 *
 * Per direction B2 · cross-link related wisdoms via cosine similarity
 * over their embeddings. When operator opens a wisdom, surface 5 most
 * related wisdoms · "see also" pattern.
 *
 * COMPUTED ON-DEMAND with in-process LRU cache. No graph table · no
 * pre-compute cron · just pull all wisdom embeddings, compute top-5 by
 * cosine, cache for 10 minutes per anchor wisdom.
 *
 * Pairs with v10.0.394 topic tagger · related wisdoms also share
 * topics often (a Greene law on Power often relates to a Buffett
 * principle on capital allocation).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import { withTracing } from "@/lib/utils/with-tracing";
import { tagWisdomTopics, topicLabel, type WisdomTopic } from "@/lib/brain/wisdom-topic-tagger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const dynamic = "force-dynamic";

interface RelatedWisdom {
  id: string;
  key: string;
  content: string;
  origin: string;
  similarity: number;
  topics: WisdomTopic[];
  topicLabels: string[];
}

interface CacheEntry {
  computedAt: number;
  related: RelatedWisdom[];
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function inferOriginFromKey(key: string): string {
  if (key.startsWith("wisdom_jobs_")) return "steve-jobs";
  if (key.startsWith("wisdom_satori_")) return "satori";
  if (key.startsWith("wisdom_buffett_")) return "warren-buffett";
  if (key.startsWith("wisdom_gates_")) return "bill-gates";
  if (key.startsWith("wisdom_musk_")) return "elon-musk";
  if (key.startsWith("wisdom_greene_")) return "greene-laws";
  if (key.startsWith("wisdom_distilled_")) return "distiller";
  if (key.startsWith("wisdom_from_")) return "consolidation";
  return "uncategorized";
}

async function handler(req: NextRequest, ctx?: unknown): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const params = await (ctx as { params?: Promise<{ id: string }> } | undefined)?.params;
  const anchorId = params?.id;
  if (!anchorId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const cached = cache.get(anchorId);
  if (cached && Date.now() - cached.computedAt < CACHE_TTL_MS) {
    return NextResponse.json({ related: cached.related, cached: true });
  }

  // Pull anchor's embedding
  const anchorEmbedding = await prisma.vectorEmbedding.findFirst({
    where: { sourceType: "brain_memory", sourceId: anchorId },
    select: { embedding: true },
  });
  if (!anchorEmbedding) {
    return NextResponse.json({ related: [], reason: "no_embedding_for_anchor" });
  }

  // Pull all wisdom IDs (excluding anchor) and their embeddings
  const allWisdomIds = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.WISDOM, deletedAt: null, id: { not: anchorId }, confidence: { gte: 0.5 } },
    select: { id: true, key: true, content: true },
  });
  if (allWisdomIds.length === 0) return NextResponse.json({ related: [] });

  const embedRows = await prisma.vectorEmbedding.findMany({
    where: { sourceType: "brain_memory", sourceId: { in: allWisdomIds.map((w) => w.id) } },
    select: { sourceId: true, embedding: true },
  });

  let anchorVec: number[];
  try {
    anchorVec = JSON.parse(anchorEmbedding.embedding) as number[];
  } catch {
    return NextResponse.json({ related: [], reason: "anchor_parse_failed" });
  }

  const wisdomById = new Map(allWisdomIds.map((w) => [w.id, w]));

  const scored: Array<{ id: string; sim: number }> = [];
  for (const row of embedRows) {
    try {
      const vec = JSON.parse(row.embedding) as number[];
      if (vec.length !== anchorVec.length) continue;
      const sim = cosineSimilarity(anchorVec, vec);
      if (sim < 0.4) continue; // floor · don't surface unrelated
      scored.push({ id: row.sourceId, sim });
    } catch { /* skip */ }
  }
  scored.sort((a, b) => b.sim - a.sim);

  const related: RelatedWisdom[] = scored.slice(0, 5).map((s) => {
    const w = wisdomById.get(s.id);
    if (!w) return null;
    const topics = tagWisdomTopics(w.content);
    return {
      id: w.id,
      key: w.key,
      content: w.content,
      origin: inferOriginFromKey(w.key),
      similarity: Math.round(s.sim * 1000) / 1000,
      topics,
      topicLabels: topics.map(topicLabel),
    };
  }).filter((r): r is RelatedWisdom => r !== null);

  cache.set(anchorId, { computedAt: Date.now(), related });
  // Bound cache size
  if (cache.size > 100) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].computedAt - b[1].computedAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }

  return NextResponse.json({ related, cached: false });
}

// Auth: handler above invokes requireSession on first line.
export const GET = withTracing(handler, { name: "/api/brain/wisdom/[id]/related" });
