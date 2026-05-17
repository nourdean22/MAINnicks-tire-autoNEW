/**
 * Semantic tool-result cache · v10.0.515 · #4
 *
 * Layers on top of the existing two-tier cached() helper to add a
 * THIRD tier: pgvector-keyed similarity lookup.
 *
 * Why a third tier:
 *   L1 (memory) and L2 (Redis) key by exact string. "What's my drift
 *   right now?" and "How drifty am I?" miss each other and each
 *   independently pays the Perplexity / Tavily / Exa bill.
 *
 *   L3 (semantic) embeds the question and searches vector_embeddings
 *   (sourceType="tool_cache") for any recent entry within cosine
 *   distance <= SIMILARITY_THRESHOLD. A hit returns the prior result
 *   in ~50ms — no remote API call, no LLM round-trip.
 *
 * Reuses the existing pgvector infrastructure:
 *   · vector_embeddings table (no schema migration needed)
 *   · getEmbedding() (provider chain, already tracing-wrapped)
 *   · knnSearch() (returns null when pgvector extension is off,
 *     so this helper degrades to L1/L2-only gracefully)
 *
 * Public API:
 *   cachedBySemantic(toolName, question, ttlSec, compute)
 *
 *   The toolName namespaces the cache (perplexity vs tavily etc) so
 *   "what's the weather" cached from a weather tool doesn't collide
 *   with the same query against a different tool.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { getEmbedding } from "@/lib/ai/provider";
import {
  isPgvectorAvailable,
  knnSearch,
  vectorLiteral,
  assertSafeVectorLiteral,
} from "@/lib/db/pgvector";

/**
 * Cosine-distance threshold for "same question, paraphrased".
 * Empirical baseline · tighten if false-positives appear.
 *   distance = 0.00 → identical embedding
 *   distance = 0.10 → near-paraphrase (target hit range)
 *   distance = 0.20 → loosely related (reject)
 *   distance = 0.40 → different topic
 *
 * 0.12 is a conservative starting point. Adjust after observing
 * false positives in /system/agent-traces.
 */
const SIMILARITY_THRESHOLD = 0.12;

interface ToolCacheEntry<T> {
  result: T;
  expiresAt: number;
  // The original question — useful for debugging cache hits in
  // /system/agent-traces ("what semantic match did we serve?").
  question: string;
}

/**
 * Normalize a question for cache key generation. Lowercases, strips
 * punctuation, collapses whitespace. Stops at the literal stage —
 * embedding search handles deeper semantic matching.
 */
