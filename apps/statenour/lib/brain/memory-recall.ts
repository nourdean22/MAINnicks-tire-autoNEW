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
import { getFlag } from "@/lib/feature-flags";
import { logger as rootLogger } from "@/lib/logger";
import { recordError } from "@/lib/errors/record-error";
import { withEfSearch, EF_SEARCH } from "@/lib/db/vector-tuning";
import { assertSafeVectorLiteral } from "@/lib/db/pgvector";

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
//
// 2026-05-24 · Wave X.f · added `meeting_transcript` · the
// ingest-fireflies cron has been writing Fireflies meeting
// transcripts twice daily since v10.0.x · they have full embeddings
// from embed-backfill but recall never pulled the category. Result:
// the paid Fireflies pipeline was running for nothing. With this
// addition chat can now surface "you said X in last Tuesday's
// meeting with Y" the way the cron docstring originally intended.
//
// 2026-05-29 · added `board_consultation` · the multi-advisor board
// persists each run via brainMemory.remember() (embedded inline →
// recallable once the write-time embedding_vec_1536 fix shipped), but
// recall never pulled the category, so past board advice never resurfaced
// in chat. With this, chat can surface "the board advised X on a similar
// call before". NOTE: `reasoning_trace` is deliberately NOT added — those
// rows are written via a raw prisma.create (no inline embedding), so the
// whitelist alone would be a no-op; revisit only with an embedding step.
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
  "meeting_transcript",
  "board_consultation",
  // 2026-05-29 · two more dead recall lanes (same class as the three
  // above): categories that are written + embedded but were never in
  // this whitelist, so their own docstrings' recall intent went unmet.
  // · weekly_review — operator's weekly commitments; categories.ts says
  //   "Read by Monday-morning recall so Nick remembers what the operator
  //   committed to" — that intent was unrealized until now.
  // · mission_retro — per-mission retrospective the operator writes on
  //   completion; feeds "what compounds across missions". Low volume,
  //   high signal. Both are operator-authored so noise risk is ~zero.
  "weekly_review",
  "mission_retro",
  // 2026-05-29 · two more verified dead lanes (embedded, high-signal):
  // · relationships_weekly_synthesis — Sunday 3-paragraph synthesis of
  //   the week's relationship movement; 1/week, AI-synthesized, already
  //   lands in /journal. Low volume.
  // · gmail_outgoing — the operator's OWN sent mail (decisions, tone,
  //   commitments). categories.ts: "Read by Nick to ground 'did I commit
  //   to X' recall" — that intent was unmet without the whitelist entry.
  //   (gmail_thread / inbound deliberately excluded: higher volume, more
  //   noise — add later only if recall stays clean.)
  "relationships_weekly_synthesis",
  "gmail_outgoing",
]);

export interface RecallHit {
  memoryId: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  /**
   * Days since last_seen — which the recall path itself BUMPS on every hit,
   * so this measures recency-of-recall, not age of the underlying fact. A
   * memory recalled daily reads 0 here forever. Kept for scoring; never
   * present it as the fact's age.
   */
  ageDays: number;
  /**
   * Days since created_at — the fact's true age, immune to the lastSeen
   * bump. This is what the prompt's epistemic stamp renders (2026-08-05):
   * before it existed, a year-old fact recalled daily presented as "today".
   */
  factAgeDays: number;
  knnDistance: number;
  finalScore: number;
}

