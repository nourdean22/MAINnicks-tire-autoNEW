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
import { fenceContent } from "@/lib/ai/tool-result-fencing";
import { getEmbedding } from "@/lib/ai/provider";
import { getFlag } from "@/lib/feature-flags";
import { logger as rootLogger } from "@/lib/logger";
import { recordError } from "@/lib/errors/record-error";
import { withEfSearch, EF_SEARCH } from "@/lib/db/vector-tuning";
import { assertSafeVectorLiteral } from "@/lib/db/pgvector";
import { reciprocalRankFusion } from "@/lib/brain/rrf";
// 2026-09-10 · lib/brain/memory-trust.ts was written and unit-tested and
// had ZERO production importers -- the schema even carries a trust_tier
// column with an index and no reader or writer. This is that module's
// first consumer. OWASP AISVS C08 8.2.3 is the control it implements:
// tool and agent output must not be treated as trusted memory.
import { classifyTrustTier, isAuthoritative, fenceUntrustedMemory, type TrustTier } from "@/lib/brain/memory-trust";

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
// whitelist alone would be a no-op. 2026-08-19 · outcome-loop wave: the
// embedding step that note asked for now exists as a COMPANION category —
// `reasoning_conclusion` (persist-conclusion.ts writes one distilled,
// embedded row per run) is whitelisted below; the raw trace stays out.
// 2026-08-27 · retrieval baseline (docs/RETRIEVAL-BASELINE-2026-08-27.md F1):
// this whitelist contained NO durable personal category, so the lane KNN'd
// the full corpus correctly and then deleted the answers — hit@5 = 0/28 on
// the labelled corpus while dense rank was #1 on several cases (a medication
// query; pm_event_shop_assault_2026-08-15). These are the categories the
// operator's real queries target (and the same durable set the consolidation
// guards protect in categories.ts). Exported for the canary test.
export const DURABLE_PERSONAL_CATEGORIES = [
  "identity",
  "biography",
  "relationships",
  "health",
  "event",
  "business_fact",
  "environment",
  "ai_directive",
  "vision",
  "fact",
  "personal",
  "preference",
  "goal",
  "routine",
] as const;

export const CONTEXT_CATEGORIES = new Set<string>([
  ...DURABLE_PERSONAL_CATEGORIES,
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
  // 2026-08-19 · the conversation digest now fans decisions out as
  // decision_log rows (conversation-memory.ts). decision_pattern was
  // already recallable while the underlying decisions were not — the
  // pattern could recall, the evidence couldn't.
  "decision_log",
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
  // 2026-08-19 · outcome-loop wave · two lanes that close "what did I
  // learn" loops, both written WITH inline embeddings:
  // · task_lesson — the operator's typed completion lesson (was a
  //   write-only column; operator-authored, low volume, high signal).
  // · reasoning_conclusion — the distilled companion to reasoning_trace,
  //   so Nick can recall what he previously concluded instead of
  //   re-reasoning from scratch ("Nick reasons hard, then forgets" was
  //   the audited defect).
  "task_lesson",
  "reasoning_conclusion",
  // 2026-08-28 · learning-loops census, gap-2 cleanup · one more dead lane:
  // · hidden_correlation — correlation-finder's surprising-finding rows
  //   (stable `corr_a_b` keys, embedded — the policy denylist never named
  //   the category). Their only prompt path was getCorrelationContext(),
  //   a v1 system-prompt feeder orphaned by the 2026-07-11 v2 cutover and
  //   deleted in this wave; this entry is its replacement — relevance-
  //   gated recall instead of 3 rows every turn. counter_intuitive and
  //   blind_spot were already whitelisted, so their deleted feeders
  //   needed no counterpart here.
  "hidden_correlation",
  // 2026-08-28 · v1 feeder-family purge (the remaining 14 orphaned
  // get*Context feeders, same census): time_pattern was the one category
  // left with NO reader at all once its feeder died — the cron writer
  // (analyzeTimePatterns, cron/intelligence) upserts a handful of stable
  // `time_*` keyed rows (peak productivity, revenue timing) that are
  // embedded by default. Same rewire shape as hidden_correlation above.
  // The other 13 feeders needed no counterpart: their categories were
  // already whitelisted, or reach Nick via a named tool
  // (getEmotionalState, getBrainHealth, runSimulation), the Discover
  // feed (teaching_moment), or the daily brief (attention).
  "time_pattern",
]);

