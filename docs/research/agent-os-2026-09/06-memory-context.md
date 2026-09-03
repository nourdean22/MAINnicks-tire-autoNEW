# Track 6 — Memory / Graph / Unified Search (verified 2026-09-03)

## HEADLINE VERDICT
**Do not adopt GraphRAG. Do not adopt a graph database. Postgres is enough — and this codebase
already has the better structure.**

## A. GraphRAG — the evidence is unusually one-sided
| Project | License | State (2026-09-03) | Verdict |
|---|---|---|---|
| **Microsoft GraphRAG** | MIT | v3.1.2 · 2026-08-21; last commit 2026-08-24 (deps/cleanup, **not features**); 35,819 stars; **no new-capability post since Dec 2024** | **DO NOT USE** |
| **LightRAG** (HKUDS) | MIT | v1.5.7 · 2026-09-02, commits today; **39,363 stars — more than MS GraphRAG**; EMNLP 2025 | **WATCH** |
| **nano-graphrag** | MIT | **De facto dormant** — last push 2026-01-27 (~7mo); **last PyPI release 2024-10-19 (~23mo)**; every community PR from Feb/Mar/Jun 2026 unmerged with zero maintainer response | **DO NOT USE** |
| **LazyGraphRAG** | — | **NEVER OPEN-SOURCED.** Absent from the repo (code search for "lazy" = 6 unrelated hits). Per a 2025-06-06 editor's note it shipped into **Microsoft Discovery and Azure Local** (closed products) | **N/A — vendor claim only** |

### Cost, from Microsoft's own numbers
- **$0.34** to index ~38,371 tokens (GPT-4o-mini) vs **$0.0056** to plain-vector-embed the same text
  → **~61× multiplier**.
- Real user reports: **$5** for one basic file · **$35** for 10 documents · **$12** for MS's own
  "index a book" demo · **$15** for "a very small amount of text".
- **arXiv 2608.16096** (2026-08-17, freshest): *"three of five audited systems (adding Microsoft's
  GraphRAG) do not disclose indexing cost, and the only published GraphRAG dollar figures span **11×**
  inside one third-party paper (USD 2.30 vs USD 24.94 to index a 5.64 MB corpus once)... at 1 TB,
  embedding sits **7.5×–900× below** graph construction."*
- LightRAG's paper: rebuilding MS GraphRAG's community reports after an update costs **~13.99M tokens**.
  **A personal corpus grows continuously, so this cost recurs indefinitely.**

### Quality — GraphRAG frequently LOSES
- **arXiv 2603.29875** *"UnWeaving the knots of GraphRAG — turns out VectorRAG is almost enough"*
  (2026-02-06, rev 2026-06-08): *"VectorRAG performs better than standard GraphRAG and almost as good
  as current SOTA graph-based solutions, for a fraction of the cost."*
- **arXiv 2509.16780** (CMU, 477 QA pairs): best embedding model **99.4% top-10, beating GraphRAG
  outright**; **BM25 outperformed several embedding models**; GraphRAG retrieved **~47K tokens vs
  ~3.7K (12.7×)**, which *reduced* generation quality. **RAG's edge was LARGER on a weaker open
  model (+39% vs +16% relative F1)** — directly relevant to cost-conscious deployments.
- **arXiv 2506.05690** (GraphRAG-Bench) states as its own premise: *"recent studies report that
  GraphRAG frequently underperforms vanilla RAG on many real-world tasks."*
- **arXiv 2507.03226** — a paper *trying to rescue* GraphRAG concedes LLM extraction is the
  expensive, mostly-droppable part (94% of performance without it).
- **GitHub microsoft/graphrag#750**: an MS maintainer confirms global search *"requires many more
  LLM calls."*
- **HN 41597587** — a practitioner building **personal-memory chatbots** (the analogous use case):
  *"Both the performance and $ cost really hurt."*

> **The decisive argument for THIS codebase:** the structural benefit GraphRAG chases — entities +
> relationships for multi-hop reasoning — **already exists here, at higher precision and zero
> extraction cost**, because the app writes `PersonProfile` / `MemoryEdge` / `SemanticEdge` rows
> **deterministically at memory-creation time** rather than having an LLM probabilistically
> re-derive that structure later from a text dump. That re-derivation is exactly the "dirty graph"
> failure mode practitioners describe.

**The one defensible use:** a **one-time bulk import** of genuinely unstructured legacy text with no
write-time hook (old journal PDFs, inherited documents) — paid once, not continuously.
**Build instead:** a narrow, home-grown **periodic-summarization layer over the existing
`SemanticEdge`/`VectorEmbedding` tables** — LazyGraphRAG's actual insight (defer summarization to
query time) — for the rare broad "sensemaking" query a single vector lookup can't answer.