export interface RecallReport {
  query: string;
  durationMs: number;
  scanned: number;
  hits: RecallHit[];
  // 2026-05-23 · Wave C · Q1 · mean knnDistance across returned hits.
  // The whole 3-lane RRF + Cohere rerank pipeline existed but quality
  // was unmeasured — `hitCount` was logged, the actual distance signal
  // was computed (per-hit) and discarded. -1 when no hits.
  avgKnnDistance: number;
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
    return { query, durationMs: 0, scanned: 0, hits: [], avgKnnDistance: -1 };
  }

  // 1. Get embedding for the query
  let queryEmb = opts.embedding;
  if (!queryEmb || queryEmb.length === 0) {
    queryEmb = await getEmbedding(query).catch(() => [] as number[]);
  }
  if (!queryEmb || queryEmb.length === 0) {
    log.warn("recall_no_embedding", { queryLen: query.length });
    return { query, durationMs: Date.now() - t0, scanned: 0, hits: [], avgKnnDistance: -1 };
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
      return { query, durationMs: Date.now() - t0, scanned: 0, hits: [], avgKnnDistance: -1 };
    }
  }
  const vecLit = `[${padded.join(",")}]`;
  // 2026-07-11 review · run the SAME defense-in-depth shape validator the
  // rest of the codebase uses (lib/db/pgvector.ts) so there's one guard
  // convention, not two hand-rolled ones. Note vecLit is a BOUND $1
  // parameter below (not string-interpolated), so this is belt+suspenders.
  assertSafeVectorLiteral(vecLit);

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
        created_at: Date;
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
         bm.created_at,
         (ve.embedding_vec_1536 <=> $1::vector(${TARGET_DIM})) AS distance
       FROM vector_embeddings ve
       JOIN brain_memories bm
         ON bm.id = ve."sourceId"
        AND bm.deleted_at IS NULL
       WHERE ve."sourceType" = 'brain_memory'
         AND ve.embedding_vec_1536 IS NOT NULL
         AND bm.confidence >= 0.3
         -- BDN-310 supersession honored (2026-08-19): a superseded or
         -- expired-validity belief must not be recalled as current.
         -- The columns were applied to prod 2026-08-14 with no reader.
         AND bm.superseded_by_id IS NULL
         AND (bm.valid_until IS NULL OR bm.valid_until > NOW())
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
      created_at: Date;
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
      const factAgeDays = Math.floor(
        (now - new Date(r.created_at).getTime()) / 86_400_000,
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
        factAgeDays,
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

  // 2026-05-23 · Wave C · Q1 · compute + persist avg KNN distance.
  // Lower = more semantically similar to the query. Surfaces in
  // SystemMetric as metric="brain.recall.avg_distance" so the
  // /system observability dashboard can plot recall quality over
  // time. Pre-fix this signal was computed per-hit then discarded.
  // Fire-and-forget · best-effort · doesn't block the chat path.
  const avgKnnDistance =
    scored.length === 0
      ? -1
      : Number(
          (
            scored.reduce((s, h) => s + h.knnDistance, 0) / scored.length
          ).toFixed(4),
        );

  if (scored.length > 0) {
    void prisma.systemMetric
      .create({
        data: {
          metric: "brain.recall.avg_distance",
          value: avgKnnDistance,
          unit: "cosine-distance",
          source: "memory-recall",
          tags: {
            hitCount: scored.length,
            scanned: rows.length,
            queryLen: query.length,
          },
        },
      })
      .catch((err) => {
        recordError("brain:memory-recall", err, {
          phase: "metric-write",
          count: scored.length,
        });
      });
  }

  return {
    query,
    durationMs: Date.now() - t0,
    scanned: rows.length,
    hits: scored,
    avgKnnDistance,
  };
}

/**
 * A fact older than this renders with a VERIFY-FIRST stale marker. Wisdom-tier
 * categories are durable by design (the consolidate cron actively curates
 * them), so they get a year before the marker — a stamp that fires on all
 * wisdom is a stamp the model learns to ignore.
 */
const STALE_AFTER_DAYS = 120;
const WISDOM_STALE_AFTER_DAYS = 365;

/** The epistemic envelope for one recalled memory (2026-08-05). */
export function renderFactStatus(hit: RecallHit): string {
  const recorded = hit.factAgeDays === 0 ? "recorded today" : `recorded ${hit.factAgeDays}d ago`;
  const staleAfter = hit.category.includes("wisdom") ? WISDOM_STALE_AFTER_DAYS : STALE_AFTER_DAYS;
  const stale = hit.factAgeDays > staleAfter ? " · STALE — verify before relying on this" : "";
  return `${recorded}${stale}, conf=${hit.confidence.toFixed(2)}`;
}

/**
 * Format the recall hits as a compact system-prompt block.
 * Designed to be appended to the chat system prompt under a
 * "Recently relevant memories" header.
 *
 * EPISTEMIC STAMP (2026-08-05): the age shown is the fact's TRUE age
 * (created_at), never last_seen — the recall path bumps last_seen on every
 * hit, so the previous stamp showed a perpetually-fresh "today" on any
 * memory recalled daily, exactly the stale-masquerading-as-current failure
 * the whole memory index documents. Kill-switch:
 * RECALL_FACT_AGE_DISABLED=1 restores the legacy last_seen rendering.
 */
export function formatRecallForPrompt(hits: RecallHit[]): string {
  if (hits.length === 0) return "";
  let disabled = false;
  try {
    disabled = getFlag("RECALL_FACT_AGE_DISABLED")?.isOn ?? false;
  } catch {
    disabled = false; // flag infra failure → new (truthful) rendering
  }
  const lines = hits.map((h, i) => {
    if (disabled) {
      const ageStr = h.ageDays === 0 ? "today" : `${h.ageDays}d ago`;
      return `[${i + 1}] [${h.category}] ${h.content} (${ageStr}, conf=${h.confidence.toFixed(2)})`;
    }
    return `[${i + 1}] [${h.category}] ${h.content} (${renderFactStatus(h)})`;
  });
  return `Recently relevant memories (top-${hits.length} via hybrid search):\n${lines.join("\n")}`;
}
