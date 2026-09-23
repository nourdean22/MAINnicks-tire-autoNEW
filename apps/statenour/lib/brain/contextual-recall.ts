/**
 * Contextual Memory Recall — Semantic + keyword hybrid.
 *
 * v2: Uses vector embeddings for semantic similarity (finds memories
 * even when none of the same words match) with recency and category boosts.
 * Falls back to keyword matching when embeddings aren't available.
 *
 * Scoring formula:
 *   0.70 × semantic similarity (cosine)
 * + 0.15 × recency score (exponential decay)
 * + 0.15 × category importance
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";
// v10.0.64 · AgentTrace coverage. getEmbedding kept direct (its own
// cost-tracking via VectorEmbedding writes).
import { getEmbedding } from "@/lib/ai/provider";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("contextual-recall", "chat");
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { cosineSimilarity, semanticSearch } from "@/lib/brain/embedding-utils";
import { fuseRankings } from "@/lib/brain/rrf";
// 2026-08-27 · F3 KNN candidate lane — reuse the one guard/pad convention
// (lib/db/pgvector.ts), same as memory-recall.ts.
import {
  padToVectorDim,
  vectorLiteral,
  assertSafeVectorLiteral,
  VECTOR_DIM_1536,
} from "@/lib/db/pgvector";
// Wave AG · rerank orchestrator routes between BGE (HF Inference,
// $0.0001/call) and Cohere ($2/1000 calls) based on the BGE_RERANK
// env flag. Same interface as cohereRerank · falls back to identity
// ordering when neither backend is available. See lib/brain/rerank.ts
// + docs/runbooks/bge-rerank-cutover.md.
import { rerank, isRerankAvailable } from "@/lib/brain/rerank";
import { classifyQuery, coalaKindOf, coalaKindBoost } from "@/lib/brain/coala";
import { classifyQueryTopics, tagWisdomTopics, topicBoost } from "@/lib/brain/wisdom-topic-tagger";
import { getFlag } from "@/lib/feature-flags";
import { scoreMessage } from "@/lib/brain/importance-scorer";
// 2026-08-16 · ONE evidence vocabulary. The write gate already grades every
// source; recall now shows that grade instead of a confidence percentage the
// model was reading as certainty. Value-import is safe here (recall is
// server-only and already pulls prisma) — unlike lib/ai/vnext/truth/claims.ts,
// which must stay client-reachable and so type-imports it instead.
import {
  evidenceClassForSource,
  type MemoryEvidenceClass,
  isOperatorSource,
} from "@/lib/brain/memory-commit-gateway";

/**
 * v-truth · Importance-weighted recall (Generative-Agents R+R+I).
 * Recall already scores Relevance (semantic) + Recency; this is the
 * missing third axis — how much a memory MATTERS, not how SURE we are
 * (confidence). Computed at recall time from content via the pure
 * scoreMessage heuristic (no schema/migration), mapped to a GENTLE
 * 0.92..1.25 multiplier so it nudges, never dominates.
 *
 * GATED off by default (NICK_IMPORTANCE_RECALL): when off this returns
 * exactly 1.0 so the existing SOTA ranking is byte-for-byte unchanged.
 */
function importanceMultiplier(content: string, enabled: boolean): number {
  if (!enabled) return 1.0;
  const s = scoreMessage(content).score; // 0..10, pure/no-IO
  return 0.92 + 0.033 * s; // 0.92 (s=0) .. 1.25 (s=10)
}

/**
 * NOVELTY AXIS (2026-08-16) — the answer to "why does it only tell me things
 * I already know?"
 *
 * BrainMemory `confidence` is not a certainty. It starts at 0.5 and rises
 * +0.1 per re-sighting (memory-manager.ts reinforce), so it is a FREQUENCY
 * COUNT. Recall ranks by it. Surprise is, by definition, low-frequency —
 * which means a one-off surprising correlation sits at 0.5 forever and loses
 * every ranking contest to a banality that got re-observed nightly until it
 * hit 1.0. Every other signal in this pipeline (semantic similarity, lexical
 * overlap, category weight, topic match, CoALA kind) also rewards FIT. A
 * ranking function whose every term rewards fit converges on reciting the
 * operator's own priors back at him.
 *
 * This is the one term that rewards DIFFERENCE: how far a memory sits from
 * the ones already selected. Not from the query — from the answer set. A
 * memory that says something the top picks do not already say gets a nudge.
 *
 * Deliberately gentle (0.95..1.18) and gated OFF by default, mirroring
 * importanceMultiplier: it must never dominate relevance, and a novelty term
 * that over-surfaces genuine noise is worse than none. Promote it only on an
 * eval win (pnpm eval:recall).
 *
 * Cost: zero extra queries — `selectedVectors` are the embeddings
 * getSemanticScores already parsed. O(k) per memory against a capped
 * selection set, NOT O(N²) over the 300-row candidate pool.
 */
export function noveltyMultiplier(
  vec: number[] | undefined,
  selectedVectors: number[][],
  enabled: boolean,
): number {
  if (!enabled) return 1.0;
  if (!vec || vec.length === 0 || selectedVectors.length === 0) return 1.0;
  let maxSim = 0;
  for (const other of selectedVectors) {
    if (other.length !== vec.length) continue;
    const sim = cosineSimilarity(vec, other);
    if (sim > maxSim) maxSim = sim;
  }
  // maxSim 1.0 (says exactly what we already picked) → 0.95
  // maxSim 0.0 (orthogonal to everything picked)     → 1.18
  const novelty = 1 - Math.max(0, Math.min(1, maxSim));
  return 0.95 + 0.23 * novelty;
}

/** How many already-selected memories a candidate is compared against. */
const NOVELTY_COMPARISON_SET = 5;

/**
 * Short, honest evidence labels for the prompt. Reuses the memory commit
 * gateway's ladder rather than inventing a fourth taxonomy — that ladder is
 * already the shared vocabulary between the write gate and the vNext claim
 * ledger (compile-time locked in lib/ai/vnext/truth/claims.ts).
 */
const EVIDENCE_LABEL: Record<MemoryEvidenceClass, string> = {
  operator_stated: "you stated",
  system_receipt: "receipt",
  direct_observation: "observed",
  external_source: "external",
  supported_inference: "inferred",
  generated_summary: "summary",
  prediction: "prediction",
  // NOT "unverified" — that asserts a check was run and failed. This class is
  // the ladder's FALLBACK for any source string it does not recognize. Until
  // 2026-09-08 real operator-authored writers landed here: `source: "operator"`
  // (app/api/relationships/log-outreach, lib/media/media-moment — whose own
  // comment calls that source "load-bearing, not decoration") and `pin:chat` /
  // `pin:manual` from lib/services/pins.ts, since the operator_stated test is
  // three EXACT equality checks (user/manual/skill_ingestion), not a prefix.
  // Labelling those "unverified" told the model the operator's own logged
  // action and his explicit pins were untrusted — the same overclaim, inverted,
  // that this whole change set exists to remove. Admit ignorance instead.
  weak_inference: "unclassified",
};

/**
 * The provenance prefix for one recalled memory.
 *
 * Replaces `(NN%)`. That percentage read as certainty, but BrainMemory
 * confidence is `0.5 + 0.1 × (sightings − 1)` capped at 1.0 — it IS the
 * sighting count, restated. Printing both would print one fact twice, so the
 * count replaces the percentage rather than joining it. What the model was
 * missing is not a number: it is WHERE the claim came from. Without it a
 * blind-spot inference the system generated itself rendered identically to
 * something the operator said out loud.
 *
 * Follows the `· `-separated bracket convention already used by
 * appendCrossSourceContext, so the block stays visually consistent.
 */
export function provenancePrefix(m: RelevantMemory): string {
  const cls = evidenceClassForSource(m.source ?? "");
  const seen = m.seenCount && m.seenCount > 1 ? ` · seen ${m.seenCount}x` : "";
  return `[${m.category} · ${EVIDENCE_LABEL[cls]}${seen}]`;
}

/**
 * The slice of a memory's content the recall block renders: 200 chars for a
 * direct hit, 150 otherwise. The renderer AND the token-budget trim read this
 * one helper, so the budget charges exactly what the model is shown.
 */
export function renderedContent(m: RelevantMemory): string {
  return m.content.slice(0, m.relevance === "direct" ? 200 : 150);
}
// 2026-05-17 follow-up · exclude binary-payload categories from
// every recall path · keeps the prompt builder from pulling 100KB+
// base64 audio blobs that have no semantic value (Phase 5 morning
// brief audio).
import { RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";
import { fenceContent } from "@/lib/ai/tool-result-fencing";

/**
 * S-1 (2026-09-01 audit) · recalled memory was the one path external content
 * reached the system prompt WITHOUT a <tool_data> fence: ingest-gmail (and
 * drive / calendar / reviews) write email and document text into BrainMemory,
 * and this module injects it into the prompt. fenceContent wraps ~20 tool
 * results at read time and never touched these blocks.
 *
 * The heading stays OUTSIDE the fence so the section-aware trimmer still sees
 * a `## ` boundary; every memory line goes inside. The cap is lifted because
 * this block is already trimmed to its own token budget above — the 4000-char
 * tool-result default would amputate it.
 */
const RECALL_FENCE_MAX_CHARS = 200_000;
export function fenceRecallBlock(lines: string[]): string {
  if (lines.length === 0) return "";
  const [heading, ...body] = lines;
  if (body.length === 0) return heading;
  return `${heading}\n${fenceContent("brainRecall", "memory_recall", body.join("\n"), { maxChars: RECALL_FENCE_MAX_CHARS })}`;
}

export interface RelevantMemory {
  /** BrainMemory id/key — carried so observers (onRanked) can identify a rendered row. */
  id?: string;
  key?: string;
  category: string;
  content: string;
  confidence: number;
  relevance: "direct" | "supporting" | "background";
  /** Raw BrainMemory.source — mapped to an evidence class at render time. */
  source?: string;
  /** Re-sighting count. confidence is derived from this, not from evidence. */
  seenCount?: number;
}

// ---------------------------------------------------------------------------
// Topic extraction (used for keyword fallback + query embedding)
// ---------------------------------------------------------------------------

/**
 * 2026-08-27 · retrieval baseline F2. The LLM extractTopics below measured
 * p50 4,183ms / p90 11,294ms in prod agent_traces (label=contextual-recall,
 * ollama) — alone exceeding the 3,000ms withTimeout the chat route races this
 * whole pipeline against, so the median turn lost the entire fused block.
 * This is the deterministic replacement for the chat hot path: stopword-strip
 * the recent text and take the most recent informative unigrams. Topics only
 * feed the lexical tsquery (OR semantics) + keyword lane; the semantic lane
 * uses the precomputed queryEmbedding directly. Exported for tests.
 */
const FAST_TOPIC_STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "all", "any", "can",
  "had", "has", "have", "was", "were", "will", "with", "that", "this", "these",
  "those", "there", "their", "then", "than", "them", "they", "what", "whats",
  "when", "where", "which", "who", "why", "how", "hows", "did", "does", "doing",
  "don", "dont", "cant", "wont", "just", "like", "about", "into", "over",
  "some", "still", "been", "being", "would", "could", "should", "very", "also",
  "out", "get", "got", "going", "gonna", "know", "need", "want", "make", "made",
  "much", "many", "more", "most", "even", "ever", "never", "now", "one", "two",
  "say", "said", "see", "tell", "told", "think", "thing", "things", "really",
  "right", "yeah", "okay", "well", "way", "back", "off", "too", "let", "lets",
  // 2026-09-18 · PRO-FORMS AND QUANTIFIERS — completing a class this list
  // already started. `any`, `all`, `one`, `thing`, `things` and `some` were
  // here from the beginning, so the intent to exclude this class predates
  // this edit; these 18 are its gaps.
  //
  // MEASURED on 20 short anaphoric follow-ups: 14 derived PRO-FORM-ONLY
  // topics ("is it still the same" -> ["same"], "the other way" -> ["other"],
  // "is it done" -> ["done"]) and 17 carried at least one. Those turns have
  // topics.length > 0, so they never reach the zero-topic embedding path added
  // in #2425 — they run a real lexical tsquery for "same" instead.
  //
  // Why this is noise removal and NOT a precision/recall trade: the lexical
  // lane matches memory CONTENT. For a pro-form, any content match is
  // COINCIDENTAL — no memory is ever *about* the word "same". So there is no
  // true positive to lose, which is what makes this safe without a full
  // recall-eval run.
  //
  // "rest" is deliberately NOT here: it has a real domain sense ("rest day").
  // Same reason "change" is absent — "oil change". A pro-form with a noun
  // sense in this operator's world is not a pro-form.
  "same", "other", "another", "both", "else", "anything", "something",
  "nothing", "everything", "everyone", "anyone", "someone", "nobody", "none",
  "each", "every", "done", "such",
]);

