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
// 2026-09-02 self-audit, defect #5 · this route carried the second of
// four copies of the origin registry. Its copy ignored `metadata.origin`
// and had no `nick_advice_` case, so a row the wisdom tab labelled
// "Chat scrape" fell through to "uncategorized" in the see-also list on
// the same page. Deleted; the one registry is `lib/brain/wisdom-origins.ts`.
import { resolveWisdomOrigin } from "@/lib/brain/wisdom-origins";

export const dynamic = "force-dynamic";

/** Cosine floor · pairs below this are not "related", they're noise. */
const SIMILARITY_FLOOR = 0.4;
/**
 * The candidate pool is ALSO narrowed to confidence >= 0.5 (see the
 * `findMany` below). Both numbers ship in the response because the
 * client used to hardcode "0.40" in its empty-state copy — and said
 * nothing at all about the confidence floor, so a wisdom with no
 * above-floor neighbours and a wisdom whose neighbours were all
 * low-confidence read identically.
 */
const POOL_CONFIDENCE_FLOOR = 0.5;

interface RelatedWisdom {
  id: string;
  key: string;
  content: string;
  origin: string;
  similarity: number;
  topics: WisdomTopic[];
  topicLabels: string[];
}

/**
 * Why an empty `related` list is empty. An unembedded row must not look
 * like a semantically isolated one: the first is a pipeline gap the
 * operator can fix, the second is a real fact about the corpus.
 */
export type RelatedEmptyReason =
  | "no_embedding_for_anchor"
  | "anchor_parse_failed"
  | "empty_pool"
  | "no_match_above_threshold";

interface CacheEntry {
  computedAt: number;
  related: RelatedWisdom[];
  /** Cached alongside the list · a cache hit on an empty result used to
   *  drop the reason and re-open the ambiguity 10 minutes at a time. */
  reason?: RelatedEmptyReason;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Every response carries the two thresholds that shaped the pool. */
function respond(body: {
  related: RelatedWisdom[];
  cached: boolean;
  reason?: RelatedEmptyReason;
}): Response {
  return NextResponse.json({
    ...body,
    similarityFloor: SIMILARITY_FLOOR,
    poolConfidenceFloor: POOL_CONFIDENCE_FLOOR,
  });
}

async function handler(req: NextRequest, ctx?: unknown): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const params = await (ctx as { params?: Promise<{ id: string }> } | undefined)?.params;
  const anchorId = params?.id;
  if (!anchorId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const cached = cache.get(anchorId);
  if (cached && Date.now() - cached.computedAt < CACHE_TTL_MS) {
    return respond({ related: cached.related, cached: true, reason: cached.reason });
  }

  // Pull anchor's embedding. NOT cached when absent: an embedding can
  // land at any time (embed-backfill cron), and a 10-minute cache of
  // "not embedded" would keep telling the operator so after the fix.
  const anchorEmbedding = await prisma.vectorEmbedding.findFirst({
    where: { sourceType: "brain_memory", sourceId: anchorId },
    select: { embedding: true },
  });
  if (!anchorEmbedding) {
    return respond({ related: [], cached: false, reason: "no_embedding_for_anchor" });
  }

  // Pull all wisdom IDs (excluding anchor) and their embeddings
  const allWisdomIds = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.WISDOM,
      deletedAt: null,
      id: { not: anchorId },
      confidence: { gte: POOL_CONFIDENCE_FLOOR },
    },
    // `metadata` joins the select so the shared resolver can prefer
    // `metadata.origin` · the deleted local copy read the key only.
    select: { id: true, key: true, content: true, metadata: true },
  });
  if (allWisdomIds.length === 0) {
    return respond({ related: [], cached: false, reason: "empty_pool" });
  }

  const embedRows = await prisma.vectorEmbedding.findMany({
    where: { sourceType: "brain_memory", sourceId: { in: allWisdomIds.map((w) => w.id) } },
    select: { sourceId: true, embedding: true },
  });

  let anchorVec: number[];
  try {
    anchorVec = JSON.parse(anchorEmbedding.embedding) as number[];
  } catch {
    return respond({ related: [], cached: false, reason: "anchor_parse_failed" });
  }

  const wisdomById = new Map(allWisdomIds.map((w) => [w.id, w]));

  const scored: Array<{ id: string; sim: number }> = [];
  for (const row of embedRows) {
    try {
      const vec = JSON.parse(row.embedding) as number[];
      if (vec.length !== anchorVec.length) continue;
      const sim = cosineSimilarity(anchorVec, vec);
      if (sim < SIMILARITY_FLOOR) continue; // floor · don't surface unrelated
      scored.push({ id: row.sourceId, sim });
    } catch { /* skip */ }
  }
  scored.sort((a, b) => b.sim - a.sim);

  const related: RelatedWisdom[] = scored.slice(0, 5).map((s) => {
    const w = wisdomById.get(s.id);
    if (!w) return null;
    const topics = tagWisdomTopics(w.content);
    const meta = w.metadata as { origin?: string } | null;
    return {
      id: w.id,
      key: w.key,
      content: w.content,
      origin: resolveWisdomOrigin(w.key, meta?.origin ?? null),
      similarity: Math.round(s.sim * 1000) / 1000,
      topics,
      topicLabels: topics.map(topicLabel),
    };
  }).filter((r): r is RelatedWisdom => r !== null);

  // An empty list here IS the semantic answer — the anchor is embedded,
  // the pool was non-empty, nothing cleared the floor. Say which.
  const reason: RelatedEmptyReason | undefined =
    related.length === 0 ? "no_match_above_threshold" : undefined;

  cache.set(anchorId, { computedAt: Date.now(), related, reason });
  // Bound cache size
  if (cache.size > 100) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].computedAt - b[1].computedAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }

  return respond({ related, cached: false, reason });
}

// Auth: handler above invokes requireSession on first line.
export const GET = withTracing(handler, { name: "/api/brain/wisdom/[id]/related" });
