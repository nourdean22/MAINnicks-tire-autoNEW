# Brain pipeline walkthrough · `lib/brain/*`

A guided tour of the ~85 modules that make up Nick's memory + cognition
layer. The architecture follows CoALA (Cognitive Architectures for
Language Agents · Sumers et al, 2024) — semantic / episodic /
procedural memory split, with retrieval routed by query kind.

> Last verified against `lib/brain/` (85 files) and `lib/brain/coala.ts`,
> `contextual-recall.ts`, `memory-consolidation.ts`,
> `anti-pattern-auto-promote.ts`, `conversation-memory.ts`,
> `conversation-recall.ts`. The recall layer uses RRF + Cohere
> cross-encoder + 4k token budget.

---

## Map at a glance

```
                    ┌─────────────────────────────────────────┐
                    │            CHAT TURN                    │
                    │  app/api/ai/chat/route.ts:632           │
                    │  buildBrainContext (7 modules parallel) │
                    └────────────────────┬────────────────────┘
                                         │
            ┌────────────────────────────┼────────────────────────────┐
            ▼                            ▼                            ▼
   ┌────────────────────┐       ┌────────────────────┐       ┌────────────────────┐
   │ contextual-recall  │       │ conversation-      │       │ skill-recall       │
   │ · 3-lane RRF       │       │ memory             │       │ · 1,423 skill index│
   │ · Cohere rerank    │       │ · digest + cross-  │       │ · cosine on        │
   │ · CoALA kind boost │       │   session thread   │       │   summaries        │
   │ · 4k token budget  │       │                    │       │                    │
   └────────────────────┘       └────────────────────┘       └────────────────────┘
            │
            ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │                            STORAGE LAYER                                    │
   │  BrainMemory  +  Reflection  +  StrategicLaw  +  VectorEmbedding (KNN)      │
   └────────────────────────────────────────────────────────────────────────────┘
            ▲
            │
   ┌────────┴────────────────────────────────────────────────────────────────────┐
   │                       NIGHTLY CONSOLIDATION                                 │
   │  /api/cron/auto-calibrate                                                   │
   │  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐      │
   │  │ mergeMems  │ │ promote  │ │  prune   │ │  distill │ │  score     │      │
   │  │ similar→1  │ │  →wisdom │ │ noise    │ │ ↑knowledge│ │  by dynamic│      │
   │  └────────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────┘      │
   │  + crossPollinate + selfHeal + autoPromoteFailedDecisions                  │
   └─────────────────────────────────────────────────────────────────────────────┘
```

---

## CoALA · semantic, episodic, procedural

The three-kind split is the foundation of every retrieval decision.

### What the three kinds mean

```ts
// lib/brain/coala.ts:27-55
export type CoalaKind = "semantic" | "episodic" | "procedural" | "unspecified";

const CATEGORY_TO_KIND: Record<string, CoalaKind> = {
  // ── PROCEDURAL · how-to · principles · workflows ──
  wisdom: "procedural",
  wisdom_candidate: "procedural",
  pattern: "procedural",
  routine: "procedural",
  prediction_lesson: "procedural",
  counter_intuitive: "procedural",
  hidden_correlation: "procedural",
  decision_manual: "procedural",
  belief: "procedural",
  // ── SEMANTIC · facts · concepts ──
  business_alert: "semantic",
  insight: "semantic",
  preference: "semantic",
  domain_knowledge: "semantic",
  contradiction: "semantic",
  wisdom_contradiction: "semantic",
  // ── EPISODIC · events · conversation snippets ──
  nick_advice: "episodic",
  conversation_summary: "episodic",
  glitch_capture: "episodic",
  daily_score: "episodic",
  device_behavior: "episodic",
  reply_judgment: "episodic",
  anomaly: "episodic",
};
```

| Kind        | What it holds                                         | Example                                                    |
|-------------|-------------------------------------------------------|------------------------------------------------------------|
| `semantic`  | Facts and concepts (**what IS true**)                 | "tire margins are 35-40%", "Cleveland tax rate 8%"         |
| `episodic`  | Events Nick experienced (**what HAPPENED**)           | "yesterday Nour asked about pricing", chat snippets        |
| `procedural`| How-to knowledge (**HOW to act**)                     | "when X, do Y because Z" — wisdom principles, workflows    |

