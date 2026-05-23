/**
 * Conversational memory recall · v10.0.91 · 2026-05-02.
 *
 * Given a user message (or any text), surface the top-N memories
 * most relevant to inject as live context. Combines:
 *   · Hybrid search (FTS + KNN via embedding_vec_1536)
 *   · Recency boost (last_seen within 14d gets +20%)
 *   · Confidence boost (high-conf rows surface first)
 *   · Category whitelist (only "context-worthy" categories)
 *
 * Returns a compact citation-ready payload the chat route can stuff
 * into the system prompt as "Recently relevant" context.
 *
 * Intentionally separate from semantic-recall.ts (which is the
 * lower-level KNN tool) — this is the opinionated "what does Nick
 * NEED to remember right now" surface.
 */

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import { logger as rootLogger } from "@/lib/logger";
import { recordError } from "@/lib/errors/record-error";
import { withEfSearch, EF_SEARCH } from "@/lib/db/vector-tuning";

const log = rootLogger.withSurface("brain/memory-recall");

const TARGET_DIM = 1536;
const KNN_TOP = 30;
const FINAL_TOP = 8;
const MAX_CONTENT_LEN = 220;

// Categories worth pulling into chat context. Anti-list: telemetry,
// markers, alerts (those don't help the conversation).
//
// 2026-05-23 · Wave B · Q3 · added `domain_knowledge` (the most
// information-dense category in the brain · CoALA semantic-kind ·
// fed by lib/brain/domain-knowledge-extractor.ts with tire margins,
// tax rates, shop-specific business facts). Pre-fix it was pulled
// by KNN then silently filtered out at line ~175 before scoring ·
// the entire semantic CoALA lane was dead on arrival for recall.
const CONTEXT_CATEGORIES = new Set([
  "wisdom",
  "insight",
  "pattern",
  "blind_spot",
  "strategic_plan",
  "decision_pattern",
  "qualitative_identity",
  "belief",
  "contradiction",
  "counter_intuitive",
  "meta_pattern",
  "nick_advice",
  "customer_stories",
  "industry_intel",
  "chat_summary",
  "conversation_summary",
  "brain_dump",
  "reflection",
  "domain_knowledge",
]);

export interface RecallHit {
  memoryId: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  ageDays: number;
  knnDistance: number;
  finalScore: number;
}

export interface RecallReport {
  query: string;
  durationMs: number;
  scanned: number;
  hits: RecallHit[];
}

function padToTargetDim(arr: number[]): number[] {
  if (arr.length === TARGET_DIM) return arr;
  if (arr.length > TARGET_DIM) return arr.slice(0, TARGET_DIM);
  return [...arr, ...new Array(TARGET_DIM - arr.length).fill(0)];
}

/**
 * Recall the top-N most relevant memories for a user query.
 *
 * @param query — the user's message or any text to search against
 * @param opts.limit — how many memories to return (default 8)
 * @param opts.embedding — pre-computed embedding (skips AI call)
 */
