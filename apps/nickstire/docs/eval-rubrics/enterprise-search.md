# Enterprise Search & Retrieval

**Skill port:** A7 · enterprise-search + the hybrid-search-rebuild (audit #317 / PORT 6)
**Applies to:** statenour `/brain` · `/journal` retrieval · operator nudge inbox · agent context-fetch · future MCP server exposing brain to external tools.
**Authored:** 2026-05-26.

## Why this doc exists

The operator's brain (statenour `brain_memory` + `journal_entries` + `mission_history` + ADRs + RECONCILIATION docs) grows ~10-50 entries/day. By month 6 the search-recall is the bottleneck · operator can't find the entry they wrote · agent can't surface the right context · the brain becomes write-only.

Pure vector search (current state) gets ~60% recall on operator queries. The HF rerankers from Wave AC + a proper hybrid pipeline + the discipline below pushes that to 85%+. This doc codifies the retrieval contract.

## The 4-stage retrieval pipeline

Every brain query goes through 4 stages. Each stage filters or reranks · the final stage produces ≤5 candidates the agent (or operator) actually reads.

### Stage 1 · BM25 lexical (cast wide · fast · keyword-aware)

Library · sqlite-fts5 OR Postgres ts_vector OR Elasticsearch · whatever the platform supports.

**Input** · operator query (3-20 words usually).
**Output** · top 100 candidates by lexical match score.
**Latency budget** · <50ms.
**Why first** · BM25 catches exact-match phrases vector search misses (e.g. "PORT 6 #317" · "wave 181.60" · proper nouns · acronyms). Pure-vector ranks these arbitrarily.

### Stage 2 · Vector retrieve (semantic · catches synonyms + paraphrase)

Library · pgvector + an embedding model (currently OpenAI text-embedding-3-small · target BGE-large via Wave AC).

**Input** · same operator query · embedded via the SAME model the corpus was embedded with (DON'T mix · re-embed corpus on model swap).
**Output** · top 100 candidates by cosine similarity.
**Latency budget** · <100ms (depends on index size · IVFFLAT with `lists = sqrt(rows)` keeps it under).
**Why second** · vector catches "the operator wrote about X using different words" · operator's query "lead getting stuck" matches a memory written as "customer dormant after estimate."

### Stage 3 · Union + dedup (merge the two lists)

**Algorithm** · reciprocal rank fusion (RRF) · for each candidate, score = `1/(60+rank_bm25) + 1/(60+rank_vec)` · re-rank.

Outputs top 25 candidates after fusion. Each has a `score` + a `provenance` flag (bm25-only · vec-only · both).

Provenance matters for debugging · "vec-only" results that turn out wrong indicate the embedding model needs tuning.

### Stage 4 · Cross-encoder rerank (precision · the recall winner)

Library · `BAAI/bge-reranker-v2-m3` (Wave AC Cat 2) OR `cross-encoder/ms-marco-MiniLM-L-12-v2` (lighter · faster).

**Input** · 25 candidates from Stage 3 + original query.
**Output** · top 5 with cross-encoder scores.
**Latency budget** · <200ms (CPU · or <50ms on HF Inference API).
**Why last** · cross-encoders see query AND candidate together · they catch semantic mismatch that BM25 + bi-encoder vector both miss. The recall jump from this stage is 15-25 percentage points.

## The metadata + filter discipline

Retrieval without filters is a lottery. Every brain entry MUST carry:

| Field | Purpose |
|---|---|
| **kind** | `brain_memory` · `journal_entry` · `adr` · `reconciliation` · `audit_finding` · `wave_log` |
| **created_at** | for time-decay filter (recent ones surface higher by default) |
| **operator_state** | per `operatorStateSnapshot` · for context-match boost (cross-ref task-intelligence.md) |
| **tags** | free array · the operator's organic categorization |
| **wave_id** | links to which build wave produced it · for "what was open during wave 181.X" queries |
| **confidence** | the writer's own self-rated 0-1 · low-confidence entries deprioritized |

Filters get APPLIED BEFORE stages 1-2 · not AFTER. Filter first · search the filtered subset · saves both latency and recall.

## The query-rewrite layer (optional but high-leverage)

Operators write terse queries. Agents write structured queries. Both benefit from a rewrite step BEFORE Stage 1.

**Pattern** · LLM rewrites operator query into 3-5 query variants · run each through the 4-stage pipeline · union the top-5 from each · cross-encoder rerank the union to final top-5.

Example:
- Operator types · "why did sms break Tuesday"
- Rewrites · `["SMS gateway failure 2026-05-XX Tuesday", "F25e SMS outbound error Tuesday", "twilio fallback Tuesday"]`
- Each rewrite hits the pipeline · final cross-encoder picks the best 5 across all 3 result sets

Cost · 1 extra LLM call (cheap on a 3B model · cross-ref HF Wave AC Cat 7 self-hosted Llama).
Latency · adds ~300ms · acceptable for non-realtime.

DON'T use this for agent context-fetch (latency-sensitive) · DO use it for /brain/search operator-facing surfaces.

## The "recent" tradeoff (time-decay)

Operator wants recent entries surfaced higher by default — but exact-match queries should NOT be time-decayed (the 6-month-old ADR is still relevant for that query).

**Rule** · time-decay applies to Stage 3 fusion score · NOT Stage 1 BM25 or Stage 4 cross-encoder.

```
final_score = fusion_score * (1 + 0.3 * recency_factor)
recency_factor = exp(-age_days / 90)  // half-life 90 days
```

Operator can toggle "no time-decay" if they're searching archives. Default is on.

## Anti-patterns

### "Pure-vector search"

The starting point of most brain stacks · misses 30-40% of recall. Always add BM25 + reranker before declaring the pipeline shipped.

### "Re-embedding inconsistency"

If the embedding model changes (Wave AC OpenAI → BGE), the ENTIRE corpus must be re-embedded. Mixing models in pgvector produces silent-mode failure · scores look fine but the geometry is meaningless.

### "Generic prompt to LLM with all candidates"

After retrieval, some skills paste ALL 25 candidates into a Claude prompt. That's $$$ and slow. Pass only the top 5 (post cross-encoder) PLUS the user query. Context-window discipline.

### "Filter after search instead of before"

`SELECT * FROM brain WHERE date > X` first · THEN run BM25 on that subset. Doing it the other way wastes recall · top 100 by BM25 might all be older than X, then the filter leaves 0.

### "No relevance signal in storage"

Every retrieval response should ship back `{ candidate, score, provenance }` · NOT just the raw text. Without scores, the consumer can't tell how confident the retrieval was · the consumer either trusts all 5 (wrong) or trusts none (also wrong).

### "Snapshot-and-forget"

The corpus changes daily. The vector index needs reindexing schedule · OR an upsert pattern. Without it, new entries are invisible. Worse · without monitoring, the operator doesn't know the index is stale.

## The MCP-expose play (future)

Once the 4-stage pipeline is solid, expose `searchBrain(query, filters)` as an MCP tool · any external agent (Claude Desktop · third-party tool · operator's phone shortcut) can search the brain without re-building retrieval.

This is the A7 enterprise-search × A2 agent-ready-apis × PORT 5 MCP server intersection · one canonical retrieval tool, multiple consumers.

## Implementation plan (queued)

1. **Audit current retrieval** · grep statenour for `pgvector` + `embed` + `searchBrain` calls · catalog current shape
2. **Drop BGE rerankers in** · cross-ref Wave AC Cat 2 · add Stage 4 to existing pipeline
3. **Add BM25 stage** · Postgres `ts_vector` is the lowest-friction path · OR opt into Tantivy/Quickwit for richer lexical
4. **Schema migration** · add `metadata jsonb` column to `brain_memory` if not present · backfill `kind/tags/operator_state/wave_id/confidence` for old entries
5. **RRF fusion module** · `apps/statenour/lib/ai/search-hybrid.ts` · the canonical 4-stage pipeline
6. **Query-rewrite (optional)** · `apps/statenour/lib/ai/query-rewrite.ts` · gated behind `BRAIN_SEARCH_REWRITE=true` flag
7. **Metrics + eval** · log every retrieval · operator-rated 0-5 satisfaction on /brain search · weekly recall@5 dashboard
8. **MCP exposure** · once Stage 1-4 ship + recall@5 > 0.85, expose `searchBrain` as MCP tool · external agents consume

## Skill-port lineage

A7 from the audit's Round 2 + PORT 6 hybrid-search rebuild from audit #317. Pairs with:
- `docs/eval-rubrics/huggingface-model-strategy.md` Cat 2 (the rerankers · this doc is where they live in the pipeline)
- `docs/eval-rubrics/agent-ready-apis.md` (the contract layer · `searchBrain` becomes a public agent tool)
- `docs/eval-rubrics/tool-builder-patterns.md` (the discipline of how `searchBrain` MCP tool gets designed)
- `docs/eval-rubrics/task-intelligence.md` (the operator-state metadata signal feeds context-match boost)
- statenour `/brain` + `/journal` surface (the operator-facing consumer)

Future · the retrieval pipeline becomes a public-facing capability for nickstire customers · "ask Nick's brain anything about your car" · the consumer-facing chat surface uses the same 4-stage pipeline · trained on the operator's expertise corpus.