export interface RecallHit {
  memoryId: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  /** The REAL sighting counter (brain_memories.seen_count). confidence
   *  cannot stand in for it: writers stamp confidence directly (0.9s and
   *  1.0s on first sight — 73% of recent seen_count=1 rows violate the
   *  0.5+0.1(n−1) formula, measured on prod 2026-08-19). */
  seenCount: number;
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
  /**
   * 2026-09-10 · derived, not stored. `classifyTrustTier` is a pure
   * function of (source, created_by), both of which are already
   * populated on every row -- so the tier is exact at read time and
   * needs no backfill of the 158 write sites. The `trust_tier` column
   * remains a denormalized cache for SQL-side filtering, and is
   * deliberately NOT read here: a stale cache would be worse than the
   * function.
   */
  trustTier: TrustTier;
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
  /**
   * 2026-09-10 · EMPTY vs ERROR vs UNMEASURED.
   *
   * `hits: []` used to mean four different things -- genuine no-match,
   * a failed query embedding, an invalid embedding, and an empty query
   * -- and every one of them rendered in the Memory Inspector as the
   * same "(0) No semantic memory hits retrieved". The 2026-09-10 audit
   * caught exactly that: a turn synthesising weeks of context showed
   * (0), which read as "Nick believes nothing about you" when it
   * almost certainly meant "the embedding call fell over".
   *
   * This lane has NO min-score and its durable sub-lane returns up to
   * 10 rows unconditionally, so a true zero against a populated corpus
   * is nearly impossible. A `(0)` here is therefore far more likely to
   * be a failure than a miss -- which is precisely why the two must
   * never render the same.
   *
   * Vocabulary matches the existing panel contract in
   * components/brain/contradiction-resolution-panel.tsx.
   */
  provenance: RecallProvenance;
  /** Human-readable cause when provenance is ERROR or UNMEASURED. */
  provenanceReason?: string;
}

/**
 * OK        - the search ran and returned rows.
 * ZERO      - the search ran and genuinely matched nothing.
 * ERROR     - the read failed. State unknown, NOT empty.
 * UNMEASURED- the read never ran (guard/precondition not met).
 */
export type RecallProvenance = "OK" | "ZERO" | "ERROR" | "UNMEASURED";

/**
 * 2026-08-27 · durable-lane fusion (levers run, eval-datasets/levers*-2026-08-27).
 *
 * MEASURED DEFECT: on first-person paraphrase queries ("how old am i", "what
 * is going on with my sister visiting") the full-corpus KNN top-30 is
 * dominated by mood/journal/semantic_edge noise — the durable personal row
 * exists, is embedded, and never enters the pool. Identity-slice hit@5 was
 * 0/4 on EVERY lane.
 *
 * MEASURED FIX: a second KNN restricted to the durable personal categories
 * (~122 rows — tiny competition, so weak similarity still ranks the right
 * row) fused with the main lane via RRF at k=60, equal weights. On the
 * 28-case labelled corpus: hit@5 50% → 86%, hit@10 50% → 96%, identity 0/4 →
 * 4/4, no slice worse. ef_search 200 / iterative_scan were measured as
 * alternatives and added NOTHING to the endpoint metric (96.4% hit@10
 * either way) — this lane, not more HNSW effort, is what closes the gap.
 */
const DURABLE_KNN_LIMIT = 10;
/** main + durable + lexical. Used to tell "all lanes failed" from "some did". */
const LANE_COUNT = 3;

/**
 * RRF-merge the two lane orderings (k=60, equal weights — exactly the
 * measured configuration). A row present in both lanes gets the natural RRF
 * boost; an empty durable lane returns the main ordering untouched.
 * Exported for the canary test.
 */
export function rrfMergeHitOrders(
  main: RecallHit[],
  durable: RecallHit[],
  /**
   * 2026-09-10 · the LEXICAL ordering (tsvector/BM25-ish). Optional so
   * every existing caller and the canary test keep their exact
   * two-lane behaviour.
   */
  lexical: RecallHit[] = [],
): RecallHit[] {
  if (durable.length === 0 && lexical.length === 0) return main;
  const lanes = [
    main.map((h) => ({ id: h.memoryId, item: h })),
    durable.map((h) => ({ id: h.memoryId, item: h })),
  ];
  if (lexical.length > 0) lanes.push(lexical.map((h) => ({ id: h.memoryId, item: h })));
  const fused = reciprocalRankFusion(lanes, { k: 60 });
  return fused.map((f) => f.item);
}

