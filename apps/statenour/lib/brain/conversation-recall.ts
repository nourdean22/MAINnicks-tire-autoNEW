/**
 * Conversation recall · v10.0.524 · #1 cross-conversation context
 *
 * Semantic recall over past conversation summaries. Mirrors the
 * skill-recall pattern (lib/skills/skill-recall.ts):
 *   · Query embedding cache (60s TTL, max 100 entries)
 *   · Pull conversation_summary BrainMemory rows
 *   · Join to vector_embeddings (sourceType="brain_memory")
 *   · Cosine similarity in JS
 *   · Return top-K with similarity score + date + title
 *
 * Used by:
 *   · findRelatedConversations chat tool ("what did I discuss
 *     about X last week?")
 *   · /api/ai/chat/related-conversations endpoint (future UI)
 *   · the detectCrossSessionThread function can also delegate here
 *     instead of doing its own thing
 *
 * The conversation_summary BrainMemory row is written by
 * lib/brain/conversation-memory.ts:summarizeAndStoreConversation
 * with key = `conv_${conversationId}`. We use that key prefix to
 * extract the conversationId for the result payload.
 */

import { prisma } from "@/lib/prisma";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import { getEmbedding } from "@/lib/ai/provider";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/conversation-recall");

const TOP_K_HARD_CAP = 10;
const SIMILARITY_FLOOR = 0.32;
const QUERY_CACHE_TTL_MS = 60 * 1000;

export interface ConversationMatch {
  conversationId: string;
  summary: string;
  similarity: number;
  date: string;
  /** Best-effort topic line extracted from summary. */
  topics: string | null;
}

// ── query embedding cache (60s TTL) ────────────────────────────

const queryCache = new Map<string, { vec: number[]; at: number }>();

async function embedQuery(query: string): Promise<number[] | null> {
  const key = query.trim().toLowerCase();
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.at < QUERY_CACHE_TTL_MS) return cached.vec;
  try {
    const vec = await getEmbedding(key.slice(0, 1500));
    if (!Array.isArray(vec) || vec.length === 0) return null;
    queryCache.set(key, { vec, at: Date.now() });
    if (queryCache.size > 100) {
      const first = queryCache.keys().next().value;
      if (first) queryCache.delete(first);
    }
    return vec;
  } catch (err) {
    log.warn("query_embed_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}

/**
 * Find past conversations semantically similar to `query`. Returns
 * empty array if no embeddings exist or the query is too short.
 *
 * Excludes the current conversation when `excludeConversationId` is
 * provided — keeps "related thread" surfaces from listing the live
 * convo as its own related thread.
 */
export async function findRelatedConversations(
  query: string,
  topK = 5,
  excludeConversationId?: string,
): Promise<ConversationMatch[]> {
  if (!query || query.trim().length < 4) return [];
  const k = Math.max(1, Math.min(TOP_K_HARD_CAP, topK));

  const queryVec = await embedQuery(query);
  if (!queryVec) return [];

  // Pull conversation_summary memories with their embedding rows.
  // Filter at the DB layer so we don't waste compute on un-related
  // brain rows.
  //
  // v10.0.525 H2 fix · log.warn on .catch fallback so the silent-
  // failure-hunter audit's findings don't recur. Pre-fix any DB
  // hiccup collapsed to empty array · indistinguishable from "no
  // prior convos exist yet" which is a real cold-start state. Now
  // the log surface tells the difference.
  const memories = await prisma.brainMemory
    .findMany({
      where: {
        category: "conversation_summary",
        deletedAt: null,
        key: excludeConversationId
          ? { not: `conv_${excludeConversationId}` }
          : undefined,
      },
      orderBy: { updatedAt: "desc" },
      take: 500, // upper bound · operator has ~weeks of convos
      select: { id: true, key: true, content: true, updatedAt: true },
    })
    .catch((err): never[] => {
      log.warn("brainMemory_findMany_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      return [];
    });

  if (memories.length === 0) return [];

  // Pull embeddings for those rows in one query.
  const ids = memories.map((m) => m.id);
  const embeddings = await prisma.vectorEmbedding
    .findMany({
      where: { sourceType: "brain_memory", sourceId: { in: ids } },
      select: { sourceId: true, embedding: true },
    })
    .catch((err): never[] => {
      log.warn("vectorEmbedding_findMany_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
        memCount: memories.length,
      });
      return [];
    });

  if (embeddings.length === 0) return [];

  const embeddingBySourceId = new Map<string, string>();
  for (const e of embeddings) embeddingBySourceId.set(e.sourceId, e.embedding);

  const memById = new Map(memories.map((m) => [m.id, m] as const));

  // v10.0.529 H3 fix · count decode failures so silent corruption surfaces.
  // Pre-fix: a corrupt embeddingJson silently `continue`d, and a dimensionality
  // migration silently skipped every row · the recall returned 0 matches
  // instead of N · indistinguishable from "no relevant convos exist". Now
  // the operator sees a single one-line warn when >0 of either fires.
  let parseFailures = 0;
  let dimensionMismatches = 0;
  const scored: ConversationMatch[] = [];
  for (const [memId, embeddingJson] of embeddingBySourceId) {
    let vec: number[];
    try {
      vec = JSON.parse(embeddingJson) as number[];
    } catch {
      parseFailures += 1;
      continue;
    }
    if (!Array.isArray(vec) || vec.length !== queryVec.length) {
      dimensionMismatches += 1;
      continue;
    }
    const sim = cosineSimilarity(queryVec, vec);
    if (sim < SIMILARITY_FLOOR) continue;

    const mem = memById.get(memId);
    if (!mem) continue;
    const conversationId = mem.key.startsWith("conv_")
      ? mem.key.slice(5)
      : mem.key;

    scored.push({
      conversationId,
      summary: mem.content,
      similarity: sim,
      date: mem.updatedAt.toISOString().slice(0, 10),
      topics: extractTopicsLine(mem.content),
    });
  }

  if (parseFailures > 0 || dimensionMismatches > 0) {
    log.warn("embedding_decode_skips", {
      parseFailures,
      dimensionMismatches,
      queryVecDim: queryVec.length,
      totalRows: embeddingBySourceId.size,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);
}

/**
 * Pull a "topics:" line out of the structured summary if present.
 * The summary format from conversation-memory.ts looks like:
 *   "[conversation 2026-05-12] topics: tasks, drift. key: ...."
 */
function extractTopicsLine(summary: string): string | null {
  const m = summary.match(/topics?:\s*([^.]+)\./i);
  return m ? m[1].trim() : null;
}