export function deriveFastTopics(messages: string[]): string[] {
  const recentText = messages.slice(-3).join("\n").slice(0, 1000).toLowerCase();
  const words = recentText.match(/[a-z][a-z0-9'-]{2,}/g) ?? [];
  const seen = new Set<string>();
  const topics: string[] = [];
  // Walk BACKWARDS so the newest message's terms win the cap — the last turn
  // is what the operator is asking about right now.
  for (let i = words.length - 1; i >= 0 && topics.length < 8; i--) {
    const w = words[i].replace(/^'+|'+$/g, "");
    if (w.length < 3 || FAST_TOPIC_STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    topics.push(w);
  }
  return topics;
}

/**
 * 2026-09-18 · Should recall abandon the query and return top-N by confidence?
 *
 * The guard this replaces was a bare `topics.length === 0`, written before the
 * Wave-81 `queryEmbedding` pass-through existed. With an embedding of the
 * operator's own message in hand, two of the four lanes need no topics at all:
 * `getSemanticScores` prefers `precomputedEmbedding` over `queryText`, and the
 * KNN pool is pure vector. `buildLexicalTsQuery([])` yields `""` so the lexical
 * lane returns `[]`. So zero topics is a reason to lean on the embedding lanes,
 * not a reason to stop answering.
 *
 * ⚠ CORRECTION (review, PR #2425) — an earlier version of this comment said
 * `keywordScore(m, [])` returns 0 for every row "and therefore cannot reorder
 * anything". THAT WAS WRONG, and wrong in the direction that mattered. RRF
 * ignores absolute scores and reads POSITION, and the sort is stable, so an
 * all-tied lane degrades into input order and gets paid out as
 * 1/(k+1), 1/(k+2), ... The pool is `orderBy confidence desc` with KNN-only
 * hits unioned in afterward, so that phantom lane boosted generic
 * high-confidence memories over the vector hits — reintroducing, through the
 * back door, the very failure this guard was changed to fix. Uniform is
 * neutral for a SCORE-based fusion; this one is RANK-based. `fuseRankings` now
 * drops a fully-tied lane (see lib/brain/rrf.ts).
 *
 * Only when BOTH signals are missing is there genuinely no query to run, and
 * confidence-ranked fallback is the honest answer.
 *
 * Exported so the test can call the real predicate — a re-implemented copy in
 * the test would pass while this rotted (see the measurement-proxies rule).
 */
export function shouldFallbackToConfidence(topics: string[], queryEmbedding?: number[]): boolean {
  return topics.length === 0 && (queryEmbedding?.length ?? 0) === 0;
}

/**
 * The text handed to the reranker and the cross-source semantic search.
 *
 * `topics.join(", ")` is `""` when topics are empty, and that empty string does
 * NOT stop at the embedding lane — it reaches `rerank({ query })` and
 * `semanticSearch()`, both of which would then score against nothing. The
 * operator's own last message IS the query in that case, so use it. Capped
 * because it only ever feeds a reranker and a log line.
 */
export function buildQueryText(topics: string[], recentMessages: string[]): string {
  if (topics.length > 0) return topics.join(", ");
  // String(...) not a bare .slice: the param is typed string[], but this module
  // is on the chat hot path under a withTimeout whose fallback is "", so a
  // throw here would surface as a silently EMPTY brain block rather than an
  // error — the exact failure mode this file keeps getting bitten by. Cheap
  // insurance against a caller that hands over a non-string.
  return String(recentMessages[recentMessages.length - 1] ?? "").slice(0, 500);
}

async function extractTopics(messages: string[]): Promise<string[]> {
  const recentText = messages.slice(-3).join("\n").slice(0, 1000);

  const result = await aiChat(
    [
      {
        role: "system",
        content: `Extract 3-8 topic keywords/phrases from this conversation snippet. Return ONLY a JSON array of strings.
Examples: ["revenue", "hiring", "tire inventory", "workout schedule", "customer complaints", "website SEO"]
Focus on: business topics, people names, specific projects, health/personal goals, emotional states.`,
      },
      { role: "user", content: recentText },
    ],
    "fast"
  );

  const extracted = extractJsonArray<unknown>(result.content);
  if (!extracted.ok) return [];

  const topics = extracted.value;
  return Array.isArray(topics) ? topics.filter((t: unknown) => typeof t === "string").slice(0, 8) as string[] : [];
}

// ---------------------------------------------------------------------------
// Recency score (exponential decay)
// ---------------------------------------------------------------------------

function recencyScore(createdAt?: Date | string): number {
  if (!createdAt) return 0;
  const days = (Date.now() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000);
  if (days < 1) return 1.0;    // Today
  if (days < 3) return 0.85;   // Last 3 days
  if (days < 7) return 0.7;    // This week
  if (days < 14) return 0.5;   // Last 2 weeks
  if (days < 30) return 0.3;   // This month
  return 0.1;                   // Older
}

// ---------------------------------------------------------------------------
// Category importance (0-1 scale)
// ---------------------------------------------------------------------------

const CATEGORY_SCORES: Record<string, number> = {
  wisdom: 0.9,
  business_alert: 0.85,
  contradiction: 0.85,
  // 2026-05-23 · Wave B · Q3 · weighted ABOVE pattern/insight ·
  // domain_knowledge rows are extracted business facts (tire
  // margins · tax rates · shop-specific quantitative facts) ·
  // they're the most information-dense category by design.
  domain_knowledge: 0.75,
  pattern: 0.7,
  insight: 0.6,
  routine: 0.5,
  preference: 0.4,
  anomaly: 0.3,
};

function categoryScore(category: string): number {
  return CATEGORY_SCORES[category] ?? 0.3;
}

// ---------------------------------------------------------------------------
// v10.0.354 · Source-trust weighting
//
// Wisdom flowed from many pipelines (skill ingestion, distiller, chat
// consolidation, raw chat scanning). They are not equal. Operator-curated
// ingestion deserves rank > scrape-style raw-chat dumps.
//
// Multiplier applied to the hybrid score per memory. >1 boosts trusted
// sources; <1 demotes scrape sources. Anything not listed gets 1.0
// (neutral). Tuned conservatively · the goal is to break ties between
// equally-relevant memories, not to suppress weaker sources entirely.
// ---------------------------------------------------------------------------

const SOURCE_TRUST_WEIGHT: Record<string, number> = {
  skill_ingestion: 1.50,           // hand-curated philosophical/design wisdom
  manual: 1.40,                    // operator-typed entries
  user: 1.40,                      // alias for manual
  consolidation: 1.15,             // promoted from proven patterns
  output_critic: 1.10,             // critic flagged this as principle-grade
  wisdom_ingest: 1.10,             // older manual ingestion path
  distillation: 1.05,              // legacy single-shot distiller
  "wisdom-distiller": 1.00,        // automated cron · neutral baseline
  conversation_analysis: 0.85,     // chat post-mortem · medium trust
  history_ingestion: 0.85,         // seed import
  wisdom_sync_cron: 0.70,          // raw chat-message scrape · noisy
  device_analysis: 0.80,           // device-derived
};

function sourceTrustWeight(source: string | null | undefined): number {
  if (!source) return 1.0;
  return SOURCE_TRUST_WEIGHT[source] ?? 1.0;
}

// v10.0.397 · Operator's favorite-persona bias.
// Operator stated · 'Greene is my favorite of them all'. Apply a small
// additional multiplier to wisdom_greene_* keys so when a Greene law is
// semantically competitive, it rises slightly above other curated
// personas. Conservative · 1.10x · doesn't crowd out Buffett/Jobs/etc.
// when they're a clearer match · just breaks ties in Greene's favor.
const FAVORITE_PERSONA_BOOST = 1.10;

function favoritePersonaBoost(key: string): number {
  if (key.startsWith("wisdom_greene_")) return FAVORITE_PERSONA_BOOST;
  return 1.0;
}

// ---------------------------------------------------------------------------
// Keyword fallback scoring (from v1, used when embeddings unavailable)
// ---------------------------------------------------------------------------

function keywordScore(
  memory: { category: string; content: string; key: string },
  topics: string[]
): number {
  const contentLower = memory.content.toLowerCase();
  const keyLower = memory.key.toLowerCase();
  let score = 0;

  for (const topic of topics) {
    const topicLower = topic.toLowerCase();
    if (contentLower.includes(topicLower)) score += 3;
    else if (keyLower.includes(topicLower)) score += 2;
    else {
      const words = topicLower.split(/\s+/);
      for (const word of words) {
        if (word.length > 3 && contentLower.includes(word)) score += 1;
      }
    }
  }

  // Normalize to 0-1 range (max realistic score ~24 for 8 topics × 3)
  return Math.min(1.0, score / 12);
}

// ---------------------------------------------------------------------------
// Lexical lane — real Postgres full-text search (Wave B · 2026-06-02)
// ---------------------------------------------------------------------------
//
// The keywordScore lane above is naive JS substring matching, AND it only
// ever sees the top-300-by-confidence rows loaded in getContextualMemories.
// A perfect lexical hit (a person's name, an error code like "F25e", a SKU)
// on a mid-confidence memory was never loaded, so it could not surface. This
// runs a true Postgres FTS (ts_rank + websearch_to_tsquery, OR semantics
// across topics) over ALL non-deleted, confidence>=0.3 memories, backed by
// the STORED generated column `brain_memories.content_tsv` and its GIN
// `brain_memories_content_tsv_idx` (migration 20260923000000_brain_content_tsv;
// the 0007_brain_fts expression index it replaces stays until the operator
// drops it). Filter AND rank read the stored vector: measured on production
// 2026-09-22, the same OR-of-topics query took 1,902 ms warm when ts_rank
// re-parsed content for ~3,600 candidate rows and 8 ms with the rank
// removed - the parse WAS the lane's cost, and the 900 ms statement timeout
// below was dropping the lane on 84 of 89 hybrid benchmark queries.
// Results (a) replace the keyword lane with a real ts_rank
// signal and (b) are UNIONed into the candidate pool so lexical-strong but
// low-confidence memories can win. Best-effort: any failure (pre-migration,
// empty tsquery) returns [] and the caller falls back to keywordScore. It is
// independent of pgvector (vector_embeddings is a separate table) — purely
// additive to the existing semantic lane.

interface LexicalRow {
  id: string;
  content: string;
  category: string;
  key: string;
  confidence: number;
  created_at: Date;
  source: string | null;
  seen_count: number | null;
  updated_at: Date;
  rank: number;
}

/**
 * Build the websearch tsquery text from extracted topics. Topics are joined
 * with " or " so a memory matching ANY topic ranks (websearch_to_tsquery
 * treats the bare word "or" as the OR operator; a multi-word topic like
 * "tire inventory" stays ANDed within itself). Exported for unit tests.
 */
export function buildLexicalTsQuery(topics: string[]): string {
  return topics
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join(" or ");
}

// 2026-08-13 · BDN-203 · exported so scripts/recall-eval.ts can run the
// lexical lane as a standalone retriever against the eval corpus
// (grep-first vs vector comparison). Behavior unchanged.
/**
 * 2026-08-27 · retrieval levers run: this GIN query ran past 900ms on 10 of
 * 28 corpus queries (max 2.9s) while contributing exactly ONE lexical hit
 * among those slow runs — and it sits inside the chat pipeline's 3s race, so
 * every slow lexical run taxed the semantic + rerank stages behind it. The
 * tx-scoped statement_timeout caps the tail; a timeout lands in the existing
 * catch and the lane degrades to [] exactly like every other lexical failure.
 * Term COUNT was measured NOT to be the driver (caps 8/5/3 had equal
 * latency), so the topics stay uncapped.
 *
 * 2026-09-23 · the "slow tail" was never a tail. The cost was ts_rank
 * re-parsing `content` for every candidate row (1,902 ms warm on the
 * production query shape, 8 ms with the rank removed), a constant that the
 * timeout cut on 84 of 89 hybrid benchmark queries. #2553 moved filter and
 * rank onto the stored content_tsv column: the same query runs in 25.6 ms on
 * production and the post-fix benchmark timed out on 0 of 89 (lexical median
 * 162 ms, was ~1,020 ms). The timeout stays as a guard against a regression,
 * not as an accepted loss; the counters below should now read ~0.
 */
const LEXICAL_STATEMENT_TIMEOUT_MS = 900;

/* ════════════════════════════════════════════════════════════════════════════
 * LEXICAL LANE OUTCOME COUNTERS — an accepted trade-off nobody can currently see
 * ════════════════════════════════════════════════════════════════════════════
 * getLexicalMatches returns `[]` for FOUR different things, and no caller can
 * tell them apart:
 *   1. no usable ts_query could be built from the topics  (nothing was asked)
 *   2. the query ran and genuinely matched nothing        (asked, no answer)
 *   3. the 900ms statement_timeout fired, lane dropped    (asked, gave up)
 *   4. the query failed for some other reason             (broken)
 *
 * (3) is the designed trade-off recorded above — and it is a bare console.warn,
 * so its RATE is invisible in production. That matters because the trade-off was
 * accepted ON a measurement ("10 of 28 corpus queries, contributing exactly ONE
 * lexical hit"), and nothing re-checks that measurement as brain_memories grows.
 * A decision made on data, with no instrument watching the data.
 *
 * Measured 2026-09-18 on a sequential unloaded probe: 9 of 25 queries over
 * budget (36%) — matching the 2026-08-27 figure, which was read as "no
 * degradation". It was the wrong reading: the counters were watching a
 * constant cost, not a tail (see the timeout note above), and the
 * 2026-09-22 benchmark put the hybrid-shaped rate at 94% (84 of 89). After
 * #2553 the expected rate is ~0 (0 of 89 in the post-fix benchmark); a
 * post-#2553 process whose `lexicalSkipPctCum` reads above a few percent is a
 * regression, not the old trade-off. The point stands: nobody would have
 * known either way without the counter.
 *
 * ⚠ AGGREGATE COUNTERS ARE SAFE HERE; PER-REQUEST STATE WOULD NOT BE. Several
 * chat turns share this module concurrently. A "last outcome" variable would be
 * clobbered by whichever turn finished most recently and would misattribute the
 * result to another turn. A monotonic COUNT is the one shape concurrent writers
 * cannot corrupt into a wrong answer — it is exactly what a rate needs, and it
 * is why this is a counter rather than the obvious out-parameter.
 * ════════════════════════════════════════════════════════════════════════════ */

export interface LexicalLaneStats {
  /** No ts_query could be built — the lane was never asked. */
  noQuery: number;
  /** The query ran. Includes genuine zero-row results. */
  ok: number;
  /** 57014 statement_timeout — the lane was DROPPED mid-flight. */
  skippedTimeout: number;
  /** Any other failure. */
  failedOther: number;
}

const lexicalLaneCounters: LexicalLaneStats = {
  noQuery: 0,
  ok: 0,
  skippedTimeout: 0,
  failedOther: 0,
};

/** Snapshot of lexical-lane outcomes since process start. Exported for tests
 *  and for the structured `[brain-recall]` line. */
export function lexicalLaneStats(): LexicalLaneStats {
  return { ...lexicalLaneCounters };
}

/** Test seam only. */
export function resetLexicalLaneStats(): void {
  lexicalLaneCounters.noQuery = 0;
  lexicalLaneCounters.ok = 0;
  lexicalLaneCounters.skippedTimeout = 0;
  lexicalLaneCounters.failedOther = 0;
}

/**
 * Fraction of ATTEMPTED queries that were dropped on the statement timeout.
 *
 * `noQuery` is excluded from the denominator on purpose: a turn that produced
 * no search terms did not attempt the lane, and counting it would dilute the
 * rate toward zero exactly when topic extraction is failing — the rate would
 * look healthiest when the pipeline is sickest. Returns null when nothing has
 * been attempted: an UNKNOWN rate must never render as 0%.
 *
 * ⚠ PURE, TAKING STATS AS AN ARGUMENT, DELIBERATELY. The first cut read the
 * module counters directly, which left no way to drive it without a database —
 * and the test written against it computed the arithmetic on its own local
 * objects and asserted that equalled itself. It would have passed with this
 * function deleted. A predicate that cannot be fed cannot be tested, and an
 * untested rate is how the invisible thing stays invisible.
 */
export function computeLexicalSkipRate(s: LexicalLaneStats): number | null {
  const attempted = s.ok + s.skippedTimeout + s.failedOther;
  return attempted === 0 ? null : s.skippedTimeout / attempted;
}

/** The live rate, read off the module counters. */
export function lexicalSkipRate(): number | null {
  return computeLexicalSkipRate(lexicalLaneCounters);
}

/**
 * Rerank call-site budget (2026-08-27 levers): the backends' own
 * AbortSignals are 7.5s (Cohere) / 6s (BGE) — sized before the chat
 * route's 3s Promise.race over this whole pipeline existed. Past the
 * budget the RRF-hybrid ordering stands (a correct answer, less well
 * sorted). The losing HTTP call is left to the backend's own abort:
 * it is side-effect-free and self-terminates at the backend bound —
 * plumbing an extra AbortSignal through the rerank orchestrator for a
 * sub-1%-of-turns stray call is complexity the numbers don't buy.
 */
const RERANK_CALL_BUDGET_MS = 1_500;

/**
 * Race a rerank promise against the budget: budget expiry and rejection
 * both resolve null, which every call site already treats as "keep the
 * hybrid ordering". Exported for the behavioral canary.
 */
export async function withRerankBudget<T>(p: Promise<T | null>, budgetMs: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs)),
  ]);
}