### Query classification

```ts
// lib/brain/coala.ts:69-98
export function classifyQuery(query: string): CoalaKind | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  // EPISODIC markers · past events, time references
  if (/\b(what (did|happened)|yesterday|last (week|month|night)|earlier|recently|just (asked|said|told|talked))\b/.test(q)) {
    return "episodic";
  }
  if (/\b(remember (when|what)|recall|that (chat|convo|talk))\b/.test(q)) {
    return "episodic";
  }
  // PROCEDURAL markers · how-to questions
  if (/\b(how (do|should|can) (i|we)|what(?:'s| is) the (best|right) way|step by step|process for|workflow)\b/.test(q)) {
    return "procedural";
  }
  if (/\b(should i|what should|recommend|advice on|approach to)\b/.test(q)) {
    return "procedural";
  }
  // SEMANTIC markers · fact lookups
  if (/\b(what (is|are|was)|how much|how many|when (is|did|was)|who (is|was)|where (is|was)|what(?:'s| are) (the|my))\b/.test(q)) {
    return "semantic";
  }
  // …
  return null;
}
```

| Query                             | Classification | Bias                          |
|-----------------------------------|----------------|-------------------------------|
| "what is the tire margin?"        | semantic       | facts                         |
| "what did Nour say last week?"    | episodic       | conversation snippets         |
| "how should I respond to a complaint?" | procedural | wisdom + workflows            |

### Kind-match boost during recall

```ts
// lib/brain/coala.ts:104-111
const KIND_MATCH_BOOST = 1.20;
export function coalaKindBoost(memoryKind: CoalaKind, queryKind: CoalaKind | null): number {
  if (!queryKind) return 1.0;
  if (memoryKind === queryKind) return KIND_MATCH_BOOST;
  if (memoryKind === "unspecified") return 1.0; // don't penalize unclassified
  return 1.0;
}
```

Memories matching the query's CoALA kind get a 1.20× lift on hybrid
score during recall (see contextual-recall section below).
Conservative — doesn't override a strong semantic match.

---

## Contextual recall · the 3-lane RRF + Cohere rerank + 4k budget

This is the hot-path retrieval that runs on every non-greeting chat
turn. Entry point: `getContextualMemories(messages, max, { tokenBudget })`
in `lib/brain/contextual-recall.ts`.

### Step 1 · Extract topics + load candidate pool

```ts
// lib/brain/contextual-recall.ts:193-221
export async function getContextualMemories(
  recentMessages: string[],
  maxMemories: number = 20,
  opts: { tokenBudget?: number } = {},
): Promise<string> {
  const tokenBudget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;  // 4000
  const topics = await extractTopics(recentMessages);            // AI extract 3-8 keywords
  if (topics.length === 0) return getFallbackMemories(maxMemories);

  const queryText = topics.join(", ");
  const allMemories = await prisma.brainMemory.findMany({
    where: { confidence: { gte: 0.3 }, deletedAt: null },
    orderBy: { confidence: "desc" },
    take: 300,
    select: { id: true, category: true, key: true, content: true,
              confidence: true, createdAt: true, source: true,
              seenCount: true, updatedAt: true },
  });
```

The `deletedAt: null` filter was added v10.0.46 — pre-fix, soft-
deleted memories (retracted wisdom, superseded snapshots) were ranked
and injected into the system prompt on every chat turn.

### Step 2 · Build three score lanes

```ts
// lib/brain/contextual-recall.ts:251-274
const memScores = allMemories.map((m) => {
  let freshness = 1.0;
  // v10.0.396 · wisdom freshness decay · auto-distilled wisdoms older
  // than 90d that have low seenCount get progressively dimmer
  if (m.category === "wisdom" && !TRUSTED_SOURCES_NO_DECAY.has(m.source)) {
    const ageDays = Math.max(0, (now - new Date(m.createdAt).getTime()) / 86_400_000);
    const seenCount = m.seenCount ?? 0;
    if (ageDays > 90 && seenCount < 5) {
      freshness = Math.max(0.6, 1 - (ageDays - 90) * 0.005);
    }
  }
  return {
    ...m,
    sSemantic: useEmbeddings ? (semanticScores.get(m.id) ?? 0) : keywordScore(m, topics),
    sKeyword: keywordScore(m, topics),
    sCategory: categoryScore(m.category),
    sRecency: recencyScore(m.createdAt),
    sFreshness: freshness,
  };
});
```

