# Track 5 — Research Engine: search / crawl / extract / RAG (verified 2026-09-03)

GitHub metadata pulled live from the API 2026-09-03. `[2nd]` = secondary source, unverified.

## 0. Bottom line
| Question | Answer |
|---|---|
| Best $0 search backbone | **Tavily free (1,000 credits/mo, no card)** + free scholarly APIs + SearXNG *for DuckDuckGo only* |
| Best <$25/mo | **Serper $50 prepaid pack** (6-mo validity → ~$8.34/mo for ~8,300 q/mo) + Tavily free + Exa free $10/mo credits + Jina Reader $5 ≈ **$13–14/mo** |
| **Biggest 2026 change** | **Bing Web Search API is DEAD (2025-08-11). Brave KILLED its free tier (Feb 2026). Google CSE JSON API is CLOSED to new customers and dies 2027-01-01.** The "free Google SERP" era is over. |
| Biggest framework change | **`langchain-ai/open_deep_research` is ARCHIVED** (`archived: true`, last push 2026-08-10). Successor: **`langchain-ai/deepagents`**. Do not build on the archived repo. |
| Where Python is unavoidable | Docling, Marker, MinerU, Unstructured, trafilatura, Crawl4AI, all OCR VLMs. Everything else has a Node-native or HTTP-only path. |

## 1. Search access — real numbers
| Service | Free tier (Sep 2026) | Paid | Verdict |
|---|---|---|---|
| **Tavily** | **1,000 credits/mo, NO credit card** | $30/4k · $100/15k · PAYG $0.008/cr | **KEEP** — only real no-card monthly free tier left; LLM-shaped output |
| **Exa** | **$20 signup + $10/mo STANDING free credits** (~1,400 searches/mo) | Search $7/1k (raised from $5 Mar 2026) | **KEEP** — the recurring $10/mo is quietly the best standing freebie |
| **Serper** | **2,500 free queries, no card**, 6-mo validity | Prepaid packs **$1.00/1k → $0.30/1k** `[2nd]` | **KEEP** — cheapest $/query by ~5x |
| **Brave** | **NO free plan.** $5/mo credit contingent on **public attribution**; card required | Search $5/1k | **AUGMENT** — free tier died Feb 2026; saved card now bills; no spend cap |
| **Mojeek** | trial on request | Startup £2 CPM · Business £3 CPM | **AUGMENT** — **explicitly grants storage rights + AI usage permissions**, rare and valuable; independent index |
| **Marginalia** | Free non-commercial key (**CC-BY-NC-SA 4.0**) | commercial metered | **AUGMENT** — a *different* index (long-tail, non-SEO). Public demo key 503s constantly |
| **SearchApi** | 100 free | $40/mo = 10k | **WATCH** — ⚠ hourly cap = 20% of monthly credits |
| **Jina Reader** | keyless ~20 RPM; **10M free tokens** on signup | ~$0.05/1M tokens `[2nd]` | **KEEP** — best $/page for URL→markdown without a browser |
| **Bing Web Search API** | — | — | **DO NOT USE — retired 2025-08-11.** Every sub-API gone. Migration = full Azure AI Foundry commitment, not a drop-in |
| **Google CSE JSON** | 100 q/day | $5/1k, cap 10k/day | **DO NOT USE (new)** — closed to new customers; **REPLACE** by 2027-01-01 if you have a key |
| Common Crawl | free over HTTPS (`data.commoncrawl.org`) | bandwidth only | **WATCH** — latest index CC-MAIN-2026-34; offline corpus only, latency/freshness rule it out of a live loop |
| Parallel.ai / Linkup | — | ⚠ sources conflict ($1 vs $5/1k; €50 vs $250/1k) | **WATCH** — verify directly |