export async function getLexicalMatches(topics: string[], limit = 50, asOf?: Date): Promise<LexicalRow[]> {
  const tsQueryText = buildLexicalTsQuery(topics);
  if (!tsQueryText) {
    lexicalLaneCounters.noQuery++;
    return [];
  }
  try {
    // $1 = tsQueryText (parameterized — no injection). `limit` is an internal
    // numeric constant interpolated as a literal, mirroring memory-recall.ts.
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${LEXICAL_STATEMENT_TIMEOUT_MS}`);
      return tx.$queryRawUnsafe<LexicalRow[]>(
      `SELECT bm.id::text          AS id,
              bm.content           AS content,
              bm.category::text    AS category,
              bm.key::text         AS key,
              bm.confidence::float AS confidence,
              bm.created_at        AS created_at,
              bm.source            AS source,
              bm.seen_count        AS seen_count,
              bm.updated_at        AS updated_at,
              ts_rank(bm.content_tsv,
                      websearch_to_tsquery('english', $1)) AS rank
       FROM brain_memories bm
       WHERE bm.deleted_at IS NULL
         AND bm.confidence >= 0.3
         -- BDN-310 supersession honored (2026-08-19) — see memory-recall.ts
         AND ${validitySql("bm", asOf ? "$2" : null)}
         AND bm.content_tsv
             @@ websearch_to_tsquery('english', $1)
       ORDER BY rank DESC
       LIMIT ${limit}`,
      tsQueryText,
      ...(asOf ? [asOf] : []),
      );
    });
    // Counted AFTER the await resolves, so a query that threw is never scored
    // as ok. A zero-row result IS ok — that is a genuine empty, and conflating
    // it with a dropped lane is the whole defect these counters exist to undo.
    lexicalLaneCounters.ok++;
    return rows;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 57014 = statement_timeout — expected on the slow tail, not a defect.
    if (msg.includes("57014") || msg.includes("statement timeout")) {
      lexicalLaneCounters.skippedTimeout++;
      console.warn(`[brain-recall] lexical FTS exceeded ${LEXICAL_STATEMENT_TIMEOUT_MS}ms — lane skipped this turn`);
    } else {
      lexicalLaneCounters.failedOther++;
      console.warn(
        "[brain-recall] lexical FTS query failed (pre-migration?) — falling back:",
        msg.slice(0, 120),
      );
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// KNN candidate lane (2026-08-27 · retrieval baseline F3)
// ---------------------------------------------------------------------------
//
// The candidate pool below was `ORDER BY confidence DESC LIMIT 300` — and
// 9,004 eligible rows tie at confidence 1.0, so WHICH 300 the planner returns
// is arbitrary (two identical probes minutes apart returned pools that were
// 79% archive_document and then 63% journal_brain_take). The "semantic lane"
// was cosine-scoring an arbitrary confidence slice, never the corpus. This
// runs a true pgvector KNN over embedding_vec_1536 (same shape as
// memory-recall.ts's query) and UNIONs the top hits into the pool, so the
// dense lane sees actual nearest neighbours. Chat passes the precomputed
// queryEmbedding, so this costs one indexed KNN query and zero embedding
// calls. Best-effort like the lexical lane: any failure returns [].

// 2026-09-22 · THE POOL WAS STARVING. Measured read-only on prod (pgvector
// 0.8.0, hnsw.ef_search default 40): for six real memory-shaped queries the raw
// nearest-40 candidates were 45% dead — 34 pointed at hard-deleted memories,
// 64 at soft-deleted ones — so after the join below the "50-slot" pool came
// back with 9-28 rows. HNSW hands over its candidate budget FIRST and the WHERE
// filters AFTER; and `LIMIT 50` can never be met with ef_search 40 even on a
// clean index. The dead vectors are kept on purpose (lib/db/embedding-cleanup.ts:
// their text column is the last copy of a hard-deleted memory), so the fix is
// at query time: pgvector 0.8's iterative scan keeps walking the graph until
// LIMIT rows pass the filter. Verified on prod: 50/50 on all six queries in
// 280-600 ms, faster than a raised ef_search because it stops early. SET LOCAL
// is transaction-scoped, and the pool runs on pooled connections, so the SET
// and the SELECT travel in one transaction, bounded so a cold Neon compute
// cannot hang a turn (the lane is best-effort: any failure returns []).
const KNN_POOL_TIMEOUT_MS = 10_000;

async function getKnnPoolRows(queryVec: number[], limit = 50, asOf?: Date): Promise<LexicalRow[]> {
  try {
    const padded = padToVectorDim(queryVec, VECTOR_DIM_1536);
    const lit = vectorLiteral(padded);
    assertSafeVectorLiteral(lit);
    // $1 vector · $2 quarantined categories · $3 asOf (when given). The
    // quarantine list is the SAME one the lexical lane applies, so the two
    // lanes cannot drift; the unavailable-source skip mirrors the writer's own
    // KNN in semantic-link.ts.
    const excluded: string[] = [...RECALL_EXCLUDE_CATEGORIES];
    const sql = `SELECT bm.id::text          AS id,
              bm.content           AS content,
              bm.category::text    AS category,
              bm.key::text         AS key,
              bm.confidence::float AS confidence,
              bm.created_at        AS created_at,
              bm.source            AS source,
              bm.seen_count        AS seen_count,
              bm.updated_at        AS updated_at,
              0::float             AS rank
       FROM vector_embeddings ve
       JOIN brain_memories bm
         ON bm.id = ve."sourceId"
        AND bm.deleted_at IS NULL
       WHERE ve."sourceType" = 'brain_memory'
         AND ve.embedding_vec_1536 IS NOT NULL
         AND ve."sourceUnavailableAt" IS NULL
         AND bm.confidence >= 0.3
         AND bm.category <> ALL($2::text[])
         AND ${validitySql("bm", asOf ? "$3" : null)}
       ORDER BY ve.embedding_vec_1536 <=> $1::vector(${VECTOR_DIM_1536})
       LIMIT ${limit}`;
    const params: unknown[] = [lit, excluded, ...(asOf ? [asOf] : [])];
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL hnsw.iterative_scan = relaxed_order");
          return tx.$queryRawUnsafe<LexicalRow[]>(sql, ...params);
        },
        { timeout: KNN_POOL_TIMEOUT_MS },
      );
    } catch (err) {
      // A database without pgvector 0.8 rejects the setting as an unknown
      // parameter. Fall back to the plain (budget-limited) scan rather than
      // losing the lane — production is 0.8.0, so this is a safety net.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/iterative_scan|unrecognized configuration parameter/i.test(msg)) throw err;
      console.warn("[brain-recall] hnsw.iterative_scan unavailable — pool runs budget-limited:", msg.slice(0, 120));
      return await prisma.$queryRawUnsafe<LexicalRow[]>(sql, ...params);
    }
  } catch (err) {
    console.warn(
      "[brain-recall] knn pool query failed — pool stays confidence-sliced:",
      err instanceof Error ? err.message.slice(0, 120) : String(err),
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main: semantic + hybrid recall
// ---------------------------------------------------------------------------

/**
 * v10.0.364 · token-budget enforcement.
 *
 * Per /context-window-management skill · context bloat is the silent
 * killer of long conversations. Memory recall used to cap by COUNT
 * (`maxMemories: 20`), but each memory's content varies 100-2000 chars.
 * 20 memories could be 2K tokens or 12K. Caller had no way to bound
 * the resulting prompt block size.
 *
 * Now we enforce a token-budget · approximate (4 chars/token) ·
 * memories beyond the budget get dropped LOWEST-SCORE FIRST · the
 * 3 wisdom slots are always preserved (operator-grade guarantee).
 *
 * Default budget: 4000 tokens (~16k chars). Tunable via the
 * `tokenBudget` option for callers that need a tighter / looser cap.
 */

const DEFAULT_TOKEN_BUDGET = 4000;
const CHARS_PER_TOKEN_APPROX = 4;

/**
 * Drop lowest-relevance entries from the END of `relevant` (in place) until the
 * block fits `budgetChars`, never below the first `wisdomSlots` entries — the
 * wisdom memories, per the construction order in getContextualMemories.
 * Returns how many were dropped.
 *
 * 2026-08-16 · count the rendered PREFIX too. The trimmer summed only
 * content.length, so the `[category · evidence · seen Nx] ` prefix (and the
 * `[category] (NN%) ` one before it) was invisible to the 4000-token cap —
 * the block could run ~10-15% over its declared budget.
 *
 * 2026-09-23 · and charge the rendered CONTENT, not the stored one. The block
 * shows renderedContent (200 / 150 chars) but the trim charged content.length,
 * so a 15,000-char memory cost 94% of the 16k budget while rendering 200 chars.
 * Once #2553 made the lexical lane answer, its long OR-matched winners (top-10
 * average 11.5k-13.4k chars on production) evicted dense hits to pay for text
 * the model never saw. Test: tests/brain/recall-budget-rendered-chars.test.ts.
 *
 * Scope, stated precisely (review on #2558): this budget covers the three
 * ranked sections only. The no-topics fallback (getFallbackMemories) renders
 * its own 200-char slice and is not trimmed — it is capped by count (20). The
 * graph expansion and the cross-source pull append AFTER this trim and were
 * never inside the budget; both pre-date this change.
 */
export function trimToTokenBudget(relevant: RelevantMemory[], budgetChars: number, wisdomSlots: number): number {
  const cost = (m: RelevantMemory) => renderedContent(m).length + provenancePrefix(m).length + 1;
  let totalChars = relevant.reduce((s, m) => s + cost(m), 0);
  let dropped = 0;
  const minKeep = Math.min(wisdomSlots, relevant.length);
  while (relevant.length > minKeep && totalChars > budgetChars) {
    totalChars -= cost(relevant.pop()!);
    dropped++;
  }
  return dropped;
}

/**
 * U3 (2026-09-08, review on #2198) · the validity window of a belief, at an
 * instant. Every recall lane and the searchMemories tool read this one helper.
 *
 * Current mode (no `asOf`): a belief is live when nothing supersedes it and
 * its validUntil is unset or still ahead of now (BDN-310).
 *
 * Historical mode (`asOf`): "what was believed THEN". Supersession is a fact
 * about now, so it is NOT consulted -- the belief that was live on that date
 * is the answer even though a later correction replaced it. A row is visible
 * when its interval covers the instant: it started on or before `asOf`
 * (validFrom, else createdAt) and had not ended (validUntil unset or after
 * `asOf`). A row saved after `asOf` with no earlier validFrom is out.
 *
 * `isVisibleAsOf` is the same predicate over a loaded row; `validitySql` is
 * the same predicate for the raw-SQL lanes. Change one, change all three --
 * tests/brain/recall-as-of.test.ts pins them together.
 */
/** What onRanked observes: identity + provenance of each rendered memory, in rank order. */
export interface RankedRecallRow {
  id: string;
  key: string;
  category: string;
  source: string;
  relevance: string;
  /** The rendered text (already truncated by the lane); the arbiter dedupes on it. */
  content: string;
  seenCount?: number;
  confidence?: number;
}

export type ValidityRow = {
  createdAt: Date;
  validFrom?: Date | null;
  validUntil?: Date | null;
  supersededById?: string | null;
};

export function validityWhere(asOf?: Date): Prisma.BrainMemoryWhereInput {
  if (!asOf) {
    const at = new Date();
    return { supersededById: null, OR: [{ validUntil: null }, { validUntil: { gt: at } }] };
  }
  return {
    AND: [
      { OR: [{ validFrom: { lte: asOf } }, { validFrom: null, createdAt: { lte: asOf } }] },
      { OR: [{ validUntil: null }, { validUntil: { gt: asOf } }] },
    ],
  };
}

export function isVisibleAsOf(row: ValidityRow, asOf?: Date): boolean {
  if (!asOf) {
    if (row.supersededById) return false;
    return !row.validUntil || row.validUntil.getTime() > Date.now();
  }
  const t = asOf.getTime();
  const started = row.validFrom ? row.validFrom.getTime() <= t : row.createdAt.getTime() <= t;
  const ended = !!row.validUntil && row.validUntil.getTime() <= t;
  return started && !ended;
}

/**
 * Raw-SQL twin of validityWhere. `alias` prefixes the columns ("bm"), "" for
 * an unaliased table. `asOfParam` is the positional parameter that carries
 * `asOf` ("$2"); null = current mode (NOW(), no parameter referenced -- so
 * the caller must add the parameter to the argument list ONLY in as-of mode).
 */
export function validitySql(alias: string, asOfParam: string | null): string {
  const p = alias ? `${alias}.` : "";
  if (!asOfParam) {
    return `${p}superseded_by_id IS NULL AND (${p}valid_until IS NULL OR ${p}valid_until > NOW())`;
  }
  return (
    `((${p}valid_from IS NOT NULL AND ${p}valid_from <= ${asOfParam}) OR ` +
    `(${p}valid_from IS NULL AND ${p}created_at <= ${asOfParam})) AND ` +
    `(${p}valid_until IS NULL OR ${p}valid_until > ${asOfParam})`
  );
}

export async function getContextualMemories(
  recentMessages: string[],
  maxMemories: number = 20,
  opts: {
    tokenBudget?: number;
    /**
     * v10.0.529.106 · Wave 81 · pre-computed query embedding. When
     * supplied, skips the getEmbedding() call inside getSemanticScores ·
     * removes one embedding round-trip per chat turn. The chat route
     * already computes userEmbedding for the predictive-prefetch path ·
     * passing it through here eliminates the duplicate.
     *
     * Per docs/brain-recall-consolidation-2026-05-16.md Step 1 ·
     * absorbs memory-recall's pre-computed embedding advantage into
     * the canonical pipeline.
     */
    queryEmbedding?: number[];
    /** U3 · answer as of this instant (see validityWhere). Undefined = now. */
    asOf?: Date;
    /**
     * Wave 0 (2026-09-08) · observe the FINAL ranked list before it is rendered.
     * scripts/recall-eval.ts scores the whole pipeline through this; the chat
     * route measures lane overlap with memory-recall through it. Never awaited.
     */
    onRanked?: (rows: RankedRecallRow[]) => void;
    /**
     * v10.0.529.106 · Wave 81 · pgvector efSearch override. Defaults
     * to the standard ef tuning · pass HIGH_RECALL (80) for high-stakes
     * queries that want more candidates considered. Absorbs memory-
     * recall's `withEfSearch(HIGH_RECALL)` advantage.
     */
    efSearch?: number;
    /**
     * v10.0.529.106 · Wave 81 · chat_message conversation-id exclusion
     * set. The chat-recall pipeline (lib/brain/chat-recall.ts) hits
     * chat_message embeddings on the same turn appendCrossSourceContext
     * also hits chat_message · this caused triple-overlap. Pass the
     * chatRecall conversation IDs here so we don't re-fetch them.
     * Per docs/brain-recall-consolidation-2026-05-16.md Step 3.
     */
    excludeChatConversationIds?: string[];
    /**
     * 2026-08-27 · retrieval baseline F2. True on the chat hot path: derive
     * topics deterministically (deriveFastTopics) instead of the p50-4.2s LLM
     * call, so the pipeline fits the caller's 3s budget. Non-chat callers
     * omit it and keep the richer LLM topic extraction.
     */
    fastTopics?: boolean;
  } = {},
): Promise<string> {
  const tokenBudget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

  // ── Stage-level observability ──────────────────────────────────────
  // The recall pipeline was a black box · no per-stage latency, no
  // hit-rate signal. `timed` records each async stage into `timings`;
  // one structured `[brain-recall]` line logs at the return. Pipecat/
  // Friday lens · you cannot tune a pipeline you cannot see.
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const tStage = Date.now();
    try {
      return await fn();
    } finally {
      timings[label] = Date.now() - tStage;
    }
  };

  // v-truth · importance axis · off by default (ranking unchanged).
  const importanceOn = getFlag("NICK_IMPORTANCE_RECALL")?.isOn ?? false;
  // 2026-08-16 · novelty axis · off by default (ranking unchanged).
  // NOTE: getFlag returns null for any key missing from FLAG_REGISTRY, and
  // `?? false` swallows that silently — the entry in lib/feature-flags.ts is
  // load-bearing, not documentation.
  const noveltyOn = getFlag("NICK_NOVELTY_RECALL")?.isOn ?? false;

  const topics = await timed("topics", () =>
    opts.fastTopics ? Promise.resolve(deriveFastTopics(recentMessages)) : extractTopics(recentMessages),
  );

  // 2026-09-18 · this used to be a bare `topics.length === 0` -> fallback, which
  // returns top-N by CONFIDENCE with the query discarded entirely. That guard
  // predates the Wave-81 queryEmbedding pass-through and now throws away a working
  // query: when the caller supplies an embedding of the user's own message, two of
  // the four lanes need no topics at all — getSemanticScores prefers
  // precomputedEmbedding over queryText (:1466), and the KNN pool is pure vector
  // (:818). The other two degrade safely rather than wrongly:
  // buildLexicalTsQuery([]) returns "" so the lexical lane yields [], and
  // keywordScore(m, []) returns 0 for EVERY row, which is uniform and therefore
  // ranking-neutral. So zero topics is a reason to lean on the embedding lanes,
  // not a reason to stop answering the question.
  if (shouldFallbackToConfidence(topics, opts.queryEmbedding)) {
    console.log("[brain-recall]", {
      outcome: "fallback",
      // Renamed from "no-topics": the fallback now requires BOTH to be missing,
      // and a log line that still said "no-topics" would misattribute the cause.
      reason: "no-topics-no-embedding",
      ms: Date.now() - t0,
    });
    return getFallbackMemories(maxMemories);
  }

  const queryText = buildQueryText(topics, recentMessages);

  // Load all viable memories from DB
  // v10.0.46 — added `deletedAt: null` filter. Pre-fix soft-deleted
  // memories (retracted wisdom, superseded snapshots, deleted chat
  // importance) were ranked + injected into Nick's system prompt on
  // every chat turn. This was the highest-leverage CRITICAL because
  // it ran per-turn, not nightly.
  const tDb = Date.now();
  const allMemories = await prisma.brainMemory.findMany({
    where: {
      confidence: { gte: 0.3 },
      deletedAt: null,
      // 2026-05-17 follow-up · exclude binary-payload categories
      category: { notIn: [...RECALL_EXCLUDE_CATEGORIES] },
      // BDN-310 supersession honored (2026-08-19): superseded or
      // expired-validity beliefs leave the recall pool.
      ...validityWhere(opts.asOf),
    },
    orderBy: { confidence: "desc" },
    take: 300,
    // v10.0.354 · pull `source` so we can weight by ingestion pipeline
    // v10.0.396 · seenCount + updatedAt for wisdom freshness decay
    select: { id: true, category: true, key: true, content: true, confidence: true, createdAt: true, source: true, seenCount: true, updatedAt: true },
  });
  timings.dbFetch = Date.now() - tDb;

  if (allMemories.length === 0) {
    console.log("[brain-recall]", {
      outcome: "empty",
      reason: "no-candidates",
      topics: topics.length,
      ms: Date.now() - t0,
    });
    return "";
  }

  // Wave B · lexical lane + candidate-pool union. Run a real Postgres FTS
  // (getLexicalMatches) across ALL memories, not just the top-300-by-
  // confidence pool above, so a strong lexical match on a low-confidence
  // memory can still surface. Filter excluded categories in JS (cheap on
  // <=50 rows), build the per-id rank map for the lane, and UNION any FTS hit
  // not already in allMemories into the candidate pool. Best-effort: on any
  // failure lexicalRows is [] and the keyword lane falls back to keywordScore.
  const excludeSet = new Set<string>(RECALL_EXCLUDE_CATEGORIES);
  const lexicalRows = (await timed("lexical", () => getLexicalMatches(topics, 50, opts.asOf)))
    .filter((r) => !excludeSet.has(r.category));
  const useLexical = lexicalRows.length > 0;
  const lexicalRankById = new Map<string, number>();
  for (const r of lexicalRows) lexicalRankById.set(r.id, r.rank);
  // F3 · true-KNN candidates. Only when the caller supplied the query
  // embedding (the chat hot path) — other callers keep today's pool shape.
  const knnRows =
    opts.queryEmbedding && opts.queryEmbedding.length > 0
      ? (await timed("knnPool", () => getKnnPoolRows(opts.queryEmbedding!, 50, opts.asOf))).filter(
          (r) => !excludeSet.has(r.category),
        )
      : [];
  const existingIds = new Set(allMemories.map((m) => m.id));
  const toPoolRow = (r: LexicalRow) => ({
    id: r.id,
    category: r.category,
    key: r.key,
    content: r.content,
    confidence: r.confidence,
    createdAt: r.created_at,
    source: r.source ?? "system",
    seenCount: r.seen_count ?? 1,
    updatedAt: r.updated_at,
  });
  const unioned: ReturnType<typeof toPoolRow>[] = [];
  for (const r of [...lexicalRows, ...knnRows]) {
    if (existingIds.has(r.id)) continue;
    existingIds.add(r.id);
    unioned.push(toPoolRow(r));
  }
  const candidatePool = [...allMemories, ...unioned];

  // Try semantic scoring first · Wave 81 · pre-computed embedding
  // skips the getEmbedding round-trip when caller already has one
  // (chat route's predictive-prefetch pre-warmed userEmbedding).
  const semanticScores = await timed("semantic", () =>
    getSemanticScores(queryText, candidatePool, opts.queryEmbedding),
  );
  const useEmbeddings = semanticScores !== null;
  const memoryVectors = semanticScores?.vectors ?? null;

  // v10.0.361 · RRF (Reciprocal Rank Fusion) replaces linear weighted
  // fusion. Per /hybrid-search-implementation skill, RRF is more robust
  // when score scales differ across lanes (cosine 0-1 vs keyword 0-N
  // raw counts). Items appearing in multiple lanes get strong boosts;
  // items strong in only one lane still rank if they're top-of-lane.
  //
  // We run THREE lanes:
  //   1. Semantic · cosine similarity from vector embeddings
  //   2. Keyword · token-overlap with extracted topics
  //   3. Category · category-importance weighting (wisdom > pattern > anomaly)
  //
  // After RRF fusion, we apply two multipliers:
  //   · Source-trust (v10.0.354) — curated > scrape
  //   · Recency boost — gentler than the old linear 15% weight
  // The recency adjustment is a multiplier rather than a lane because
  // every memory has a recency score · folding it into RRF as a third
  // sort would just duplicate the time axis.

  // Pre-compute scores once. v10.0.396 · also computes wisdom freshness
  // decay · auto-distilled wisdoms older than 90d that have low seenCount
  // get progressively dimmer · operator-curated (skill_ingestion / manual)
  // bypass decay entirely (timeless principles).
  const now = Date.now();
  const memScores = candidatePool.map((m) => {
    let freshness = 1.0;
    if (m.category === "wisdom" && !isOperatorSource(m.source)) {
      const ageDays = Math.max(0, (now - new Date(m.createdAt).getTime()) / 86_400_000);
      const seenCount = m.seenCount ?? 0;
      // Cold wisdom > 90d old gets penalized · 0.5% per day past 90d
      // floor 0.6x · reinforced wisdom (seenCount ≥ 5) is exempt
      if (ageDays > 90 && seenCount < 5) {
        freshness = Math.max(0.6, 1 - (ageDays - 90) * 0.005);
      }
    }
    return {
      ...m,
      sSemantic: useEmbeddings
        ? (semanticScores.scores.get(m.id) ?? 0)
        : keywordScore(m, topics),
      sKeyword: keywordScore(m, topics),
      sLexical: lexicalRankById.get(m.id) ?? 0,
      sCategory: categoryScore(m.category),
      sRecency: recencyScore(m.createdAt),
      sFreshness: freshness,
    };
  });

  // Run RRF over the three lanes
  const fused = fuseRankings(
    memScores,
    [
      (m) => m.sSemantic,
      (m) => (useLexical ? m.sLexical : m.sKeyword),
      (m) => m.sCategory,
    ],
    {
      // Weight semantic more heavily when embeddings are available;
      // shrink to equal weighting in keyword fallback mode.
      weights: useEmbeddings ? [2.0, 1.0, 1.0] : [1.0, 1.5, 1.0],
    },
  );

  // v10.0.367 · CoALA cognitive architecture · classify the query into
  // one of {semantic, episodic, procedural} based on lexical markers.
  // v10.0.394 · ALSO classify the query's domain TOPICS (money/people/
  // strategy/etc) so recall can boost wisdoms in matching domain.
  const lastMsg = recentMessages[recentMessages.length - 1] ?? queryText;
  const queryKind = classifyQuery(lastMsg);
  const queryTopics = classifyQueryTopics(lastMsg);

  // Apply post-fusion multipliers · trust + recency + CoALA + topic.
  const scored = fused.map((entry) => {
    const m = entry.item;
    const trust = sourceTrustWeight(m.source);
    // Gentle recency · old memories not penalized harshly · 0.85x at
    // the floor (>30d) up to 1.05x for today.
    const recencyMul = 0.85 + 0.20 * m.sRecency;
    // CoALA kind match · boost when memory's kind matches query's kind
    const kindMul = coalaKindBoost(coalaKindOf(m), queryKind);
    // v10.0.394 · domain topic match · 1.15x boost when memory and
    // query share at least one topic. Computed on-the-fly from content
    // (no schema migration · just keyword sniffing).
    const memoryTopics = tagWisdomTopics(m.content);
    const topicMul = topicBoost(memoryTopics, queryTopics);
    // v10.0.396 · wisdom freshness decay · pre-computed in memScores
    const freshness = m.sFreshness ?? 1.0;
    // v10.0.397 · operator's favorite-persona bias (Greene · 1.10x)
    const favoriteMul = favoritePersonaBoost(m.key);
    // v-truth · R+R+I third axis · 1.0 when NICK_IMPORTANCE_RECALL off.
    const importanceMul = importanceMultiplier(m.content, importanceOn);
    const hybrid = entry.score * trust * recencyMul * kindMul * topicMul * freshness * favoriteMul * importanceMul;
    return {
      id: m.id,
      category: m.category,
      key: m.key,
      content: m.content,
      confidence: m.confidence,
      createdAt: m.createdAt,
      source: m.source,
      // 2026-08-16 · seenCount IS selected by the main query but was dropped
      // here, so provenance at render time read `undefined`. `source` survived
      // this map; seenCount did not.
      seenCount: m.seenCount,
      hybrid,
      semantic: m.sSemantic,
    };
  });

  scored.sort((a, b) => b.hybrid - a.hybrid);

  // v10.0.363 · cross-encoder reranker · per /rag-implementation skill.
  // Production-grade RAG: RRF candidate generation → cross-encoder
  // rerank top-K → format winners. We rerank only the top 25 by hybrid
  // score (cheap call, ~1 search unit) and let the rerank scores
  // override the hybrid order for top placement. Gated on COHERE_API_KEY ·
  // returns the input unchanged when unavailable, so brain still works
  // without a Cohere account.
  let rerankFired = false;
  if (isRerankAvailable() && scored.length > 5) {
    const rerankPool = scored.slice(0, 25);
    // 2026-08-27 · retrieval levers: the backends' own AbortSignals are 7.5s
    // (Cohere) / 6s (BGE) — sized for a world without the 3s Promise.race the
    // chat route holds over this whole pipeline. A rerank spike (1,415ms
    // observed on the eval; the backend bound permits 5x that) can bust the
    // race and lose the ENTIRE block for a reordering. Bound the call site:
    // past 1.5s we keep the RRF-hybrid ordering — a correct answer, just
    // less well-sorted — exactly the brain-context withTimeout philosophy.
    const reranked = await timed("rerank", () =>
      withRerankBudget(
        rerank({
          query: queryText,
          candidates: rerankPool.map((m) => ({
            item: m,
            text: `[${m.category}] ${m.content}`.slice(0, 1500),
          })),
          topN: rerankPool.length,
        }),
        RERANK_CALL_BUDGET_MS,
      ),
    );
    if (reranked && reranked.length > 0) {
      rerankFired = true;
      // Replace the top-25 ordering with rerank order; tail of `scored`
      // (rank > 25) stays as-is so we don't lose long-tail candidates.
      const rerankedItems = reranked.map((r) => ({
        ...r.item,
        // Inject rerank score into hybrid so downstream logging sees it ·
        // 0.5 base ensures reranked items beat unranked tail.
        hybrid: 0.5 + 0.5 * r.score,
      }));
      const tail = scored.slice(25);
      scored.length = 0;
      scored.push(...rerankedItems, ...tail);
    }
  }

  // ── Novelty pass · AFTER rerank, deliberately ────────────────────────────
  // The rerank block above OVERWRITES `hybrid` with `0.5 + 0.5 * r.score` for
  // the top 25, discarding every post-fusion multiplier for exactly the
  // memories that matter most. importanceMultiplier (folded in at the
  // multiplier block) silently suffers this today. Applying novelty here
  // instead means it survives whether or not the reranker fired.
  //
  // Greedy diversification: walk the ranked list, and score each candidate
  // against the last few ALREADY-ACCEPTED memories. This is the standard MMR
  // shape (relevance vs. redundancy), kept to a capped comparison window so
  // the hot path stays O(n·k) — the candidate pool is up to 300 rows and this
  // block runs inside a 3s timeout on every chat turn.
  if (noveltyOn && memoryVectors) {
    const accepted: number[][] = [];
    for (const m of scored) {
      const vec = memoryVectors.get(m.id);
      m.hybrid *= noveltyMultiplier(vec, accepted, true);
      if (vec) {
        accepted.push(vec);
        if (accepted.length > NOVELTY_COMPARISON_SET) accepted.shift();
      }
    }
    scored.sort((a, b) => b.hybrid - a.hybrid);
  }

  // Build result: always include top wisdom + top scored
  const relevant: RelevantMemory[] = [];
  // v-truth · NICK_EPISODIC_SPLIT (default-OFF) · on an episodic
  // (time-anchored) query, free 2 of the 3 forced-semantic wisdom slots
  // so recent episodic memories ("what did I do last week") aren't
  // crowded out by timeless wisdom. Flag off OR non-episodic query = 3
  // (byte-identical to today).
  const episodicSplitOn = getFlag("NICK_EPISODIC_SPLIT")?.isOn ?? false;
  const wisdomSlots = episodicSplitOn && queryKind === "episodic" ? 1 : 3;
  const directSlots = maxMemories - wisdomSlots;

  // Always include top wisdom memories.
  // v10.0.354 · the source-trust multiplier already biases this list,
  // but we re-sort explicitly here so the wisdom-slot selection is
  // deterministic even when the broader candidate pool is large.
  const wisdoms = scored
    .filter((m) => m.category === "wisdom")
    .sort((a, b) => b.hybrid - a.hybrid)
    .slice(0, wisdomSlots);
  for (const w of wisdoms) {
    relevant.push({
      id: w.id,
      key: w.key,
      category: w.category,
      content: w.content,
      confidence: w.confidence,
      relevance: "background",
      source: w.source,
      seenCount: w.seenCount,
    });
  }

  // v10.0.529.106 · Wave 60 · WISDOM CITATION TRACKING.
  // Pre-Wave-60 wisdoms injected via this recall path never had their
  // lastSeen bumped · only the BrainMemory.reinforce() path moved
  // lastSeen, and that path only fires on explicit `remember()` calls
  // (not implicit recall). Result: findStaleCandidates() in
  // wisdom-evolution.ts was running on corrupted input · wisdoms cited
  // 5×/week looked stale because the citation write never fired.
  // Now: bump lastSeen + seenCount for every wisdom row that lands in
  // the recall result. Fire-and-forget · no impact on recall latency.
  if (wisdoms.length > 0) {
    const wisdomIds = wisdoms.map((w) => w.id);
    void prisma.brainMemory.updateMany({
      where: { id: { in: wisdomIds } },
      data: {
        lastSeen: new Date(),
        seenCount: { increment: 1 },
      },
    }).catch(() => undefined);
  }

  // Fill with highest-hybrid-score memories (skip wisdom already added)
  const addedIds = new Set(wisdoms.map((w) => w.id));

  // GUARANTEE TOP-3: the first three candidates always go in, regardless
  // of the 0.15 threshold. This ensures contextual recall never comes
  // back empty just because the semantic scores are all weak — the top
  // of the scored list always represents the BEST available match.
  const topCandidates = scored.filter((m) => !addedIds.has(m.id));
  const guaranteedTop3 = topCandidates.slice(0, 3);
  for (const m of guaranteedTop3) {
    relevant.push({
      id: m.id,
      key: m.key,
      category: m.category,
      content: m.content,
      confidence: m.confidence,
      relevance: m.hybrid >= 0.5 ? "direct" : m.hybrid >= 0.15 ? "supporting" : "background",
      source: m.source,
      seenCount: m.seenCount,
    });
    addedIds.add(m.id);
  }

  // Then fill remaining slots with items clearing the 0.15 bar
  const remaining = topCandidates.filter(
    (m) => !addedIds.has(m.id) && m.hybrid > 0.15,
  );
  // 2026-08-27 · slot-math guard. With maxMemories=5 (the chat default),
  // directSlots(2) − guaranteedTop3(3) = −1, and slice(0, −1) meant "all but
  // the LAST remaining row" — every above-threshold candidate flooded in and
  // only the token budget stopped it. Clamp to 0: the guarantee already spent
  // the direct slots.
  const remainingSlots = Math.max(0, directSlots - guaranteedTop3.length);
  for (const m of remaining.slice(0, remainingSlots)) {
    relevant.push({
      id: m.id,
      key: m.key,
      category: m.category,
      content: m.content,
      confidence: m.confidence,
      relevance: m.hybrid >= 0.5 ? "direct" : "supporting",
      source: m.source,
      seenCount: m.seenCount,
    });
  }

  // Pad if too few
  if (relevant.length < 10) {
    const padding = scored
      .filter((m) => !relevant.some((r) => r.content === m.content))
      .slice(0, 10 - relevant.length);
    for (const m of padding) {
      relevant.push({
        id: m.id,
        key: m.key,
        category: m.category,
        content: m.content,
        confidence: m.confidence,
        relevance: "background",
        source: m.source,
        seenCount: m.seenCount,
      });
    }
  }

  if (relevant.length === 0) {
    console.log("[brain-recall]", {
      outcome: "empty",
      reason: "no-relevant",
      topics: topics.length,
      candidates: allMemories.length,
      ms: Date.now() - t0,
    });
    return "";
  }

  // v10.0.364 · token-budget trim · drop lowest-relevance entries
  // until the total content size fits within the budget. Wisdom slots
  // (the first `wisdomSlots` entries) are PRESERVED · operator-grade
  // guarantee that the always-on wisdom layer never gets dropped.
  const budgetDropped = trimToTokenBudget(relevant, tokenBudget * CHARS_PER_TOKEN_APPROX, wisdomSlots);

  // Format for system prompt
  const mode = useEmbeddings ? "semantic" : "keyword";
  const lines: string[] = [
    // queryText, not topics.join: on a zero-topic turn the latter renders a bare
    // "for: )" into the model's own prompt, which reads as a broken retrieval.
    `## Nick Brain — Context-Matched Memories [${mode}] (${relevant.length} for: ${queryText.slice(0, 120)})`,
  ];

  const direct = relevant.filter((m) => m.relevance === "direct");
  const supporting = relevant.filter((m) => m.relevance === "supporting");
  const background = relevant.filter((m) => m.relevance === "background");

  if (opts.onRanked) {
    try {
      opts.onRanked(
        [...direct, ...supporting, ...background].map((m) => ({
          id: m.id ?? "",
          key: m.key ?? "",
          category: m.category,
          source: m.source ?? "system",
          relevance: m.relevance ?? "background",
          content: m.content,
          seenCount: m.seenCount,
          confidence: m.confidence,
        })),
      );
    } catch {
      // an observer must never cost the turn its memories
    }
  }

  if (direct.length > 0) {
    lines.push(`### Directly Relevant`);
    for (const m of direct) {
      lines.push(`${provenancePrefix(m)} ${renderedContent(m)}`);
    }
  }

  if (supporting.length > 0) {
    lines.push(`### Supporting Context`);
    for (const m of supporting) {
      lines.push(`${provenancePrefix(m)} ${renderedContent(m)}`);
    }
  }

  if (background.length > 0) {
    lines.push(`### Core Knowledge`);
    for (const m of background) {
      lines.push(`${provenancePrefix(m)} ${renderedContent(m)}`);
    }
  }

  // Graph-aware expansion — traverse MemoryEdge from the top recalled hits.
  // Anchors = the 2 highest-scoring included memories; capped + best-effort.
  const anchorMemoryIds = scored
    .filter((m) => addedIds.has(m.id))
    .slice(0, 2)
    .map((m) => m.id);
  await timed("graph", () =>
    appendGraphContext(lines, anchorMemoryIds, new Set(relevant.map((r) => r.content)), opts.asOf),
  );

  // ── Cross-source semantic pull ──
  // Until the Apr-17 expansion, semantic recall was blind to brain
  // dumps, reflections, Greene laws, and past chat replies — 100% of
  // vector rows pointed at brain_memory. Now we index 5 source types.
  //
  // Here we pull the top matches from the OTHER four types so the
  // model gets access to older insight that lives outside the
  // brain_memory table. Scored by the same hybrid formula but with
  // synthetic confidence/recency (see embedding-utils.semanticSearch).
  const linesBeforeCross = lines.length;
  await timed("crossSource", () =>
    appendCrossSourceContext(lines, queryText, opts.excludeChatConversationIds),
  );
  const crossSourceLines = lines.length - linesBeforeCross;

  // Pull related commitments, loops, people (same as v1)
  const topicLower = topics.map((t) => t.toLowerCase());
  const linesBeforeRelated = lines.length;
  await timed("related", () => appendRelatedContext(lines, topicLower));

  const skipRate = lexicalSkipRate();
  console.log("[brain-recall]", {
    outcome: "ok",
    mode,
    topics: topics.length,
    candidates: allMemories.length,
    relevant: relevant.length,
    rerankFired,
    crossSourceLines,
    relatedLines: lines.length - linesBeforeRelated,
    budgetDropped,
    // CUMULATIVE since process start, not this turn — a rate needs a
    // denominator, and one turn cannot supply one. `null` rather than 0 when
    // the lane has never been attempted: an unknown rate that renders as 0%
    // is the silent-instrument shape these counters exist to remove.
    //
    // ⚠ CUMULATIVE MEANS INSENSITIVE TO RECENT CHANGE, and the field name says
    // `Cum` so nobody reads it as "the rate right now". On a long-lived process
    // early history dominates forever: a lane that degrades from ~0% to 90%
    // after 10k healthy queries barely moves this number. It answers "has this
    // lane been dropping queries?", NOT "is it dropping them now". A windowed
    // rate would answer the second, and is worth building only once this one
    // shows the first is interesting — a ring buffer per process is real
    // complexity to buy before there is any evidence it is needed.
    lexicalSkipPctCum: skipRate === null ? null : Math.round(skipRate * 100),
    timings,
    ms: Date.now() - t0,
  });
  return fenceRecallBlock(lines);
}