Three lanes:

1. **`sSemantic`** — cosine similarity from `embedding_vec_1536`
2. **`sKeyword`** — token-overlap with extracted topics
3. **`sCategory`** — category-importance weighting
   (wisdom=0.9, business_alert=0.85, contradiction=0.85, …)

### Step 3 · Reciprocal Rank Fusion (RRF)

```ts
// lib/brain/contextual-recall.ts:277-289
const fused = fuseRankings(
  memScores,
  [
    (m) => m.sSemantic,
    (m) => m.sKeyword,
    (m) => m.sCategory,
  ],
  {
    weights: useEmbeddings ? [2.0, 1.0, 1.0] : [1.0, 1.5, 1.0],
  },
);
```

RRF (`lib/brain/rrf.ts:fuseRankings`) is the production default per
the `/hybrid-search-implementation` skill because it ignores absolute
score scales (cosine 0-1 vs keyword 0-N raw counts) and uses RANK
ordering only:

```ts
// lib/brain/rrf.ts:43-75
export function reciprocalRankFusion<T>(
  lanes: Array<RankedItem<T>[]>,
  opts: FusionOptions = {},
): Array<{ id: string; item: T; score: number; lanes: number[] }> {
  const k = opts.k ?? 60;  // literature default · TREC
  // score(d) = Σ (1 / (k + rank_i(d)))
  // …
}
```

Why RRF beats linear weighted fusion: robust to score-scale skew,
no weight-tuning required across data shifts, items in both lanes
get strong boosts naturally, items in only one lane still rank if
they're top-of-lane.

### Step 4 · Post-fusion multipliers

```ts
// lib/brain/contextual-recall.ts:296-329
const lastMsg = recentMessages[recentMessages.length - 1] ?? queryText;
const queryKind = classifyQuery(lastMsg);                              // CoALA
const queryTopics = classifyQueryTopics(lastMsg);                      // domain topics

const scored = fused.map((entry) => {
  const m = entry.item;
  const trust = sourceTrustWeight(m.source);                            // 0.70 - 1.50
  const recencyMul = 0.85 + 0.20 * m.sRecency;                          // 0.85 - 1.05
  const kindMul = coalaKindBoost(coalaKindOf(m), queryKind);            // 1.0 or 1.20
  const memoryTopics = tagWisdomTopics(m.content);
  const topicMul = topicBoost(memoryTopics, queryTopics);               // 1.0 or 1.15
  const freshness = m.sFreshness ?? 1.0;                                // 0.60 - 1.00
  const favoriteMul = favoritePersonaBoost(m.key);                      // 1.0 or 1.10 (Greene)
  const hybrid = entry.score * trust * recencyMul * kindMul
                              * topicMul * freshness * favoriteMul;
  return { …m, hybrid, semantic: m.sSemantic };
});
scored.sort((a, b) => b.hybrid - a.hybrid);
```

| Multiplier              | Range       | What it does                                             |
|-------------------------|-------------|----------------------------------------------------------|
| `sourceTrustWeight`     | 0.70 - 1.50 | curated > scrape (skill_ingestion=1.50, raw scrape=0.70) |
| `recencyMul`            | 0.85 - 1.05 | gentle recency · old not penalized harshly               |
| `coalaKindBoost`        | 1.0 or 1.20 | memory kind matches query kind                           |
| `topicBoost`            | 1.0 or 1.15 | memory and query share a domain topic                    |
| `wisdom freshness`      | 0.60 - 1.00 | 90d+ unreinforced wisdoms decay to 0.6 floor             |
| `favoritePersonaBoost`  | 1.0 or 1.10 | `wisdom_greene_*` keys get a slight lift (operator bias) |