## B. Graph databases
| Product | License | State | Neon-compatible? | Verdict |
|---|---|---|---|---|
| **Postgres recursive CTE** | PostgreSQL | core | ✅ | **KEEP** for everything ≤3 hops |
| **PG19 native SQL/PGQ (`GRAPH_TABLE`)** | PostgreSQL | **Beta 3, 2026-08-13 — not GA** | ❌ **Neon supports PG 14–18 only** | **WATCH** |
| **Apache AGE** | Apache-2.0 (ASF) | v1.8.0 · 2026-07-09, active | ❌ **Neon: NO. AWS RDS: NO. GCP Cloud SQL: NO. Azure: yes** | **AVOID for this stack** — adopting it means leaving Neon |
| **Kuzu** | was MIT | 🔴 **DISCONTINUED — repo archived 2025-10-10, read-only.** Apple acquired Kuzu Inc. (~Oct 2025, disclosed via EU DMA filing). Website/blog domains now DNS-fail. No fork | **AVOID — dead** |
| **Memgraph** | **BSL 1.1** → Apache 2030-07-15 | v3.12.0 · 2026-07-15 | server process | **WATCH** — best algorithms, real ops burden |
| **FalkorDB** | **SSPL v1** | v4.20.4 · 2026-08-20 | Redis module only, no embedded mode | **AVOID** |
| **cozodb** | MPL-2.0 | 🔴 **Stalled — last commit 2024-12-04 (~1.75 yr)**, pre-1.0 w/ explicit no-stability guarantee | **AVOID** |
| **oxigraph** | Apache-2.0/MIT | active | embeds fine | **AVOID** — RDF/SPARQL, wrong data model for an LPG-shaped Prisma schema |
| **DuckDB + duckpgq** | MIT | active, CWI | sidecar only | **WATCH — narrow ADOPT** as a batch/offline sidecar for PageRank/community detection |
| PgGraph (2026) / AionDB (2026) / TypeGraph / NeuG | Apache / BUSL / unspec / unclear | new, single-vendor, unproven | unconfirmed | **WATCH / AVOID** |

### The one hard benchmark number
Memgraph's own benchmark (**vendor-sourced — flag it**), Pokec-medium, **100,000 vertices /
1,768,515 edges**, exact-N-hop reachability, 30s timeout, PG19 SQL/PGQ vs Memgraph Cypher `*BFS`:

| Hops | Postgres | Memgraph | Delta |
|---|---|---|---|
| 1–3 | ms | ms | comparable |
| 4 | seconds | <100 ms | **11.5×** |
| **5** | **times out at 30s (fails)** | 259 ms | query-breaking |

**Why this generalizes:** Postgres's own docs say SQL/PGQ is *not* a new execution engine —
*"Internally these are processed like views so are written as standard relational queries."* Both
`WITH RECURSIVE` and `GRAPH_TABLE` compile to the same nested-loop/hash-join executor. Cost scales
with **branching factor × hop depth**, not table size.

⚠ **Evidence gap, flagged not invented:** no source isolates table-size scaling at fixed depth
(a curve across 10K/100K/1M rows). The wall above appears at a **fixed, modest 1.77M edges.**

### The decision rule
**Trigger on QUERY SHAPE, not row count:**
- **1–3 hops** ("tasks for this person", "files this project references") — Postgres wins at any
  personal-agent scale. This is most of the actual query traffic.
- **4+ hop variable-length traversal** — the wall. Plausibly reachable by an actively-used personal
  memory graph within a few years.
- **Community detection / centrality (PageRank, Louvain, Leiden, betweenness)** — a **categorical
  expressibility gap, not a scaling one.** There is no reasonable single-CTE expression of PageRank.
  **If you ever want "who are my most central contacts" or "cluster my projects," that requirement
  alone justifies a graph-algorithm layer regardless of data size** — and the cheapest form is the
  DuckDB+duckpgq offline sidecar, not a new live database.

## C. Vector storage
Postgres + pgvector is sufficient at single-user scale. Dedicated vector DBs (Qdrant, Weaviate,
Milvus, LanceDB) start earning their keep well above personal-agent volumes.
**This codebase already has `VectorEmbedding` — keep it.**

## D. Hybrid retrieval (from Track 5, restated because it belongs here)
Dense (pgvector HNSW) + lexical, fused by **Reciprocal Rank Fusion** `score = Σ 1/(k + rank_i)`,
k=60 — RRF uses **rank positions only**, sidestepping BM25-vs-cosine normalization entirely.
Lexical arm: built-in `tsvector` (zero deps, adequate) → **ParadeDB `pg_search`** (real BM25 in PG).
**Pipeline:** retrieve **top-100** → dedup (URL canon → simhash → embedding cluster) → rerank top-30
with **Qwen3-Reranker-0.6B** (Apache-2.0, CPU-viable) → **8–12** to synthesis.
*Two dials matter more than model choice: retrieve 100 not 20, and let 8–12 survive not 40.*

## E. Memory evaluation
Score **retrieval in isolation from generation** (LongMemEval / LoCoMo shape) — measuring the end
answer only lets the generator paper over bad retrieval. This codebase already has
`tests/lib/evals/memory-evals.test.ts` and `tests/brain/recall-eval.test.ts`; the gap is judge
calibration (see Track 7).

## Verdicts
**KEEP:** Postgres recursive CTEs (≤3 hops) · pgvector · existing `MemoryEdge`/`SemanticEdge`/
`PersonProfile`/`VectorEmbedding` schema · RRF hybrid retrieval · Qwen3-Reranker.
**WATCH:** PG19 SQL/PGQ (not GA, Neon lacks PG19) · Memgraph (only if 4+ hop or algorithms
materialize) · DuckDB+duckpgq as an offline algorithm sidecar · LightRAG · PgGraph · AionDB.
**AVOID:** Microsoft GraphRAG · nano-graphrag (dormant) · **Kuzu (dead — Apple acquisition)** ·
Apache AGE (Neon-incompatible) · FalkorDB (SSPL + Redis-module-only) · cozodb (stalled) ·
oxigraph (wrong data model) · TypeGraph · NeuG · SQLite graph extensions (none exist).