// ---------------------------------------------------------------------------
// Cross-source: brain dumps + reflections + laws + past chat replies
// ---------------------------------------------------------------------------

async function appendCrossSourceContext(
  lines: string[],
  queryText: string,
  /** v10.0.529.106 · Wave 81 · chat-recall dedup. ConversationIds
   *  already covered by lib/brain/chat-recall.ts pass-through skip
   *  chat_message hits whose conversation is already represented in
   *  the chat exchange block · prevents triple-overlap on the same
   *  turn. Per docs/brain-recall-consolidation-2026-05-16.md Step 3. */
  excludeChatConversationIds?: string[],
): Promise<void> {
  try {
    // Silo wave (audit 2026-07-15) · situation_log + decision_replay
    // joined the lane — they were embedded by convergence scans but no
    // recall path could ever surface them.
    const matches = await semanticSearch(queryText, 8, [
      "brain_dump",
      "reflection",
      "strategic_law",
      "chat_message",
      "situation_log",
      "decision_replay",
    ]);

    if (matches.length === 0) return;

    // Filter out weak noise hits — we want real semantic matches only,
    // not the 0.16 borderline ones that'd just confuse the model.
    const strong = matches.filter((m) => m.similarity >= 0.35);
    if (strong.length === 0) return;

    // Group by source type so the section is scannable
    const byType = new Map<string, typeof strong>();
    for (const m of strong) {
      const arr = byType.get(m.sourceType) ?? [];
      arr.push(m);
      byType.set(m.sourceType, arr);
    }

    const TYPE_LABELS: Record<string, string> = {
      brain_dump: "Brain Dumps",
      reflection: "Reflections",
      strategic_law: "Strategic Laws",
      chat_message: "Past Replies",
      situation_log: "Logged Situations",
      decision_replay: "Past Decisions",
    };
    const TYPE_ORDER = [
      "strategic_law",
      "decision_replay",
      "situation_log",
      "reflection",
      "brain_dump",
      "chat_message",
    ];

    // v10.0.398 · A4 PAST-CHAT ANCHOR · render chat_message hits with
    // "N days ago you said" framing.
    // v10.0.401 · A5 PERSONAL ANECDOTE INJECTION · extend date framing
    // to brain_dump and reflection so operator's past wins/learnings
    // get cited inline.
    const chatHitIds = (byType.get("chat_message") ?? []).map((m) => m.sourceId);
    const brainDumpHitIds = (byType.get("brain_dump") ?? []).map((m) => m.sourceId);
    const reflectionHitIds = (byType.get("reflection") ?? []).map((m) => m.sourceId);
    const chatDateMap = new Map<string, Date>();
    const brainDumpDateMap = new Map<string, Date>();
    const reflectionDateMap = new Map<string, { date: Date; scope?: string }>();

    if (chatHitIds.length > 0) {
      try {
        // v10.0.529.106 · Wave 81 · select conversationId so we can
        // dedup against chat-recall's already-covered conversations.
        const rows = await prisma.chatMessage.findMany({
          where: { id: { in: chatHitIds } },
          select: { id: true, createdAt: true, conversationId: true },
        });
        for (const r of rows) chatDateMap.set(r.id, r.createdAt);

        // Drop chat_message hits whose conversation is already in the
        // chat-exchange block · prevents the same conversation surfacing
        // twice on the same turn. Mutates byType in-place.
        if (excludeChatConversationIds && excludeChatConversationIds.length > 0) {
          const excludeSet = new Set(excludeChatConversationIds);
          const idToConvId = new Map(rows.map((r) => [r.id, r.conversationId]));
          const filteredChatHits = (byType.get("chat_message") ?? []).filter((m) => {
            const conv = idToConvId.get(m.sourceId);
            return !conv || !excludeSet.has(conv);
          });
          if (filteredChatHits.length === 0) {
            byType.delete("chat_message");
          } else {
            byType.set("chat_message", filteredChatHits);
          }
        }
      } catch (err) {
        /* non-blocking */
        logError("brain.contextual-recall", err, { fn: "appendCrossSourceContext", stage: "chat-dates", hits: chatHitIds.length }, "warn");
      }
    }
    if (brainDumpHitIds.length > 0) {
      try {
        const rows = await prisma.brainMemory.findMany({
          where: { id: { in: brainDumpHitIds } },
          select: { id: true, createdAt: true },
        });
        for (const r of rows) brainDumpDateMap.set(r.id, r.createdAt);
      } catch (err) {
        /* non-blocking */
        logError("brain.contextual-recall", err, { fn: "appendCrossSourceContext", stage: "brain-dump-dates", hits: brainDumpHitIds.length }, "warn");
      }
    }
    if (reflectionHitIds.length > 0) {
      try {
        const rows = await prisma.reflection.findMany({
          where: { id: { in: reflectionHitIds } },
          select: { id: true, createdAt: true, scope: true },
        });
        for (const r of rows) reflectionDateMap.set(r.id, { date: r.createdAt, scope: r.scope });
      } catch (err) {
        /* non-blocking */
        logError("brain.contextual-recall", err, { fn: "appendCrossSourceContext", stage: "reflection-dates", hits: reflectionHitIds.length }, "warn");
      }
    }
    const fmtDaysAgo = (d: Date | undefined): string => {
      if (!d) return "earlier";
      const days = Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000));
      if (days === 0) return "today";
      if (days === 1) return "yesterday";
      if (days < 7) return `${days}d ago`;
      if (days < 30) return `${Math.round(days / 7)}w ago`;
      if (days < 365) return `${Math.round(days / 30)}mo ago`;
      return `${(days / 365).toFixed(1)}y ago`;
    };

    lines.push(`### Deeper Context`);
    for (const type of TYPE_ORDER) {
      const group = byType.get(type);
      if (!group || group.length === 0) continue;
      // Cap per-type to keep the section balanced — 2 per source, 8 total ceiling
      // (situation_log / decision_replay ride the default 1-per-type cap).
      const cap = type === "strategic_law" ? 2 : type === "reflection" ? 2 : 1;
      const chosen = group.slice(0, cap);
      for (const m of chosen) {
        const sim = Math.round(m.similarity * 100);
        if (type === "chat_message") {
          const ago = fmtDaysAgo(chatDateMap.get(m.sourceId));
          lines.push(`[Past chat · ${ago} · sim ${sim}%] You said: "${m.content.slice(0, 200)}"`);
        } else if (type === "brain_dump") {
          // v10.0.401 · operator's own dumps get personal framing
          const ago = fmtDaysAgo(brainDumpDateMap.get(m.sourceId));
          lines.push(`[Brain dump · ${ago} · sim ${sim}%] You wrote: "${m.content.slice(0, 200)}"`);
        } else if (type === "reflection") {
          // v10.0.401 · "Your weekly reflection from 5d ago"
          const meta = reflectionDateMap.get(m.sourceId);
          const ago = fmtDaysAgo(meta?.date);
          const scope = meta?.scope ? `${meta.scope} ` : "";
          lines.push(`[Your ${scope}reflection · ${ago} · sim ${sim}%] ${m.content.slice(0, 220)}`);
        } else {
          lines.push(`[${TYPE_LABELS[type]} · sim ${sim}%] ${m.content.slice(0, 220)}`);
        }
      }
    }
  } catch (err) {
    // Non-blocking — if cross-source fails, the memory section still renders
    logError("brain.contextual-recall", err, { fn: "appendCrossSourceContext" }, "warn");
  }
}

