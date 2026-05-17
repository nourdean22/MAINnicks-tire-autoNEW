# ADR-0002 · CoALA cognitive architecture · 3-lane recall

**Status:** Accepted
**Date adopted:** v10.0.367 (2026-05-06)
**Backfilled:** 2026-05-07 (v10.0.450)

## Context

By v10.0.300 the brain layer had grown to ~700 wisdoms (now 991 at
v10.0.385). Single-lane semantic recall (cosine similarity on a flat
embedding pool) was producing two failure modes:

1. **Recency loss** — high-similarity old wisdoms dominated retrieval,
   even when the user's question was about something that happened
   yesterday and the relevant context was a recent reflection.
2. **Procedural drowning** — operational patterns ("how do I run X"
   tool sequences) were getting outcompeted by philosophical wisdoms
   on the same query embedding, because the wisdoms had longer +
   richer text and won on semantic density.

Nick needed a memory architecture that distinguished:

- *What I know* (timeless principles · Greene's laws · Buffett wisdoms)
- *What recently happened* (last week's revenue dip · yesterday's
  decision · today's failed callback)
- *How I do things* (the 3-step deploy sequence · the daily journal
  cron schedule · the tire-stock lookup pattern)

Single-lane retrieval forced these into the same priority pool. The
retrieval was correct on average but consistently wrong at the
margins where Nick is most needed.

## Decision

Adopt the **CoALA** (Cognitive Architectures for Language Agents)
3-lane memory model with separate retrieval pipelines:

1. **Semantic lane** · `BrainMemory` rows tagged as wisdom, principle,
   or framework. Time-agnostic. Retrieved via embedding cosine on the
   user's query.
2. **Episodic lane** · `BrainMemory` rows tagged as reflection,
   correlation, observation. Time-decayed (older entries lose recall
   weight). Retrieved via embedding cosine + recency bonus.
3. **Procedural lane** · `BrainMemory` rows tagged as decision-pattern,
   tool-sequence, runbook. Retrieved via embedding cosine on the
   user's intent (what they're trying to *do*, not what they're
   asking about).

Each lane retrieves its own top-K. Then **RRF (Reciprocal Rank Fusion
· v10.0.361)** combines them into a single ranked list. The combined
list goes through **Cohere cross-encoder reranking · v10.0.363** for
final precision, then a **token-budget enforcer · v10.0.364** caps
the injected context at ~4K tokens.

## Consequences

**Positive:**

- Recall quality measured by the v10.0.366 LLM-as-judge has improved
  along the *evidence* axis (5-axis rubric · accuracy / actionability /
  brevity / tone / evidence). Recent-context questions now retrieve
  the relevant reflection instead of an old aphorism.
- Procedural memories surface predictably on "how do I" intents.
- Token budget stays bounded even as the wisdom corpus grows
  (991 → 2000+ would not break the recall layer).
- Each lane can be tuned independently. Wisdom-quality work
  (curation, distiller gates) doesn't fight with reflection-decay
  work (recency weighting).

**Negative:**

- 3 retrieval queries per turn (vs 1) — added latency. Mitigated by
  parallel execution (`Promise.all`) and Anthropic prompt caching on
  the system prompt prefix (ADR-0005).
- Cross-lane dedup is currently UNVERIFIED at runtime — the same
  `BrainMemory` row could be retrieved by the semantic AND episodic
  lanes if its tags overlap. Open question from the v10.0.444 prompt
  audit · needs runtime check.
- Lane assignment depends on category tagging at write-time. Bad
  categorization → wrong lane → wrong recall priority. Mitigated by
  the v10.0.356 distiller quality gate (3 rejection criteria) but
  not eliminated.

## Alternatives considered

- **Single lane with bigger embedding** — rejected. The recency-vs-
  principle conflict is conceptual, not solvable by more dimensions.
- **Manual category-aware boost factors** — rejected as brittle. RRF
  with separate queries is more principled and tunable.
- **Knowledge graph (entity-relation)** — rejected for now on
  complexity grounds. CoALA fits the existing `BrainMemory` table
  shape; a graph would require new infrastructure for marginal gain.
- **Pinecone or other managed vector DB** — rejected. pgvector +
  HNSW indexing on Neon Postgres is sufficient for 1k-100k embeddings.
  See ADR-0003 (deferred · pgvector decision).

## References

- `lib/ai/context/nick-prime-context.ts` — prime context assembly
- `lib/ai/context-reranker.ts` — Cohere cross-encoder reranking
- `lib/ai/budget.ts` — token budget enforcement
- `lib/brain/wisdom-distiller.ts` — semantic-lane curation
- `lib/brain/reflection-engine.ts` — episodic-lane decay
- `lib/brain/decision-patterns.ts` — procedural-lane tagging
- v10.0.361 commit · RRF
- v10.0.363 commit · Cohere reranker
- v10.0.367 commit · CoALA architecture introduction

## Related decisions

- ADR-0003 (deferred) · pgvector + Cohere reranker over managed
  vector DB
- The BDI overlay (v10.0.360 · belief / desire / intention /
  observation) layers on top of CoALA — BDI shapes how the AI uses
  the memory; CoALA shapes how the memory is structured.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
