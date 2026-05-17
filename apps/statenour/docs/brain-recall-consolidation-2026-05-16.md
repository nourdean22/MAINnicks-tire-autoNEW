# Brain Recall Consolidation Roadmap · 2026-05-16

> **Status**: Wave 80 audit · written by parallel code-explorer agent · v10.0.529.106.
> **Companion**: `docs/NEXT-EVOLUTION-2026-05-16.md` (full roadmap).

## TL;DR

The audit found **6 recall pipelines** (not 5 as flagged) in lib/brain + lib/skills. **2 of them genuinely overlap and should merge** (`contextual-recall` + `memory-recall` · both fire on every chat turn, both inject memory content into the system prompt, hit overlapping data). **3 should stay separate** (each serves a genuinely different purpose: cross-session conversation lookup · cached-question prediction · skills retrieval). **One 2-line dedup** between `chat-recall` and `contextual-recall` is worth doing.

Consolidation is **medium-complexity, high-value**: eliminates 1 redundant embedding call per turn, removes 200-400 duplicate chars from every non-greeting system prompt, reduces the live-turn pipeline count from 3 → 1 canonical + 1 chat-exchange companion.

## The 6 pipelines today

### 1. Contextual Recall · `lib/brain/contextual-recall.ts:193` · CANONICAL TARGET
- **Entry**: `getContextualMemories(recentMessages, maxMemories=20, opts={ tokenBudget? }): Promise<string>`
- **Reads**: BrainMemory (300 rows, conf ≥ 0.3) via VectorEmbedding cosine. Then `appendCrossSourceContext` fans out to brain_dump + reflection + strategic_law + chat_message via `semanticSearch`. Then `appendRelatedContext` hits Commitment + Task + PersonProfile.
- **Ranks by**: 3-lane RRF (semantic 2x + keyword 1x + category-importance 1x) → 6 post-fusion multipliers (source-trust + recency + CoALA kind + topic-domain + wisdom freshness + Greene 1.1x) → optional Cohere cross-encoder rerank on top-25.
- **Budget**: 4000 tokens enforced · 3 wisdom slots always preserved.
- **Callers**: `app/api/ai/chat/route.ts:447` (inside auxPromise, parallel to prompt build · sliced 1000-2000 chars, injected as `# CONTEXT MEMORIES`). `scripts/smoke-ai-chain-full.ts:143`.
- **Fires when**: Every turn > 10 chars. Parallel, result awaited before stream.

### 2. Memory Recall · `lib/brain/memory-recall.ts:85` · MERGE INTO #1
- **Entry**: `recallMemoriesForQuery(query, opts={limit?, embedding?}): Promise<RecallReport>`
- **Reads**: Raw SQL KNN — `vector_embeddings JOIN brain_memories via embedding_vec_1536 <=> $1::vector`, wrapped in `withEfSearch(HIGH_RECALL=80)`. Category whitelist (18 types). Top 30 then re-scored.
- **Ranks by**: HNSW cosine KNN → JS: `sim + recency(0.2/0.1/0) + confidence×0.3`. No RRF, no cross-encoder.
- **Budget**: 5 hits (standard) / 8 (deep), 220 chars/hit. No token enforcement.
- **Callers**: `app/api/ai/chat/route.ts:513` (inside recallPromise, uses pre-computed userEmbedding · injected as `# Recently relevant memories`). `app/api/brain/recall/route.ts:26,44`. `app/api/brain/provenance/[messageId]/route.ts:47`.
- **Fires when**: Every turn > 10 chars · parallel to everything else · appended AFTER `contextMemories` in the prompt.

**Critical overlap**: Pipelines #1 and #2 both fire on every standard chat turn and both append memory content to the system prompt independently. Plus pipeline #2 hits chat_message embeddings inside #1's appendCrossSourceContext on the same turn that pipeline #3 (chat-recall) also hits. Triple overlap.

