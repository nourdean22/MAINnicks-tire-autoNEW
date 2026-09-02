# StateNour (bdnick.info) — 2026 Open-Source & Build-vs-Buy Landscape

**Scope.** Single-operator personal AI operating system. Stack: Next.js 16 + React 19 + Prisma 6 on Neon Postgres (pgvector + tsvector), AI SDK v6, tRPC 11, Inngest 4.4, Redis available, installed as an iOS PWA. Read-only research — no code changed.

**Method.** WebSearch to find candidates, WebFetch on the canonical repository / release page / official docs to verify facts. Stars and downloads are treated as weak signals; release cadence, last release date, issue posture, SPDX license, and security policy are recorded instead. `NOT VERIFIED` is written wherever a fact resisted verification against a primary source. No confidence percentages are used anywhere in this report.

**House rules already decided (not re-litigated below):** no policy engine (Cedar/OPA/Casbin); no durable-execution replacement for Inngest (Temporal stays out); no Yjs/CRDT local-first (single operator, no concurrent editing); no resumable-stream + Redis pub/sub for streaming (a Postgres tail is kept instead); no retrieval re-architecture on blog evidence; no iterative/agentic retrieval loop (refuted by StateNour's own measurement). Every candidate below is judged against the existing implementation, a ≤100-line custom module, or a hosted service, under a **NET COMPLEXITY RULE**: a new dependency must remove at least as much complexity as it adds, or prove clear operator-facing value — otherwise the verdict is DEFER or REJECT.

**Verdict legend.** ADOPT = bring it in now. ADAPT = take the pattern/code, not the dependency. STUDY = read the source, no integration yet. EXPERIMENT = time-boxed spike behind a flag. DEFER = revisit at a stated trigger. REJECT = do not add, reason is durable.

---

## 1. Postgres-native hybrid retrieval

**Platform fact that governs this whole category:** StateNour runs on **Neon**, and Neon enforces an allow-list of extensions — arbitrary or custom-compiled C extensions cannot be installed. Per Neon's own extension list (`https://neon.com/docs/extensions/pg-extensions`, fetched 2026-09-02), **`pgvectorscale` and `VectorChord` are not on that list at all** — adopting either would require leaving managed Neon for self-managed Postgres, which is out of scope for a single operator. That fact alone resolves most of this category before benchmarks matter.

### pgvector (baseline, already in use)
- Repo: `https://github.com/pgvector/pgvector`
- Latest stable: **v0.8.6** (2026-07-29, verified via `gh api repos/pgvector/pgvector/tags` + commit date — the repo does not use GitHub's Releases feature, only tags, so `/releases` reads empty; use tags+CHANGELOG.md as canonical).
- Releases last 12 months: 6 tagged versions (0.8.1 through 0.8.6), roughly monthly patch cadence since Sep 2025.
- Maintainer/bus-factor: single maintainer (Andrew Kane) historically, but commit velocity stayed high through 2026 (`pushed_at` 2026-08-20) and issue count is low (14 open) for a 22.9k-star repo — healthy signal despite bus-factor risk.
- License: **PostgreSQL License** (permissive, BSD/MIT-family; SPDX short id `PostgreSQL`). GitHub's license detector reports `NOASSERTION` because the file doesn't match a template verbatim — confirmed by reading `LICENSE` directly.
- Security: **CVE-2026-3172** (buffer overflow / integer underflow in parallel HNSW index build, CVSS 8.1, affects 0.6.0–0.8.1) fixed in 0.8.2 (2026-02-25). No formal GHSA advisories filed in-repo (`security-advisories` endpoint 404s — advisories were issued via NVD/CVE, not GitHub Security Advisories). Current 0.8.6 is well past the fix.
- TS/React/Next compat: N/A — SQL extension, accessed through Prisma raw queries / `pgvector` npm helper types. No first-party TS package to version-check.
- Runtime footprint: in-process Postgres extension, no separate service.
- Data egress/telemetry: none — pure SQL extension.
- Self-host burden: **zero on Neon** — pre-installed, `CREATE EXTENSION vector`.
- API stability: stable; 0.8.x has been additive (iterative index scans in 0.8.0, no breaking changes since).
- 100-line custom version: N/A, this already is the minimal primitive — nothing to replace it with.
- **Verdict: ADOPT (already in production; keep current).** Reason: fastest-moving, best-supported, zero-friction option on the actual host. Revisit trigger: none needed — just track patch releases for CVEs the way 0.8.2 required.

### Neon Lakebase Search (`lakebase_vector` + `lakebase_text` + `lakebase_tokenizer`)
- Canonical docs: `https://neon.com/docs/ai/lakebase-search` and announcement `https://neon.com/blog/lakebase-search-on-neon` (fetched 2026-09-02). Not an independent OSS repo — it is a Neon-managed, closed-source extension pair bundled with the Neon control plane (Neon's core engine is Apache-2.0, but Lakebase Search itself ships no public repo — treat as a **hosted feature**, not OSS).
- Availability: "available to all Neon users on Postgres 16+" per the announcement. Exact plan-tier gating (free vs. paid) and GA-vs-preview status were **NOT VERIFIED** — the docs page states capabilities but does not carry an explicit "GA"/"beta" label in the fetched content.
- What it claims: `lakebase_vector` adds a `lakebase_ann` index (IVF + RaBitQ quantization) claimed to build 50-100x faster than HNSW and scale past 1B vectors on one index; `lakebase_text` adds a `lakebase_bm25` index for proper BM25 ranking (closing the real gap in plain `tsvector`/GIN, which ranks by term frequency heuristics, not BM25). Both are explicitly **drop-in**: "No migration from `pgvector` required... same `vector` types, distance operators, and query syntax work unchanged," and the same claim for `tsvector`.
- Context: Neon was acquired by Databricks (deal announced May 2025, ~$1B, folding into Databricks' "Lakebase" agentic-Postgres line — `https://www.cnbc.com/2025/05/14/databricks-is-buying-database-startup-neon-for-about-1-billion.html`). Lakebase Search is the productized output of that integration.
- Security/telemetry: governed by Neon's own security posture (SOC2 etc., not independently auditable here); no separate advisory feed since it isn't a standalone package. NOT VERIFIED beyond what the docs state.
- Self-host burden: **zero** — but also **cannot be self-hosted**; this is full vendor commitment to Neon for search, which the operator is already committed to for the base database.
- API stability / migration cost: claimed zero migration cost from the exact columns StateNour already has (`vector` + `tsvector`). This is the single biggest reason to look at it seriously.
- 100-line custom version: the thing it replaces isn't a 100-line module, it's the RRF-fusion SQL function StateNour already runs (see baseline below) — Lakebase Search would replace the *index type underneath* those columns, not the fusion logic.
- **Verdict: STUDY now, EXPERIMENT behind a flag before adopting.** Reason: first-party on the exact host already used, claims zero-migration drop-in compatibility, and directly replaces the deprecated pg_search path — but GA/pricing/preview status and real-world BM25-quality claims are unverified from docs alone and it is a hard vendor lock (already true of Neon itself, so marginal lock-in cost is low). Revisit trigger: before StateNour crosses ~100k rows (where plain GIN/tsvector BM25-quality ranking starts to matter), or when Neon publishes pricing/GA status for the feature — re-check `https://neon.com/docs/ai/lakebase-search`.

### ParadeDB pg_search — REJECTED BY PLATFORM, not by merit
- Repo: `https://github.com/paradedb/paradedb`
- Latest stable: **v0.25.6** (2026-08-27, verified via `gh api`). Extremely active — 8+ tags including release candidates in the 30 days before that date alone.
- License: **AGPL-3.0** (verified via `gh api repos/paradedb/paradedb` → `license.spdx_id`). This is a real consideration even for self-hosted single-operator use if StateNour ever exposes query functionality to a third party over a network — AGPL's network-copyleft clause is triggered by offering the software's functionality as a service to others, which a personal OS run by its own operator does not do, but it rules out ever redistributing a StateNour fork commercially without also open-sourcing it.
- Security: no separate advisory database found; ParadeDB is Rust-based (Tantivy-backed), which removes a class of memory-safety bugs pgvector's C code is exposed to.
- **The decisive fact:** Neon's own docs state pg_search "is no longer available for new Neon projects" as of **2026-03-19**, and existing projects lose access on **2026-09-21** — three weeks after this report's access date. Neon explicitly redirects existing users to `lakebase_text` or plain `tsvector`. Adopting pg_search now would mean re-migrating within a month.
- **Verdict: REJECT (for Neon-hosted StateNour specifically; the project itself is healthy).** Reason: platform sunset date is inside the decision horizon. Revisit trigger: only if StateNour ever migrates off Neon to self-managed Postgres — re-evaluate pg_search fresh at that point, it will likely have moved past 0.25.x.

### pgvectorscale (Timescale) — REJECTED BY PLATFORM
- Repo: `https://github.com/timescale/pgvectorscale`
- Latest stable: **0.9.0** (2025-11-04, verified via `gh api`). License **PostgreSQL** (permissive). Repo still receives commits (`pushed_at` 2026-09-01) but **no tagged release in 10 months** — worth tracking as a maintenance-cadence yellow flag even though it isn't reachable on Neon anyway.
- Not on Neon's extension allow-list (`https://neon.com/docs/extensions/pg-extensions`, checked 2026-09-02) — StreamingDiskANN's main selling point (disk-resident indexes for corpora that don't fit in RAM) is also irrelevant at StateNour's ~25k-row scale.
- **Verdict: REJECT.** Reason: not installable on the managed host StateNour actually runs on, and solves a scale problem StateNour doesn't have. Revisit trigger: only relevant if StateNour both leaves Neon and crosses into multi-million-row territory.

### VectorChord — REJECTED BY PLATFORM
- Repo: `https://github.com/tensorchord/VectorChord` (organization now shows as `supervc-stack/VectorChord` in the API — a rename; reason for the rename is NOT VERIFIED).
- Latest stable: **1.1.1** (2026-02-28, verified via `gh api`). License: **dual AGPLv3 / Elastic License v2** (verified by reading `LICENSE` directly) — same network-copyleft consideration as ParadeDB, plus ELv2's SaaS restriction.
- Not on Neon's extension allow-list. No release since 2026-02-28 as of this report (over 6 months) despite repo commits continuing.
- **Verdict: REJECT.** Reason: same platform incompatibility as pgvectorscale, plus a more restrictive license and a slower release cadence than pgvector itself. Revisit trigger: same as pgvectorscale.

### The case for adding nothing beyond pgvector + tsvector at ~25k rows
The canonical pattern — one `vector` column, one generated `tsvector` column, a GIN index on the latter, an HNSW index on the former, fused in a single SQL function with Reciprocal Rank Fusion (`score = 1/(k + rank)`, `k = 60`) — is documented by Supabase as a first-party guide (`https://supabase.com/docs/guides/ai/hybrid-search`, fetched via search 2026-09-02) and independently reproduced across multiple 2026 field-note posts reporting the fusion step lifting retrieval precision from roughly 62% (vector-only) to roughly 84% (fused) on their test sets — **NOT VERIFIED against StateNour's own data**, cited only to show the pattern is well-trodden, not to import their numbers. The whole fusion function fits in well under 100 lines of SQL and is exactly what the house rules already call for keeping. At ~25k rows, HNSW build time and query latency are non-issues on any Neon compute size, and BM25-vs-tsvector ranking quality is the only real gap — which is precisely the gap `lakebase_text` targets. **Verdict: ADOPT (keep as-is).** Nothing in this category clears the net-complexity bar to replace it outright; the only upgrade worth planned effort is swapping the *index type* under the same columns via Lakebase Search once it's verified GA.

---

## 2. Server-side rerankers

Context: StateNour deploys on Railway (per prior project record), a long-running container host rather than ephemeral serverless — this materially changes the calculus for a local cross-encoder, since a persistent Node process can load a reranker model once and keep it warm, avoiding the cold-start tax that would kill this option on Vercel-style functions.

### Cohere Rerank (v3.5 / Rerank 4 Pro)
- Canonical: `https://cohere.com/rerank` (product), `https://openrouter.ai/cohere/rerank-v3.5` and `https://docs.cohere.com` for API reference.
- Latest: **Rerank v3.5**, released 2026-04-05 per aggregator pages (NOT independently re-verified against a Cohere changelog page — cite as NOT VERIFIED beyond third-party pricing trackers); a newer "Rerank 4 Pro" SKU also appears in OpenRouter's catalog, suggesting a v4 line exists — NOT VERIFIED which is current-default.
- Pricing: **$2.00 per 1,000 searches** (one search = one query against up to 100 documents; documents over 500 tokens are chunked and each chunk bills separately).
- Latency: vendor/aggregator figures cite ~80-150ms p50 on sub-2k-token chunks, 200ms+ p99 past 3k tokens; independent user reports in production cite 1-1.5s — wide enough spread that StateNour's own measurement would be needed before relying on a latency budget.
- License/self-host: closed, API-only, hosted by Cohere (or resold via AWS/Azure/GCP marketplace) — no self-host option.
- Data egress: full query + candidate-document text leaves StateNour's infrastructure to Cohere on every rerank call — a real consideration for a personal-data corpus.
- TS support: official `cohere-ai` npm SDK, actively maintained, typed.
- 100-line custom version: not applicable to the hosted API itself, but see the open cross-encoder entry below for what replacing the *need* for a hosted reranker would look like.
- **Verdict: DEFER.** Reason: good quality signal and simple integration, but per-query cost and full-text egress are hard to justify at StateNour's scale when a same-process open cross-encoder is viable on Railway. Revisit trigger: if StateNour's own hybrid-fusion precision (Category 1 baseline) measurably plateaus below what's needed and an A/B against a local cross-encoder shows a real quality gap.

### Voyage AI rerank-2.5 / rerank-2.5-lite
- Canonical: `https://docs.voyageai.com` (Voyage is now owned by MongoDB — billing routes through `https://www.mongodb.com/docs/voyageai/`).
- Latest: **rerank-2.5** released 2026-07-27 (32K context); **rerank-2.5-lite** same release date, cheaper/faster variant.
- Pricing: **$0.05 per million tokens** (rerank-2.5), **$0.02 per million tokens** (lite) — priced per token rather than per search, which is materially cheaper than Cohere at StateNour's likely volume; both lines ship with a 200M free-token allotment.
- Quality claim: vendor states a 7.94% retrieval-accuracy improvement over Cohere Rerank v3.5 across 93 datasets — **NOT VERIFIED** (vendor-published benchmark, no independent reproduction found).
- License/self-host: closed, API-only.
- Data egress: same concern as Cohere — full text leaves StateNour's infrastructure.
- TS support: official `voyageai` npm package exists; Vercel AI Gateway lists it as a routed provider, meaning it is reachable through the AI SDK v6 provider interface StateNour already uses for embeddings/chat.
- **Verdict: DEFER, but the strongest hosted option if a hosted reranker is ever needed.** Reason: cheapest per-token hosted pricing found, native AI SDK v6 gateway routing lowers integration cost to near zero — but the same egress/cost-vs-local-cross-encoder question applies. Revisit trigger: same as Cohere.

### Jina Reranker (v3.5)
- Canonical: `https://jina.ai/reranker/` (fetched 2026-09-02).
- Latest: **jina-reranker-v3.5** — "0.6B parameter multilingual listwise reranker with a 131K context window," per Jina's own product page.
- License: hosted API is CC-BY-NC-4.0 for the underlying weights; **commercial production self-hosting now requires a paid license, which — per Jina's own page — Elastic began reselling as of 2026-08-10 under the name "Jina On-Prem"** (available via AWS/Azure/GCP marketplace or air-gapped deployment through Elastic Sales). This is a notable 2026 development: Jina's on-prem commercial channel is now Elastic, not Jina directly.
- Pricing: token-based, shared Jina token pool; per-token rate not published on the fetched page (NOT VERIFIED).
- **Verdict: REJECT for this project's shape.** Reason: the commercial on-prem path now runs through a third-party enterprise sales process (Elastic), which is disproportionate friction for a single-operator project, and the hosted API has the same egress concern as Cohere/Voyage without Voyage's price advantage or Cohere's simplicity. Revisit trigger: none — open cross-encoders below cover the same "run it yourself" need without the licensing detour.

### Open cross-encoders via transformers.js (BAAI bge-reranker-v2-m3, Mixedbread mxbai-rerank-v2)
- `BAAI/bge-reranker-v2-m3`: **Apache-2.0** (verified via Hugging Face model API, `license: apache-2.0`), 17.8M+ downloads, multilingual XLM-RoBERTa cross-encoder. Last model-card update 2024-06-24 — the model itself is stable/frozen, which for a reranker is a feature, not staleness.
- `mixedbread-ai/mxbai-rerank-v2` (base 0.5B / large 1.5B): **Apache-2.0**, per Mixedbread's own docs (`https://www.mixedbread.com/docs/models/reranking/mxbai-rerank-large-v2`) and repo `https://github.com/mixedbread-ai/mxbai-rerank`; RL-tuned specifically to cut false positives, 8k native context (32k-compatible), 100+ languages. Distributed as a Python package (`pip install mxbai-rerank`) — **no first-party npm package found**; using it from StateNour's Node/TS stack means running the raw ONNX weights through transformers.js, not a maintained JS wrapper.
- Runtime: `@huggingface/transformers` (the successor to `@xenova/transformers`, now published under the official Hugging Face npm org — confirmed via `https://huggingface.co/blog/transformersjs-v3` and `https://huggingface.co/blog/transformersjs-v4`, v4 published 2026-02-09) runs ONNX models in Node via `onnxruntime-node`. A 0.3-0.6B cross-encoder (bge-reranker-v2-m3 or mxbai-base-v2) is the realistic size for CPU inference in a Railway container; the 1.5B large variant would need real benchmarking before trusting it in the request path.
- Latency/footprint: **NOT VERIFIED** for StateNour's exact hardware — no first-party benchmark found for `bge-reranker-v2-m3` under `transformers.js`/`onnxruntime-node` on commodity CPU at StateNour's likely candidate-set size (reranking ~20-50 short passages per query). This needs a local timing spike before any adoption decision, not a vendor number.
- TS/React/Next compat: N/A (server-side only, invoked from a Route Handler or Inngest step, never shipped to the client bundle).
- Data egress: **zero** — model runs in-process, no document text leaves StateNour's infrastructure. This is the deciding advantage over all three hosted options above.
- Self-host burden: model download/cache (~500MB-1.5GB on disk depending on model), first-load latency, and keeping the ONNX runtime dependency current; no ongoing per-call cost.
- 100-line custom version: the *integration glue* (load model once at module scope, batch-score query/passage pairs, sort, return top-k) is genuinely under 100 lines — the complexity being adopted is the model runtime (`@huggingface/transformers` + `onnxruntime-node`), not custom logic.
- **Verdict: EXPERIMENT.** Reason: zero egress, zero marginal cost, and Railway's persistent-process model removes the cold-start problem that would rule this out on serverless — but real latency on StateNour's container needs to be measured before it can replace or precede a hosted call. Revisit trigger: run a same-day timing spike (load `bge-reranker-v2-m3` via `@huggingface/transformers`, score StateNour's typical top-50 candidate set, measure p50/p95) — if it lands under ~300ms server-side, adopt; if not, fall back to Voyage rerank-2.5-lite as the cost-efficient hosted option.

---

## 3. 2026 embedding models — dimension, cost, and re-embedding migration cost

**Note on scope:** this report is read-only external research and did not inspect StateNour's actual embedding call site, so the *current* model in production is **NOT VERIFIED** here — treat the numbers below as inputs to a decision, not a diagnosis. AI SDK v6 is the pinned version in this stack; a v7 already exists upstream (confirmed live at `https://ai-sdk.dev/docs/ai-sdk-core/embeddings`, fetched 2026-09-02) — that upgrade is a separate decision from the embedding-model choice and is out of scope for this category.

### OpenAI text-embedding-3 (small / large)
- Canonical: `https://developers.openai.com/api/docs/models/text-embedding-3-large` and `.../pricing` (fetched 2026-09-02; note `platform.openai.com/docs/pricing` now 301-redirects here, and OpenAI's own community forum has an open thread reporting a stale-cache discrepancy between the pricing page and model card — the two developers.openai.com pages fetched directly agreed with each other at fetch time).
- Dimensions: **1536** (small) / **3072** (large), both natively support Matryoshka Representation Learning (MRL) — the `dimensions` API parameter truncates the vector server-side with graceful quality degradation, so shrinking to e.g. 1024 or 256 does **not** require re-embedding, only re-requesting with a different parameter.
- Price: **$0.02/M tokens** (small), **$0.13/M tokens** (large) — verified directly against two current OpenAI docs pages.
- License/self-host: closed, API-only.
- **Verdict: this is the safe default if StateNour is already here — MRL means dimension changes are cheap; only a full model swap forces a re-embed.**

### Voyage-4 family (now under MongoDB)
- Canonical: `https://docs.voyageai.com/docs/pricing` (fetched 2026-09-02).
- Models: `voyage-4-large`, `voyage-4`, `voyage-4-lite` — dimensions **NOT VERIFIED** from the pricing page itself (not listed there; would need the model-card page), but Voyage's line has supported MRL-style output-dimension selection since voyage-3.
- Price (verified from the pricing page directly, correcting an earlier third-party aggregator figure that quoted large at $0.18/M): **voyage-4-large $0.12/M, voyage-4 $0.06/M, voyage-4-lite $0.02/M**, each with a 200M free-token allotment.
- Quality claim: vendor states outperforming OpenAI text-embedding-3-large by 14% and Cohere embed-v4 by 8.2% on NDCG@10 (Voyage's own RTEB benchmark, 29 datasets) — **NOT VERIFIED**, vendor-published.
- Integration: reachable through Vercel AI Gateway, i.e. through AI SDK's provider interface with no bespoke SDK glue.
- **Verdict: cheapest credible option per token if a switch is ever justified; MongoDB ownership is a mild vendor-risk note (roadmap now subordinate to MongoDB's priorities), NOT VERIFIED to have caused any product regression.**

### Cohere embed-v4
- Price: **$0.10/M tokens**, 100+ languages, positioned as the multilingual leader per multiple 2026 comparison posts (aggregator consensus, not independently re-verified against a Cohere pricing page in this pass — **NOT VERIFIED** to the same standard as the two above).
- Relevant mainly if StateNour ever needs non-English retrieval quality; otherwise no reason to prefer it over Voyage-4 on price or OpenAI on integration simplicity.

### Qwen3-Embedding (open-weight, self-hostable)
- Repo: `https://github.com/QwenLM/Qwen3-Embedding` (GitHub API reports `license: null` at the repo-metadata level — the repo's license file wasn't cleanly detected — but the model cards on Hugging Face explicitly state **Apache-2.0**, e.g. `Qwen/Qwen3-Embedding-8B`, confirmed via the HF API `cardData.license`).
- Sizes: 0.6B / 4B / 8B parameters, up to **32K token context** — long relative to the OpenAI/Cohere/Voyage lines. The 8B variant ranked #1 on the MTEB multilingual leaderboard in a January 2026 snapshot (score ~70.6), ahead of every proprietary API tested — **vendor/community-benchmark claim, NOT independently reproduced here.**
- Self-host cost: the 0.6B size is CPU-feasible on Railway the same way a reranker would be (see Category 2); 4B/8B need a GPU to be fast, which StateNour's Railway deployment does not have — running the larger variants would mean adding a GPU inference provider (Modal, Replicate, etc.), a new category of infrastructure this project doesn't currently carry.
- Data egress: zero for the 0.6B self-hosted path; otherwise whatever the chosen GPU host requires.
- **Verdict: STUDY.** Reason: only the 0.6B variant is realistically self-hostable on the current Railway footprint, and at that size it is not obviously better than OpenAI text-embedding-3-small for English-dominant personal content — the win case is multilingual or code-heavy corpora, which is NOT VERIFIED to be StateNour's actual workload. Revisit trigger: if StateNour's content mix becomes measurably multilingual or a GPU-backed inference provider gets added for another reason (making the 4B/8B sizes free to reach).

### The migration cost of re-embedding ~25,000 rows (the part that actually matters)
The **token cost is a rounding error regardless of model choice** — 25,000 rows at a representative 500 tokens/row is 12.5M tokens, which is $0.25 (OpenAI small), $1.25 (Cohere), $0.75 (Voyage-4), or $1.63 (OpenAI large). This is not the constraint. The real cost is mechanical:
1. **pgvector indexes are fixed-dimension.** The `vector` column type can technically be declared without a size, but HNSW/IVFFlat indexes require a fixed dimension to build — so switching to a model with a different output dimension is a schema change, not a data change: add a new `vector(N)` column, not an in-place resize.
2. **Embeddings from different models are not comparable.** There is no partial-migration option — every row must be re-embedded before the new column is queryable, so this is an expand/backfill/cutover/contract sequence (add column → backfill via batch job → flip the read path → drop the old column and its index), not a single `UPDATE`.
3. **At 25k rows this backfill is a non-event operationally** — even at a conservative 50 requests/sec against any of the four APIs above, full backfill finishes in minutes; the risk is entirely in the cutover step (index rebuild lock behavior, read-path flip correctness), not in embedding throughput.
4. **Staying on the same model family and only changing output dimension (MRL) avoids all of this** — this is the strongest practical argument for preferring OpenAI text-embedding-3 or Voyage-4 (both MRL-capable) over a model swap: a dimension change becomes a re-request with a different parameter against already-cached source text, not a provider migration.
- **Verdict: DEFER any embedding-model swap.** Reason: no evidence gathered here that StateNour's current model (whatever it is) is a retrieval-quality bottleneck; the fusion-and-rerank layers in Categories 1-2 are far more likely to move the needle than a different embedding model, and switching purely for a benchmark-leaderboard delta doesn't clear the net-complexity bar. Revisit trigger: only after Category 1's hybrid-fusion and Category 2's reranker changes have been measured and retrieval quality is still the bottleneck.

---

## 4. Temporal and graph memory systems

**The two benchmarks everyone cites, read directly:**
- **LoCoMo** — "Evaluating Very Long-Term Conversational Memory of LLM Agents," arXiv:2402.17753 (2024-02-27), `https://arxiv.org/abs/2402.17753`. Ten synthetic multi-session conversations (18-30 sessions each, ~9K tokens/conversation on average), 1,540 QA pairs across multi-hop (18.3%), single-hop (20.8%), temporal (6.2%), and open-domain (54.6%) categories. The paper's own finding: RAG and long-context LLMs both "substantially lag behind human performance" on this set.
- **LongMemEval** — "LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory," arXiv:2410.10813 (2024-10-14, ICLR 2025), `https://arxiv.org/abs/2410.10813`. 500 curated questions over scalable synthetic chat histories, testing five abilities: information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention. Headline finding: commercial assistants and long-context LLMs show a **30% accuracy drop** on sustained-interaction recall versus single-session recall.
- **Evidence-quality caveat that applies to every vendor number below:** LoCoMo's own QA-pair generation and grading pipeline has been criticized in follow-on papers (e.g. "Locomo-Plus," arXiv:2602.10715, and "GRAVITY," arXiv:2605.01688) for grading artifacts and a benchmark ceiling that doesn't reflect real deployments — treat any single-number LoCoMo/LongMemEval score, including the ones below, as **directional, not definitive**, and doubly so when the vendor citing the number also built or funds the benchmark harness.

### Graphiti (getzep/graphiti) — the OSS engine behind Zep
- Repo: `https://github.com/getzep/graphiti`. Paper: "Zep: A Temporal Knowledge Graph Architecture," arXiv:2501.13956.
- Latest: **v0.30.0** (2026-09-01, verified via `gh api`). License: **Apache-2.0** (verified). Very active: `pushed_at` 2026-09-01, but **480 open issues** against 30,525 stars — a high issue count that reads as much as "high adoption, understaffed triage" as "unhealthy project"; treat as a caution flag, not disqualifying.
- **Architecture, read directly from the README:** "Facts have validity windows. When information changes, old facts are invalidated — not deleted." This is, verbatim, the `valid_from` / `valid_until` / `superseded_by` pattern StateNour already has in Postgres — Graphiti's temporal model is not a new idea, it's that same idea implemented as bi-temporal edges in a graph.
- **The decisive infrastructure fact:** Graphiti's own README installation section requires **Neo4j 5.26, FalkorDB 1.1.2, Amazon Neptune, or Kuzu 0.11.2 (now deprecated)** as the backing graph database — a wholly new database technology to provision, back up, and operate alongside Neon Postgres. There is no Postgres-native mode.
- **Language fit:** Graphiti's core library is **Python-only** (`Requirements: Python 3.10 or higher`). The one TypeScript reimplementation found, `aexy-io/graphzep` ("a temporal knowledge graph memory system for AI agents in Typescript based on the Zep paper"), is a third-party, unofficial port: Apache-2.0, but only **22 stars** and no push since **2025-08-24** — effectively dormant, not a viable dependency.
- **The managed alternative (Zep):** Zep, the commercial product built on Graphiti, ships official Python/TypeScript/Go SDKs and — per Graphiti's own comparison table — "no third-party graph database vendor required" because Zep's backend is a proprietary managed graph engine. This removes both the Python-only problem and the new-database-to-run problem, at the cost of a recurring hosted-service bill and full data egress of StateNour's memory graph to a third party.
- **Verdict: REJECT self-hosting Graphiti; DEFER on Zep-the-managed-service.** Reason: self-hosting fails on language fit (Python-only core, dormant TS port) and net-complexity (a whole new graph database for a capability — bi-temporal fact tracking — three Postgres columns already provide); Zep removes those two problems but is a new paid, data-egressing vendor dependency that hasn't been shown necessary. Revisit trigger: if StateNour's memory queries start needing genuine multi-hop graph traversal ("who introduced X to Y's employer") that flat Postgres tables can't express reasonably — that capability gap, not the temporal-tracking pitch, is the only thing that would justify either option.

### mem0 (mem0ai/mem0)
- Repo: `https://github.com/mem0ai/mem0`. License: **Apache-2.0** (verified). Latest core version **v2.0.20** (2026-09-02, same day as this report — very active; commit history shows near-daily core releases). Separate `mem0ai` npm package independently confirmed on the npm registry at **v3.1.8, published 2026-09-02**.
- Maintainer/bus-factor: Y Combinator S24 company, 64,581 stars, 718 open issues (high in absolute terms but proportionate to star count), has a real `SECURITY.md` with a private-disclosure process (GitHub Security Advisories + `support@mem0.ai`) — the most formal security posture of any candidate in this category.
- **First-party TypeScript support is real**, not a wrapper: the monorepo contains a `mem0-ts` package published as `mem0ai` on npm, with TypeScript-specific config examples in the docs (`collectionName`, `embeddingModelDims`).
- **Runs on StateNour's existing Postgres**, verified directly from mem0's docs (`https://docs.mem0.ai/components/vectordbs/dbs/pgvector`, fetched 2026-09-02): pgvector is a first-party-documented vector-store backend (`CREATE EXTENSION IF NOT EXISTS vector;`, then point mem0's config at it), with HNSW or DiskANN indexing options. This is the one candidate in this category that adds **no new database**.
- Benchmark claims (mem0's own blog, April 2026 algorithm release, `https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm`): **92.5 on LoCoMo** (up from 71.4), **94.4 on LongMemEval**, at ~7K tokens/query and sub-1.1s p50 latency. **These are vendor-published numbers, scored using mem0's own `mem0ai/memory-benchmarks` harness** — the entity publishing the benchmark and the entity being scored are the same, so treat the specific deltas as marketing until independently reproduced; the general claim (retrieval-then-extraction beats raw full-context stuffing on token cost) is directionally plausible and consistent with LongMemEval's own findings about long-context degradation.
- Data egress: depends entirely on which LLM/embedding provider mem0 is configured to call for its own extraction step — it is a orchestration layer, not a hosted memory store, so egress is whatever StateNour already sends its model provider, plus one more LLM call per memory write for fact extraction.
- 100-line custom version: this is the one place in this category where "just add columns" genuinely does **not** obviously suffice — what mem0 provides beyond temporal columns is the **extraction pipeline** (turning a raw conversation turn into discrete, deduplicated, contradiction-checked facts), which is real logic, not infrastructure. A from-scratch version is a prompted-extraction step plus an upsert-with-supersession routine against the existing facts table — plausibly 150-300 lines, not 100, because contradiction detection and dedup are where the actual complexity lives.
- **Verdict: STUDY, then EXPERIMENT.** Reason: this is the only graph/memory-system candidate that clears the net-complexity bar on infrastructure grounds (reuses Neon/pgvector, has a real TS SDK) — the open question is purely whether its extraction-and-supersession pipeline beats a custom version, not whether it's deployable. Revisit trigger: time-box a spike using mem0's TS SDK against the existing pgvector instance for one real memory-writing flow, and compare fact-extraction quality and latency against a hand-written extraction prompt + upsert function before committing.

### Letta (letta-ai/letta, formerly MemGPT)
- Repo: `https://github.com/letta-ai/letta`. License: **Apache-2.0** (verified). Latest **0.16.8** (2026-05-14 — the least recent of the four candidates here, ~3.5 months stale at report time, though 0.16.x reads as a mature, slowing-down version line rather than an abandoned one: only **39 open issues** against 24,574 stars is the healthiest issue-to-star ratio in this category).
- **Architectural mismatch, not a feature gap:** Letta is not a memory library to bolt onto an existing agent loop — it is a full **stateful-agent server** (the direct MemGPT descendant) that owns agent execution, identity, and conversation state itself. Its docs describe a "Letta Agent SDK for building agents into TypeScript applications" that calls *into* a running Letta server (Python, its own REST API) — the TS piece is a client for Letta's server, not an in-process memory module for StateNour's own AI SDK v6 / tRPC / Inngest agent loop.
- Adopting Letta would mean StateNour's agent orchestration moving to run *inside* Letta rather than Letta's memory concepts moving into StateNour — a full orchestration-layer replacement, which the house rules already treat skeptically for narrower cases (Temporal was rejected as a durable-execution replacement for Inngest on the same logic).
- **Verdict: REJECT for memory-layer purposes; not evaluated as an orchestration replacement (out of scope — Category 5 covers orchestration, and Letta was not a fit there either for the same reason).** Reason: solves a problem StateNour doesn't have (owning the whole agent runtime) to get a feature (self-editing memory) that's narrower in scope than what mem0 already provides as a library. Revisit trigger: none anticipated under the current architecture.

### Cognee (topoteretes/cognee)
- Repo: `https://github.com/topoteretes/cognee`. License: **Apache-2.0** (verified). Latest **v1.5.3** (2026-08-23, verified). 30,415 stars, 490 open issues — comparable activity profile to Graphiti.
- Cognee markets a genuinely relevant pitch directly in its README: **"Run the Whole Memory Layer on Postgres"** — replacing the traditional graph-DB + vector-DB + Redis + relational-DB stack with pgvector for embeddings and a Postgres-backed graph store, claiming ~10% faster search than the split-service setup in their own CI benchmarks (**NOT VERIFIED**, vendor-published, no methodology detail fetched).
- **The catch, stated by Cognee itself, in bold, in their own README:** "Using Postgres as a graph store is currently a released as a demo feature. **The production ready feature is available as a licenced product.**" Free/OSS Cognee in production still wants a real graph backend (Neo4j, or Kuzu/Ladybug for local dev only) — the headline "no separate graph database" pitch is a demo-tier claim, not a production one, unless StateNour pays for Cognee's commercial license.
- **Language fit:** Python-only (`pip install cognee`); confirmed no `cognee` or `cognee-sdk` package exists on the npm registry (both return HTTP 404). Cognee is designed to run as its own service (Docker Compose profiles for the core service, a UI, and an MCP server) — consuming it from StateNour's Node/TS app means calling it over HTTP or MCP, not importing it.
- **Verdict: REJECT.** Reason: the one feature that would matter (Postgres-native graph, no new DB) is explicitly not the free tier in production, and even the demo tier requires treating Cognee as an external service rather than a library given the Python/no-npm-package situation. Revisit trigger: only if Cognee's Postgres-graph-store feature graduates out of demo status under a license StateNour is willing to pay for, and only after mem0 has been tried and found insufficient.

### LangMem (langchain-ai/langmem) — noted, not fully evaluated
License **MIT**, but version is still **0.0.30** (pre-1.0) and star count (1,638) is an order of magnitude below the other four — it is also LangChain-ecosystem-shaped (built to slot into LangGraph's checkpointing model), which StateNour's AI SDK v6-based stack does not use. **Verdict: DEFER without a full row** — too immature and ecosystem-mismatched to justify the same depth of evaluation as the four above; would only become relevant if StateNour adopted LangGraph.js for orchestration, which Category 5 also does not recommend.

### Does Postgres already cover the temporal need?
Yes, for the specific claim being made. Every system above that leads with "temporal" (Graphiti/Zep most explicitly, Cognee and mem0 implicitly) implements the same primitive StateNour already has: a fact row with a start time, an end time (or null = still current), and a pointer to whatever superseded it. That is `valid_from timestamptz`, `valid_until timestamptz`, `superseded_by uuid references facts(id)` — three columns and an index, not a research paper. What the graph systems actually add on top of that primitive is (a) LLM-driven autonomous extraction of entities/facts from unstructured text, and (b) multi-hop graph traversal queries. **(a)** is real, non-trivial logic that mem0 already packages reasonably (see above) without demanding a new database. **(b)** is the one capability genuinely absent from a flat relational schema — and nothing gathered in this research shows StateNour has a query pattern that needs it yet. **Verdict: ADOPT (keep the Postgres columns as the temporal substrate); do not add a graph database for temporal tracking alone.**

---

## 5. Agent orchestration and durable agents in TypeScript

**Framing constraint from the brief:** these are only worth adopting where they would **delete** existing code — StateNour already has AI SDK v6 for model calls and Inngest 4.4 for durable execution, so the bar is not "is this framework good," it's "does bringing this in let something currently maintained by hand go away." This report cannot see StateNour's actual orchestration code (read-only external research, no repo access per the task's own constraint), so each verdict below is framed as a conditional test rather than a confirmed deletion.

**A methodology note that changed the numbers in this category:** GitHub's tags API does not return tags in reliable chronological order for several of these repos — cross-checking against each package's real npm registry `time` field caught a materially misleading staleness read for one candidate (Inngest AgentKit, below). All dates in this category are npm-registry-verified, not tag-list-order-assumed.

### AI SDK's own native agent primitives (`ai` package, already a dependency)
- Docs: `https://ai-sdk.dev/docs/agents/overview` (fetched 2026-09-02, reflects the current v7 docs site — StateNour is pinned to **v6**, and this report could not confirm the `ToolLoopAgent` / `HarnessAgent` naming or `stopWhen`/`prepareStep` API surface is identical between v6 and v7; **NOT VERIFIED for v6 specifically**, flagged as a check-before-relying-on-this-section item).
- What it is: a first-party agentic tool-calling loop (`stopWhen`, `prepareStep` for loop control) built into the same `ai` package already imported for model calls — **zero new dependency** if used.
- 100-line custom version: this *is* the 100-line custom version, already written by the AI SDK team and already in StateNour's `node_modules`.
- **Verdict: ADOPT if and only if StateNour is currently hand-rolling a tool-calling loop that duplicates this.** Reason: this is the one candidate in the category that can only add value by deleting code, never by adding a dependency — there's nothing to weigh against net complexity because there's no new surface area. Revisit trigger: audit the current agent loop against v6's actual (not v7's documented) Agent API before the next orchestration change; if it's already using AI SDK's loop primitives, this row is moot.

### Inngest AgentKit (`@inngest/agent-kit`)
- Repo: `https://github.com/inngest/agent-kit`. License: **Apache-2.0**. Description (from the repo itself): "Build multi-agent networks in TypeScript with deterministic routing and rich tooling via MCP."
- **Version reality check:** npm registry shows latest **0.13.2, published 2025-11-13** — over **9 months stale** as of this report (2026-09-02), despite being built by the same team as Inngest itself, which StateNour already depends on and which is actively maintained (Inngest core is on 4.4 per the brief). A same-vendor, same-ecosystem project going quiet for 9+ months while the core product keeps shipping is a real signal that AgentKit specifically has lost internal priority — worth more weight than a generic staleness flag precisely because the "obvious fit" argument for this candidate rests entirely on active first-party Inngest alignment.
- **Verdict: DEFER, leaning REJECT.** Reason: the entire case for AgentKit over AI SDK's own agent primitives was "it's from the same team as Inngest, so it'll integrate cleanly" — a 9-month-stale 0.13.x package undermines that case regardless of the API's design quality. Revisit trigger: only if Inngest ships a new AgentKit release showing renewed investment — recheck `https://www.npmjs.com/package/@inngest/agent-kit` before ever reconsidering.

### Mastra (`@mastra/core`)
- Repo: `https://github.com/mastra-ai/mastra`. License: **Apache-2.0 for the core**, with an enterprise carve-out for anything under an `ee/` directory (`@mastra/core/auth/ee`, `@mastra/editor/ee`, etc.) licensed separately — verified by reading `LICENSE.md` directly, which is why GitHub's own license detector reports `NOASSERTION` (mixed licensing, not a template match). This is a standard, disclosed open-core structure, not a bait-and-switch, but worth knowing which directories are which license before depending on anything under `ee/`.
- Latest: **1.63.2** (npm-verified, published 2026-08-28) — extremely active, real 1.x version line (unlike the misleading `v0.1.10` git tag, which the tags API returned out of chronological order).
- Architecture: Mastra ships its **own** default workflow/execution engine, but per its own docs explicitly supports delegating durable execution to external "workflow runners" **including Inngest** — so adopting Mastra would not necessarily force abandoning the existing Inngest investment.
- **Why this still doesn't clear the bar:** Mastra is a comprehensive application framework (agents, workflows, storage, evals, a dev playground) meant to be adopted wholesale, not a narrow module that slots in next to existing code. For a project that already has a working AI SDK v6 + tRPC + Inngest combination, bringing in Mastra means restructuring around Mastra's abstractions — that is additive framework adoption, not the code-deletion this category requires, unless a genuinely large amount of hand-rolled orchestration/storage glue exists that Mastra would obsolete wholesale. This report has no visibility into whether that much glue exists.
- **Verdict: DEFER.** Reason: real, well-maintained, and not incompatible with keeping Inngest — but "comprehensive framework adoption" is the wrong shape of change for an established app absent a specific, named pile of hand-rolled code it would remove. Revisit trigger: only if a future orchestration rewrite is already on the table for independent reasons (not triggered by this report) — evaluate Mastra then, against a concretely named list of code it would delete.

### LangGraph.js (`@langchain/langgraph`)
- Repo: `https://github.com/langchain-ai/langgraphjs`. License: **MIT**. Latest **1.4.13** (npm-verified, published 2026-08-26) — actively maintained.
- Core model: graph-based state machines with LangChain's own checkpointing/persistence layer for durable state — this is a **second durable-execution abstraction** competing directly with the role Inngest already fills, which is the same shape of redundancy the house rules already rejected once (Temporal, for the identical reason: don't run two durable-execution systems). Adopting it also pulls in LangChain-ecosystem conventions StateNour's AI-SDK-v6-based stack does not otherwise use.
- **Verdict: REJECT.** Reason: durable-execution overlap with Inngest is disqualifying on the same grounds the house rules already established for Temporal — this isn't a new argument, it's the same one applied to a second product. Revisit trigger: none; this is durable unless Inngest itself is ever replaced, which is its own separate decision this report does not recommend.

### OpenAI Agents SDK (JS) (`@openai/agents`)
- Repo: `https://github.com/openai/openai-agents-js`. License: **MIT**. Latest **0.17.0** (npm-verified, published 2026-08-19) — actively maintained, "lightweight" per its own description, and covers multi-agent workflows and voice agents.
- Why it's redundant here specifically: StateNour already uses AI SDK v6 as its provider-agnostic model/agent layer across (presumably) multiple LLM vendors. OpenAI's Agents SDK is a second, OpenAI-flavored agent abstraction (handoffs, guardrails, its own runner) — running it alongside AI SDK v6 means two different agent-loop mental models in the same codebase for no capability AI SDK's own primitives (see first entry) don't already cover.
- **Verdict: REJECT.** Reason: pure overlap with a capability already available in an existing, provider-agnostic dependency — adopting it adds a second way to do the same thing rather than deleting a first one. Revisit trigger: none identified; would only matter if StateNour became OpenAI-exclusive and specifically needed the Realtime/voice-agent handoff features this SDK bundles (see Category 17 for voice, evaluated separately).

---

## 6. Prompt-injection defenses and tool-result sanitization

**The headline finding in this category: two of the most commonly-recommended OSS point-solutions are dead.**

### The research, read directly from the papers
- **Spotlighting** — "Defending Against Indirect Prompt Injection Attacks With Spotlighting," Hines et al. (Microsoft), arXiv:2403.14720 (2024-03-20), confirmed by direct fetch of `https://arxiv.org/abs/2403.14720`. A family of techniques (datamarking, delimiting, encoding) that mark untrusted input's provenance so the model can distinguish it from privileged instructions. **Reported result: reduces attack success rate from >50% to below 2%** on GPT-family models, "with minimal impact on task efficacy." This is a prompting technique, not a package — implementing datamarking (wrapping every tool-result/document string with a distinguishing marker before it enters the prompt, and instructing the model that marked spans are data, never instructions) is a function of well under 100 lines.
- **Instruction Hierarchy** — "The Instruction Hierarchy: Training LLMs to Prioritize Privileged Instructions," Wallace et al. (OpenAI), arXiv:2404.13208 (2024-04-19), confirmed by direct fetch. Trains the model itself (GPT-3.5 in the paper) to rank system/developer/user/tool-output privilege and reject conflicting lower-privilege instructions, "drastically increasing robustness" with "minimal degradation" on normal capability. **This is not something StateNour implements — it's a property of the underlying model.** Its relevance here is as a baseline: current-generation frontier models (OpenAI's GPT-4o-and-later line, and per public vendor statements Anthropic's Claude models) are trained with hierarchy-aware instruction-following already, meaning StateNour gets a meaningful baseline defense "for free" from model choice alone, before any additional tooling — **NOT VERIFIED per-model** for whichever specific models StateNour calls today, but worth confirming against each provider's current model card rather than assuming the oldest/cheapest model in a provider's lineup has it.
- **Verdict on the research itself: ADOPT the technique (datamarking wrapper for tool results), track instruction-hierarchy as a model-selection input, not a dependency.**

### LLM Guard (protectai/llm-guard) — DEAD
- Repo: `https://github.com/protectai/llm-guard`. **Archived** (`archived: true` via `gh api`, and the README itself carries a first-party warning banner: **"THIS PROJECT HAS BEEN ARCHIVED... no longer under active development or maintained."**). License MIT, last push 2026-07-08, 3,204 stars.
- **Verdict: REJECT.** Reason: dead by the maintainer's own declaration. Revisit trigger: none — do not adopt an archived security tool regardless of how often it's cited in older tutorials.

### Rebuff (protectai/rebuff) — DEAD, longer dead
- Repo: `https://github.com/protectai/rebuff`. **Archived**, license Apache-2.0, last push **2024-08-07** — over two years stale at report time, the oldest "last activity" date found anywhere in this entire report.
- **Verdict: REJECT.** Reason: same as LLM Guard, more severely so. Both tools sharing the ProtectAI org and going dark around the same period is a useful pattern-recognition data point: check an org's overall trajectory, not just one repo, before depending on a security tool from a smaller vendor. Revisit trigger: none.

### NVIDIA NeMo Guardrails
- Repo: `https://github.com/NVIDIA/NeMo-Guardrails`. License: **Apache-2.0** (confirmed by reading `LICENSE.md` directly — the SPDX header states it explicitly even though GitHub's detector returned `NOASSERTION`). Latest **v0.24.0**, very active (`pushed_at` same day as this report), 7,048 stars, 213 open issues.
- **Language/integration fit:** Python-only core (requires Python 3.10-3.13); ships its own DSL (**Colang**, "a python-like syntax" for defining dialogue-flow guardrails, versions 1.0 and 2.0 both supported) that has to be learned and maintained as `.co` files alongside YAML config; can run as a standalone HTTP server (`nemoguardrails server`) for out-of-process use from a Node/TS app, or Docker-deployed.
- **Verdict: REJECT for adoption; STUDY the Colang flow-definition concept as inspiration only.** Reason: this is a new language, a new Python runtime, and (if run as a server) a new service to operate — for a single operator whose actual need is "don't let tool-result text get treated as instructions," this is a large amount of net-new complexity to reach a narrower goal than what the free datamarking technique above already covers for the specific indirect-injection threat model. Revisit trigger: if StateNour's threat model expands to need topic-rail/jailbreak-classification-style guardrails beyond tool-result sanitization specifically — re-evaluate then, and re-check whether Colang 2.0 has stabilized.

### Lakera Guard (commercial, hosted)
- `https://www.lakera.ai/lakera-guard` (fetched 2026-09-02). Positioned as an inspection layer for "every AI interaction," deploys without model/prompt changes.
- Pricing, TypeScript SDK availability, and exact data-handling terms: **NOT VERIFIED** — not disclosed on the fetched marketing page; would require the docs site or a sales conversation to confirm.
- Structural concern regardless of pricing: an inspection API of this kind must see the content to guard it, meaning every tool result and every user message StateNour wants protected would be egressed to a third party as a prerequisite of the protection — a real privacy cost for a *personal* AI OS specifically, independent of dollar cost.
- **Verdict: REJECT.** Reason: the free, in-process datamarking technique addresses the specific threat (tool-result content being treated as instructions) without adding a data-egressing third-party dependency; Lakera's broader guardrail surface (jailbreak detection, PII leakage, etc.) is not a demonstrated StateNour need. Revisit trigger: none identified.

---

## 7. Sandboxing for code and tool execution

StateNour already uses E2B plus an in-process JS VM for tool/code execution, so this category is a switching-cost question, not a greenfield choice.

### E2B (already in use)
- Repo: `https://github.com/e2b-dev/E2B`. License: **Apache-2.0**. Very active: 13,653 stars, 48 open issues, `pushed_at` same day as this report. npm packages independently confirmed current: `e2b` **2.46.1** (2026-08-27), `@e2b/code-interpreter` **2.7.2** (2026-08-26).
- **Verdict: ADOPT (keep).** Reason: actively maintained, permissively licensed, already integrated — nothing found in this pass justifies a switch. Revisit trigger: none.

### Vercel Sandbox
- Docs: `https://vercel.com/docs/sandbox` (fetched 2026-09-02). Firecracker-microVM isolation, full Linux images (Ubuntu/Arch/custom OCI via Vercel Container Registry), first-party JS/TS SDK (`@vercel/sandbox`) and Python SDK, millisecond startup claimed, persistent sandboxes with auto-save/resume as the default behavior, and a related changelog title confirms it is **"now generally available"** (not beta) — the "Drives" feature (attached persistent storage) is explicitly still beta.
- **The catch for StateNour specifically:** this is a Vercel-platform primitive — authentication is built around Vercel OIDC tokens tied to a Vercel project, with access tokens as the fallback for non-Vercel environments. StateNour deploys on Railway, not Vercel, so this would be consumed as an out-of-platform API (access-token auth) rather than the zero-config, same-platform experience it's designed for.
- **Verdict: DEFER.** Reason: technically credible (GA, Firecracker isolation, good SDK) but StateNour is not on Vercel's hosting, which removes most of the operational advantage over the already-integrated E2B; switching sandboxing providers purely on feature parity isn't justified without a specific E2B gap. Revisit trigger: only if StateNour's hosting ever moves to Vercel, or if a specific E2B limitation (not identified in this pass) shows up in practice.

### Cloudflare Sandbox SDK
- Repo: `https://github.com/cloudflare/sandbox-sdk`. License reported `NOASSERTION` by GitHub's detector (**NOT VERIFIED** against the actual LICENSE file in this pass — check before relying on the license specifically). Active: 1,122 stars, 33 open issues, pushed same day as this report; npm package `@cloudflare/sandbox` at **0.12.9** (2026-08-27).
- Architecture: built on Cloudflare Workers + Durable Objects — same platform-coupling issue as Vercel Sandbox, but to Cloudflare's Workers runtime instead, which StateNour is not on.
- **Verdict: REJECT.** Reason: same platform-mismatch logic as Vercel Sandbox, with a smaller/younger project and an unverified license on top — strictly worse fit for this stack. Revisit trigger: none under the current hosting choice.

### isolated-vm
- Repo: `https://github.com/laverdet/isolated-vm`. License: **ISC** (permissive). Latest npm **7.0.1** (2026-08-05); repo `pushed_at` 2026-08-23, 2,911 stars, 89 open issues — smaller but genuinely active, single-maintainer-flavored project (bus-factor risk noted, not disqualifying).
- What it is: real V8 isolates embedded in the Node process (not a container/VM) — much lighter weight than E2B for pure-JS, no-filesystem, no-network code execution, at the cost of weaker isolation guarantees than a microVM (it isolates at the V8-heap level within the same OS process, not at the kernel/hypervisor level E2B and Vercel Sandbox provide).
- **A safety note on the *other* common "JS VM" option, since the brief's "and a JS VM" is ambiguous about which one StateNour runs:** Node's ecosystem also has `vm2`, which had multiple **critical, publicly-disclosed sandbox-escape CVEs in 2023** (widely documented at the time as full RCE breakouts from the sandbox). Checked fresh for this report: `vm2` is **not npm-deprecated** and shows a surprisingly recent release — **3.12.0, published 2026-09-01** (i.e., yesterday relative to this report), meaning the project has apparently resumed active maintenance after appearing dormant. **This report found no independent post-revival security audit** of vm2 — if StateNour's existing "JS VM" is vm2 specifically, that history is a standing reason to prefer `isolated-vm` (no comparable CVE history found) or a real microVM (E2B) for anything executing untrusted input; if it's already `isolated-vm` or Node's built-in `vm` module used correctly (which Node's own docs already warn is not a security boundary by itself), this note doesn't apply.
- **Verdict: STUDY as a complement to E2B, not a replacement.** Reason: for lightweight, latency-sensitive, no-I/O code execution (e.g., evaluating a small user-provided expression or template), an in-process V8 isolate avoids E2B's network round-trip and per-sandbox cost — but it is not a substitute for E2B's stronger isolation on anything that needs filesystem/network access or handles genuinely untrusted code. Revisit trigger: if a specific tool-execution path is identified where E2B's round-trip latency is the measured bottleneck and the code being run is provably side-effect-free.

---

## 8. Evals and tracing

### OpenTelemetry GenAI semantic conventions — status check first, since it governs the rest
Checked directly against the spec site (`https://opentelemetry.io/docs/specs/semconv/gen-ai/` and the attribute registry, fetched 2026-09-02): the GenAI conventions **moved to a dedicated repository** (`open-telemetry/semantic-conventions-genai`), and on the main spec site, attributes like `gen_ai.request.model` and `gen_ai.usage.input_tokens` are now marked **Deprecated** (superseded by the new repo, not removed as a capability). Within the new repository's own registry, current values (e.g. operation names `chat`, `embeddings`, `text_completion`) are marked **Development** stability, not Stable. **Answer to the brief's question: still experimental/Development in 2026, and mid-reorganization on top of that** — treat any tracing integration built against `gen_ai.*` attribute names as subject to change, and prefer a tracing vendor whose SDK abstracts the raw attribute names rather than hand-writing them.

### Langfuse
- Repo: `https://github.com/langfuse/langfuse`. License: **MIT** for the core, with the same open-core `ee/`-directory carve-out pattern seen in Mastra (verified by reading `LICENSE` directly — copyright now reads **"Copyright (c) 2023-2026 ClickHouse, Inc."**, indicating Langfuse's copyright has moved to ClickHouse, consistent with Langfuse's ClickHouse-backed architecture — **NOT VERIFIED** whether this reflects a full acquisition or a narrower agreement, but it is a real ownership-signal change worth tracking). Extremely active: 34,097 stars, 877 open issues, pushed same day as this report.
- **SDK generation matters here:** the current SDK is **v5** of the JS/TS line, restructured into `@langfuse/tracing` (OTel-native tracing primitives) + `@langfuse/otel` (`LangfuseSpanProcessor` exporter) + provider integration packages (`@langfuse/openai`, `@langfuse/langchain`), confirmed at **5.11.0, published 2026-08-27** — actively current. The legacy monolithic `langfuse` npm package (last published 2026-04-01, v3.38.20) still works but is the older generation; **adopt the `@langfuse/*` v5 packages, not `langfuse`**, for any new integration.
- Self-host burden: real if self-hosting the full platform (ClickHouse + Postgres + Redis + S3-compatible storage, per Langfuse's known architecture — **NOT VERIFIED in this pass**, cited from the product's well-documented deployment requirements); trivial if using Langfuse Cloud instead, which reintroduces data egress.
- Being OTel-native means Langfuse's SDK is a reasonable hedge against the GenAI semconv instability noted above — it abstracts the raw attribute names rather than requiring StateNour to hand-write them.
- **Verdict: STUDY.** Reason: strong OTel alignment and real self-host option make this the most architecturally sound tracing candidate found, but the self-hosted stack (ClickHouse + Postgres + Redis + object storage) is a meaningful new-infrastructure commitment for a single operator, and Langfuse Cloud reintroduces egress of prompt/completion content. Revisit trigger: if StateNour needs trace-level debugging across multiple agent runs badly enough to justify either the new infrastructure or the egress — not clearly true yet from anything gathered here.

### Braintrust
- Repo: `https://github.com/braintrustdata/braintrust-sdk`. License: **Apache-2.0**. This repo itself is small (27 stars, 86 open issues) because **Braintrust's core product is a hosted, closed-source eval/observability platform** — the public repo is the thin client SDK, not the product. npm `braintrust` at **3.29.0** (2026-08-27) — actively maintained.
- **Verdict: DEFER.** Reason: well-regarded commercially but there is no self-host path to evaluate — this is a pure hosted-vendor decision (pricing, data egress, lock-in) rather than an OSS build-vs-buy question, and no pricing/data-handling terms were verified in this pass. Revisit trigger: if a hosted eval platform is decided to be worth paying for, get pricing/DPA terms directly before choosing between this and Langfuse Cloud.

### promptfoo
- Repo: `https://github.com/promptfoo/promptfoo`. License: **MIT**. Latest npm **0.122.2** (2026-08-28) — very active (24,761 stars, 566 open issues, pushed same day).
- What it is: a CLI-first, config-driven (YAML) eval runner — define test cases and assertions against prompts/models, run in CI. No hosted dependency required; results can be viewed locally or pushed to promptfoo's optional cloud UI.
- Self-host burden: effectively zero — it's a dev-dependency/CLI tool, not a running service, closer in shape to a test framework than to Langfuse/Braintrust's always-on tracing role.
- **Verdict: ADOPT for offline/CI evals specifically.** Reason: this is the one candidate in the category that is genuinely lightweight (no new infrastructure, no egress unless the optional cloud feature is opted into) and solves a distinct problem (pre-deploy regression testing of prompts) from what Langfuse/Braintrust solve (production trace observability) — the two are complementary, not competing, if StateNour ever wants both. Revisit trigger: none needed to start using it for prompt-change regression tests.

### Inspect AI (UK AI Security Institute)
- Repo: `https://github.com/UKGovernmentBEIS/inspect_ai`. License: **MIT**. PyPI `inspect-ai` at **0.3.261** — active (2,686 stars, 261 open issues, pushed same day).
- What it is: a framework built by the UK's AI Security Institute for running rigorous model evaluations (originally for frontier-model safety testing), with strong support for multi-turn, tool-using, and agentic eval scenarios.
- Language fit: **Python-only** — no TypeScript/Node package exists for this framework.
- **Verdict: STUDY only, not adopt.** Reason: the most rigorous eval methodology of the group (built for safety-critical frontier-model assessment, not just prompt regression), but Python-only in a TS-first stack means it would run as a separate offline evaluation harness rather than an integrated dependency — worth reading for eval-design ideas, not worth the language-boundary cost of operationalizing directly. Revisit trigger: if StateNour builds any Python-side tooling for another reason, revisit using Inspect AI there instead of hand-rolling eval logic.

---

## 9. Scheduling primitives

**The decisive platform fact for this whole category:** StateNour is installed as an **iOS PWA**. Checked directly against caniuse data (`https://caniuse.com/temporal`, fetched 2026-09-02): the native **Temporal API has no stable Safari support** — available only in Safari Technology Preview, not shipped in any released Safari or iOS Safari version (through 26.6) — while Chrome/Edge 144+, Firefox 139+, and their Android equivalents do support it natively, for **69.2% global coverage**. For an iOS-PWA-first product specifically, native Temporal is not usable client-side today regardless of its global coverage number — a polyfill would be required, which erases the "it's a browser built-in, no dependency" appeal that is Temporal's main pitch.

### date-fns v4 + @date-fns/tz
- `date-fns`: **4.4.0** (npm, published 2026-05-29), MIT. `@date-fns/tz`: **1.5.0** (npm, published 2026-05-21), MIT. Both reasonably current.
- v4's headline change (relative to v3) is first-class time zone support via the separate `@date-fns/tz` package rather than a monolithic core — keeps the core tree-shakeable while adding IANA time zone handling, which StateNour needs for scheduling if the operator or any reminders cross time zones.
- **Verdict: ADOPT (or keep, if already in use).** Reason: current, permissively licensed, modular, and covers the actual gap (time zone-aware date math) without needing Temporal's browser support.

### chrono-node
- Repo/npm: **2.10.1** (published 2026-07-20), MIT — actively maintained.
- What it is: a natural-language date/time parser ("next Tuesday at 3pm," "in two weeks") — directly relevant to a personal-AI-OS chat interface where the operator will type schedule requests in natural language rather than picking dates from a widget.
- **Verdict: ADOPT.** Reason: solves a real, specific problem (NL date parsing) that would be a significant reimplementation effort to hand-roll well (natural-language date parsing has enormous edge-case surface), current and permissively licensed.

### rrule.js — stale, but the alternative is worse
- Repo: `https://github.com/jkbrzt/rrule`. License: **BSD-3-Clause** (per npm package metadata; GitHub's detector returns `NOASSERTION`, **NOT VERIFIED** against a root LICENSE file in this pass). Latest **2.8.1**, published **2023-11-10** — both the npm package and the underlying repo (`pushed_at` 2024-06-27) have been quiet for roughly two to three years, with **212 open issues** accumulating against 3,742 stars — a real staleness signal, not a false alarm from tag-ordering this time.
- Why it's still the right call anyway: it implements RFC 5545 RRULE parsing and expansion (the iCalendar recurrence-rule standard) — a genuinely complex, well-specified, and **stable spec** (RFC 5545 itself hasn't changed), so an unmaintained-but-correct implementation of a frozen standard is materially lower risk than an unmaintained implementation of something still evolving. A from-scratch replacement is not a 100-line module — RRULE expansion (BYDAY/BYMONTH/BYSETPOS interactions, exception dates, DST edge cases) is a well-known source of subtle bugs even in mature implementations.
- **Verdict: ADOPT with a maintenance flag, not DEFER.** Reason: still the least-bad option for recurring-schedule expansion; the staleness is a reason to pin the version deliberately and watch for a fork gaining traction (none identified as clearly ahead in this pass), not a reason to avoid it. Revisit trigger: if a security-relevant bug is found and unpatched for an extended period, or if a actively-maintained fork demonstrably overtakes it.

### Temporal API (native) and Luxon
- **Temporal:** per the caniuse data above, not viable client-side for an iOS PWA today. Server-side (Node.js), Temporal's runtime support depends on the Node version in use — **NOT VERIFIED** whether StateNour's Node runtime ships it natively or would need the `temporal-polyfill` package; check `node --version` against the Node release that stabilized Temporal before assuming server-side availability either.
- **Luxon:** `3.7.2`, published **2025-09-05** — about a year stale, MIT. Luxon's own project positioning has long been "a bridge to Temporal" — its maintainers built it anticipating Temporal would eventually obsolete it. With Temporal still not viable on the target platform (iOS Safari), Luxon remains a reasonable general-purpose date library, but StateNour gains nothing by adding it on top of `date-fns` v4 + `@date-fns/tz`, which already cover the same ground and are more current.
- **Verdict: REJECT Luxon (redundant with date-fns v4); DEFER native Temporal.** Reason: no case for a second general-purpose date library alongside date-fns; Temporal is a wait-for-the-platform situation, not a StateNour decision — revisit when Safari/iOS Safari ships it stably, which caniuse shows has not happened yet.

---

## 10. Accessible dense-UI primitives

All version/React-19-compatibility claims below are read directly from each package's published `peerDependencies` on the npm registry — a first-party statement, not a blog claim.

### Base UI (`@base-ui-components/react`) — active repo, stale package
- Repo: `https://github.com/mui/base-ui` (MUI's unstyled-primitives project). License: **MIT**. The **GitHub repo is extremely active** — `pushed_at` is the same day as this report (2026-09-02), 426 open issues, 10,795 stars.
- **But the npm package has not had a new version published since 2025-12-04** — the `latest` dist-tag still points at **1.0.0-rc.0**, and there is no `next`/`canary` dist-tag offering anything more current (checked directly against the registry's `dist-tags` field). That is a **9-month gap** between what's merged on `main` and what `npm install` actually gets you.
- React 19: yes, `peerDependencies` explicitly allow `^17 || ^18 || ^19`.
- **Verdict: DEFER.** Reason: the "1.x" framing in the brief is aspirational — what ships today is still an rc from nine months ago despite vigorous ongoing development, which is a worse position than either alternative below; revisit once a real 1.0.0 (not another rc) actually publishes. Revisit trigger: a new npm publish past `1.0.0-rc.0` — check `https://www.npmjs.com/package/@base-ui-components/react` before reconsidering.

### Radix UI (`@radix-ui/react-*`)
- Per-primitive packages (e.g. `@radix-ui/react-dialog` at **1.1.23**, published **2026-07-24**). License: **MIT**. React 19 explicitly supported: `^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc`.
- **Verdict: ADOPT (or keep, if already in use).** Reason: currently the most reliably shippable of the three unstyled-primitive options for this stack — actively published, explicit React 19 support, mature ecosystem (shadcn/ui and most Next.js component recipes assume it).

### React Aria (`react-aria` / `@react-aria/*`, Adobe)
- Latest **3.52.0**, published **2026-09-01** — the most current release date found in this entire category (literally yesterday relative to this report). License: **Apache-2.0**. React 19 supported: `^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1`.
- Strongest accessibility pedigree of the three (Adobe's team has the longest track record specifically on ARIA-pattern correctness across assistive tech, not just visual behavior) — relevant for a dense personal-OS UI where keyboard/screen-reader correctness compounds across many components.
- **Verdict: ADOPT for any new component where accessibility correctness is the binding constraint; no reason to migrate existing Radix usage wholesale.** Reason: best-maintained option found in this pass and Apache-2.0 is no less permissive than Radix's MIT for this use case; the two are not mutually exclusive within one app.

### cmdk (command palette)
- Repo: `https://github.com/pacocoursey/cmdk`. License: **MIT**. Latest **1.1.1**, published **2025-03-14** — repo `pushed_at` **2025-10-29**, both roughly 10-18 months stale, 74 open issues against 12,940 stars. React 19 is supported in the published peer deps (`^18 || ^19 || ^19.0.0-rc`), so the staleness is a maintenance-cadence concern, not a compatibility one.
- **Verdict: ADOPT with a watch flag.** Reason: still the de facto standard for a `cmd+k`-style command palette in React, React-19-compatible today, and a personal AI OS is exactly the kind of dense power-user tool that benefits from one — but the maintenance slowdown is real enough to check for unpatched issues before leaning on it further. Revisit trigger: any accessibility or React-version-compat bug reported and left unaddressed for an extended period.

### TanStack Virtual and TanStack Table
- `@tanstack/react-virtual`: **3.14.10**, published **2026-08-18**, MIT, React 19 explicitly supported (`^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`). Actively maintained.
- `@tanstack/react-table`: **9.2.4**, published **2026-08-28**, MIT — note this is already a **major-version-9** line (well past the v8 that was current through most of 2024-2025), confirming the project keeps shipping breaking-change majors; peer dep states only `>=18` (no explicit upper bound, which covers 19 but isn't a named commitment the way the others above are — **NOT VERIFIED** whether any React-19-specific concurrent-rendering issues exist, only that the stated range permits it).
- **Verdict: ADOPT both, as needed.** Reason: virtualization and headless table logic are exactly the kind of correctness-sensitive, edge-case-heavy problems not worth re-implementing for a dense-UI personal OS, and both are current and React-19-compatible.

### Streamdown
- Repo/npm: **2.6.0**, published **2026-08-24**. License: **Apache-2.0**. React 18/19 explicitly supported. Built by Vercel specifically for **streaming markdown rendering in AI chat interfaces** (incremental-parse-safe, handles partial/incomplete markdown mid-stream without flicker or broken formatting) — a direct fit for StateNour's chat surface given it already runs AI SDK v6.
- **Verdict: ADOPT.** Reason: purpose-built for exactly the rendering problem a chat-based personal AI OS has (rendering markdown as it streams token-by-token), current, permissively licensed, and hand-rolling safe incremental-markdown parsing is a genuinely nontrivial problem (not a 100-line module) that Streamdown has already solved.

### Sonner (toasts)
- Latest **2.0.8**, published **2026-08-09**. License: **MIT**. React 19 explicitly supported.
- **Verdict: ADOPT (or keep, if already in use).** Reason: current, minimal, React-19-confirmed, and toast notification stacking/timing/accessibility is a small-but-fiddly-enough problem that a maintained library beats a custom one at this size.

---

## 11. Offline capture without CRDT for a single-operator PWA

The house rules already reject Yjs/CRDT (single operator, no concurrent editing) — the right question for this category is therefore narrower than "which sync engine," it's "what's the smallest thing that lets one operator's phone queue writes while offline and replay them on reconnect."

### The minimal design: TanStack Query persistence + a mutation queue
- `@tanstack/query-persist-client-core`: **5.102.8**, published **2026-08-27**, MIT — persists the Query cache itself (reads) to storage (IndexedDB/localStorage via a pluggable persister) so cached data survives a reload or offline gap.
- What it does **not** do on its own: queue *writes* made while offline for later replay — that's a genuinely separate concern (mutations, not cached reads), and TanStack Query's own docs treat offline mutation queuing as a pattern to implement with `MutationCache` + `onlineManager`, not a built-in black box.
- The minimal custom piece: an array (persisted to IndexedDB) of pending mutations, appended to when a write is attempted offline, drained in order through the existing tRPC client when `onlineManager` reports back online, with a small on-conflict rule (last-write-wins is sufficient — there is exactly one writer). This is genuinely a well-under-100-line addition on top of a dependency (`@tanstack/react-query`) StateNour already has.
- **Verdict: ADOPT (build the mutation queue as the ≤100-line custom piece on top of existing TanStack Query).** Reason: this is the textbook net-complexity win — reuses an existing dependency, adds a small, fully-understood amount of custom code, and the single-writer assumption removes the entire conflict-resolution problem that makes the sync engines below heavyweight.

### Dexie (IndexedDB wrapper)
- Repo/npm: **4.4.5**, published **2026-08-14**. License: **Apache-2.0** — actively maintained, long-standing, well-understood library.
- What it adds beyond the minimal design above: a real query-able local database (indexes, compound queries, transactions) if the mutation queue above grows into needing more than an array — e.g., if StateNour ever wants to let the operator browse/search their own queued-but-unsynced data while offline, not just silently replay it.
- **Verdict: STUDY, adopt only if the plain-array queue proves insufficient.** Reason: solid, low-risk option to reach for the moment offline data needs structure beyond a FIFO queue, but adding it before that need is concrete would be complexity ahead of requirement.

### TanStack DB — a genuinely interesting middle option, not a full sync engine
- Repo/npm: **0.8.7**, published **2026-08-31** (one day before this report) — very active, MIT.
- Per its own docs (fetched 2026-09-02): explicitly **"not a CRDT replacement"** — it applies optimistic local writes and reconciles against server responses (confirm or roll back), which is exactly the single-writer client-server model StateNour needs, not peer-to-peer conflict resolution. Described by its own maintainers as **"brownfield by design"**: it works directly against a plain REST/tRPC backend via `queryCollectionOptions()`, with dedicated sync-engine backends (Electric, PowerSync, RxDB, TrailBase) as optional, not required, data sources.
- What it would add over the minimal design: normalized, reactive local collections with live queries — useful if StateNour's UI needs relational-feeling client-side queries across cached data (e.g., "show me all overdue tasks joined with their project"), which is more than a persisted cache and a mutation array provide.
- **Verdict: STUDY.** Reason: unlike the three sync engines below, this one doesn't require new backend infrastructure and explicitly supports the existing tRPC setup — it's a legitimate incremental upgrade path from the minimal design if client-side query complexity grows, not an architecture change. Revisit trigger: if the hand-rolled mutation-queue-plus-cache approach starts accumulating its own ad hoc client-side query/join logic — that's the signal TanStack DB would be replacing real complexity rather than adding speculative complexity.

### Zero, Electric, PowerSync — REJECT, same reason as the CRDT rule
- **Zero** (`@rocicorp/zero`, Rocicorp): 1.9.0, published 2026-08-14, Apache-2.0.
- **Electric** (`@electric-sql/client`, now rebranded — `electric-sql.com` 301-redirects to **`electric.ax`**, a naming change worth knowing about before bookmarking docs): 1.5.27, published 2026-09-01, Apache-2.0. Per its own docs, it is "a read-path sync engine for Postgres" that "requires a sync service running alongside Postgres" — self-hostable, but "the easiest way to use Electric in production is the Electric Cloud," implying real operational weight for the self-hosted path.
- **PowerSync** (`@powersync/web`): 2.3.0, published 2026-09-02, Apache-2.0.
- All three are real, actively-maintained, well-regarded sync engines — and all three exist to solve **multi-writer, real-time, multi-client synchronization with conflict handling**, which is precisely the problem StateNour's single-operator, no-concurrent-editing shape does not have. All three also require standing up a **new backend service** (a sync engine process alongside Postgres), which runs against the same simplicity preference already established by the house rules' Redis-pub/sub rejection ("a Postgres tail is kept instead").
- **Verdict: REJECT, all three.** Reason: solving a problem (multi-writer conflict resolution) that doesn't exist here, at the cost of a new always-on service that does exist as ongoing operational burden — the identical logic the house rules already applied to CRDTs and to resumable-stream+Redis. Revisit trigger: only if StateNour ever adds a second concurrent writer (a second person, or multiple devices writing simultaneously rather than one operator's single phone) — that would be the point the multi-writer problem becomes real.

---

## 12. PWA push, badging, and VAPID libraries

### web-push (npm `web-push`)
- Repo: `https://github.com/web-push-libs/web-push`. License: **MPL-2.0**. Latest **3.6.7**, published **2024-01-16** — at first glance a 2.5-year-stale version number, but the repo itself (`pushed_at` 2026-08-31) shows continuous recent activity that's all **dependency bumps and CI maintenance** (`Bump globals from 17.7.0 to 17.8.0`, `Bump http_ece from 1.2.0 to 1.2.1`, `enable Firefox testing in CI`, all July-August 2026), with `package.json` on `main` still reading `3.6.7`. This reads as a **mature, low-churn library implementing a stable protocol** (VAPID/Web Push is RFC 8291/8292, not a moving target) rather than an abandoned one — the same "frozen spec, healthy maintenance without version churn" pattern as `rrule`, but with more visible recent activity than rrule had.
- **Verdict: ADOPT (or keep, if already in use).** Reason: standard, actively-maintained-if-not-actively-versioned implementation of a settled protocol — no better-maintained alternative found. `@block65/webcrypto-web-push` (MIT, WebCrypto-based instead of Node's `crypto`) exists as an edge-runtime-compatible alternative but is only relevant if StateNour ever needs to send push from an edge function rather than the Railway container it already runs in — **DEFER** that one specifically, not needed today.

### Badging API — better iOS news than it first looks
- MDN flags the Badging API as **not "Baseline"** cross-browser (`https://developer.mozilla.org/en-US/docs/Web/API/Badging_API`, fetched 2026-09-02) — true, but not the whole picture for this project specifically.
- **caniuse gives the platform-specific answer that actually matters here** (`https://caniuse.com/mdn-api_navigator_setappbadge`, fetched 2026-09-02): **41.99% global usage support, with both desktop Safari (17.0+) and iOS Safari (16.4+) listed as supporting `navigator.setAppBadge`/`clearAppBadge`.** iOS Safari 16.4 shipped in March 2023 — meaning essentially every iOS device StateNour's operator could plausibly be running today supports this natively. The "not Baseline" framing is about gaps elsewhere (other engines), not about the specific platform this PWA targets.
- **Verdict: ADOPT.** Reason: native, zero-dependency, and — checked specifically for the platform this project cares about — actually well-supported there, contrary to the more cautious general framing. Use `navigator.setAppBadge()`/`clearAppBadge()` directly; no library needed.

---

## 13. Feature flags for a solo operator

**The argument that decides this whole category before the vendor comparison starts:** every flag platform below (Unleash, GrowthBook, Flagsmith) earns its complexity by managing flags **across a team and across a user population** — percentage-based gradual rollouts, statistically-powered A/B test analysis, approval workflows between people, and SDKs that stay synchronized across many services and many end users. A single operator has none of the multi-*person* problems these solve: there's one user, one approver, and (per this project's own prior infrastructure notes) the actual pattern in use already looks like "flip `competitor_threshold_alerts`" — a boolean being toggled by the person who owns the whole system, not a rollout being managed across a population.

### Unleash
- Repo: `https://github.com/Unleash/unleash`. License: **AGPL-3.0** (verified) — same network-copyleft consideration flagged for ParadeDB/VectorChord in Category 1. Extremely active (13,778 stars, pushed same day).
- **Verdict: REJECT.** Reason: AGPL plus full-platform weight (its own database, its own admin UI, its own SDK-sync protocol) for a one-person use case — no version of "self-hosted Unleash" is lighter than a table for this project's shape.

### GrowthBook
- Repo: `https://github.com/growthbook/growthbook`. License: **MIT** core with an `enterprise/`-directory carve-out under a separate GrowthBook Enterprise License (verified by reading `LICENSE` directly — same open-core pattern seen in Mastra and Langfuse in earlier categories). Very active (8,250 stars, 792 open issues, pushed same day).
- **Note from this project's own prior infrastructure record (not new research for this report, carried over from session context):** GrowthBook already has some footprint in this operator's broader stack — which cuts both ways for this decision: it lowers the marginal cost of using it *if* a real multi-variant-experiment need shows up (the integration muscle already exists somewhere), but it does not on its own justify reaching for it over a table for a flag that's just an on/off switch one operator flips.
- **Verdict: DEFER.** Reason: best-licensed and most actively developed of the three platforms, and not a bad choice *if* StateNour ever needs actual experiment analysis (statistically comparing outcomes across a real user population) — but that need has not been established here, and a table is strictly less complexity for on/off and simple-rollout flags. Revisit trigger: a concrete need for percentage-based rollout with statistical outcome comparison across more than one user.

### Flagsmith
- Repo: `https://github.com/Flagsmith/flagsmith`. License: **BSD-3-Clause** (permissive, verified). Active (6,539 stars, 702 open issues, pushed same day).
- **Verdict: REJECT.** Reason: same shape of over-fit as Unleash — a full platform (API server, own database, admin UI, environment/organization model) for a problem a single boolean column solves. No specific advantage over GrowthBook was found that would justify choosing it instead if a platform were ever warranted.

### OpenFeature — the one piece worth taking, without the platform
- Repo: `https://github.com/open-feature/js-sdk`. License: **Apache-2.0**. Smaller (277 stars) because it's a **specification and SDK interface**, not a flag-management product — a CNCF project defining a vendor-neutral `evaluate()`-style API that any "provider" implements.
- **The actual recommendation:** adopt the OpenFeature *interface* with a custom provider backed by a `feature_flags` Postgres table (key, enabled boolean, value jsonb, updated_at) — this gets a standard call-site API (`client.getBooleanValue('flag-key', false)`) without adopting any of the three platforms above, and leaves the door open to swap in GrowthBook or another provider later purely by writing a new provider, with zero call-site changes, if a real multi-user need ever appears.
- **The ≤100-line custom version:** the table, a tiny cached-read helper (query + short in-memory TTL cache to avoid a DB round-trip per flag check), and — optionally — the OpenFeature provider adapter around it. All comfortably under 100 lines combined.
- **Verdict: ADOPT the table (with or without the OpenFeature interface wrapper).** Reason: this is the cleanest net-complexity win in the whole report — the "existing implementation" (a table) already fully covers the need, and the only defensible upgrade is a thin standard-interface wrapper, not a platform. Revisit trigger: same as GrowthBook above — a real multi-user rollout/experiment need, not before.

---

## 14. Security scanning and supply chain

**Framing note specific to this category:** these are CI/dev-tooling additions, not runtime dependencies shipped in StateNour's app bundle — so the net-complexity question is "CI minutes and config-file maintenance," not "bundle size or attack surface at runtime." A CLI tool's own license (e.g. Semgrep's LGPL below) doesn't propagate to StateNour's code the way a linked runtime dependency's license would, since it runs over the codebase as an external process rather than being imported by it.

### osv-scanner (Google)
- Repo: `https://github.com/google/osv-scanner`. License: **Apache-2.0**. Very active: 10,961 stars, 117 open issues, pushed same day as this report.
- What it does: scans lockfiles against the OSV (Open Source Vulnerabilities) database — free, no account required, runs as a single Go binary in CI.
- **Verdict: ADOPT.** Reason: zero-cost, zero-account, well-maintained, and directly complements `npm audit` with a broader vulnerability database and cleaner CI output; a natural addition to a CI job, not an app dependency.

### npm audit signatures + provenance/SLSA — already free, already there
- Per npm's own docs (`https://docs.npmjs.com/generating-provenance-statements`, fetched 2026-09-02): `npm audit signatures` verifies registry-signature authenticity of installed packages (via Sigstore's transparency ledger) and separately reports which installed packages carry **provenance attestations** — a verifiable link from the published package back to the exact CI build and source commit that produced it. This is a **publisher-side** opt-in (maintainers add `--provenance` when publishing from supported CI like GitHub Actions), checked from the **consumer** side with a single built-in npm command — no new dependency at all.
- SLSA compliance level specifically: **NOT VERIFIED** from npm's own docs page in this pass — the provenance mechanism is SLSA-adjacent (source-to-build traceability) but this report did not confirm which SLSA level, if any, npm's provenance system formally satisfies.
- **Verdict: ADOPT.** Reason: this is free, already built into the npm CLI StateNour already uses, and adds a real supply-chain signal (`npm audit signatures` in CI) for zero new dependencies. The lowest-cost item in this entire report.

### gitleaks
- Repo: `https://github.com/gitleaks/gitleaks`. License: **MIT**. Very active: 29,069 stars, 475 open issues, pushed 2026-08-26.
- What it does: scans git history and working-tree diffs for accidentally-committed secrets (API keys, tokens, credentials) via regex/entropy rules — directly relevant given this operator's own credential-handling patterns (vault files, `.env` secrets, tokens referenced throughout the broader project's own infrastructure notes).
- **Verdict: ADOPT.** Reason: single static binary, MIT-licensed, well-maintained, addresses a real and recurring risk category (secret leakage into a commit) cheaply as a pre-commit hook or CI gate.

### Semgrep
- Repo: `https://github.com/semgrep/semgrep`. License: **LGPL-2.1** for the CLI/engine (a CLI tool invoked over the codebase, not linked into it — see the framing note above). Very active: 16,477 stars, 912 open issues, pushed 2026-09-01.
- What it does: pattern-based static analysis (custom or community rulesets) — broader than secret-scanning or dependency-CVE scanning, catching code-level anti-patterns (e.g. unsanitized input reaching a dangerous sink).
- **Verdict: STUDY.** Reason: genuinely useful but has real config/ruleset maintenance overhead relative to the three "ADOPT" items above, which are closer to zero-config; worth a scoped ruleset (e.g. just the categories relevant to this stack) rather than the full community set, which would need active curation for a single operator to keep signal-to-noise reasonable. Revisit trigger: after osv-scanner/gitleaks/npm-audit-signatures are running cleanly in CI — add Semgrep next if a code-pattern-level gap shows up (e.g. a near-miss injection bug) that the dependency/secret scanners wouldn't have caught.

### lockfile-lint
- Repo: `https://github.com/lirantal/lockfile-lint`. License: **Apache-2.0**. Smaller but real: 868 stars, only 6 open issues, pushed 2026-08-13.
- What it does: validates that lockfile entries resolve to expected registries/hosts and use HTTPS — catches a lockfile-injection/registry-substitution attack class the other tools here don't specifically target.
- **Verdict: ADOPT.** Reason: narrow, cheap, low-maintenance, and closes a specific gap (malicious registry substitution in the lockfile) none of the other four tools cover.

### Socket
- Repo: `https://github.com/socketdev/socket-cli` — license reported as `null`/unset via the GitHub API (**NOT VERIFIED**, check the actual LICENSE file before depending on the CLI's licensing terms specifically; Socket's core product is a hosted service, similar to Braintrust in Category 8). Active: 313 stars, 16 open issues, pushed same day.
- What it does: goes beyond known-CVE scanning to behavioral supply-chain risk signals (a package that starts making network calls, using `eval`, requesting new permissions on update, etc.) — a different threat model than the CVE-database tools above.
- **Verdict: DEFER.** Reason: the free/CLI tier's exact scope and the paid platform's pricing were not verified in this pass, and the four ADOPT items above already cover the highest-value, lowest-cost ground (known CVEs, leaked secrets, signature verification, lockfile integrity); Socket's behavioral-analysis angle is a real but incremental addition, not an obvious must-have at this project's scale. Revisit trigger: after the baseline four tools are running, if a specific incident or near-miss suggests behavioral (not just CVE-database) supply-chain monitoring is worth the cost.

---

## 15. Visual-regression and accessibility testing

### Playwright
- Repo: `https://github.com/microsoft/playwright`. License: **Apache-2.0**. The clear standard: 95,526 stars, extremely active (pushed same day as this report). `@playwright/test` at **1.62.1** (published 2026-07-30). Built-in screenshot comparison (`toHaveScreenshot()`) covers visual regression without a separate product.
- **Verdict: ADOPT.** Reason: no serious competing option found for browser-driven E2E/visual-regression testing in this ecosystem; this is also directly available as this session's own tooling (the `mcp__plugin_playwright_playwright__*` and `mcp__Claude_Browser__*` tool families), so there's no integration gap between "what CI runs" and "what an agent session can drive interactively."

### axe-core (+ `@axe-core/playwright`)
- Repo: `https://github.com/dequelabs/axe-core`. License: **MPL-2.0**. Very active: 7,468 stars, pushed 2026-09-01. `axe-core` at **4.13.0** (2026-08-05), with the first-party `@axe-core/playwright` integration package published days later at the matching **4.13.0** (2026-08-11) — the two are kept in lockstep.
- **Verdict: ADOPT.** Reason: the de facto standard automated accessibility ruleset, actively maintained, with a first-party Playwright binding that removes any integration-glue work — directly relevant given Category 10's dense-UI accessibility focus (Radix/React Aria correctness is only confirmed by actually running an accessibility scan against it).

### Lighthouse CI — the wrapper is stale, the engine underneath isn't
- Repo: `https://github.com/GoogleChrome/lighthouse-ci`. License: **Apache-2.0**, but `pushed_at` **2026-03-27** (~5 months stale) and the npm package `@lhci/cli` last published **2025-06-25** (over a year stale) — a real slowdown, no explicit deprecation notice found in the README, so treat as "quieted down," not confirmed dead.
- **The underlying engine is fine:** the core `lighthouse` npm package itself is current (**13.4.1**, published 2026-07-20) — it's specifically the CI-orchestration wrapper/server (`@lhci/cli`, for storing and diffing historical scores) that's gone quiet, not Lighthouse auditing itself.
- **A genuinely newer 2026 option worth naming:** Lighthouse auditing is increasingly reachable through agent/MCP-integrated tooling rather than a standalone CI server — this session's own Chrome DevTools MCP toolset includes a `lighthouse_audit` capability, letting an agent run a Lighthouse pass interactively as part of a review rather than only as a scheduled CI job.
- **Verdict: ADOPT the `lighthouse` CLI directly in CI (e.g. via a simple script or the community `treosh/lighthouse-ci-action` wrapper — NOT VERIFIED as independently vetted in this pass, name noted for follow-up); DEFER the full `@lhci/cli` server** given its specific staleness, and use MCP-driven Lighthouse audits for ad hoc/agent-assisted checks. Reason: the actual auditing engine is healthy and worth using; the historical-tracking server component is the one piece worth being cautious about adopting fresh today.

---

## 16. Document parsing in 2026

### The rule that decides most of this category: try native text extraction before OCR, always
A digitally-native PDF (produced by a word processor, invoice system, bank statement generator, etc.) already has a text layer — extracting it is fast, free, exact, and requires no model call at all. OCR (classical or vision-model) is only needed when that text layer is absent or unreliable (a scanned page, a photographed receipt, a fax). The correct pipeline is therefore: **attempt native extraction first; fall back to OCR only when the extracted text is empty, near-empty, or fails a garbage-ratio check** — not "OCR everything" and not "assume every PDF has a clean text layer."

### pdfjs-dist (Mozilla PDF.js)
- npm: **6.3.289**, published **2026-08-29**. License: **Apache-2.0**. This is Mozilla's own PDF rendering/parsing engine (what Firefox uses internally), exposed as a library — the most authoritative native-JS PDF text-layer extractor available.
- **Verdict: ADOPT.** Reason: current, permissively licensed, TypeScript-friendly, and is the reference implementation, not a wrapper around something else.

### unpdf
- npm: **1.8.1**, published **2026-08-13**. License: **MIT**. A thin, serverless/edge-friendly wrapper around pdf.js's core specifically built to avoid pdf.js's browser-oriented baggage (worker setup, DOM assumptions) in a Node/edge runtime.
- **Verdict: ADOPT as the practical integration layer over pdfjs-dist.** Reason: solves exactly the friction (pdf.js's browser-first packaging) that makes raw `pdfjs-dist` annoying to use directly from a Node server context; current and permissively licensed.

### Docling (IBM) and Marker (Datalab) — powerful, but a language-boundary problem
- **Docling**: `https://github.com/docling-project/docling`. License: **MIT**. Enormous adoption (65,896 stars) and extremely active (pushed same day as this report). Handles complex layout — tables, figures, multi-column text, reading order — better than plain text-layer extraction for structurally complex documents.
- **Marker**: `https://github.com/datalab-to/marker`. License: **Apache-2.0**. Also very active (39,478 stars, pushed 2026-08-31), converts PDFs (including scanned ones, via integrated OCR/layout models) to clean Markdown.
- **Both are Python-only**, confirmed by checking for JS/npm equivalents directly: `marker-pdf` (the actual PyPI/repo name) has no corresponding npm package (404 on the registry); an npm package literally named `docling` exists but is a **squatted placeholder** — published as `0.0.1` and unpublished the same day in March 2025 (confirmed via the npm registry's own record) — not a real integration.
- **Verdict: STUDY, do not integrate directly.** Reason: both are best-in-class for genuinely complex document layouts, but bringing either in means running a Python service alongside StateNour's TS stack — the same language-boundary cost paid in Categories 4 and 6 for Graphiti/Cognee/NeMo Guardrails. Worth reaching for only if a specific document class (dense multi-column tables, forms) proves to need layout-aware extraction that plain text-layer extraction genuinely can't provide — and even then, as an external service call, not an in-process dependency. Revisit trigger: a concrete document type in StateNour's actual usage that native extraction handles badly.

### OCR: vision-model calls beat Tesseract.js for this project's likely volume
- **tesseract.js**: `https://github.com/naptha/tesseract.js`. License: **Apache-2.0**. Active enough (38,688 stars) but `pushed_at` **2026-05-17** — about 3.5 months stale at report time, 49 open issues (a healthy ratio, not alarming on its own).
- Classical OCR engines like Tesseract are weaker than current vision-capable LLMs on messy real-world input — skewed photos, handwriting, receipts, low-contrast scans — which is exactly the kind of document a personal AI OS operator is likely to throw at it (a photographed receipt or note), not clean scanner output.
- **The zero-new-dependency option:** StateNour already has AI SDK v6 with access to vision-capable models — sending a page image directly to a vision model with an extraction prompt is available today with no new package, and per-page cost is trivial at a single operator's document volume (occasional uploads, not bulk digitization).
- **Verdict: DEFER tesseract.js; ADOPT vision-model OCR as the fallback path (native extraction first, per the rule above).** Reason: better accuracy on the realistic input shape (photos, not scans), zero new dependency since AI SDK v6 already provides the vision-model call path, and avoids adding a moderately-stale OCR library for a capability already reachable through an existing dependency. Revisit trigger: if per-page vision-model OCR cost becomes material at higher document volume than expected — that's the point classical OCR's zero-marginal-cost starts to matter more than its lower accuracy.

---

## 17. Voice for a phone-first PWA

### OpenAI Realtime API
- Docs: `https://developers.openai.com/api/docs/guides/realtime` (note: `platform.openai.com/docs/guides/realtime` now 301-redirects here, same pattern seen with the pricing page in Category 3). Confirmed **General Availability** — the docs explicitly cover migrating off the old beta header (`OpenAI-Beta: realtime=v1`), which is now retired.
- Current model line: `gpt-realtime-2.1` (voice agents), `gpt-realtime-translate` (live translation), `gpt-live-transcribe` (streaming transcription).
- **Browser/PWA fit, stated directly by the docs:** WebRTC is the recommended connection method specifically for "browser and mobile clients that capture or play audio directly" — this is close to a direct description of an iOS PWA's voice-input use case.
- Pricing: **NOT VERIFIED** in this pass (not shown on the fetched guide page).
- **Verdict: ADOPT as the primary path if StateNour wants live, low-latency, two-way voice conversation** (as opposed to simple record-then-transcribe). Reason: GA (not beta), first-party WebRTC guidance matches the PWA delivery shape directly, and it's a single vendor/integration surface rather than stitching together separate STT+LLM+TTS services for that specific use case. Revisit trigger: confirm current per-minute pricing against actual usage patterns before committing, since that wasn't verified here.

### Deepgram
- npm `@deepgram/sdk`: **5.9.0**, published **2026-08-28** — actively maintained.
- Specialist STT (speech-to-text) provider, typically priced and tuned for transcription accuracy/latency rather than bundled two-way voice-agent behavior — relevant if StateNour wants best-in-class transcription (e.g., dictated notes) decoupled from a live conversational loop.
- **Verdict: STUDY.** Reason: a real, current option for pure transcription specifically, but overlaps with what OpenAI Realtime's `gpt-live-transcribe` already covers if that path is adopted — worth a direct accuracy/cost comparison for StateNour's actual dictation use case rather than assuming either is better. Revisit trigger: if transcription accuracy on the operator's actual voice/accent/environment proves to be a gap with the Realtime API's built-in transcription.

### ElevenLabs
- npm `@elevenlabs/elevenlabs-js`: **2.66.0**, published **2026-09-02** (same day as this report) — very actively maintained.
- Specialist TTS (text-to-speech), widely regarded as a top-quality voice-synthesis provider; this project's own prior infrastructure notes already record an ElevenLabs API key and awareness of its free-tier limits (10k characters/month), so there is zero net-new integration cost if that credential is reused here rather than provisioned fresh.
- **Verdict: ADOPT for TTS specifically if voice output quality matters more than the bundled voice-agent convenience of OpenAI Realtime** (e.g., for a distinctive assistant voice, or longer spoken responses where synthesis quality is more noticeable than in short back-and-forth exchanges). Reason: already-provisioned credential, current SDK, best-in-class synthesis quality; not a redundant add if it's serving a different need (voice character/quality) than Realtime's bundled voice serves (low-latency conversational loop).

### LiveKit
- Repo: `https://github.com/livekit/livekit`. License: **Apache-2.0**. Very active (20,656 stars, pushed same day as this report, 193 open issues).
- What it is: a full WebRTC media-server (SFU) platform for building custom real-time audio/video pipelines — the infrastructure layer *underneath* a voice product, not a voice product itself.
- **Verdict: REJECT for this project's shape.** Reason: this replaces exactly the WebRTC transport that OpenAI Realtime already provides first-party for the browser/PWA case — running a self-hosted or LiveKit-Cloud media server on top would be net-new infrastructure solving a transport problem StateNour doesn't have unless it needs multi-party calls or a custom non-OpenAI voice pipeline, neither of which is indicated here. Revisit trigger: only if StateNour ever needs multi-participant voice/video (more than the operator and one AI voice) or a provider-agnostic voice transport independent of any single vendor's Realtime API.

### edge-tts and Whisper variants — free options, with real caveats
- `edge-tts` (`rany2/edge-tts`): license `NOASSERTION` on GitHub (**NOT VERIFIED** against the actual file), `pushed_at` **2026-03-22** (~5.5 months stale, but only 4 open issues against 11,844 stars — reads as stable/low-maintenance-needed rather than abandoned). It is an **unofficial, reverse-engineered wrapper around Microsoft Edge's browser TTS service** — free, decent quality, but running on an unofficial integration with no SLA and a real risk that Microsoft changes the underlying (undocumented) API without notice.
- Whisper variants (OpenAI's open-weight STT model family, and its many community-optimized ports) were not individually re-verified in this pass — **NOT VERIFIED** version/license details here; the practical point for this project is that OpenAI's own hosted `gpt-live-transcribe` (Realtime API) and Whisper-based hosted transcription endpoints likely cover the need without a self-hosted model, given StateNour's Railway container has no GPU.
- **Verdict: REJECT edge-tts (unofficial API, real breakage risk, no clear advantage over ElevenLabs' already-provisioned credential); DEFER self-hosted Whisper variants** (no GPU on the current Railway footprint makes self-hosting a real lift for a capability the hosted APIs above already cover). Revisit trigger for Whisper: only if per-minute hosted-transcription cost becomes material at a volume that would justify GPU infrastructure — not indicated here.

---

## 18. Genuinely new in 2026

### MCP had a major, very recent protocol overhaul — verify which version any integration targets
Checked directly against the official spec (`https://modelcontextprotocol.io/specification/versioning` and the `2026-07-28` changelog, fetched 2026-09-02): the **current** MCP protocol revision is **`2026-07-28`**, superseding `2025-11-25`, and the changes are large enough that anything built against the older `2025-06-18` elicitation model (which this report initially read first) is now out of date. In order of relevance to a personal AI OS:
- **Elicitation was completely redesigned.** The `2025-06-18` model (server sends a standalone `elicitation/create` request mid-interaction) is gone. The new **Multi Round-Trip Requests (MRTR)** pattern (SEP-2322) has servers return an `InputRequiredResult` (`resultType: "input_required"`) on the *original* request, and the client retries that same request with `inputResponses` once it has the answer — no more separate server-initiated request/notification pair, and the `notifications/elicitation/complete` notification introduced in `2025-11-25` was itself removed one revision later. **If StateNour builds or depends on an MCP server using elicitation, verify which spec revision its SDK targets before assuming either behavior.**
- **"Tasks" moved out of core into an official extension** (`io.modelcontextprotocol/tasks`, SEP-2663), redesigned around polling (`tasks/get`, `tasks/update`) instead of a blocking `tasks/result` call — directly relevant for any MCP-exposed long-running operation (matches the kind of async job StateNour already models with Inngest on its own side).
- **The protocol went stateless**: the `initialize`/`notifications/initialized` handshake and the `Mcp-Session-Id` header are both removed (SEP-2575); every request now self-declares its protocol version and capabilities via `_meta`, and a new mandatory `server/discover` RPC lets a client learn a server's supported versions/capabilities/identity up front. This is a bigger architectural change than a version bump — a server or client written against the old handshake model needs explicit backward-compatibility handling, which the spec does document.
- **Roots, Sampling, and Logging are now formally Deprecated** (SEP-2577, 12-month minimum deprecation window) — new MCP integrations should not build against these; the spec's own suggested migration for Sampling specifically is "integrate directly with LLM provider APIs instead," which is already what AI SDK v6 gives StateNour.
- New `ttlMs`/`cacheScope` fields on list/read results (SEP-2549) give clients an explicit caching hint — relevant if StateNour caches MCP tool/resource listings client-side.
- **Verdict: STUDY / ADOPT-AWARE.** Reason: this isn't a dependency decision, it's a "know before you build" fact — any current or future MCP server/client work should target `2026-07-28` semantics (or confirm exactly which older revision a given third-party MCP server actually implements), not the more commonly-blogged-about `2025-06-18` elicitation model. Revisit trigger: before writing or updating any MCP client/server integration, re-check `https://modelcontextprotocol.io/specification/versioning` for the then-current revision.

### A2A (Agent2Agent) protocol
- Per `https://a2a-protocol.org/latest/` (fetched 2026-09-02): originally built by Google, **donated to the Linux Foundation**, now under a Technical Steering Committee with AWS/Cisco/IBM Research/Microsoft/Salesforce/SAP/ServiceNow representation, and has **reached v1.0**, joining something the fetched page calls the "Agentic AI Foundation" (**NOT VERIFIED** further — this report did not independently confirm the precise nature/scope of that foundation beyond the one page fetched). Official SDKs exist for Python, JS, Java, C#/.NET, Go, and Rust.
- Positioning relative to MCP, stated directly: MCP is agent-to-tool (what StateNour already uses for tool/resource access); A2A is agent-to-agent (independent agents discovering each other and delegating tasks across frameworks) — a different problem than anything else in this report.
- **Verdict: DEFER.** Reason: StateNour is a single-operator system, not a multi-agent-vendor interoperability platform — A2A solves a problem (letting agents built by different teams/companies talk to each other) that doesn't arise for one operator's own agents talking to each other, which they can already do directly. No concrete adoption metrics were found in this pass to weigh against that. Revisit trigger: only if StateNour ever needs to interoperate with a third party's independently-built agent rather than orchestrating its own.

### On-device inference: WebGPU is now real on iOS, WebNN still isn't
- Checked directly (`https://caniuse.com/webgpu`, fetched 2026-09-02): **85.56% global usage support**, and — the fact that matters most for this specific project — **iOS Safari gained full WebGPU support starting at version 26.0** (desktop Safari, by contrast, still shows only partial support through 26.x). This is a real, recent, platform-specific capability unlock: client-side, in-PWA model inference (e.g., a small on-device embedding or classification model via `transformers.js`'s WebGPU backend) is now genuinely viable on current iOS in a way it was not until recently.
- WebNN (the other on-device-inference browser API) was **NOT VERIFIED** in this pass — no direct check was made of its Safari/iOS support status; treat as unconfirmed rather than assuming parity with WebGPU's iOS support.
- **Verdict: STUDY.** Reason: this doesn't change any verdict elsewhere in this report (the reranker and OCR discussions in Categories 2 and 16 both assumed server-side execution on Railway, which remains correct for anything needing to stay off the operator's device or work regardless of device capability) — but it's a genuinely new option worth knowing about for any *future* feature specifically wanting zero-network-round-trip, on-device processing (e.g., instant client-side search-as-you-type over already-synced data). Revisit trigger: a specific feature idea that would benefit from on-device inference and can tolerate iOS 26+ as a floor.

### Computer-use APIs
- Not independently re-verified against vendor docs in this pass (**NOT VERIFIED** pricing/API-stability specifics) — noted here because this exact working session has direct, lived access to computer-use and browser-automation tool families (desktop control, Chrome-extension-based browser control) as part of its own toolset, which is itself evidence these capabilities have matured enough in 2026 to be routinely available in agentic tooling, not just a research demo. Relevance to StateNour specifically as a *personal* AI OS: a computer-use capability is a much larger trust/security surface than anything else in this report (it can take real-world action on a real device) — worth treating as a separate, higher-scrutiny decision if ever considered, not something to fold into a dependency-budget line item.
- **Verdict: DEFER, out of scope for a dependency-budget-style decision.** Reason: not evaluated as a library/vendor choice here; flagged only as a category that exists and is maturing. Revisit trigger: a specific proposed use case, evaluated on its own security merits rather than as a routine dependency addition.

---

## Dependency budget proposal

**Rule: at most 3 new *runtime* (production) dependencies adopted per quarter, each carrying a one-paragraph justification written before merge — not after.** Runtime means: ships to the browser bundle, runs in the Railway server process, or is called as a hosted API from production code. This report's own per-candidate format is the template for that paragraph — it should state, in a few sentences each:
1. **What it deletes or replaces** — a named piece of existing custom code, or a named gap with no current coverage (not "might be nice").
2. **License + security posture** — SPDX license, whether it's actively maintained (checked against a primary source, not a star count), and whether it has a real disclosure process.
3. **Net-complexity math** — what it costs (new infra? new language? new egress path?) versus what a ≤100-line custom version would look like, stated explicitly even when the conclusion is "not worth building by hand."
4. **A named revisit trigger** — the specific, checkable condition that would change the verdict, not "revisit later."

**Separate, looser budget for dev-only tooling** (test frameworks, linters, CI scanners, one-off scripts that never ship to production): no hard quarterly cap, but each addition still needs the license+maintenance check — dev-tooling risk is lower (no runtime attack surface, no user-facing egress) but not zero (supply-chain compromise of a build-time tool is a real, documented attack class).

**A stricter, separate gate for anything that adds a *new backend service or new database technology*** (a graph database, a sync engine, a second durable-execution system, a self-hosted eval platform's storage stack): at most **one such addition per half-year**, and only with a named operator-facing capability gap that nothing already running can cover — this report found zero candidates across 18 categories that clear this bar today (Category 1's Neon Lakebase Search is the closest, and it adds no new infrastructure since it's bundled into the database StateNour already runs).

**Why 3/quarter and not a bigger or smaller number:** small enough to force real prioritization among this report's own ADOPT list (there are more than 3 genuinely current, well-evidenced candidates above — e.g. chrono-node, TanStack Virtual, Streamdown, pdfjs-dist/unpdf, React Aria, osv-scanner/gitleaks/lockfile-lint as a CI batch — so the cap is the actual constraint, not a formality); large enough that a single operator isn't blocked from taking genuinely free wins (a current, permissively-licensed, well-evidenced library replacing real hand-rolled complexity) at a reasonable pace. Dev-tooling and CI-only additions (Category 14, Category 15) don't count against the runtime cap precisely because their blast radius is smaller.

## DO-NOT-ADD list

Durable rejections from this report, with reasons — do not re-propose without a stated change in the trigger condition:

- **pgvectorscale, VectorChord** (Category 1) — not on Neon's extension allow-list; would require leaving managed Neon.
- **ParadeDB pg_search** (Category 1) — Neon is actively removing it (full removal 2026-09-21); re-evaluate only off-Neon.
- **Graphiti (self-hosted), Cognee** (Category 4) — both require a new graph database (Neo4j/FalkorDB/etc.) and are Python-only with no viable TS integration; Cognee's Postgres-native pitch is a paid-license feature, not the free tier.
- **Letta** (Category 4) — an agent-runtime replacement disguised as a memory library; would replace StateNour's own AI SDK v6/tRPC/Inngest orchestration wholesale.
- **LangGraph.js** (Category 5) — a second durable-execution/checkpointing system competing with Inngest, the same objection already applied to Temporal.
- **OpenAI Agents SDK (JS)** (Category 5) — pure overlap with AI SDK v6's own provider-agnostic agent primitives.
- **Inngest AgentKit** (Category 5) — DEFERRED not rejected outright, but 9-months-stale from the same vendor as core Inngest; don't reach for it until it shows renewed investment.
- **LLM Guard, Rebuff** (Category 6) — both formally archived/dead by their own maintainers' declaration.
- **NeMo Guardrails, Lakera Guard** (Category 6) — new language/runtime (Colang) or data-egressing third party, respectively, for a threat the free datamarking technique already covers.
- **Unleash, Flagsmith** (Category 13) — full flag-management platforms (Unleash also AGPL) for a single-operator on/off-switch need a table already covers.
- **Zero, Electric, PowerSync, LiveKit** (Categories 11 and 17) — all solve multi-writer/multi-party problems this single-operator PWA doesn't have, each at the cost of a new standing service.
- **edge-tts** (Category 17) — unofficial, reverse-engineered API with no SLA; ElevenLabs is already provisioned.
- **Yjs/CRDT, Temporal, resumable-stream+Redis pub/sub** — pre-existing house rules, reaffirmed by every adjacent finding in this report (Categories 4, 5, 11 each independently arrived at the same logic from a different angle).
- **A second general-purpose date library (Luxon) alongside date-fns v4** (Category 9) — redundant, no capability gap identified.

---

## Sources

All accessed 2026-09-02 unless otherwise noted. GitHub facts (license, tags, dates, issue counts) were pulled via the authenticated `gh api` CLI against `api.github.com`, not by browsing github.com pages, and are cited here by the corresponding repository URL.

**Category 1 — Postgres retrieval**
- `https://github.com/pgvector/pgvector` (tags/CHANGELOG.md/LICENSE via API) · `https://neon.com/docs/extensions/pg-extensions` · `https://neon.com/docs/extensions/pg_search` · `https://neon.com/docs/ai/lakebase-search` · `https://neon.com/blog/lakebase-search-on-neon` · `https://github.com/timescale/pgvectorscale` · `https://github.com/paradedb/paradedb` · `https://github.com/tensorchord/VectorChord` (LICENSE) · `https://www.cnbc.com/2025/05/14/databricks-is-buying-database-startup-neon-for-about-1-billion.html` · `https://supabase.com/docs/guides/ai/hybrid-search` · NVD/vendor coverage of CVE-2026-3172 (`https://nvd.nist.gov/vuln/detail/CVE-2026-3172`, `https://www.sentinelone.com/vulnerability-database/cve-2026-3172/`)

**Category 2 — Rerankers**
- `https://openrouter.ai/cohere/rerank-v3.5` · `https://openrouter.ai/voyageai/rerank-2.5` · `https://jina.ai/reranker/` · Hugging Face model API for `BAAI/bge-reranker-v2-m3` and `Qwen/Qwen3-Embedding-8B` (`https://huggingface.co/api/models/...`) · `https://github.com/mixedbread-ai/mxbai-rerank` · `https://www.mixedbread.com/docs/models/reranking/mxbai-rerank-large-v2` · `https://huggingface.co/blog/transformersjs-v3` · `https://huggingface.co/blog/transformersjs-v4`

**Category 3 — Embeddings**
- `https://developers.openai.com/api/docs/pricing` and `.../models/text-embedding-3-large` · `https://docs.voyageai.com/docs/pricing` · `https://github.com/QwenLM/Qwen3-Embedding` · `https://ai-sdk.dev/docs/ai-sdk-core/embeddings`

**Category 4 — Memory systems**
- LoCoMo paper: `https://arxiv.org/abs/2402.17753` · LongMemEval paper: `https://arxiv.org/abs/2410.10813` · Graphiti paper: `https://arxiv.org/abs/2501.13956` · `https://github.com/getzep/graphiti` (README) · `https://github.com/mem0ai/mem0` (README, SECURITY.md) · `https://docs.mem0.ai/components/vectordbs/dbs/pgvector` · `https://github.com/letta-ai/letta` · `https://github.com/topoteretes/cognee` (README) · `https://github.com/langchain-ai/langmem` · `https://registry.npmjs.org/mem0ai` · follow-on critique papers `https://arxiv.org/html/2602.10715v1` and `https://arxiv.org/pdf/2605.01688`

**Category 5 — Agent orchestration**
- `https://agentkit.inngest.com/overview` · `https://ai-sdk.dev/docs/agents/overview` · `https://github.com/inngest/agent-kit` + `https://registry.npmjs.org/@inngest/agent-kit` · `https://github.com/mastra-ai/mastra` (LICENSE.md) + `https://registry.npmjs.org/@mastra/core` · `https://mastra.ai/en/docs/workflows/overview` · `https://github.com/langchain-ai/langgraphjs` + `https://registry.npmjs.org/@langchain/langgraph` · `https://github.com/openai/openai-agents-js` + `https://registry.npmjs.org/@openai/agents`

**Category 6 — Prompt-injection defenses**
- Spotlighting paper: `https://arxiv.org/abs/2403.14720` · Instruction Hierarchy paper: `https://arxiv.org/abs/2404.13208` · `https://github.com/protectai/llm-guard` (README archival notice) · `https://github.com/protectai/rebuff` · `https://github.com/NVIDIA/NeMo-Guardrails` · `https://www.lakera.ai/lakera-guard`

**Category 7 — Sandboxing**
- `https://github.com/e2b-dev/E2B` + `https://registry.npmjs.org/e2b` · `https://vercel.com/docs/vercel-sandbox` · `https://github.com/cloudflare/sandbox-sdk` · `https://github.com/laverdet/isolated-vm` · `https://github.com/patriksimek/vm2` (README, npm deprecation status)

**Category 8 — Evals and tracing**
- `https://opentelemetry.io/docs/specs/semconv/gen-ai/` · `https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/` · `https://github.com/langfuse/langfuse` (LICENSE) + `https://registry.npmjs.org/@langfuse/tracing` · `https://langfuse.com/docs/sdk/typescript/guide` · `https://github.com/braintrustdata/braintrust-sdk` · `https://github.com/promptfoo/promptfoo` · `https://github.com/UKGovernmentBEIS/inspect_ai` + PyPI `inspect-ai`

**Category 9 — Scheduling**
- `https://caniuse.com/temporal` · `https://registry.npmjs.org/date-fns`, `/@date-fns/tz`, `/chrono-node`, `/luxon` · `https://github.com/jkbrzt/rrule`

**Category 10 — UI primitives**
- npm registry `peerDependencies` for `@base-ui-components/react`, `@radix-ui/react-dialog`, `react-aria`, `cmdk`, `@tanstack/react-virtual`, `@tanstack/react-table`, `streamdown`, `sonner` · `https://github.com/mui/base-ui` · `https://github.com/pacocoursey/cmdk`

**Category 11 — Offline capture**
- `https://tanstack.com/db/latest` · `https://electric.ax/docs/intro` (redirected from `electric-sql.com`) · npm registry for `@tanstack/query-persist-client-core`, `@tanstack/db`, `dexie`, `@rocicorp/zero`, `@electric-sql/client`, `@powersync/web`

**Category 12 — PWA push/badging**
- `https://github.com/web-push-libs/web-push` (commit history) · `https://developer.mozilla.org/en-US/docs/Web/API/Badging_API` · `https://caniuse.com/mdn-api_navigator_setappbadge`

**Category 13 — Feature flags**
- `https://github.com/Unleash/unleash` · `https://github.com/growthbook/growthbook` (LICENSE) · `https://github.com/Flagsmith/flagsmith` · `https://github.com/open-feature/js-sdk`

**Category 14 — Security scanning**
- `https://github.com/google/osv-scanner` · `https://docs.npmjs.com/generating-provenance-statements` · `https://github.com/gitleaks/gitleaks` · `https://github.com/semgrep/semgrep` · `https://github.com/lirantal/lockfile-lint` · `https://github.com/socketdev/socket-cli`

**Category 15 — Testing**
- `https://github.com/microsoft/playwright` · `https://github.com/dequelabs/axe-core` + `https://registry.npmjs.org/@axe-core/playwright` · `https://github.com/GoogleChrome/lighthouse-ci` + `https://registry.npmjs.org/@lhci/cli` and `/lighthouse`

**Category 16 — Document parsing**
- `https://registry.npmjs.org/pdfjs-dist`, `/unpdf`, `/docling` (unpublished-placeholder record) · `https://github.com/docling-project/docling` · `https://github.com/datalab-to/marker` (`marker-pdf` on PyPI, no npm equivalent) · `https://github.com/naptha/tesseract.js`

**Category 17 — Voice**
- `https://developers.openai.com/api/docs/guides/realtime` (redirected from `platform.openai.com`) · `https://registry.npmjs.org/@deepgram/sdk`, `/@elevenlabs/elevenlabs-js` · `https://github.com/livekit/livekit` · `https://github.com/rany2/edge-tts`

**Category 18 — What's new**
- `https://modelcontextprotocol.io/specification/versioning` · `https://modelcontextprotocol.io/specification/2026-07-28/changelog` · `https://modelcontextprotocol.io/specification/2025-06-18/changelog` · `https://a2a-protocol.org/latest/` · `https://caniuse.com/webgpu`

*End of report.*


