# HuggingFace Embeddings · Backend Add + Cutover Runbook

**Owner:** operator (Nour)
**Module:** `apps/statenour/lib/ai/hf-embeddings.ts` + `lib/ai/provider.ts` (chain position #4)
**Skill-port:** Category 1 of `apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md`
**Last updated:** 2026-05-26

## What we shipped (Wave AH)

Added HuggingFace Inference as embedding backend **#4** in the existing provider fallback chain:

```
1. Venice (text-embedding-bge-m3 · 1024-dim)         ← primary, unchanged
2. Ollama Cloud (nomic-embed-text · 768-dim)         ← unchanged
3. Cohere (embed-v4.0 · 1024-dim)                     ← unchanged
4. HuggingFace Inference (NEW · 1024-dim multilingual) ← Wave AH inserts here
5. OpenAI (text-embedding-3-small · 1536-dim)         ← final, unchanged
```

**Default model:** `intfloat/multilingual-e5-large` · 1024-dim · supports Spanish + 100 other languages.

The chain is preserved · the existing customer-facing path is unchanged. Wave AH adds HF as a cheaper, multilingual fallback when Venice/Ollama/Cohere all miss. Nothing breaks if HF_API_KEY is unset · the chain just skips this tier.

## Why this matters

| Backend | Cost / 1M tokens | Multilingual | Dimension |
|---|---|---|---|
| Venice bge-m3 | ~$0.10 | yes (limited) | 1024 |
| Ollama nomic | (Ollama Cloud subscription) | no | 768 |
| Cohere embed-v4.0 | $0.10 | yes (100+ langs) | 1024 |
| **HF multilingual-e5-large** | **$0.10** (free under 30k/month) | **yes (100+ langs)** | **1024** |
| OpenAI text-embedding-3-small | $0.02 | partial | 1536 |

HF advantages over Cohere:
- Free tier covers 30k tokens/month (sufficient for low-volume brain queries)
- Open weights · option to self-host on Modal later for $0 marginal cost
- Aligns with the broader HF stack (BGE rerank in Wave AG · NickGPT in Wave AE)

HF disadvantages vs Venice:
- ~200ms latency penalty on warm calls
- 503 cold-load on first request after ~15 min idle

## Activation (operator-action)

### Step 1 · Set env vars on Vercel

If you already set `HF_API_KEY` for Wave AG (BGE rerank), nothing new is needed · same key works.

```
HF_API_KEY=hf_xxxxxxxxxxxxxxxxx
HF_EMBED_MODEL=intfloat/multilingual-e5-large    # optional · matches default
```

### Step 2 · Deploy

Push the Wave AH commits. Vercel redeploys. HF is now in the chain.

### Step 3 · Verify (manual probe)

In a Node REPL or scratch script:

```ts
const { getHfEmbedding, isHfEmbeddingAvailable } = await import("./lib/ai/hf-embeddings");
console.log(isHfEmbeddingAvailable());           // true
const vec = await getHfEmbedding("brake pads");
console.log(vec?.length);                         // 1024
```

OR force-trigger by setting `VENICE_API_KEY=""` + `OLLAMA_API_KEY=""` + `COHERE_API_KEY=""` temporarily · the chain falls through to HF. Watch for `[ai:embedding] HF cold-load (503)` once on first call · subsequent calls land at ~250ms.

### Step 4 · Validate multilingual (optional · for Spanish prep)

```ts
const enVec = await getHfEmbedding("brake pads");
const esVec = await getHfEmbedding("pastillas de freno");
// Cosine similarity should be > 0.85 if model is doing its job
const dot = enVec.reduce((s, v, i) => s + v * esVec[i], 0);
const en = Math.sqrt(enVec.reduce((s, v) => s + v * v, 0));
const es = Math.sqrt(esVec.reduce((s, v) => s + v * v, 0));
console.log(dot / (en * es));  // expect ≥0.85
```

This proves the embedding space treats Spanish equivalents as semantically close · the foundation for the Spanish customer unlock in HF strategy Cat 10.

## Promoting HF to PRIMARY (the migration)

The above is purely additive. To make HF the FIRST embedding tried (and Venice fallback), the corpus must be re-embedded with the HF model. The vector geometry is model-specific · cosine distance is only meaningful WITHIN a model.

### Step P1 · Decide the model

| Candidate | Dim | Spanish | Notes |
|---|---|---|---|
| **`intfloat/multilingual-e5-large`** | 1024 | yes | Default · best multilingual balance |
| `BAAI/bge-large-en-v1.5` | 1024 | no | Pure-English SOTA · better en-only recall |
| `mixedbread-ai/mxbai-embed-large-v1` | 1024 | partial | Newer SOTA · pairs with mxbai-rerank |
| `nomic-ai/nomic-embed-text-v1.5` | 768 | no | Smaller · faster · Matryoshka-adjustable |

Default recommended: `intfloat/multilingual-e5-large` (matches Cohere embed-v4.0 dim + Spanish support).

### Step P2 · Re-embed corpus

Use existing `scripts/embed-backfill.ts` (the one that originally embedded `domain_knowledge` + `meeting_transcript` rows). Add an env-var gate:

```bash
HF_API_KEY=hf_xxx \
  HF_EMBED_MODEL=intfloat/multilingual-e5-large \
  pnpm tsx apps/statenour/scripts/embed-backfill.ts --force-reembed-all
```

The `--force-reembed-all` flag (TO BE ADDED · scope of a follow-up wave) iterates every `brain_memory` row, computes a fresh HF embedding, and writes to `embedding_vec_1536`. The padding at memory-recall.ts:padToTargetDim handles the 1024→1536 dim conversion (zero-padded · zeros are no-op in dot product).

**Cost** · 10k brain rows × ~50 tokens each = 500k tokens = ~$0.05 on HF Inference. Trivial.

**Time** · 10k rows × 250ms = ~40 min serial; parallelize 10× via Promise pool → 4 min.

### Step P3 · Flip chain order

After backfill completes, change provider.ts so HF tries FIRST:

```diff
- 1. Venice
- 2. Ollama
- 3. Cohere
- 4. HuggingFace
+ 1. HuggingFace (PRIMARY)
+ 2. Venice (fallback if HF down)
+ 3. Ollama
+ 4. Cohere
  5. OpenAI
```

This is a 1-line move in the function order. Ship as a separate small commit so the operator can rollback by reverting only that file.

### Step P4 · Decommission OpenAI subscription (optional)

After 30 days of green HF telemetry:
1. Verify OpenAI is no longer reached (grep logs for `[ai:embedding] OpenAI`)
2. Cancel OpenAI billing OR rotate to a read-only key
3. Keep `OPENAI_API_KEY` env unset · chain handles missing key cleanly

## Rollback

If HF causes recall regression after promoting to primary:
1. Revert the chain-order commit · 1-file change · Venice becomes primary again
2. Optionally re-run backfill with previous model · OR leave HF embeddings in place (the chain will route to Venice and the new query embeddings won't match — caller falls through to RRF + identity)

If only the new HF backend tier is misbehaving (still as #4):
1. Unset `HF_API_KEY` · chain skips the HF tier · existing Cohere → OpenAI path resumes
2. Zero code change required

## Monitoring

Watch in logs:

```
[ai:embedding] HF failed (503) on intfloat/multilingual-e5-large · falling through
[ai:embedding] HF cold-load (503) on intfloat/multilingual-e5-large · falling through
```

503s should clear after 1-2 minutes of warm-up. If sustained, the HF Inference free tier may be saturated · upgrade to HF Inference Endpoints (dedicated GPU · $0.06/hr for embedding-class models).

Per-tier success rate is the right metric · count `[ai:embedding] HF returned 200` vs `HF failed` over 24h.

## Anti-patterns

### "Promote to primary without re-embedding"

Mixing 2 embedding models in the same pgvector column produces noise · cosine distance becomes meaningless. Always run backfill BEFORE flipping chain order.

### "Pad dimensions and forget"

The memory-recall padding works for the FALLBACK case (query hits HF when corpus is Venice-embedded · result is approximate). Acceptable for fallback, NOT acceptable as steady state. Re-embed the corpus when you commit to a new primary.

### "Use HF for everything"

HF embedding is a cheap fallback · not necessarily better than Venice bge-m3 for English-only content. Run the 20-query baseline before promoting.

### "Skip the multilingual validation"

If the cos-sim test on `brake pads ↔ pastillas de freno` returns < 0.7, the multilingual model isn't actually doing its job for your corpus. Try `Cohere embed-v4.0` instead · same dim, proven multilingual.

## Skill-port lineage

Category 1 of `apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md`. Pairs with:

- `apps/statenour/lib/brain/bge-rerank.ts` (Wave AG · Cat 2 · Stage 4 of the retrieval pipeline)
- `apps/nickstire/docs/eval-rubrics/enterprise-search.md` (the 4-stage retrieval framework · embeddings + reranker live in stages 2 + 4)
- `apps/statenour/lib/ai/provider.ts` getEmbedding chain (where HF is now position #4)
- HF strategy Cat 10 (Spanish-specific models · multilingual-e5-large IS the unlock)

Future · once HF is the PRIMARY and the corpus is fully migrated, the next compounding move is `apps/nickstire` Spanish landing pages + bilingual SMS via the multilingual embedding + intent classifier stack (HF Wave AF + Wave AH together).