**Free-forever structured sources most stacks forget:** OpenAlex, Crossref, arXiv, Europe PMC/PubMed,
Semantic Scholar, Wikipedia/Wikidata. For any scholarly/reference component these beat paid web
search per dollar by an unbounded margin. ⚠ OpenAlex + Semantic Scholar rate limits could not be
re-verified this pass — confirm caps before designing a loop around them.

### SearXNG — the brutally honest section
AGPL-3.0 · 36,466 stars · ~275 contributors · commits **daily** · rolling releases, date-tagged.

**Solves:** privacy, zero marginal cost, one normalized JSON shape over ~200 engines, no billing surprise.

**Does NOT solve** — measured from one datacenter IP, 2026-07-22:
| Engine | Result |
|---|---|
| Google | **zero parseable results** |
| Brave | suspended — too many requests |
| Startpage | suspended — CAPTCHA |
| DuckDuckGo | 10 results, worked |

**1 of 4 engines usable.** Further friction: JSON API **disabled by default**; bot limiter needs
Valkey/Redis and blocks programmatic access until reconfigured; Wikidata 403 at init →
`KeyError: 'wikidata'` crash; ~0.83s median latency; `number_of_results` returns garbage.

> **A self-hosted SearXNG without a residential proxy pool is a DuckDuckGo proxy with extra steps,
> not a free Google SERP API.** Google's blocking is upstream — no `settings.yml` fixes it. Adding
> proxies converts "free software" into a recurring proxy bill plus continuous parser maintenance
> (that's what the daily commits are). Hyperscaler IPs get CAPTCHA-walled fastest.
> **ToS:** you are the party in breach, not the project. Fine for a personal agent; do not build a product on it.

**Verdict: AUGMENT** — breadth/diversity source (DuckDuckGo + Wikipedia + arXiv + Mojeek + Marginalia
engines, which don't fight you). Never the only path. Never expect Google.

## 2. Crawl / fetch
| Tool | License | Stars | Latest | JS | Politeness | Verdict |
|---|---|---|---|---|---|---|
| **Crawl4AI** | Apache-2.0 | 81,190 | **v0.9.3 · 2026-08-31** (security release: 5 coordinated advisories + 33 fixes) | Playwright | manual | **KEEP — pin ≥0.9.3.** Python sidecar required |
| **Crawlee (JS/TS)** | Apache-2.0 | — | active | yes | configurable | **KEEP** — only OSS crawler with built-in fingerprint rotation, and **native to a Next.js/TS stack** |
| **Scrapy** | BSD-3 | 64,186 | 2.18.0 · 2026-08-20 | via plugin | **best in class** (robots on by default, AutoThrottle) | **KEEP** for scheduled polite resumable crawls |
| Firecrawl | **AGPL-3.0** (SDKs MIT) | 176,024 | v2.11.0 · 2026-06-19 | yes | managed in cloud | **AUGMENT self-host / WATCH cloud** — see delta below |
| Katana | MIT | 17,382 | v1.7.0 · 2026-08-05 | optional | **not polite by default** (recon tool) | **AUGMENT** — great for URL discovery; produces no clean text. Go single binary |
| Colly | Apache-2.0 | 25,495 | v2.2.0 · **2025-03-27** | no | good | **WATCH** — release cadence stalled ~18 months |
| Jina Reader | hosted | — | — | yes | vendor's problem | **KEEP** — $0/low-$ default for single URL→markdown |

**Firecrawl self-host vs cloud — honest delta:** self-hosted **does not include Fire-engine** — no
managed proxies, no stealth, **no `/agent` or `/browser` endpoints**; every request exits your single
static IP. Cloud credit multipliers are the real bill: base 1cr/page, Search 2cr/10 results,
**JSON output +4cr**, **Stealth 5cr/page** — a full workflow burns **~9x** base. Credits don't roll over.

**Recommended fetch stack:** Crawlee (TS, in-process) → Jina Reader (cheap single URL) → Crawl4AI
Python sidecar **only** for adaptive-crawl stopping or JS-heavy volume. **Skip Firecrawl at $0.**

## 3. Extraction / parsing
| Tool | License | Stars | Latest | Strength | Python? | Verdict |
|---|---|---|---|---|---|---|
| **Docling** | **MIT** | 65,948 | **v2.125.0 · 2026-09-03** | Tables **TEDS >91%** (TableFormer ACCURATE), layout **>85% mAP**, 15+ formats, `granite-docling` 258M VLM | Yes | **KEEP — the default.** MIT + LF AI & Data + **294 contributors** = best license/governance/quality combo |
| **Defuddle** | **MIT** | 9,257 | 0.19.3 · 2026-08-22 | **TypeScript/npm — runs in your Next.js process.** Multi-pass, recovers where Readability over-strips | **No** | **KEEP — default HTML extractor.** ⚠ not in any rigorous published benchmark; validate on your corpus |
| `@mozilla/readability` | Apache-2.0 | — | active | **highest median (0.970), most predictable**; loses on hard pages | No | **KEEP as fallback/second opinion** — cheap ensemble |
| trafilatura | Apache-2.0 | 6,757 | v2.2.0 · 2026-07-31 | HTML article; self-eval F1 0.945, independent 0.883 | Yes | **KEEP** if a Python sidecar already exists |
| MinerU | **Custom** (Apache base; commercial license only above **100M MAU or $20M/mo**) | 79,092 | 3.4.5 · 2026-08-14 | **Formula king** — UniMERNet >90% BLEU | Yes | **AUGMENT** — only for math-heavy scientific PDFs. Moved off AGPL |
| Marker | ⚠ **CONFLICT** — GitHub API says Apache-2.0; 2026 write-ups say GPL-3.0 + RAIL-M weights | 39,500 | v2.0.0 · 2026-07-20 | ~120 pages/sec on H100 `[2nd]`; tables ~75–80% TEDS — behind Docling | Yes | **WATCH** — license ambiguity + **27 contributors** + weaker tables = poor default. **Read LICENSE yourself** |
| Unstructured | Apache-2.0 | 15,388 | 0.27.5 · 2026-08-28 | connectors/ETL; hosted $0.015/page, 10k free | Yes | **AUGMENT** — OSS lib outclassed by Docling; value is the connector layer |
| PyMuPDF | **AGPL-3.0** (commercial $1.5k→$50k+/yr `[2nd]`) | 10,633 | 1.28.2 · 2026-08-06 | fastest text/geometry; `pymupdf4llm` went **fully AGPL at 1.28.2** | Yes | **AUGMENT with care** — fine for a personal non-distributed agent; a landmine the moment it's a service |
| **pypdfium2 / PDFium** | Apache-2.0 or BSD-3 | — | active | fast render + text, **license-clean** | bindings | **KEEP** — the AGPL-free substitute for PyMuPDF's fast path |
| MarkItDown | MIT | 177,950 | active | cheap format→markdown; **no layout ML** | Yes | **AUGMENT** — "already-clean documents" fast lane only |

### Scanned / OCR (2026)
**olmOCR 2** (AI2, 8B) — avg 82.3, **70.2% win rate over DeepSeek-OCR** across 124 head-to-heads ·
**PaddleOCR-VL-1.6** — 100+ languages, strongest on tables · **DeepSeek-OCR** (3B) · **dots.ocr** (3B) ·
**GOT-OCR 2.0** (inline math) · **granite-docling** (258M, ships inside Docling) · **Nanonets-OCR2**.
All are Python + GPU sidecars. **Pragmatic rule: Docling standard pipeline on CPU for 95% of PDFs;
escalate to a VLM only when Docling's text layer comes back empty.**

### Decision matrix
| Input | Use |
|---|---|
| HTML article | **Defuddle** (TS, in-process) → `@mozilla/readability` → trafilatura |
| Born-digital PDF, no tables | **pypdfium2** / `unpdf` / `pdfjs-dist` in Node — no sidecar |
| PDF w/ tables or complex layout | **Docling** (Python sidecar), ACCURATE table mode |
| PDF w/ heavy math | MinerU |
| Scanned/photographed | Docling + granite-docling → escalate to olmOCR 2 / PaddleOCR-VL |
| DOCX/PPTX/XLSX/EPUB | Docling, or MarkItDown for text only |

## 4. Research-agent implementations
| Project | License | Stars | State | Verdict |
|---|---|---|---|---|
| `langchain-ai/open_deep_research` | MIT | 12,680 | **ARCHIVED**, last push 2026-08-10 | **DO NOT USE — read for patterns only.** Successor **`langchain-ai/deepagents`** (MIT, 28,885 stars, pushed 2026-09-03) |
| **GPT Researcher** | Apache-2.0 | 29,273 | v3.6.1 · 2026-08-24, **~237 contributors** | **KEEP as reference** — planner/executor split, MCP retrievers, ~5 min & **~$0.40/report** on o3-mini |
| **Local Deep Research** | MIT | 9,029 | v1.10.7 · 2026-08-28, ⚠ **747 open issues** | **AUGMENT** — privacy-first reference: fully offline w/ Ollama+SearXNG, AES-256 SQLCipher, Cosign-signed images + SLSA + SBOM. Claims 95.7% SimpleQA |
| **DeerFlow** | MIT | 81,316 | pushed 2026-09-03; **2.0 is a ground-up rewrite sharing no code with v1** | **WATCH (strong)** — best-resourced pattern source; heavy for personal use |
| STORM | MIT | 31,211 | v1.1.0 · **2025-01-23**, push 2025-09-30 | **WATCH / dormant** — but its **pre-writing** idea (perspective-guided questions + simulated expert conversations → outline before prose) is the best-value pattern to steal |
| `jina-ai/node-DeepResearch` | Apache-2.0 | 5,223 | push 2026-05-01 | **WATCH** — TypeScript-native (rare) but decelerating |
| `zilliztech/deep-searcher` · `nickscamara/open-deep-research` | Apache-2.0 / NOASSERTION | 8,255 / 6,281 | stale 2025 | **DO NOT USE** |

### Patterns worth stealing (mapped to Postgres)
1. **Separate the plan artifact from the prose** — store the plan as rows, not a paragraph in context.
2. **Query decomposition with acceptance criteria per sub-question** — each carries a *stop condition*
   ("resolved when ≥2 independent sources agree on a figure with a date"). This makes the loop terminable.
3. **Adaptive stopping via information foraging** — Crawl4AI's Adaptive Crawling is a shipped
   implementation: continue while marginal info gain per fetch exceeds a threshold. Difference between
   8 fetches and 80.
4. **Hierarchical planner → workers → critic**, reflection *inside* each worker.
5. **Evidence objects as first-class rows:**
```sql
evidence(id, claim_id, url, url_canonical, domain, title,
         published_at, fetched_at, quote_span, char_start, char_end,
         content_sha256, simhash, embedding vector, extractor,
         credibility_score, credibility_reasons jsonb, grade char(1))
claim(id, task_id, subquestion_id, text, stance, support_count,
      contradict_count, status)  -- supported | disputed | unsupported
```
   **The model may only cite evidence IDs present in the prompt. Single highest-leverage anti-hallucination move.**
6. **Cite-as-you-write, never cite-after-the-fact** — post-hoc citation attachment is *the* mechanism
   producing plausible-but-wrong references.
7. **Three-level dedup:** URL canonicalization → content SHA-256 + **simhash near-dup** → **claim-level
   embedding clustering**. Skipping the third is how agents manufacture false consensus (ten articles
   repeating one wire story must count as **one** corroboration).
8. **Credibility as a stored, explainable score, never a bare LLM number** — domain class,
   primary-vs-secondary, dated byline, does the page cite sources, independent-corroboration count.
   Persist `credibility_reasons`.
9. **Contradiction detection as an explicit pass** — group by (entity, predicate), pairwise NLI, mark
   `disputed` and **surface both sides**. *A research agent that never reports a disagreement is hiding one.*
10. **Freshness weighting by query class** — store `published_at` (with parse-confidence flag; date
    extraction is notoriously unreliable) *and* `fetched_at`. Exponential decay with **class-dependent
    half-life**: days for news/pricing/versions, years for definitions. **Never one global constant.**
11. **Evidence grading:** A = primary/peer-reviewed w/ date · B = reputable secondary w/ named author ·
    C = blog/forum w/ corroboration · D = uncorroborated single source. Policy: no unhedged numeric
    claim from C/D.
12. **Verification pass before emit** — re-fetch every cited URL, confirm the stored `quote_span` still
    appears (exact then fuzzy), flag drift/404 as `dead-citation`.
13. **Log the trajectory, not just the answer** — DeepHalluBench's **PING taxonomy** (Propagation,
    Intent, Noise-induced, Grounding; arXiv 2601.22984). **Hallucination propagation — an early error
    later steps inherit and amplify — was the headline systemic deficit.** Mark low-confidence early
    findings so they can't become premises.

### Citation-correctness evals
| Benchmark | Measures | Ref |
|---|---|---|
| **DeepResearch Bench — RACE + FACT** | 100 PhD-level tasks, 22 fields; **FACT = effective citation count + accuracy** | arXiv 2506.11763; reported spread **78% (OpenAI DR) → 94% (Claude w/ search)** `[2nd]` |
| DeepHalluBench / PING | trajectory-level hallucination | arXiv 2601.22984 |
| Reference-hallucination detection | fabricated references | arXiv 2604.03173 |
| Structural eval (intent → evidence) | soundness of the *structure* | arXiv 2603.25342 |
| VeriTrace · MMDeepResearch-Bench · survey | — | 2605.26081 · 2601.12346 · 2508.12752 |

**Cheap in-house metrics runnable weekly against Postgres:** quote-span verification rate ·
unsupported-claim rate (NLI vs own cited evidence) · dead-citation rate · independent-source count
per claim (post-dedup) · disputed-claim surfacing rate.

## 5. Reranking + hybrid retrieval
| Model | License | Verdict |
|---|---|---|
| **Qwen3-Reranker-0.6B / 4B / 8B** | **Apache-2.0** | **KEEP — default.** 0.6B on CPU; 4B is the quality pick |
| **mxbai-rerank-v2-base/-large** | **Apache-2.0** | **KEEP** — BEIR 55.57 / 57.49; base-v2 genuinely CPU-viable |
| **bge-reranker-v2-m3** | MIT | **KEEP** — safe, boring, license-clean; easiest via ONNX/transformers.js in Node |
| jina-reranker-v3/v3.5 | **CC-BY-NC-4.0** | **DO NOT USE commercially.** **Listwise, 64 docs, 131k ctx, BEIR nDCG@10 61.94 — top score here.** Fine for a private personal agent; blocker the moment money is involved |
| zerank-1/-2 | CC-BY-NC-4.0 | **WATCH** — non-commercial. `zerank-1-small` is **Apache-2.0** → **AUGMENT** |
| Cohere Rerank | hosted / Model Vault **$5–10/hr (~$3,250–6,500/mo)** | **DO NOT USE at this budget** (130x the ceiling) |

**Listwise beats pointwise in 2026** — ~57 → ~62 nDCG@10 is the biggest single retrieval-quality delta
available, but the best listwise weights are non-commercial. Private agent → jina-v3.5; possible
product → Qwen3-Reranker-4B and accept the gap.

**Hybrid in Postgres (already available):** dense (pgvector HNSW) + lexical, fused by **Reciprocal Rank
Fusion** `score = Σ 1/(k + rank_i)`, k=60 — RRF uses **rank positions only**, sidestepping BM25-vs-cosine
normalization entirely. Lexical arm options: built-in `tsvector` (zero deps, adequate) → **ParadeDB
`pg_search`** (real BM25 in Postgres) → VectorChord-BM25 → SPLADE via pgvector `sparsevec`.
Weighted alternative: **alpha 0.7 dense** default; **drop to 0.3–0.4 for exact-token domains**
(function names, part numbers, version strings). **Pick alpha per query class, not globally.**

**Pipeline:** hybrid retrieve **top-100** → dedup (URL canon → simhash → embedding cluster) → rerank
top-30 w/ Qwen3-Reranker-0.6B → **8–12 evidence objects** to synthesis.
*Two dials matter more than model choice: retrieve 100 not 20, and let 8–12 survive not 40.*

## 6. Fit against this stack
**Native TypeScript, no sidecar:** Defuddle · `@mozilla/readability` · Crawlee · cheerio · `unpdf`/`pdfjs-dist` ·
all search APIs (HTTP) · Jina Reader · Firecrawl even self-hosted (HTTP) · pgvector + tsvector/ParadeDB + RRF ·
ONNX rerankers via transformers.js · LangGraph.js.

**Python sidecar — only where it buys something:**
| Sidecar | Buys | Worth it? |
|---|---|---|
| **Docling** (`docling-serve` container over HTTP) | tables TEDS >91%, 15+ formats, OCR | **Yes — the one sidecar to build first.** Next.js never imports Python |
| Crawl4AI (Docker, HTTP) | adaptive crawling, JS-heavy volume | Only if Crawlee + Jina prove insufficient |
| MinerU / OCR VLM | math / scanned | Only on demand; GPU |
| gpt-researcher / LDR / DeerFlow | a whole agent you don't control | **No — steal patterns, don't adopt the runtime. You already have an agent** |

Katana is a Go binary — shell out, no sidecar.

## 7. Verdicts
**KEEP:** Tavily · Serper · Exa · Jina Reader · Crawl4AI (≥0.9.3) · Crawlee · Scrapy · Docling ·
Defuddle · readability · trafilatura · pypdfium2 · Qwen3-Reranker · mxbai-rerank-v2 · bge-reranker-v2-m3 ·
pgvector+RRF.
**AUGMENT:** Brave (attribution trade) · Mojeek (storage+AI rights unique) · Marginalia · SearXNG
(breadth only) · Firecrawl self-host · Katana · MinerU · Unstructured · PyMuPDF (AGPL-aware) ·
MarkItDown · Local Deep Research · zerank-1-small.
**REPLACE:** Google CSE JSON API (terminal 2027-01-01).
**WATCH:** deepagents · DeerFlow 2.0 · Marker (license) · Colly · SearchApi · Parallel.ai · Linkup.
**DO NOT USE:** Bing Search API (retired) · `open_deep_research` (archived) · deep-searcher ·
nickscamara/open-deep-research · jina-reranker-v3/v3.5 + zerank-1/-2 **if commercial** · Cohere Model Vault.

## 8. Confidence caveats
⚠ `[2nd]`-only, verify before spending: Serper per-pack $/1k · SearchApi tiers · Firecrawl cloud credit
counts (sources disagree: Free 500 vs 1,000; Hobby 3k vs 5k) · Parallel.ai ($1 vs $5/1k) · Linkup deep
(€50 vs $250/1k) · PyMuPDF commercial price · Marker throughput/TEDS · DeepResearch Bench 78–94% spread.
⚠ **Unresolved conflict, not smoothed: Marker's license.** GitHub API says Apache-2.0; mid-2026
write-ups say GPL-3.0 + revenue-gated RAIL-M weights. Read `LICENSE` and the model card.
⚠ Could not verify: OpenAlex + Semantic Scholar rate limits.