// ---------------------------------------------------------------------------
// Semantic scoring via embeddings
// ---------------------------------------------------------------------------

async function getSemanticScores(
  queryText: string,
  memories: { id: string; category: string; key: string; content: string }[],
  /** v10.0.529.106 · Wave 81 · pre-computed embedding short-circuit. */
  precomputedEmbedding?: number[],
): Promise<{ scores: Map<string, number>; vectors: Map<string, number[]> } | null> {
  // Generate query embedding · or use the pre-computed one when supplied.
  const queryVec = precomputedEmbedding && precomputedEmbedding.length > 0
    ? precomputedEmbedding
    : await getEmbedding(queryText);
  if (queryVec.length === 0) return null; // No embedding provider available

  // Load all brain_memory embeddings
  const memoryIds = memories.map((m) => m.id);
  const embeddingRows = await prisma.vectorEmbedding.findMany({
    where: { sourceType: "brain_memory", sourceId: { in: memoryIds } },
    select: { sourceId: true, embedding: true },
  });

  // Need at least 5 embedded memories for semantic mode to be useful
  if (embeddingRows.length < 5) return null;

  const scores = new Map<string, number>();
  // 2026-08-16 · keep the parsed vectors. This loop already JSON.parsed every
  // candidate's embedding and threw it away after one cosine — so the novelty
  // axis below costs zero extra queries and zero extra embedding calls.
  const vectors = new Map<string, number[]>();

  let corrupted = 0;
  for (const row of embeddingRows) {
    try {
      const vec = JSON.parse(row.embedding) as number[];
      if (vec.length !== queryVec.length) continue;
      scores.set(row.sourceId, cosineSimilarity(queryVec, vec));
      vectors.set(row.sourceId, vec);
    } catch {
      // Skip corrupted rows · aggregated below — recall runs every chat
      // turn over up to 300 rows, so per-row logging would flood ErrorLog
      corrupted++;
    }
  }
  if (corrupted > 0) {
    logError(
      "brain.contextual-recall",
      new Error(`${corrupted} corrupted embedding rows skipped`),
      { fn: "getSemanticScores", corrupted, scanned: embeddingRows.length },
      "warn",
    );
  }

  return { scores, vectors };
}