function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionHash(toolName: string, question: string): string {
  return createHash("sha1")
    .update(`${toolName}:${normalizeQuestion(question)}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Get a tool result by semantic similarity, or compute it.
 *
 * @param toolName  Namespace ("perplexity", "tavily", "weather", ...)
 * @param question  Natural-language question (the cache key)
 * @param ttlSeconds  Time-to-live for the cached result
 * @param compute  Async fn that returns the result on cache miss
 */
export async function cachedBySemantic<T>(
  toolName: string,
  question: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  // Tier 1+2: literal cache key. Fast path for exact-repeat questions.
  const literalKey = `semcache:${toolName}:${questionHash(toolName, question)}`;
  return cached(literalKey, ttlSeconds, async () => {
    // Tier 3 (semantic): only attempt when pgvector is live.
    if (await isPgvectorAvailable()) {
      const hit = await trySemanticLookup<T>(toolName, question);
      if (hit !== null) return hit;
    }

    // Miss on all tiers — compute fresh.
    const result = await compute();

    // Fire-and-forget the semantic write so the critical path isn't
    // gated on embedding latency.
    void writeSemanticEntry(toolName, question, result, ttlSeconds);

    return result;
  });
}

/**
 * Look for a semantically-similar cache hit. Returns null on miss,
 * pgvector unavailable, or any error (graceful degrade).
 */
async function trySemanticLookup<T>(
  toolName: string,
  question: string,
): Promise<T | null> {
  try {
    const vec = await getEmbedding(question);
    if (!vec || vec.length === 0) return null;

    const hits = await knnSearch(vec, {
      sourceType: "tool_cache",
      limit: 5,
      metric: "cosine",
    });
    if (!hits || hits.length === 0) return null;

    const now = Date.now();
    for (const hit of hits) {
      // Filter to this tool's namespace. sourceId is `${toolName}:${hash}`.
      if (!hit.sourceId.startsWith(`${toolName}:`)) continue;

      // Similarity gate — cosine distance from the `<=>` operator.
      // `distance` field is provided by knnSearch.
      const distance = (hit as { distance?: number }).distance ?? Infinity;
      if (distance > SIMILARITY_THRESHOLD) continue;

      try {
        const entry = JSON.parse(hit.content) as ToolCacheEntry<T>;
        if (entry.expiresAt < now) continue; // expired
        return entry.result;
      } catch {
        // Malformed JSON — skip this entry.
        continue;
      }
    }
    return null;
  } catch {
    // Any failure in the semantic path is non-fatal; fall back to
    // the compute() path.
    return null;
  }
}

/**
 * Persist a tool result to the semantic cache. Dedupes by
 * (toolName + normalized question) so paraphrased re-asks update
 * the existing row instead of bloating the table.
 */
async function writeSemanticEntry<T>(
  toolName: string,
  question: string,
  result: T,
  ttlSeconds: number,
): Promise<void> {
  try {
    const vec = await getEmbedding(question);
    if (!vec || vec.length === 0) return;

    const entry: ToolCacheEntry<T> = {
      result,
      expiresAt: Date.now() + ttlSeconds * 1000,
      question,
    };
    const content = JSON.stringify(entry);
    const sourceId = `${toolName}:${questionHash(toolName, question)}`;

    // Upsert against (sourceType, sourceId).
    const existing = await prisma.vectorEmbedding.findFirst({
      where: { sourceType: "tool_cache", sourceId },
      select: { id: true },
    });
    if (existing) {
      await prisma.vectorEmbedding.update({
        where: { id: existing.id },
        data: { content, embedding: JSON.stringify(vec) },
      });
      await writeVectorColumn(existing.id, vec);
    } else {
      const created = await prisma.vectorEmbedding.create({
        data: {
          sourceType: "tool_cache",
          sourceId,
          content,
          embedding: JSON.stringify(vec),
        },
      });
      await writeVectorColumn(created.id, vec);
    }
  } catch {
    // Cache-write failures are non-fatal — we already returned the
    // computed result to the caller.
  }
}

/**
 * Write the native pgvector column. Inline-quoted because Prisma
 * doesn't parameterize `vector` types. vectorLiteral() validates
 * the input is a numeric array, then assertSafeVectorLiteral()
 * checks the rendered string for injection chars.
 */
async function writeVectorColumn(rowId: string, vec: number[]): Promise<void> {
  try {
    const lit = vectorLiteral(vec);
    assertSafeVectorLiteral(lit);
    await prisma.$executeRawUnsafe(
      `UPDATE vector_embeddings SET embedding_vec = '${lit}'::vector WHERE id = $1`,
      rowId,
    );
  } catch {
    // Most likely the column doesn't exist on this DB. The brain
    // embedding-utils handle the same case identically.
  }
}

/**
 * Purge expired tool-cache entries. Call from a cron or on-demand.
 * Cheap — single SQL pass keyed by sourceType.
 *
 * Returns the row count purged. Failures are silent.
 */
export async function purgeExpiredToolCache(): Promise<number> {
  try {
    // Pull candidate rows, parse content, filter expired.
    const rows = await prisma.vectorEmbedding.findMany({
      where: { sourceType: "tool_cache" },
      select: { id: true, content: true },
    });
    const now = Date.now();
    const expiredIds: string[] = [];
    for (const r of rows) {
      try {
        const e = JSON.parse(r.content) as { expiresAt?: number };
        if (typeof e.expiresAt === "number" && e.expiresAt < now) {
          expiredIds.push(r.id);
        }
      } catch {
        // Malformed entries are also pruned — they're useless.
        expiredIds.push(r.id);
      }
    }
    if (expiredIds.length === 0) return 0;
    await prisma.vectorEmbedding.deleteMany({
      where: { id: { in: expiredIds } },
    });
    return expiredIds.length;
  } catch {
    return 0;
  }
}