export async function recallMemoriesForQuery(
  query: string,
  opts: { limit?: number; embedding?: number[] } = {},
): Promise<RecallReport> {
  const t0 = Date.now();
  const limit = Math.max(1, Math.min(opts.limit ?? FINAL_TOP, 20));

  if (!query?.trim()) {
    return { query, durationMs: 0, scanned: 0, hits: [] };
  }

  // 1. Get embedding for the query
  let queryEmb = opts.embedding;
  if (!queryEmb || queryEmb.length === 0) {
    queryEmb = await getEmbedding(query).catch(() => [] as number[]);
  }
  if (!queryEmb || queryEmb.length === 0) {
    log.warn("recall_no_embedding", { queryLen: query.length });
    return { query, durationMs: Date.now() - t0, scanned: 0, hits: [] };
  }

  const padded = padToTargetDim(queryEmb);
  // v10.0.104 audit fix · validate every element is a finite number
  // before serializing to a vector literal. Prevents "[NaN, Infinity]"
  // or any other malformed token from landing in the SQL string. The
  // embedding source is internal AI but a poisoned response is the
  // failure mode we hardenagainst here.
  for (let i = 0; i < padded.length; i++) {
    if (!Number.isFinite(padded[i])) {
      log.warn("recall_invalid_embedding", { idx: i, val: padded[i] });
      return { query, durationMs: Date.now() - t0, scanned: 0, hits: [] };
    }
  }
  const vecLit = `[${padded.join(",")}]`;

  // 2. KNN cosine search across brain_memory embeddings, joined to
  //    BrainMemory for category + confidence + recency
  // v10.0.403 · wrap KNN in withEfSearch(HIGH_RECALL=80) so this
  // recall path uses 2x the HNSW search effort vs default · trades
  // ~30-50ms latency for ~3-5pp recall lift on borderline matches.
  const rows = await withEfSearch(prisma, EF_SEARCH.HIGH_RECALL, (tx) =>
    tx.$queryRawUnsafe<
      Array<{
        memory_id: string;
        category: string;
        key: string;
        content: string;
        confidence: number;
        last_seen: Date;
        distance: number;
      }>
    >(
      `SELECT
         bm.id::text AS memory_id,
         bm.category::text AS category,
         bm.key::text AS key,
         substring(bm.content, 1, ${MAX_CONTENT_LEN})::text AS content,
         bm.confidence::float AS confidence,
         bm.last_seen,
         (ve.embedding_vec_1536 <=> $1::vector(${TARGET_DIM})) AS distance
       FROM vector_embeddings ve
       JOIN brain_memories bm
         ON bm.id = ve."sourceId"
        AND bm.deleted_at IS NULL
       WHERE ve."sourceType" = 'brain_memory'
         AND ve.embedding_vec_1536 IS NOT NULL
         AND bm.confidence >= 0.3
       ORDER BY ve.embedding_vec_1536 <=> $1::vector(${TARGET_DIM})
       LIMIT ${KNN_TOP}`,
      vecLit,
    ),
  ).catch((err) => {
    log.warn("knn_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return [] as Array<{
      memory_id: string;
      category: string;
      key: string;
      content: string;
      confidence: number;
      last_seen: Date;
      distance: number;
    }>;
  });

  // 3. Filter to context-worthy categories + score
  const now = Date.now();
  const scored: RecallHit[] = rows
    .filter((r) => CONTEXT_CATEGORIES.has(r.category))
    .map((r) => {
      const ageDays = Math.floor(
        (now - new Date(r.last_seen).getTime()) / 86_400_000,
      );
      // similarity = 1 - distance (cosine). Then:
      //   recency boost: <14d → +0.2, <60d → +0.1, else 0
      //   confidence boost: confidence × 0.3
      const sim = Math.max(0, 1 - r.distance);
      const recency =
        ageDays < 14 ? 0.2 : ageDays < 60 ? 0.1 : 0;
      const conf = r.confidence * 0.3;
      const finalScore = sim + recency + conf;
      return {
        memoryId: r.memory_id,
        category: r.category,
        key: r.key,
        content: r.content.replace(/\s+/g, " ").trim(),
        confidence: r.confidence,
        ageDays,
        knnDistance: r.distance,
        finalScore: Math.round(finalScore * 1000) / 1000,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);

  // 4. Bump lastSeen on returned memories so they stay "fresh"
  if (scored.length > 0) {
    void prisma.brainMemory
      .updateMany({
        where: { id: { in: scored.map((s) => s.memoryId) } },
        data: { lastSeen: new Date() },
      })
      .catch((err) => {
        recordError("brain:memory-recall", err, { phase: "lastSeen-bump", count: scored.length });
      });
  }

  return {
    query,
    durationMs: Date.now() - t0,
    scanned: rows.length,
    hits: scored,
  };
}

/**
 * Format the recall hits as a compact system-prompt block.
 * Designed to be appended to the chat system prompt under a
 * "Recently relevant memories" header.
 */
export function formatRecallForPrompt(hits: RecallHit[]): string {
  if (hits.length === 0) return "";
  const lines = hits.map((h, i) => {
    const ageStr = h.ageDays === 0 ? "today" : `${h.ageDays}d ago`;
    return `[${i + 1}] [${h.category}] ${h.content} (${ageStr}, conf=${h.confidence.toFixed(2)})`;
  });
  return `Recently relevant memories (top-${hits.length} via hybrid search):\n${lines.join("\n")}`;
}