// ---------------------------------------------------------------------------
// Graph-aware expansion (1-hop MemoryEdge traversal)
// ---------------------------------------------------------------------------

// R1 audit (2026-06): MemoryEdge connections are WRITTEN by the brain cycle
// (connect() + cross-pollinate) but were never TRAVERSED during recall. This
// surfaces the strongest links off the top recalled memories so the model
// sees causal chains ("X caused Y"), not just similar rows. Best-effort +
// capped (<=2 anchors, <=3 links, 150 chars each); any failure is swallowed
// so recall never breaks or stalls on a graph miss. Interface unchanged: it
// only appends to the existing `lines` array.
async function appendGraphContext(
  lines: string[],
  anchorMemoryIds: string[],
  alreadyIncluded: Set<string>,
  asOf?: Date,
): Promise<void> {
  if (anchorMemoryIds.length === 0) return;
  try {
    const { getConnections } = await import("./relational-graph");
    const connLists = await Promise.all(
      anchorMemoryIds.map((id) =>
        getConnections("memory", id, { minStrength: 0.5 }),
      ),
    );
    const anchorSet = new Set(anchorMemoryIds);
    const strongestById = new Map<string, { relationship: string; strength: number }>();
    for (const c of connLists.flat()) {
      if (c.type !== "memory" || anchorSet.has(c.id)) continue;
      const prev = strongestById.get(c.id);
      if (!prev || c.strength > prev.strength) {
        strongestById.set(c.id, { relationship: c.relationship, strength: c.strength });
      }
    }
    if (strongestById.size === 0) return;
    const top = [...strongestById.entries()]
      .sort((a, b) => b[1].strength - a[1].strength)
      .slice(0, 3);
    const rows = await prisma.brainMemory.findMany({
      // BDN-310 supersession honored (2026-08-19 round-2): this lane
      // injects CONTENT into the same recall block the filtered pool
      // feeds — a superseded belief must not re-enter via graph links.
      where: {
        id: { in: top.map(([id]) => id) },
        deletedAt: null,
        ...validityWhere(asOf),
      },
      select: { id: true, category: true, content: true },
    });
    const rowById = new Map<string, { id: string; category: string; content: string }>();
    for (const r of rows) rowById.set(r.id, r);
    const out: string[] = [];
    for (const [id, link] of top) {
      const row = rowById.get(id);
      if (!row || alreadyIncluded.has(row.content)) continue;
      out.push(
        `[${row.category}] (${link.relationship.replace(/_/g, " ")}) ${row.content.slice(0, 150)}`,
      );
    }
    if (out.length > 0) {
      lines.push(`### Connected (linked in your brain graph)`);
      lines.push(...out);
    }
  } catch (err) {
    // best-effort — never break recall on a graph miss
    logError("brain.contextual-recall", err, { fn: "appendGraphContext", anchors: anchorMemoryIds.length }, "warn");
  }
}