### Step 5 · Cohere cross-encoder reranker

```ts
// lib/brain/contextual-recall.ts:340-363
if (isCohereRerankAvailable() && scored.length > 5) {
  const rerankPool = scored.slice(0, 25);
  const reranked = await cohereRerank({
    query: queryText,
    candidates: rerankPool.map((m) => ({
      item: m,
      text: `[${m.category}] ${m.content}`.slice(0, 1500),
    })),
    topN: rerankPool.length,
  }).catch(() => null);
  if (reranked && reranked.length > 0) {
    const rerankedItems = reranked.map((r) => ({
      ...r.item,
      hybrid: 0.5 + 0.5 * r.score,
    }));
    const tail = scored.slice(25);
    scored.length = 0;
    scored.push(...rerankedItems, ...tail);
  }
}
```

The production-grade RAG pattern per `/rag-implementation`:

1. RRF candidate generation (~25 candidates)
2. Cross-encoder rerank on top-K
3. Format winners

Why cross-encoder beats bi-encoder reranking (`lib/brain/cohere-rerank.ts:9-15`):
bi-encoder embeds query + doc independently and uses cosine, missing
fine-grained signals. Cross-encoder runs `(query, doc)` as a pair
through a transformer, capturing explicit relevance reasoning.
Benchmark RAG tasks see 15-30% top-3 precision lift.

Gated on `COHERE_API_KEY` — without it the function returns the input
unchanged. Cohere free tier covers 1000 reranks/month.

### Step 6-8 · Slot guarantee + budget + cross-source pull

```ts
// contextual-recall.ts:366-418 · wisdom-slot guarantee + top-3 floor
// 3 wisdom slots ALWAYS reserved; top-3 always inserted regardless of
// the 0.15 score floor (recall never returns empty even on weak scores).

// contextual-recall.ts:441-452 · token-budget trim
// Drop lowest-relevance entries until total content fits 4000 tokens
// (~16k chars). Wisdom slots preserved · operator-grade guarantee.

// contextual-recall.ts:507-619 · cross-source pull
const matches = await semanticSearch(queryText, 8, [
  "brain_dump", "reflection", "strategic_law", "chat_message",
]);
// Strong matches (sim ≥ 0.35) render with personal-anecdote framing:
//   chat_message:    "You said: ..." with "N days ago" timestamp
//   brain_dump:      "You wrote: ..." with relative date
//   reflection:      "Your weekly reflection from 5d ago: ..."
//   strategic_law:   "[Strategic Laws · sim 71%] ..."
```

Pre-v10.0.364 the cap was by **count** (`maxMemories: 20`), but each
memory's content varies 100-2000 chars — 20 memories could be 2k
tokens or 12k. Caller had no way to bound prompt size. Now: drop
lowest-relevance entries until total content fits within the budget.
Wisdom slots are preserved.

Cross-source pull (v10.0.398, v10.0.401) reaches into 4 source types
outside `brain_memory` so the model sees insight that wouldn't surface
otherwise — operator's past brain dumps + reflections + the cited
strategic laws + literal past chat replies.

---

## Memory consolidation · the nightly "sleep"

Runs as part of the evening cron via `/api/cron/auto-calibrate`. Five
stages, each idempotent so reruns don't double-count.

### Stage 1 · `mergeMemories` — combine similar memories (m-c.ts:27-120)

For each category with >3 memories: pull up to 30 by confidence,
filter `deletedAt: null` (v10.0.35), ask AI to find mergeable groups
(up to 5/category), update keeper + delete others **in a transaction**
(v10.0.34 — pre-fix `delete-with-bare-.catch` swallowed partial
failures, leaving N+1 dupes around AND inflating keeper confidence on
every cron run).

```ts
await prisma.$transaction([
  prisma.brainMemory.update({ where: { id: keeper.id }, data: {
    content: group.merged,
    confidence: Math.min(keeper.confidence + 0.15, 1.0),
    seenCount: toMerge.reduce((s, m) => s + m.seenCount, 0),
  } }),
  ...others.map((other) => prisma.brainMemory.delete({ where: { id: other.id } })),
]);
```