### 3. Chat-Exchange Recall · `lib/brain/chat-recall.ts:209` · STAYS · 2-line dedup needed
- **Entry**: `buildChatRecallBlock(queryText, limit=5): Promise<string>`
- **Reads**: `semanticSearch(query, 20, ["chat_message"])` → batch-hydrates ChatMessage turn pairs. `buildChatContinuityBlock` reads recent ChatConversation titles.
- **Ranks by**: similarity × 0.8 + recencyScore(ageDays) × 0.2. Floor 0.42. De-duped by conversationId.
- **Budget**: 5 exchanges (6 in deep), 180 chars/side. Block ≈ 1.5KB.
- **Callers**: `lib/services/chat/brain-context.ts:144` · one of 7 parallel blocks in `buildBrainContext`. Reranked by `rerankContextBlocks` (0.12 sim drop threshold) before final injection.
- **Fires when**: Every turn via `buildBrainContext`.

### 4. Conversation-Summary Recall · `lib/brain/conversation-recall.ts:78` · STAYS
- **Entry**: `findRelatedConversations(query, topK=5, excludeConversationId?)`
- **Reads**: BrainMemory (category=conversation_summary, up to 500 rows) → VectorEmbedding. JS cosine. Floor 0.32.
- **Ranks by**: Pure cosine. Hard cap 10.
- **Budget**: Returns structured array · NOT auto-injected.
- **Callers**: `lib/ai/tools.ts:354` (model-invoked `findRelatedConversations` tool). `app/api/ai/chat/related-conversations/route.ts:38`.
- **Fires when**: Only on explicit model tool call.

### 5. Anticipated-Question Recall · `lib/brain/anticipated-questions.ts:571` · STAYS
- **Entry**: `findAnticipated(userQuery, opts={allowStale?}): Promise<AnticipatedMatch | null>`
- **Reads**: Single BrainMemory row (category=anticipated_question, key=anticipated_YYYY-MM-DD). Embeds user query + 3 predicted questions at match time, cosine compare. Floor 0.85.
- **Ranks by**: Cosine only. Returns single best match or null.
- **Budget**: Single match, answer capped at 3000 chars in system prompt.
- **Callers**: `app/api/ai/chat/route.ts:1304` · fires near end of request assembly (AFTER `buildBrainContext`). Prepends `# ANTICIPATED-QUESTION HIT` block to `finalSystemPrompt` when sim ≥ 0.85.
- **Fires when**: Every non-precompute chat turn. Falls through silently when no match.

### 6. Skill Recall · `lib/skills/skill-recall.ts:129` · STAYS
- **Entry**: `recallSkills(query, topK=5): Promise<SkillMatch[]>`
- **Reads**: `data/skills-registry.json` (1,423 skills, 1h cache) + VectorEmbedding (sourceType=skill). JS cosine. Floor 0.30. Cap 10.
- **Ranks by**: Pure cosine. No recency, no category weighting.
- **Budget**: Top 3 auto-injected via `skill-context.ts`. Up to 10 via `searchSkills` tool.
- **Callers**: `lib/skills/skill-context.ts:55` → `buildSkillsContextBlock` → `buildBrainContext` (one of 7 parallel blocks). `lib/ai/tools.ts:314,2265`, `app/api/skills/suggest/route.ts:36`.
- **Fires when**: Every chat turn via `buildBrainContext`. Also model-invoked.

## What can SAFELY merge

**Pipelines 1 + 2 → Pipeline 1 as canonical.**
- `contextual-recall` already has pgvector fast-path via `semanticSearch` → `pgvectorSemanticSearch`.
- The only genuine things `memory-recall` adds: (a) pre-computed embedding passthrough · (b) `withEfSearch(HIGH_RECALL)`.
- Both are one-line additions to `getContextualMemories`.
- After that, `recallMemoriesForQuery` becomes a thin format-adapter over `getContextualMemories` · the route eliminates its `recallPromise` + second system-prompt section.