// ---------------------------------------------------------------------------
// Related context (commitments, loops, people)
// ---------------------------------------------------------------------------

async function appendRelatedContext(lines: string[], topicLower: string[]): Promise<void> {
  const matchesTopic = (text: string) =>
    topicLower.some(
      (t) =>
        text.toLowerCase().includes(t) ||
        t.split(/\s+/).some((w) => w.length > 3 && text.toLowerCase().includes(w))
    );

  // Commitments
  const commitments = await prisma.commitment
    .findMany({
      where: { status: { in: ["active", "in_progress"] } },
      take: 10,
      select: { description: true, deadline: true },
    })
    .catch(() => []);

  const relevantCommitments = commitments.filter((c) => matchesTopic(c.description));
  if (relevantCommitments.length > 0) {
    lines.push(`### Related Commitments`);
    for (const c of relevantCommitments.slice(0, 3)) {
      lines.push(`- "${c.description.slice(0, 100)}"${c.deadline ? ` (due ${c.deadline})` : ""}`);
    }
  }

  // Active tasks (Apr 18: OpenLoop → Task).
  const loops = await prisma.task
    .findMany({
      where: { status: { in: ["INBOX", "READY", "DOING"] } },
      take: 15,
      select: { title: true, mission: { select: { domain: true } } },
    })
    .then((rows) => rows.map((t) => ({ title: t.title, domain: t.mission?.domain ?? "general" })))
    .catch(() => []);

  const relevantLoops = loops.filter((l) => matchesTopic(l.title));
  if (relevantLoops.length > 0) {
    lines.push(`### Related Active Tasks`);
    for (const l of relevantLoops.slice(0, 3)) {
      lines.push(`- "${l.title}" (${l.domain})`);
    }
  }

  // People
  const allPeople = await prisma.personProfile
    .findMany({
      take: 30,
      select: { name: true, role: true, relationship: true },
    })
    .catch(() => []);

  const relevantPeople = allPeople.filter(
    (p) => matchesTopic(p.name) || matchesTopic(p.relationship)
  );
  if (relevantPeople.length > 0) {
    lines.push(`### Related People`);
    for (const p of relevantPeople.slice(0, 3)) {
      lines.push(`- ${p.name} (${p.role}): ${p.relationship.slice(0, 80)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Fallback: top memories by confidence
// ---------------------------------------------------------------------------

async function getFallbackMemories(max: number): Promise<string> {
  // v10.0.46 — added `deletedAt: null` filter. Same bug class as the
  // primary path at line 136; fallback fires when vector search is
  // empty/dark and was injecting deleted memories with no other
  // safety net.
  const memories = await prisma.brainMemory.findMany({
    where: {
      confidence: { gte: 0.4 },
      deletedAt: null,
      // 2026-05-17 follow-up · exclude binary-payload categories
      category: { notIn: [...RECALL_EXCLUDE_CATEGORIES] },
      // BDN-310 supersession honored (2026-08-19) — same guard as the
      // primary path; the fallback must not resurrect a superseded belief.
      ...validityWhere(),
    },
    orderBy: { confidence: "desc" },
    take: max,
    // 2026-08-16 · source + seenCount added so this path renders the SAME
    // provenance as the main one. Patching only the three main render sites
    // would leave the no-topics path printing bare lines — an inconsistency
    // that reads as a bug.
    select: { category: true, content: true, confidence: true, source: true, seenCount: true },
  });

  if (memories.length === 0) return "";

  const lines = [`## Nick Brain — Top Memories (${memories.length} by confidence)`];
  for (const m of memories) {
    lines.push(
      `${provenancePrefix({ ...m, relevance: "background" })} ${m.content.slice(0, 200)}`,
    );
  }

  return fenceRecallBlock(lines);
}