/** One row from any retrieval lane. Module-level since 2026-09-10 so the
 *  lexical lane can share the shape (and therefore the shared scorer). */
type KnnRow = {
  memory_id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  seen_count: number;
  last_seen: Date;
  created_at: Date;
  distance: number;
  /** 2026-09-10 · provenance columns, for trust-tier classification. */
  source: string | null;
  created_by: string | null;
};

/** Shared lane scorer. Module-level since 2026-09-10 so the lexical
 *  fallback can score rows without duplicating the formula. */
function scoreRow(r: KnnRow, now: number): RecallHit {
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
      seenCount: r.seen_count,
      ageDays,
      factAgeDays,
      knnDistance: r.distance,
      finalScore: Math.round(finalScore * 1000) / 1000,
      trustTier: classifyTrustTier(r.source, r.created_by, r.category),
    };
  }

/**
 * 2026-09-10 · THE LEXICAL LANE.
 *
 * This module's own header has claimed "Hybrid search (FTS + KNN)" since
 * it was written. It was not true: both SQL statements below were
 * `ORDER BY embedding <=> $1::vector`, pure dense cosine. The FTS half
 * existed only in lib/brain/contextual-recall.ts:487-495, feeding a
 * DIFFERENT prompt block that the Memory Inspector does not count.
 *
 * Two things this fixes that dense retrieval structurally cannot:
 *
 *  1. PARAPHRASE + EXACT TERMS. "the taper plan" may sit far from the
 *     original brain-dump wording in embedding space while sharing the
 *     literal token. Lexical retrieval does not care how the sentence
 *     was phrased around it.
 *  2. EMBEDDING OUTAGES. This lane needs no query vector. When
 *     embedUserMessage() fail-softs to [] (12s timeout), dense recall
 *     returned NOTHING and the panel rendered "(0)". Now the turn
 *     degrades to lexical instead of going blind -- which is the
 *     difference between a slow provider and an amnesiac assistant.
 *
 * Deliberately NOT category-filtered: the main dense lane post-filters
 * its top-30 against CONTEXT_CATEGORIES, and this file's own comment
 * measures that filter at hit@5 = 0/28 on the labelled corpus.
 * Reproducing it here would import the same defect.
 */