### Stage 2 · `promoteToWisdom` — elevate high-signal memories (m-c.ts:124-201)

```ts
const candidates = await prisma.brainMemory.findMany({
  where: { confidence: { gte: 0.8 }, seenCount: { gte: 5 },
           category: { notIn: ["wisdom", "action_frequency", "emotional_state"] } },
  take: 10,
});
// Three quality safeguards:
//   1. High bar: confidence ≥ 0.8 AND seenCount ≥ 5
//   2. gateWisdom (v10.0.416) rejects vague meta-summaries
//   3. Upsert NOT create (v11.1) — fuzzy `contains(probe)` pre-check
//      misses when content mutates → unique constraint catches collision
await prisma.brainMemory.upsert({
  where: { category_key: { category: "wisdom", key: `wisdom_from_${c.id}` } },
  create: { category: "wisdom", key: `wisdom_from_${c.id}`,
            content: `[PROVEN PATTERN] ${c.content} (confirmed ${c.seenCount}x, …)`,
            confidence: 1.0, seenCount: c.seenCount, source: "consolidation" },
  update: { /* refresh content + bump seenCount */ },
});
```

### Stage 3-7 · Prune, distill, score, cross-pollinate, self-heal

```ts
// Stage 3 · pruneNoise (m-c.ts:205-260)
//   · deleteMany expired (expiresAt < now)
//   · deleteMany stale (confidence < 0.1 AND lastSeen < 14d)
//   · dedupe action_frequency · bounded scan (500 newest, v10.0.34)

// Stage 4 · distillKnowledge (m-c.ts:264-342)
//   · pull 30d of memories with confidence ≥ 0.5 (max 50)
//   · AI extracts HIGHER-ORDER KNOWLEDGE (max 3/run)
//   · content-based key prevents per-run duplicates (v10.0.65):
//     `distilled_${today()}_${fingerprint}_${stored}`

// Stage 5 · scoreMemories (m-c.ts:346-416)
//   · EXCLUDES wisdom rows (v10.0.35 - preserves promoteToWisdom's 1.0 confidence)
//   · pre-computes connection counts via 2 grouped queries (v10.0.34)
//   · importance = recency*0.20 + frequency*0.25 + categoryWeight*0.30
//                + connectedness*0.15 + confidence*0.10
//   · only writes when |Δ| > 0.05 (avoid churn)

// Stage 6 · crossPollinate (m-c.ts:438-486)
//   · creates MemoryEdge rows: wisdom ↔ contradictions, predictions ↔ reflections
//   · token overlap ≥ 2 = shared concepts

// Stage 7 · selfHeal (m-c.ts:490+)
//   · fix orphans (category="" → "uncategorized")
//   · additional self-heal passes
```

Good distillations look like *"Nour's productivity follows a 3-day
cycle"* or *"Revenue correlates with follow-up speed more than ad
spend"*. Bad ones look like *"Things are going well"* (too vague) or
*"Nour should exercise more"* (advice, not knowledge).

---

## Anti-pattern auto-promote · the D/F decision trigger

```ts
// lib/brain/anti-pattern-auto-promote.ts:61-135
export async function autoPromoteFailedDecisions(
  sinceMs = 24 * 3600_000,
): Promise<AutoPromoteResult> {
  const recent = await prisma.masteryDecision.findMany({
    where: {
      updatedAt: { gte: since },
      grade: { not: null },
      actualOutcome: { not: null },
      deletedAt: null,
    },
    take: 100,
  });

  for (const d of recent) {
    const gn = gradeToNum(d.grade);
    if (gn === null || gn > 1) { skip; }  // grade > D → not a failure

    const key = `auto-${d.id}-${slugify(d.title || "decision")}`;
    const meta: AntiPatternMeta = {
      attempt: `Decided: "${d.chosen ?? d.title}" (stakes: ${d.stakes ?? "—"})`,
      outcome: d.actualOutcome ?? "(unreviewed)",
      severity: "warn",
      domain: mapDomain(d.domain),
      firstTriedAt: d.createdAt.toISOString(),
      lastRevisitedAt: null,
      revisitCount: 0,
      tags: ["auto-draft", `grade-${d.grade?.toLowerCase()}`, …],
    };

    // Upsert by (category="anti_pattern", key) — idempotent on rerun.
    // Bumps revisitCount when the same decision re-grades to D/F after review.
    const existing = await prisma.brainMemory.findUnique({
      where: { category_key: { category: "anti_pattern", key } },
    });
    if (existing) {
      // …merge revisitCount + lastRevisitedAt
    } else {
      await prisma.brainMemory.create({
        data: {
          category: "anti_pattern",
          key, content, metadata: meta,
          confidence: 0.8, source: "auto-promote",
        },
      });
    }
  }
}
```

