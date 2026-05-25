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

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage. getEmbedding kept direct (its own
// cost-tracking via VectorEmbedding writes).
import { getEmbedding } from "@/lib/ai/provider";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("contextual-recall", "chat");
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { cosineSimilarity, semanticSearch } from "@/lib/brain/embedding-utils";
import { fuseRankings } from "@/lib/brain/rrf";
// Wave AG · rerank orchestrator routes between BGE (HF Inference,
// $0.0001/call) and Cohere ($2/1000 calls) based on the BGE_RERANK
// env flag. Same interface as cohereRerank · falls back to identity
// ordering when neither backend is available. See lib/brain/rerank.ts
// + docs/runbooks/bge-rerank-cutover.md.
import { rerank, isRerankAvailable } from "@/lib/brain/rerank";
import { classifyQuery, coalaKindOf, coalaKindBoost } from "@/lib/brain/coala";
import { classifyQueryTopics, tagWisdomTopics, topicBoost } from "@/lib/brain/wisdom-topic-tagger";
// 2026-05-17 follow-up · exclude binary-payload categories from
// every recall path · keeps the prompt builder from pulling 100KB+
// base64 audio blobs that have no semantic value (Phase 5 morning
// brief audio).
import { RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";

interface RelevantMemory {
  category: string;
  content: string;
  confidence: number;
  relevance: "direct" | "supporting" | "background";
}

// ---------------------------------------------------------------------------
// Topic extraction (used for keyword fallback + query embedding)
// ---------------------------------------------------------------------------

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

  const topics = await timed("topics", () => extractTopics(recentMessages));

  if (topics.length === 0) {
    console.log("[brain-recall]", {
      outcome: "fallback",
      reason: "no-topics",
      ms: Date.now() - t0,
    });
    return getFallbackMemories(maxMemories);
  }

  // Build a natural language query for embedding
  const queryText = topics.join(", ");

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

  // Try semantic scoring first · Wave 81 · pre-computed embedding
  // skips the getEmbedding round-trip when caller already has one
  // (chat route's predictive-prefetch pre-warmed userEmbedding).
  const semanticScores = await timed("semantic", () =>
    getSemanticScores(queryText, allMemories, opts.queryEmbedding),
  );
  const useEmbeddings = semanticScores !== null;

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
  const TRUSTED_SOURCES_NO_DECAY = new Set(["skill_ingestion", "manual", "user"]);
  const now = Date.now();
  const memScores = allMemories.map((m) => {
    let freshness = 1.0;
    if (m.category === "wisdom" && !TRUSTED_SOURCES_NO_DECAY.has(m.source)) {
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
        ? (semanticScores.get(m.id) ?? 0)
        : keywordScore(m, topics),
      sKeyword: keywordScore(m, topics),
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
      (m) => m.sKeyword,
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
    const hybrid = entry.score * trust * recencyMul * kindMul * topicMul * freshness * favoriteMul;
    return {
      id: m.id,
      category: m.category,
      key: m.key,
      content: m.content,
      confidence: m.confidence,
      createdAt: m.createdAt,
      source: m.source,
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
    const reranked = await timed("rerank", () =>
      rerank({
        query: queryText,
        candidates: rerankPool.map((m) => ({
          item: m,
          text: `[${m.category}] ${m.content}`.slice(0, 1500),
        })),
        topN: rerankPool.length,
      }).catch(() => null),
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

  // Build result: always include top wisdom + top scored
  const relevant: RelevantMemory[] = [];
  const wisdomSlots = 3;
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
      category: w.category,
      content: w.content,
      confidence: w.confidence,
      relevance: "background",
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
      category: m.category,
      content: m.content,
      confidence: m.confidence,
      relevance: m.hybrid >= 0.5 ? "direct" : m.hybrid >= 0.15 ? "supporting" : "background",
    });
    addedIds.add(m.id);
  }

  // Then fill remaining slots with items clearing the 0.15 bar
  const remaining = topCandidates.filter(
    (m) => !addedIds.has(m.id) && m.hybrid > 0.15,
  );
  const remainingSlots = directSlots - guaranteedTop3.length;
  for (const m of remaining.slice(0, remainingSlots)) {
    relevant.push({
      category: m.category,
      content: m.content,
      confidence: m.confidence,
      relevance: m.hybrid >= 0.5 ? "direct" : "supporting",
    });
  }

  // Pad if too few
  if (relevant.length < 10) {
    const padding = scored
      .filter((m) => !relevant.some((r) => r.content === m.content))
      .slice(0, 10 - relevant.length);
    for (const m of padding) {
      relevant.push({
        category: m.category,
        content: m.content,
        confidence: m.confidence,
        relevance: "background",
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
  const budgetChars = tokenBudget * CHARS_PER_TOKEN_APPROX;
  let totalChars = relevant.reduce((s, m) => s + m.content.length, 0);
  let budgetDropped = 0;
  if (totalChars > budgetChars) {
    // Strip from the END (lowest-relevance first) but never below the
    // wisdom guarantee. The first `wisdomSlots` items in `relevant`
    // are wisdom memories per the construction order above.
    const minKeep = Math.min(wisdomSlots, relevant.length);
    while (relevant.length > minKeep && totalChars > budgetChars) {
      const dropped = relevant.pop();
      if (dropped) {
        totalChars -= dropped.content.length;
        budgetDropped++;
      }
    }
  }

  // Format for system prompt
  const mode = useEmbeddings ? "semantic" : "keyword";
  const lines: string[] = [
    `## Nick Brain — Context-Matched Memories [${mode}] (${relevant.length} for: ${topics.join(", ")})`,
  ];

  const direct = relevant.filter((m) => m.relevance === "direct");
  const supporting = relevant.filter((m) => m.relevance === "supporting");
  const background = relevant.filter((m) => m.relevance === "background");

  if (direct.length > 0) {
    lines.push(`### Directly Relevant`);
    for (const m of direct) {
      lines.push(`[${m.category}] (${(m.confidence * 100).toFixed(0)}%) ${m.content.slice(0, 200)}`);
    }
  }

  if (supporting.length > 0) {
    lines.push(`### Supporting Context`);
    for (const m of supporting) {
      lines.push(`[${m.category}] (${(m.confidence * 100).toFixed(0)}%) ${m.content.slice(0, 150)}`);
    }
  }

  if (background.length > 0) {
    lines.push(`### Core Knowledge`);
    for (const m of background) {
      lines.push(`[${m.category}] (${(m.confidence * 100).toFixed(0)}%) ${m.content.slice(0, 150)}`);
    }
  }

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
    timings,
    ms: Date.now() - t0,
  });
  return lines.join("\n");
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
    const matches = await semanticSearch(queryText, 8, [
      "brain_dump",
      "reflection",
      "strategic_law",
      "chat_message",
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
    };
    const TYPE_ORDER = ["strategic_law", "reflection", "brain_dump", "chat_message"];

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
      } catch { /* non-blocking */ }
    }
    if (brainDumpHitIds.length > 0) {
      try {
        const rows = await prisma.brainMemory.findMany({
          where: { id: { in: brainDumpHitIds } },
          select: { id: true, createdAt: true },
        });
        for (const r of rows) brainDumpDateMap.set(r.id, r.createdAt);
      } catch { /* non-blocking */ }
    }
    if (reflectionHitIds.length > 0) {
      try {
        const rows = await prisma.reflection.findMany({
          where: { id: { in: reflectionHitIds } },
          select: { id: true, createdAt: true, scope: true },
        });
        for (const r of rows) reflectionDateMap.set(r.id, { date: r.createdAt, scope: r.scope });
      } catch { /* non-blocking */ }
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
  } catch {
    // Non-blocking — if cross-source fails, the memory section still renders
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
): Promise<Map<string, number> | null> {
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

  for (const row of embeddingRows) {
    try {
      const vec = JSON.parse(row.embedding) as number[];
      if (vec.length !== queryVec.length) continue;
      scores.set(row.sourceId, cosineSimilarity(queryVec, vec));
    } catch {
      // Skip corrupted rows
    }
  }

  return scores;
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
    },
    orderBy: { confidence: "desc" },
    take: max,
    select: { category: true, content: true, confidence: true },
  });

  if (memories.length === 0) return "";

  const lines = [`## Nick Brain — Top Memories (${memories.length} by confidence)`];
  for (const m of memories) {
    lines.push(`[${m.category}] (${(m.confidence * 100).toFixed(0)}%) ${m.content.slice(0, 200)}`);
  }

  return lines.join("\n");
}
