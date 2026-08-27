# Retrieval baseline — 2026-08-27

The brain's retrieval had **no recall metric anywhere** — every ranking multiplier is a stated
prior (recall-eval.ts's own header says so). This document is the first measurement: what
retrieval actually runs per chat turn, what it returns on a labelled corpus of real operator
queries, and where the losses are. Method and receipts inline; re-measure before trusting any
number that has aged. The eval corpus and per-case artifacts live in `eval-datasets/`
(**gitignored — real personal content; aggregates only in this doc**).

## Method

- **Corpus:** 28 labelled cases (`eval-datasets/recall-corpus.json`), queries taken verbatim from
  the operator's chat turns where possible ("hows my mental state been?", "dont u have my
  biography?", "cant u see my health data?"), each mapped to the `brain_memories.key`(s) whose row
  answers it. Slices: health 7 · business 6 · relationships 4 · identity 4 · event 4 · routine 2 ·
  preference 1. **Denominator honesty:** this corpus measures the durable/personal layer — the
  operator's dominant real usage — not wisdom/ephemera recall.
- **Harness:** `eval-datasets/run-baseline.ts` — runs the REAL production functions
  (`semanticSearch`, `getLexicalMatches`, `recallMemoriesForQuery`, `getContextualMemories`,
  `reciprocalRankFusion`) against prod Neon, read-only by verified construction: every write
  method those paths fire-and-forget (lastSeen bumps, SystemMetric, AgentTrace) is stubbed on the
  prisma singleton and the stub is sentinel-verified before any lane runs; the run aborts if a
  stub does not stick. 75 write calls were intercepted across the run.
- **Metric:** hit@k = fraction of cases with ≥1 relevant key in the top k. MRR over first
  relevant rank.

## Baseline numbers (n=28, k=10, run 2026-08-27)

| Lane | What it is | hit@5 | hit@10 | MRR | p50 |
|---|---|---|---|---|---|
| A · dense full-corpus KNN | `semanticSearch` — pgvector HNSW over all embedded rows | **39%** | 39% | 0.375 | 225ms |
| B · lexical FTS | `getLexicalMatches` — `ts_rank` over the GIN index, raw query | 21% | 21% | 0.131 | 43ms |
| C · RRF(A+B), k=60 | repo's own `reciprocalRankFusion` over A+B | **43%** | **46%** | 0.381 | ~0ms |
| D · live chat lane | `recallMemoriesForQuery` — the "Hybrid Recall" block that fired on 71/118 real turns last week | **0%** | **0%** | 0.000 | 147ms |
| E · contextual pipeline | `getContextualMemories` top-5 render, containment-scored | 0% (local artifact — see F2) | — | — | — |

Per-slice (hit@5): event 4/4 A · health 4/7 A · identity **0/4 on every lane** ·
relationships 0/4 dense (1/4 lexical) — the first-person-paraphrase classes lose dense ranking
to journal/mood/semantic_edge noise, reproducing the pipeline study's Finding 4 at scale.

## Findings

**F1 — the wired lane retrieves the right memory zero times, by filter, not by search.**
`memory-recall.ts` KNNs the full corpus correctly, then applies a `CONTEXT_CATEGORIES`
whitelist that contains no durable personal category (`relationships`, `health`, `identity`,
`event`, `business_fact`, `biography`, …). Exhibit: on a medication query the dense lane ranked
the correct row **#1 of 92k** and the whitelist then deleted it from the result; same shape on
the shop-assault query (`pm_event_shop_assault_2026-08-15`, dense rank 1, filtered out). The
misnamed "Hybrid Recall" block is single-lane KNN + a filter that excludes what the operator
actually asks about. Its 7-day prod telemetry: fired on 71/118 assistant turns.

**F2 — the sophisticated pipeline cannot fit its own timeout, so chat rarely receives it.**
`getContextualMemories` (3-lane RRF at k=60 + BGE/Cohere rerank — the fusion the external
baseline recommends ALREADY EXISTS here) is called under a 3,000ms `withTimeout` that silently
drops the block. Its FIRST stage is a blocking LLM topic-extraction: prod `agent_traces`
(label=`contextual-recall`, 14d) show **334 calls on ollama, p50 4,183ms, p90 11,294ms**, plus
32 `provider_emergency` failures at p50 36s. The median turn loses the entire fused pipeline
before its retrieval stages even start; `Promise.race` keeps the work running, billed, and
discarded. Consistent prod signal: `deeperContextCount` > 0 on **0 of 118** turns. (The local
eval's E row is an environment artifact — local spend-protection returns `provider: emergency`
in 17ms — so E's *quality* is unmeasured; its prod *latency* is what the traces prove.)

**F3 — the semantic lane's candidate pool is a planner-arbitrary 300 rows.**
The pipeline's dense lane never KNNs: it cosine-scores a `top-300 ORDER BY confidence DESC`
pool. 9,004 eligible rows tie at confidence 1.0, so which 300 the planner returns is
arbitrary — two identical probes minutes apart returned pools that were 79% `archive_document`
and then 63% `journal_brain_take`. The recallable corpus mutates with the query plan.

**F4 — one-line unwired plumbing.** `getContextualMemories` has exactly one production caller
(brain-context.ts:277) and it passes no opts — the `queryEmbedding` pass-through built in Wave
81 (with the chat route's precomputed `userEmbedding` sitting in scope) was never wired, costing
an extra embedding round-trip inside the 3s budget.

**F5 — pre-conditions verified healthy.** Embedding writes are current (216 last 24h, 1,952
last 7d; backlog among recall-eligible rows: **9**); the dead `OPENAI_API_KEY` is irrelevant to
embeddings (Cohere `embed-v4.0` is primary, dim-pinned 1024, both sampled eras 1024-dim).
pgvector 0.8.0 with HNSW on both vector columns; GIN FTS index present and queried. The
hybrid-search hypothesis lands as: **both halves exist and are already RRF-fused — but the fused
pipeline can't reach chat (F2), and the lane that does reach chat fuses nothing and filters out
the answers (F1).**

## Fix slices (this wave — fuse what exists; rerank was already wired)

1. **S1** `memory-recall.ts`: admit the durable personal categories to `CONTEXT_CATEGORIES`.
2. **S2** `brain-context.ts`: pass the precomputed `userEmbedding` into `getContextualMemories`.
3. **S3** `contextual-recall.ts`: when a precomputed embedding is supplied (the chat hot path),
   derive lexical topics deterministically instead of the p50-4.2s LLM call — the pipeline fits
   its 3s budget; non-chat callers keep the LLM path.
4. **S4** `contextual-recall.ts`: union a true KNN top-50 into the candidate pool so the
   semantic lane sees the corpus instead of an arbitrary confidence slice (fixes F3).

Each slice measured on the same corpus; canaries assert the mechanisms (fixture-backed, proven
to bite). Numbers after the wave are in the AFTER section below.

## AFTER (same corpus, same harness, post-wave)

| Lane | hit@5 before → after | MRR before → after | p50 |
|---|---|---|---|
| D · live chat lane | **0% → 50%** | 0.000 → 0.448 | 139ms |
| E · contextual pipeline | 0% → **46%** contained (now measurable: real runs, `outcome:ok`, `rerankFired:true`) | — | 1,981ms (was: first stage alone p50 4,183ms) |
| A/B/C (unchanged code) | 39% / 21% / 43% | — | — |

- `topics` stage: p50 **4,183ms → 0ms** (deterministic; zero LLM calls verified — the run's
  agentTrace stub intercepted 0 calls, vs 28 on the baseline run).
- `knnPool` (the new true-KNN lane): **27–38ms** per turn — the F3 fix costs ~30ms.
- D now BEATS raw dense (50% vs 39%): the confidence/recency boosts help once the whitelist
  stops deleting the answers. **Consequence: no further fusion build into memory-recall is
  justified by these numbers** — naive RRF(A+B) measures 43%, below the fixed lane. The fused
  pipeline already exists in contextual-recall; investment goes to its remaining tail.
- Remaining measured tail: `lexical` stage spikes to 1.6–1.9s on some queries (8-term OR
  tsquery over the GIN index) — those runs still bust the 3s race. Lever: cap fast topics
  lower / tighten the tsquery, measured on this corpus. Identity-slice queries ("how old am
  i") are 0/4 on EVERY lane — paraphrase-gap class, the next quality lever along with the
  durable-class RRF weight (study Finding 4).

## Levers deliberately not taken now

- **Rerank tuning / two-stage rerank expansion** — the reranker is already wired inside the
  pipeline (BGE/Cohere via `rerank.ts`); once S3 lets the pipeline complete in budget it fires
  again on real turns. Further rerank investment only on a measured win over this baseline.
- **Weighted fusion** — external guidance (and this repo's rrf.ts header) both say: stay on RRF
  k=60 until ≥50 labelled pairs exist. The corpus is 28 cases; grow it via `pnpm harvest:evals`
  + real misses before tuning weights.
- **Durable-class RRF weight / ephemera decay** (study Finding 4) — measure after this wave
  re-lands the durable layer at all.
- **ef_search / iterative_scan** (study Finding 3) — pgvector 0.8.0 supports both; measure on
  this corpus before changing.
