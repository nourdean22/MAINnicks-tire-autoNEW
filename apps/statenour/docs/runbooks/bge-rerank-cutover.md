# BGE Rerank Cutover · Runbook

**Owner:** operator (Nour)
**Module:** `apps/statenour/lib/brain/bge-rerank.ts` + `lib/brain/rerank.ts`
**Skill-port:** Category 2 of `apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md`
**Last updated:** 2026-05-26

## Why migrate

| Backend | Cost | Quality | Latency |
|---|---|---|---|
| **Cohere** (legacy) | $2 / 1,000 reranks | rerank-english-v3.0 · proprietary | ~150ms warm |
| **BGE on HF Inference** (Wave AG) | $0.0001 / 1,000 reranks | BAAI/bge-reranker-v2-m3 · SOTA open weights · multilingual | ~250ms warm |

The cost gap is **5000×**. Quality on benchmark RAG tasks (MTEB rerank track) is comparable or slightly better for BGE. The 100ms latency hit is acceptable for the brain pipeline (operator-facing chat, not customer-realtime).

At current volume (~500 brain queries/day) the Cohere bill is ~$30/mo. At projected volume after enabling page-aware Chrome extension recall (Wave J) it's ~$200/mo. BGE makes both invisible on the bill.

## What we shipped (Wave AG)

3 files · all additive, zero breaking change to the live brain pipeline:

1. `lib/brain/bge-rerank.ts` (NEW) — same interface as `cohereRerank`, calls HF Inference API. Returns `null` if HF_API_KEY unset or >50% per-candidate failure rate. Wrapped in `withGuardian` for retry safety.
2. `lib/brain/rerank.ts` (NEW orchestrator) — single entry point `rerank()` and `isRerankAvailable()` and `getActiveRerankBackend()`. Routes between BGE and Cohere based on `BGE_RERANK` env flag.
3. `lib/brain/contextual-recall.ts` (MODIFIED · 2 lines) — replaced `cohereRerank` + `isCohereRerankAvailable` calls with `rerank` + `isRerankAvailable`. Same call shape · zero behavior change with default flag.

Existing `lib/brain/cohere-rerank.ts` is unchanged · the orchestrator wraps both backends so we keep optionality.

## Activation (operator-action)

### Step 1 · Get an HF Inference API key

1. Sign up at https://huggingface.co/join (free)
2. Settings → Access Tokens → Create New Token (read scope)
3. Copy the `hf_xxxxxx` value

### Step 2 · Set env vars on Vercel

```
HF_API_KEY=hf_xxxxxxxxxxxxxxx
BGE_RERANK=true
```

Optional override (don't need this unless you've A/B tested another reranker model):

```
BGE_RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

### Step 3 · Deploy

Push the wave-AG commits. Vercel auto-deploys.

### Step 4 · Verify activation

Check the active backend without flipping anything:

```typescript
import { getActiveRerankBackend } from "@/lib/brain/rerank";
console.log(getActiveRerankBackend());  // → "bge"
```

Or fire a brain query in `/chat` and watch the log line:

```
[bge-rerank] { model: "BAAI/bge-reranker-v2-m3", candidatesIn: 25, topN: 25, resultsOut: 25, successRate: "1.00" }
```

If you see `[cohere-rerank]` instead, the flag isn't honored · check env vars on Vercel.

### Step 5 · Compare recall on identical queries

Run the brain smoke suite that exists at `scripts/smoke-ai-chain-full.ts`. Capture top-5 memory IDs returned for 20 representative queries with `BGE_RERANK=false`, then again with `BGE_RERANK=true`. Compare overlap.

Expected · ≥85% Jaccard overlap on top-5. Below that, BGE is meaningfully different (could be better or worse). Eyeball 5 disagreements:
- If BGE's pick is more relevant → ship and forget
- If Cohere's pick is more relevant → keep Cohere preferred OR try a different BGE model (Cat 2 lists alternatives)

### Step 6 · Decommission Cohere (eventually)

Once BGE has been live for 30 days with no regressions and the bill drop is confirmed:

1. Cancel the Cohere subscription
2. Delete `COHERE_API_KEY` env var
3. Keep `lib/brain/cohere-rerank.ts` as graceful-degradation fallback · the orchestrator handles missing keys cleanly
4. Document the cutover in `docs/RECONCILIATION.md`

## Rollback

If BGE causes recall regression OR HF Inference is unstable:

1. Set `BGE_RERANK=false` (or unset) on Vercel
2. Push a redeploy OR wait for the next request — orchestrator routes back to Cohere
3. No code change required

If Cohere is ALSO down (rare), the orchestrator returns `null` and `contextual-recall.ts` falls back to identity ordering · brain still works at lower precision.

## Monitoring

Per-call log lines on success:

```
[bge-rerank] { model, candidatesIn, topN, resultsOut, successRate }
[cohere-rerank] { candidatesIn, topN, resultsOut, searchUnits }
```

Failure logs are visible at the guardian level:

```
[bge-rerank] guardian gave up · timeout · ...
[cohere-rerank] guardian gave up · http5xx · ...
```

Future dashboards (operator):
- `/system/migrations` should display `getActiveRerankBackend()` as a one-line status
- Daily rerank cost trend on `/system/cost-watch`
- Per-backend p95 latency on `/system/observability`

## Performance tuning

If BGE latency becomes a bottleneck (>500ms p95):

| Optimization | Effort | Latency gain |
|---|---|---|
| Switch to `cross-encoder/ms-marco-MiniLM-L-12-v2` (80MB, 5× faster) | 5min env var swap | -150ms |
| Migrate to HF Inference Endpoints (dedicated GPU) | 1 day | -100ms |
| Batch pairwise scoring (1 HF call for 25 candidates) | 1 day · API supports it | -200ms |

For now, the parallel-single-call pattern in `bge-rerank.ts` is fine at our volume.

## Anti-patterns

### "Migrate without measuring"

The whole point is recall. If you don't measure top-5 overlap before flipping the default, you'll never know if a quality regression happened. The smoke suite + 20 query baseline is non-optional.

### "Keep Cohere subscription paying"

After 30 days of green BGE telemetry, cancel Cohere. Paying $30/mo for fallback redundancy is fine if it's intentional · letting the bill linger because you forgot is waste.

### "Use BGE for everything"

Rerank is the high-leverage HF win. Other parts of the brain (embeddings, classifiers, multi-search) deserve their own evaluation per `huggingface-model-strategy.md`. Don't migrate the whole stack on this flag.

### "Disable graceful degradation"

The orchestrator returning `null` when both backends fail is correct · brain still works at lower precision. Don't add a hard-fail · the chat path must never block on rerank.

## Skill-port lineage

Category 2 of `apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md`. Pairs with:

- `apps/nickstire/docs/eval-rubrics/enterprise-search.md` (Stage 4 of the 4-stage retrieval pipeline · this is where BGE lives in the macro)
- `apps/statenour/lib/brain/cohere-rerank.ts` (the legacy backend · kept as fallback)
- `apps/statenour/lib/feature-flags.ts` (BGE_RERANK registered in FLAG_REGISTRY)
- Audit finding #317 (hybrid-search rebuild · this is one phase of that work)

Future · once BGE is the default and recall is measurably improved, the next move is **Cat 1 (embeddings swap)** · drop in `BAAI/bge-large-en-v1.5` or `intfloat/multilingual-e5-large` (the Spanish unlock) in `lib/ai/provider.ts`'s `getEmbedding()`.