| Grade  | gradeToNum | Promote?           |
|--------|-----------|--------------------|
| A, A+  | 4         | no                 |
| B      | 3         | no                 |
| C      | 2         | no                 |
| D, D+  | 1, 1.3    | **yes**            |
| D-     | 0.7       | **yes**            |
| F      | 0         | **yes**            |

Drafts get tagged `auto-draft` + `grade-d|f` so Nour can distinguish
them from hand-entered lessons in `/system/anti-patterns`. Promoting a
draft to canonical is a no-op — same row shape.

The `surfaceAntiPatterns` chat tool (see tool catalog doc) reads from
these rows so Nick can proactively warn: "you said X two weeks ago
and broke it."

---

## Conversation memory · digest + cross-session thread

Two surfaces, both in `lib/brain/conversation-memory.ts`.

### `summarizeAndStoreConversation` — post-turn digest

Triggered from `onFinish` after every chat turn with 4+ messages.

```ts
// lib/brain/conversation-memory.ts:155-285
export async function summarizeAndStoreConversation(
  conversationId: string,
): Promise<void> {
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, createdAt: true },
  });
  if (messages.length < 4) return;
  // Idempotency check — skip if already digested
  const existing = await prisma.auditEvent.findFirst({
    where: { eventType: "conversation_digest", detail: { contains: conversationId } },
  });
  if (existing) return;

  const digest = await digestConversation(conversationId, messages);
  // …
}
```

The `digestConversation` AI call extracts:

```ts
// lib/brain/conversation-memory.ts:25-44
interface ConversationDigest {
  conversationId: string;
  date: string;
  messageCount: number;
  topics: Array<{ topic: string; depth: "mentioned" | "discussed" | "deep_dive" }>;
  decisions: Array<{ decision: string; stakes: "low" | "medium" | "high"; resolved: boolean }>;
  commitments: Array<{ what: string; who: "nour" | "nick" | "other"; deadline: string | null }>;
  actionItems: string[];
  emotionalArc: {
    start: string; end: string;
    trajectory: "improving" | "declining" | "stable" | "volatile";
    triggers: string[];
  };
  peopleMentioned: Array<{ name: string; context: string; sentiment: "positive" | "neutral" | "negative" }>;
  keyInsight: string | null;
  followUpNeeded: string | null;
  relatedConversations: string[];
}
```

Two destinations on every digest:

1. **`AuditEvent` (eventType=`conversation_digest`)** — legacy consumers
   read from here. v10.0.35 PII fix: `peopleMentioned` is stripped
   from the audit payload (names + relational context). The data
   lives in `PersonProfile` where it belongs.
2. **`BrainMemory(category=conversation_summary, key=conv_<id>)`** —
   contextual recall + the embedding pipeline can surface this in
   future system prompts. Embedded async via
   `storeMemoryEmbedding(mem.id, ...)`.

The summary content shape:

```
[conversation 2026-05-12] topics: tasks, drift. key: hiring is the bottleneck. decisions: high:will post job ad this week. emotional arc: improving
```

People extraction also upserts `PersonProfile` with name + context +
sentiment-derived trust score.

### `detectCrossSessionThread` — pre-turn context inject (c-m.ts:389-442)

Triggered from `auxPromise` (chat route stage C2). Pulls 5 sources in
parallel (15 digests + 10 commitments + 10 tasks + 20 people + 5
pending predictions), asks AI: *"Find ANY connection between
user_message and these 5 sources. Don't force connections. Return
`[]` if nothing matches. Max 3 connections."*