**Chat_message overlap dedup between Pipeline 1 + Pipeline 3.**
- Pass already-seen conversationIds from `buildChatRecallBlock`'s result into `appendCrossSourceContext`'s chat_message filter.
- 2-line fix.

## What should STAY separate

- **Pipeline 4** (`findRelatedConversations`): Model-invoked only · different data (conversation summaries, not memory rows) · different use case (explicit cross-session lookup vs implicit context injection).
- **Pipeline 5** (`findAnticipated`): Cached-prediction lookup · not retrieval · 0.85 floor exists specifically to avoid false triggers.
- **Pipeline 6** (`recallSkills`): Completely different data source + slot budget · skills ≠ memories.

## Recommended canonical path

**Keep**: `getContextualMemories(recentMessages, maxMemories=20, opts={ tokenBudget?, embedding? })` from `lib/brain/contextual-recall.ts`.

Add to its opts:
- `embedding?: number[]` (pre-computed · removes one `getEmbedding` per turn)
- `efSearch?: number` (passed through to underlying pgvector knnSearch)
- `excludeChatConversationIds?: string[]` (for the chat_message dedup)

## Migration sequence · 7 steps · safest first

1. Add `embedding?: number[]` to `getContextualMemories` opts · zero behavioral change · removes one getEmbedding call per turn.
2. Thread `withEfSearch(HIGH_RECALL)` into `semanticSearch`'s pgvector path via optional `efSearch` param · absorbs memory-recall's pgvector advantage.
3. Deduplicate chat_message hits: pass `chatRecall` conversationIds into `appendCrossSourceContext` exclusion set · 2-line fix.
4. Make `recallMemoriesForQuery` a thin wrapper over `getContextualMemories` · keeps provenance/recall API surface intact.
5. Remove `recallPromise` from chat route · unify the two separate prompt sections into one `# BRAIN CONTEXT` block with the single `getContextualMemories` result. Regression test before shipping.
6. Confirm `app/api/brain/recall/route.ts` + `app/api/brain/provenance/[messageId]/route.ts` still work via the thin wrapper.
7. (Optional · lower priority) Delete `memory-recall.ts` after a 1-sprint stabilization window.

## Risk callout

- The two duplicate prompt sections may be carrying subtly different content the operator has come to expect. Step 5 is the ONLY step with behavioral risk · regression eval needed before shipping.
- Cross-encoder reranker (Cohere) in pipeline 1 sometimes downgrades or filters results the simpler pipeline 2 ranking would surface. Operator may notice "Nick used to remember X" if a rerank tier removes it.
- The `excludeChatConversationIds` dedup in step 3 needs to be additive-only · do NOT filter out a conversation that's the canonical home for the matched fact.

## Estimated leverage

- 1 fewer embedding call per chat turn (cost saving)
- 200-400 fewer duplicate chars in every non-greeting system prompt (cost saving + cache hit improvement)
- 1 fewer module to maintain (`memory-recall.ts` deletable after stabilization)
- Single canonical recall path for all future feature work

## Essential files

- `lib/brain/contextual-recall.ts` · canonical target
- `lib/brain/memory-recall.ts` · to be absorbed
- `lib/brain/chat-recall.ts` · stays · dedup step only
- `lib/brain/conversation-recall.ts` · untouched
- `lib/brain/anticipated-questions.ts` · untouched
- `lib/skills/skill-recall.ts` · untouched
- `lib/services/chat/brain-context.ts` · step 3 touch
- `app/api/ai/chat/route.ts` · steps 4-6 (lines 447, 513, 816, 882, 1304)
- `lib/brain/embedding-utils.ts` · step 2 (pgvectorSemanticSearch)
- `lib/db/pgvector.ts` · step 2 (knnSearch efSearch param)
- `app/api/brain/recall/route.ts` · verify step 6
- `app/api/brain/provenance/[messageId]/route.ts` · verify step 6