function lexicalLane(query: string, limit: number, onFail?: () => void): Promise<KnnRow[]> {
  return prisma
    .$queryRawUnsafe<KnnRow[]>(
      `SELECT bm.id::text AS memory_id, bm.category::text AS category,
              bm.key::text AS key,
              substring(bm.content, 1, ${MAX_CONTENT_LEN})::text AS content,
              bm.confidence::float AS confidence, bm.seen_count::int AS seen_count,
              bm.last_seen, bm.created_at,
              bm.source::text AS source, bm.created_by::text AS created_by,
              -- Presented as a DISTANCE so the shared scorer needs no
              -- special case: higher ts_rank -> smaller distance.
              (1.0 - LEAST(ts_rank(to_tsvector('english', bm.content),
                                   websearch_to_tsquery('english', $1)), 1.0))::float AS distance
       FROM brain_memories bm
       WHERE bm.deleted_at IS NULL
         AND bm.confidence >= 0.3
         AND bm.superseded_by_id IS NULL
         AND (bm.valid_until IS NULL OR bm.valid_until > NOW())
         AND to_tsvector('english', bm.content) @@ websearch_to_tsquery('english', $1)
       ORDER BY ts_rank(to_tsvector('english', bm.content),
                        websearch_to_tsquery('english', $1)) DESC
       LIMIT ${limit}`,
      query,
    )
    .catch((err) => {
      log.warn("lexical_lane_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      onFail?.();
      return [] as KnnRow[];
    });
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

  // 2026-09-10 (review #2267 P2) · PER-LANE FAILURE LEDGER.
  //
  // Each lane below catches its own error and returns []. That is right
  // for resilience -- one dead lane must not take the turn down -- but
  // it recreates, one level lower, the exact defect this file's
  // provenance work exists to remove: if every lane throws, `scored` is
  // empty and the result would report a measured ZERO. During a Postgres
  // or pgvector outage the panel would then say "searched memory,
  // nothing matched" when in truth nothing was searched at all.
  //
  // The catches record WHICH lane failed; the provenance mapper at the
  // bottom reads this ledger instead of inferring from `scored.length`.
  const laneFailures: string[] = [];

  if (!query?.trim()) {
    return {
      query,
      durationMs: 0,
      scanned: 0,
      hits: [],
      avgKnnDistance: -1,
      provenance: "UNMEASURED",
      provenanceReason: "empty query -- recall never ran",
    };
  }

  // 1. Get embedding for the query
  let queryEmb = opts.embedding;
  if (!queryEmb || queryEmb.length === 0) {
    queryEmb = await getEmbedding(query).catch(() => [] as number[]);
  }
  if (!queryEmb || queryEmb.length === 0) {
    // 2026-09-10 · DEGRADE, do not go blind.
    //
    // embedUserMessage() fail-softs to [] on a 12s timeout, and this
    // lane is the only one the "REMEMBERED -- WHAT NICK BELIEVES (N)"
    // counter reads. Before this branch existed, one slow embedding call
    // rendered as "Nick believes nothing about you" -- the exact reading
    // the 2026-09-10 audit made. The lexical lane needs no query vector,
    // so a dense-side outage costs ranking quality, not memory itself.
    log.warn("recall_no_embedding", { queryLen: query.length });
    const lexicalOnly = await lexicalLane(query, limit);
    const now = Date.now();
    const hits = lexicalOnly.map((r) => scoreRow(r, now)).slice(0, limit);
    return {
      query,
      durationMs: Date.now() - t0,
      scanned: lexicalOnly.length,
      hits,
      avgKnnDistance: -1,
      // Still ERROR: the dense lanes genuinely did not run, and callers
      // must not read this as a clean result. But the hits are real.
      provenance: "ERROR",
      provenanceReason:
        hits.length > 0
          ? `query embedding unavailable -- degraded to lexical retrieval (${hits.length} hit${hits.length === 1 ? "" : "s"}); ranking is weaker than usual`
          : "query embedding unavailable and lexical retrieval matched nothing -- recall state unknown",
    };
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
      return {
        query,
        durationMs: Date.now() - t0,
        scanned: 0,
        hits: [],
        avgKnnDistance: -1,
        provenance: "ERROR",
        provenanceReason: "query embedding contained a non-finite value",
      };
    }
  }
  const vecLit = `[${padded.join(",")}]`;
  // 2026-07-11 review · run the SAME defense-in-depth shape validator the
  // rest of the codebase uses (lib/db/pgvector.ts) so there's one guard
  // convention, not two hand-rolled ones. Note vecLit is a BOUND $1
  // parameter below (not string-interpolated), so this is belt+suspenders.
  assertSafeVectorLiteral(vecLit);

  // 2. Two KNN lanes in parallel (2026-08-27 durable-lane fusion — see the
  //    header note on rrfMergeHitOrders for the measured numbers):
  //    · main — full-corpus HNSW KNN, withEfSearch(HIGH_RECALL=80) as before
  //    · durable — EXACT scan over the durable personal partition (~122
  //      rows) via a MATERIALIZED CTE. Deliberately not HNSW: a 0.4%-
  //      selective category filter after an ANN index is the starvation
  //      shape this file's own baseline documented; materializing the tiny
  //      partition first makes the plan deterministic and the recall exact.
  const durablePromise: Promise<KnnRow[]> = prisma
    .$queryRawUnsafe<KnnRow[]>(
      `WITH durable AS MATERIALIZED (
         SELECT bm.id, bm.category, bm.key, bm.content, bm.confidence,
                bm.seen_count, bm.last_seen, bm.created_at,
                bm.source, bm.created_by, ve.embedding_vec_1536
         FROM vector_embeddings ve
         JOIN brain_memories bm
           ON bm.id = ve."sourceId"
          AND bm.deleted_at IS NULL
         WHERE ve."sourceType" = 'brain_memory'
           AND ve.embedding_vec_1536 IS NOT NULL
           AND bm.confidence >= 0.3
           AND bm.superseded_by_id IS NULL
           AND (bm.valid_until IS NULL OR bm.valid_until > NOW())
           AND bm.category = ANY($2)
       )
       SELECT id::text AS memory_id, category::text AS category, key::text AS key,
              substring(content, 1, ${MAX_CONTENT_LEN})::text AS content,
              confidence::float AS confidence, seen_count::int AS seen_count,
              last_seen, created_at,
              source::text AS source, created_by::text AS created_by,
              (embedding_vec_1536 <=> $1::vector(${TARGET_DIM})) AS distance
       FROM durable
       ORDER BY embedding_vec_1536 <=> $1::vector(${TARGET_DIM})
       LIMIT ${DURABLE_KNN_LIMIT}`,
      vecLit,
      [...DURABLE_PERSONAL_CATEGORIES],
    )
    .catch((err) => {
      log.warn("durable_knn_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      laneFailures.push("durable");
      return [] as KnnRow[];
    });

  const mainPromise = withEfSearch(prisma, EF_SEARCH.HIGH_RECALL, (tx) =>
    tx.$queryRawUnsafe<KnnRow[]>(
      `SELECT
         bm.id::text AS memory_id,
         bm.category::text AS category,
         bm.key::text AS key,
         substring(bm.content, 1, ${MAX_CONTENT_LEN})::text AS content,
         bm.confidence::float AS confidence,
         bm.seen_count::int AS seen_count,
         bm.last_seen,
         bm.created_at,
         bm.source::text AS source,
         bm.created_by::text AS created_by,
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
    laneFailures.push("main");
    return [] as KnnRow[];
  });

  // the lexical lane runs alongside the two dense lanes.
  // KNN_TOP is reused as its ceiling so one lane cannot swamp the fusion.
  const lexicalPromise = lexicalLane(query, KNN_TOP, () => laneFailures.push("lexical"));
  const [rows, durableRows, lexicalRows] = await Promise.all([
    mainPromise,
    durablePromise,
    lexicalPromise,
  ]);

  // 3. Score both lanes with the SAME formula, then RRF-merge the orderings.
  //    Main lane keeps its boosted-score ordering; the durable lane is
  //    ordered by raw distance (the measured configuration).
  const now = Date.now();
  const toHit = (r: KnnRow): RecallHit => scoreRow(r, now);
  const mainScored: RecallHit[] = rows
    .filter((r) => CONTEXT_CATEGORIES.has(r.category))
    .map(toHit)
    .sort((a, b) => b.finalScore - a.finalScore);
  const durableScored: RecallHit[] = durableRows
    .map(toHit)
    .sort((a, b) => a.knnDistance - b.knnDistance);
  // Lexical rows are ordered by ts_rank, which the scorer sees as
  // ascending distance -- same convention as the durable lane.
  const lexicalScored: RecallHit[] = lexicalRows
    .map(toHit)
    .sort((a, b) => a.knnDistance - b.knnDistance);
  const scored: RecallHit[] = rrfMergeHitOrders(
    mainScored,
    durableScored,
    lexicalScored,
  ).slice(0, limit);
  const mainIds = new Set(rows.map((r) => r.memory_id));
  const scannedCount =
    rows.length + durableRows.filter((d) => !mainIds.has(d.memory_id)).length;

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
            scanned: scannedCount,
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
    scanned: scannedCount,
    hits: scored,
    avgKnnDistance,
    // Read the LEDGER, not `scored.length`. An empty result means
    // "nothing matched" only when the searches actually ran.
    provenance:
      scored.length > 0
        ? "OK"
        : laneFailures.length === LANE_COUNT
          ? "ERROR"
          : "ZERO",
    provenanceReason:
      laneFailures.length === 0
        ? undefined
        : laneFailures.length === LANE_COUNT
          ? `every retrieval lane failed (${laneFailures.join(", ")}) -- recall state unknown, not empty`
          : `${laneFailures.join(", ")} lane(s) failed; results are from the surviving lane(s) and ranking is weaker than usual`,
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
/**
 * 2026-09-10 · what the Memory Inspector should SAY about a recall.
 *
 * The audit's finding was a rendering failure, not only a retrieval one:
 * "REMEMBERED -- WHAT NICK BELIEVES (0)" is what the operator saw when
 * the embedding call had fallen over, and it reads as "Nick has no
 * memory of you" rather than "the memory read failed". Those are
 * opposite claims and they were rendering identically.
 *
 * Pure, so the panel and any server-side summary cannot drift.
 * `unlock` names what would move the number -- an empty state that does
 * not say how to leave it is a dead end.
 */
export interface RecallStateView {
  provenance: RecallProvenance;
  /** One line, operator-facing. Never says "0" unless a search truly ran. */
  headline: string;
  /** What would change this reading. Null when nothing is wrong. */
  unlock: string | null;
  /** True when the count is a fact about memory; false when it is a fact about the instrument. */
  countIsMeaningful: boolean;
}

export function describeRecallState(
  hitCount: number,
  provenance: RecallProvenance,
  reason?: string,
): RecallStateView {
  switch (provenance) {
    case "OK":
      return {
        provenance,
        headline: `${hitCount} memor${hitCount === 1 ? "y" : "ies"} retrieved`,
        unlock: null,
        countIsMeaningful: true,
      };
    case "ZERO":
      // A real zero, and it needs its denominator: this lane has no
      // min-score and its durable sub-lane returns rows unconditionally,
      // so a genuine zero means the corpus had nothing in range at all.
      return {
        provenance,
        headline: "Searched memory -- nothing matched this turn",
        unlock: "Recall ran against every eligible memory and found no match above the category filter.",
        countIsMeaningful: true,
      };
    case "ERROR":
      return {
        provenance,
        headline: "Memory read failed -- state unknown, not empty",
        unlock: reason ?? "The recall lane errored or timed out. Nick may well remember this; the lookup did not complete.",
        countIsMeaningful: false,
      };
    case "UNMEASURED":
      return {
        provenance,
        headline: "Memory not queried this turn",
        unlock: reason ?? "Recall was not attempted for this turn.",
        countIsMeaningful: false,
      };
  }
}

export function formatRecallForPrompt(hits: RecallHit[]): string {
  if (hits.length === 0) return "";
  // S-1 completion (2026-09-02 self-review) · this block renders BrainMemory
  // content of ANY category — including gmail_thread rows ingested from
  // external mail — and reached the system prompt bare while the recall
  // block from contextual-recall was fenced. Every memory-rendering block
  // is fenced at source now; tests/ai/prompt-block-fencing-gate.test.ts
  // enumerates the producers so a new one cannot ship unfenced.
  let disabled = false;
  try {
    disabled = getFlag("RECALL_FACT_AGE_DISABLED")?.isOn ?? false;
  } catch {
    disabled = false; // flag infra failure → new (truthful) rendering
  }
  // 2026-09-10 · TRUST TIER at the retrieval boundary.
  //
  // OWASP AISVS C08 8.2.3: "agent outputs and tool outputs are not
  // automatically written to trusted agent memory without explicit
  // source validation." NICK's memory ingests scraped pages, mail
  // threads and model inferences alongside things Nour actually said,
  // and until now they all rendered into the prompt as one
  // undifferentiated list of things "Nick believes".
  //
  // That is the memory-poisoning surface OWASP ASI06 names, and the
  // published attacks (SpAIware; the Gemini conditional-instruction
  // bypass) work precisely because retrieved external text is read back
  // as the agent's own knowledge. Fencing it does not stop a poisoned
  // row being stored -- it stops the stored row being obeyed.
  //
  // EXTERNAL_CONTENT is wrapped and labelled; everything else renders as
  // before. AGENT_INFERRED is labelled but not fenced: a model's own
  // guess is not attacker-controlled, it just is not a fact.
  const lines = hits.map((h, i) => {
    // A hit built by something that predates trust tiering has no tier.
    // Do NOT default that to untrusted: a missing field would then fence
    // EVERY memory, which is fail-closed in the letter and product-
    // destroying in practice (caught by renderer-fencing.test.ts, whose
    // own fixture pairs a gmail_thread injection row with an ordinary
    // preferences row). Re-derive from the category instead, which is
    // the field that actually carries provenance for ingested content.
    const tier: TrustTier = h.trustTier ?? classifyTrustTier("unclassified", null, h.category);
    const body = disabled
      ? `${h.content} (${h.ageDays === 0 ? "today" : `${h.ageDays}d ago`}, conf=${h.confidence.toFixed(2)})`
      : `${h.content} (${renderFactStatus(h)})`;
    if (!isAuthoritative(tier)) {
      return `[${i + 1}] [${h.category}] ${fenceUntrustedMemory(body, tier)}`;
    }
    const tierMark = tier === "AGENT_INFERRED" ? " [inferred, unverified]" : "";
    return `[${i + 1}] [${h.category}]${tierMark} ${body}`;
  });
  return `Recently relevant memories (top-${hits.length} via hybrid search):\n${fenceContent("hybridRecall", "memory_recall", lines.join("\n"), { maxChars: 20_000 })}`;
}