The returned context block (capped at 1000 chars) gets prepended as
`# CROSS-SESSION THREAD`. Sample output:

```
[ACTIVE COMMITMENT: 2026-05-08] You committed to posting the job ad by Friday.
[KNOWN PERSON: Mo] Current tech, reliable, positive sentiment.
[PAST THREAD: 2026-05-10] Discussed hiring bottleneck.
```

---

## Conversation recall · semantic over past summaries

`lib/brain/conversation-recall.ts:findRelatedConversations` (v10.0.524)
powers the `findRelatedConversations` chat tool. Pattern mirrors
skill-recall:

```ts
// conversation-recall.ts:78-154
const queryVec = await embedQuery(query);  // 60s TTL cache · 100 entry LRU
const memories = await prisma.brainMemory.findMany({
  where: { category: "conversation_summary", deletedAt: null,
           key: excludeConversationId ? { not: `conv_${excludeConversationId}` } : undefined },
  orderBy: { updatedAt: "desc" }, take: 500,
});
const embeddings = await prisma.vectorEmbedding.findMany({
  where: { sourceType: "brain_memory", sourceId: { in: ids } },
});
// Cosine similarity in JS · floor 0.32 · sort desc · top-K
```

Used by the `findRelatedConversations` chat tool +
`/api/ai/chat/related-conversations` endpoint. Could delegate from
`detectCrossSessionThread` instead of doing its own pull (refactor
opportunity).

---

## Wisdom packs ingestion path

Pre-curated wisdom (Jobs / Greene / Buffett / Munger / Naval / Bezos /
Musk / Satori / 189 Greene Laws) lives in `lib/brain/skill-extractor.ts`
+ docs under `docs/wisdom-packs-*.md`.

Ingestion flow:

```
docs/wisdom-packs-*.md            (curated source files)
       │
       ▼
scripts/ingest-wisdom-pack.ts     (manual one-shot)
       │
       ▼
brainMemory.remember({
  category: "wisdom",
  key: `wisdom_greene_${number}_${slug}`,
  source: "skill_ingestion",       (TRUSTED · bypasses freshness decay)
  confidence: 1.0,
})
       │
       ▼
storeMemoryEmbedding(id, content)  (async, fire-and-forget)
       │
       ▼
VectorEmbedding(sourceType="brain_memory", sourceId=mem.id)
```

The `source: "skill_ingestion"` tag is critical:

- `SOURCE_TRUST_WEIGHT.skill_ingestion = 1.50` (highest)
- `TRUSTED_SOURCES_NO_DECAY` includes `skill_ingestion` — these
  timeless principles bypass the 90d freshness decay
- The wisdom-quality-gate in `brainMemory.remember` short-circuits on
  `operatorTrusted` sources

Greene laws also get the `favoritePersonaBoost` (1.10×) per v10.0.397
when keyed as `wisdom_greene_*`.

---

## Skill recall · the 1,423-skill layer

Separate module: `lib/skills/skill-recall.ts` (not under `lib/brain/`
but functionally part of the recall stack).

```
data/skills-registry.json           (1,423 skills + summaries + embeddings)
       │
       ▼
recallSkills(query, topK)
  ├─ Query embedding (60s cache)
  ├─ Cosine similarity over the registry vec
  ├─ Filter by similarity floor
  └─ Return top-K with similarity score
```

Two surfaces:

1. **`searchSkills` chat tool** — explicit lookup
2. **`lib/skills/skill-context.ts`** — auto-injects top-K relevant
   skill summaries into the system prompt per turn

The mechanism is the same as `conversation-recall`: cosine over
JSON-stored embedding vectors, no pgvector dependency. ~250ms warm
lookup over 1,423 skills.

---

## Layer interactions

**Chat turn read paths** (route.ts loads these in parallel):
- `contextual-recall` → RRF over [semantic, keyword, category] + CoALA boost + Cohere rerank + cross-source pull (brain_dump, reflection, strategic_law, chat_message)
- `conversation-memory.detectCrossSessionThread` → AI synthesizes from {digests, commitments, tasks, people, predictions}
- `conversation-recall` (chat tool only) → semantic over conversation_summary brain rows
- `skill-recall` (auto-inject + chat tool) → semantic over 1,423-skill registry
- `brain-context` (chat route stage D5) → 7 modules parallel · rerank by similarity:
  skill-extractor · identity-snapshot · ghost-nick · qualitative-identity · belief-harvester · cross-system-nudge · contradiction-surfacer

**Chat turn write paths** (`onFinish` in persist-assistant-turn.ts):
- `processConversation` (pipeline-controller)
- `summarizeAndStoreConversation` → `AuditEvent(conversation_digest)` + `BrainMemory(conversation_summary, key=conv_<id>)` + `storeMemoryEmbedding` → `VectorEmbedding(brain_memory)` + `PersonProfile` upsert per person
- `maybeAutoRename` + `runPeopleIntelligence`

**Nightly cron** (`/api/cron/auto-calibrate`):
    ├─ pruneNoise
    ├─ distillKnowledge
    ├─ scoreMemories
    ├─ crossPollinate  ──→  MemoryEdge
    ├─ selfHeal
    └─ autoPromoteFailedDecisions  ──→  BrainMemory(anti_pattern)
```

---

## Common seams future-Nour will look for

| Question                                                  | File · symbol                                              |
|-----------------------------------------------------------|------------------------------------------------------------|
| Where do I add a new memory category?                     | `lib/brain/categories.ts:BRAIN_CATEGORIES`                 |
| Where do I tune recall scoring weights?                   | `lib/brain/contextual-recall.ts:SOURCE_TRUST_WEIGHT` etc.  |
| Where do I add a new CoALA kind classification?           | `lib/brain/coala.ts:CATEGORY_TO_KIND`                      |
| Where do I add a new cross-source search type?            | `lib/brain/contextual-recall.ts:appendCrossSourceContext`  |
| Where do I add a new consolidation stage?                 | `lib/brain/memory-consolidation.ts` (add export + cron job)|
| Where do I tune the wisdom quality gate?                  | `lib/brain/wisdom-quality-gate.ts:gateWisdom`              |
| Where do I add a new anti-pattern trigger?                | `lib/brain/anti-pattern-auto-promote.ts:autoPromoteFailedDecisions` |
| Where do I add a new conversation digest field?           | `lib/brain/conversation-memory.ts:ConversationDigest`      |
| Where do I tune cross-session source weights?             | `lib/brain/conversation-memory.ts:detectCrossSessionThread`|
| Where do I add a new wisdom pack?                         | New `docs/wisdom-packs-*.md` + `scripts/ingest-wisdom-pack.ts` |

---

## Pitfalls

1. **`deletedAt: null` filters are load-bearing.** Pre-v10.0.46
   soft-deleted memories leaked into recall on every chat turn. Every
   new query against `brainMemory` MUST include
   `where: { …, deletedAt: null }`.
2. **Wisdom rows are protected.** `scoreMemories` excludes
   `category: "wisdom"` (v10.0.35) because dynamic importance scoring
   was downgrading the 1.0 confidence set by `promoteToWisdom`. The
   3 wisdom slots in contextual-recall are ALWAYS preserved.
3. **Idempotency requires upsert** not create-with-fuzzy-precheck.
   v11.1 fixed `promoteToWisdom` after `contains(probe)` missed when
   content mutated between runs.
4. **Bounded scans matter.** `pruneNoise` pulls 500 newest
   `action_frequency` rows, not all of them. `scoreMemories` uses
   `take: 100` + 2 grouped queries instead of 100 sequential count()
   round-trips that timed out the 60s cron limit.
5. **Source-trust weights skew curated > scraped.** When inspecting
   recall hits in `/brain/recall`, remember
   `skill_ingestion=1.50` and `wisdom_sync_cron=0.70` — same content
   ranked very differently by provenance.
6. **Cohere rerank gracefully degrades.** Missing `COHERE_API_KEY` is
   not an error — `isCohereRerankAvailable()` returns false and the
   RRF order stands.
7. **The conversation_summary BrainMemory key prefix is the contract.**
   `conv_<conversationId>` lets `conversation-recall` extract the id
   from the key. Don't rename it.
