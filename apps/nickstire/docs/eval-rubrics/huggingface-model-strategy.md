# HuggingFace Model Strategy

**Skill port:** hugging-face-* skill suite (model-trainer · paper-publisher · tool-builder · transformers-js · datasets)
**Applies to:** every AI workload across nickstire + statenour that currently calls Anthropic / OpenAI / Cartesia / Venice. Strategic guide for which workloads to migrate to HuggingFace (HF) models, where to deploy them, and the compound-moat play.
**Authored:** 2026-05-26.

## Why this doc exists

Today the stack pays per-call to:
- **Anthropic** · every `/brain` synthesis · every NickSuggestions reasoning · every agent step
- **OpenAI** · every embedding written to pgvector (`text-embedding-3-small`)
- **Cartesia** · every VAPI inbound TTS turn
- **Venice** · flux-2-pro for image gen (~$0.04/img)
- **Deepgram** · every VAPI inbound STT minute

Half of these calls don't need a $0.001-per-call frontier model. A 100MB classifier running on a tiny CPU service is enough for "is this SMS asking about brakes?" Same for sentiment, prompt-injection screening, language detection, intent routing.

HuggingFace is the GitHub for AI models · 1M+ free models you can download or call via cheap HF Inference. The wins fall into 12 categories. This doc enumerates them, picks the highest-leverage 5 to ship first, and ties each to an existing audit finding OR new capability gap.

## The deployment matrix (pick venue before picking model)

Wrong venue makes a great model expensive. Default decision tree:

| Deployment | Cost | When to use |
|---|---|---|
| **HF Inference API** | $0.0001–$0.001/call | Small models, low volume, zero ops · default for first ship |
| **HF Inference Endpoints** | $0.05–$5/hour dedicated | Medium volume, need consistent latency · upgrade path |
| **Modal / Replicate / Fal** | Per-second GPU billing | Vision models · occasional bulk jobs (re-transcribe VAPI archive) |
| **Ollama on Railway** | Flat Railway service cost | Self-hosted Llama/Qwen/DeepSeek for non-customer-facing bulk |
| **Transformers.js in browser** | $0 runtime | Tiny models · pre-classify before server roundtrip |
| **vLLM on bare GPU** | $0.50–$2/hour | High-volume self-hosted LLM serving |

**Rule** · start with HF Inference API to validate model quality, then promote to Inference Endpoints when call-volume × per-call cost > $50/month.

## The 12 categories

### Category 1 · Embeddings (LOW EFFORT · HIGH LEVERAGE)

Currently · OpenAI `text-embedding-3-small` (used by pgvector in `apps/statenour/lib/ai/embeddings.ts`).

| Model | Use |
|---|---|
| **`BAAI/bge-large-en-v1.5`** | Top free English · 330MB · matches OpenAI quality |
| **`mixedbread-ai/mxbai-embed-large-v1`** | SOTA · 500MB · top of MTEB leaderboard |
| **`intfloat/multilingual-e5-large`** | English + Spanish + 100 langs · the Cleveland-Spanish unlock |
| **`nomic-ai/nomic-embed-text-v1.5`** | Fast · Matryoshka-adjustable dims |

**Port destination** · drop-in replacement in `apps/statenour/lib/ai/embeddings.ts`. Either self-host on Railway as a tiny FastAPI service OR call HF Inference API (~50× cheaper than OpenAI).
**ROI** · same recall, lower bill, optional Spanish-language ingestion.

### Category 2 · Rerankers (the missing piece of /brain hybrid search)

Vector-only search gets ~60% recall. Adding a reranker pushes to 85%+. The audit's PORT 6 / #317 hybrid-search rebuild needs this.

| Model | Use |
|---|---|
| **`BAAI/bge-reranker-v2-m3`** | Best free reranker · multilingual · 568MB |
| **`cross-encoder/ms-marco-MiniLM-L-12-v2`** | Tiny (~80MB) · 5× faster latency |
| **`mixedbread-ai/mxbai-rerank-large-v1`** | Newer SOTA · pairs with mxbai embed |

**Port destination** · pair with audit finding #317. Pipeline: BM25 retrieve top 100 → vector rerank to top 25 → cross-encoder rerank to top 5. Lives in `apps/statenour/lib/ai/search-hybrid.ts` (NEW).
**ROI** · 30–50% recall improvement on /brain queries · operator gets sharply better answers.

### Category 3 · Tiny classifiers (each replaces a $0.001 LLM call)

Small (50–500MB), run on CPU, instant inference. Each replaces a Claude call for routing/screening.

| Model | Replaces | Volume |
|---|---|---|
| **`MoritzLaurer/deberta-v3-large-zeroshot-v2.0`** | "Brakes? tires? oil?" SMS intent classification | ~10k LLM calls/day |
| **`cardiffnlp/twitter-roberta-base-sentiment-latest`** | Review + chat sentiment scoring | Currently Claude |
| **`michellejieli/emotion_text_classifier`** | Inbound SMS emotion ("frustrated" → escalate) | New capability |
| **`unitary/toxic-bert`** | Filter inappropriate inbound | New safety layer |
| **`protectai/deberta-v3-base-prompt-injection-v2`** | **Prompt-injection screening** on VAPI + chat input | New security layer |
| **`meta-llama/PromptGuard-86M`** | Meta's tiny PI classifier · 86M params · 20ms | Alternative to above |

**Port destination** · new `apps/nickstire/server/services/classifiers.ts` wrapping HF Inference API. PRE-FILTERS before any expensive LLM call. The prompt-injection screener also closes a security gap not covered today.
**ROI** · drops 50–80% of LLM volume to a $5/month service · adds defense-in-depth at the input layer.

### Category 4 · Vision models (the photo-damage capability gap)

NEW capability · customer texts a photo, model describes the damage and estimates service. Not currently possible at any reasonable cost on the existing stack.

| Model | Use |
|---|---|
| **`Salesforce/blip2-flan-t5-xl`** | Visual Q&A · "describe the damage in this photo" |
| **`microsoft/Florence-2-large`** | Multi-task vision-language · 770M params · detect + caption + OCR |
| **`microsoft/trocr-large-handwritten`** | Handwritten receipt OCR |
| **`Qwen/Qwen2-VL-72B-Instruct`** | Top open vision-language · runs on Replicate |
| **`llava-hf/llava-onevision-qwen2-7b-ov-hf`** | Smaller LLaVA · cheap on Replicate/Modal |

**Port destination** · new `apps/nickstire/server/routes/api/photo-assess.ts`. Customer texts a photo via MMS → webhook → vision model returns "Sidewall damage · replace immediately · est. $X" → reply via F25e SMS gateway with `{ via: "shop" }`.

**Specialized search path** · check HF Hub for `tire-wear`, `brake-pad`, `vehicle-damage` community-fine-tuned models. Long-term play · fine-tune your own on operator-labeled photos (Category 11 dataset bootstrap).

**ROI** · NEW after-hours lead channel · photo inquiries become auto-qualified leads · same playbook as the F25e shop-gateway routing for SMS.

### Category 5 · Whisper variants (bulk re-transcription)

Live STT stays on Deepgram. Bulk re-transcription of the VAPI archive (eval, analytics, training corpus per audit #321) doesn't need realtime · runs in batch.

| Model | Use |
|---|---|
| **`openai/whisper-large-v3-turbo`** | Fastest large Whisper · 4× faster than v3 · ~1.5GB |
| **`distil-whisper/distil-large-v3`** | 6× faster · matches quality |
| **`nyrahealth/CrisperWhisper`** | Better on auto/parts jargon |

**Port destination** · bulk-process old VAPI recordings for retroactive eval (audit #321 / PORT 10). Run as a Modal/Replicate job OR Node subprocess via Transformers.js.
**ROI** · 1000s of past calls re-transcribed for free → eval data + RAG corpus + lift-math for SA v2.

### Category 6 · TTS (voice cloning for personalized outbound)

Inbound TTS stays on Cartesia Sonic. Outbound voicemails + personalized SMS-to-voice get cheaper with open-weight TTS.

| Model | Use |
|---|---|
| **`coqui-ai/XTTS-v2`** | **Voice clone from 6s of audio** · open-source · operator's voice → automated outbound voicemail |
| **`hexgrad/Kokoro-82M`** | Tiny 82M-param TTS · Transformers.js browser-side |
| **`metavoiceio/metavoice-1B-v0.1`** | Higher quality 1B-param baseline |

**Port destination** · new outbound voicemail service. "Hey Linda, this is Nick — quick follow-up on those brakes." Currently each requires manual recording OR generic robot TTS.
**ROI** · personalized outbound at scale · conversion rate beats generic-voice baselines by 2–4× in industry benchmarks.

### Category 7 · Self-hosted LLMs (the bulk-cost cut)

Run a 70B+ model on Railway/Fly/etc. for non-customer-facing workloads (improve-agent nightly cron · content drafting · dev tools). Customer-facing stays on Anthropic/Venice for quality.

| Model | Use |
|---|---|
| **`meta-llama/Llama-3.3-70B-Instruct`** | What Venice already serves · host yourself for fixed cost |
| **`Qwen/Qwen2.5-72B-Instruct`** | Strong reasoning · top open leaderboard |
| **`meta-llama/Llama-3.2-3B-Instruct`** | Tiny + fast · intent classification · SMS drafting |
| **`Qwen/Qwen2.5-Coder-32B-Instruct`** | Code-specific · powers statenour /brain code assistance |
| **`deepseek-ai/DeepSeek-V3`** | Top open reasoning · close to Sonnet quality |

**Port destination** · Ollama service on Railway · 1 new service in `natural-appreciation` project. Routes: improve-agent nightly · content drafts · dev tools · bulk synthesis. Keeps Anthropic/Venice for customer-facing.
**ROI** · 60–90% cost reduction on dev-only workloads (audit finding #126).

### Category 8 · Image generation (FLUX self-hosted)

Venice flux-2-pro at $0.04/img. Open-weight equivalents drop to ~$0.002/img on Replicate.

| Model | Use |
|---|---|
| **`black-forest-labs/FLUX.1-dev`** | Open FLUX dev · best free image gen |
| **`black-forest-labs/FLUX.1-schnell`** | 4-step distilled · 10× faster · same quality for most uses |
| **`stabilityai/stable-diffusion-3.5-large`** | SD3.5 architecture alternative |

**Port destination** · self-host FLUX-schnell on Replicate. Used by blog hero images · OG images · programmatic SEO page banners · brand asset generation.
**ROI** · $0.04/img → ~$0.002/img · scales with content velocity.

### Category 9 · Transformers.js (in-browser AI · zero server cost)

Most-slept-on capability. Runs ONNX-converted HF models in the customer's browser. Zero server cost, instant UX.

Customer-facing wins to ship on nickstire.org:
- **Tire size detection from photo** · "225/65R17" extracted in-browser, no server roundtrip
- **Symptom-checker on `/diagnose`** · typed input classified in <100ms locally
- **Spanish auto-detect on input** · switch chat widget to Spanish-mode if input detected
- **Sentiment-tagged contact form** · operator sees "this lead is frustrated" before they reply

Models that run in browser via Transformers.js:
- `Xenova/all-MiniLM-L6-v2` · embeddings · 25MB
- `Xenova/bert-base-multilingual-uncased-sentiment` · 170MB
- `Xenova/whisper-tiny.en` · browser-side voice input · 50MB
- `Xenova/distilbert-base-uncased-finetuned-sst-2-english` · 65MB

**Port destination** · customer chat widget + photo-upload widget on nickstire client.
**ROI** · 50–200ms UX vs 500ms+ server roundtrip · free at runtime · works offline-after-first-load.

### Category 10 · Spanish-specific models (the invisible-customer unlock)

The Cleveland Spanish-speaking customer base is currently invisible to the stack. HF has bilingual + Spanish-native models that change that.

| Model | Use |
|---|---|
| **`Helsinki-NLP/opus-mt-en-es`** + **`Helsinki-NLP/opus-mt-es-en`** | Bidirectional translation · local · no API call |
| **`PlanTL-GOB-ES/roberta-base-bne`** | Spanish-native RoBERTa · sentiment/intent in Spanish |
| **`intfloat/multilingual-e5-large`** | Embeddings that work for Spanish (Category 1) |
| **`coqui-ai/XTTS-v2`** | Voice clone supports Spanish · operator-voice in Spanish |
| **`Qwen/Qwen2.5-72B-Instruct`** | Strong Latin-American Spanish · better than Llama on this |

**Port destination** · bilingual SMS path · Spanish landing pages · Spanish-speaking voice receptionist on VAPI.
**ROI** · opens an entire customer segment currently leaking to competitors.

### Category 11 · Domain datasets (training-data bootstrap)

HF Datasets has open data to fine-tune on OR build a knowledge base from.

Search on huggingface.co/datasets for:
- `automotive` · repair manuals · parts data · symptom→cause mappings
- `tire` · tire-spec databases (size · load index · speed rating)
- `vehicle damage` · labeled damage photos
- `car forum` · r/MechanicAdvice scrapes · AutoMD Q&A
- `auto repair invoices` · anonymized invoice text for OCR training

If a good labeled dataset surfaces, fine-tune a small BERT on it · e.g. "BMW E46 + clunking when braking" → "control arm bushings · $400–600 est."

**Port destination** · fine-tuning runs on Modal/Replicate · deploy back via HF Inference Endpoints.
**ROI** · proprietary domain model · cheaper per-call than Claude · stays sharp via continued fine-tuning.

### Category 12 · The compound moat · fine-tune on YOUR data

You have:
- Years of VAPI call transcripts
- 1000s of SMS conversations
- ALG invoice history
- Customer reviews + operator responses
- Operator decisions in brain memory

This is fine-tuning data **NO COMPETITOR HAS**. Use HF's TRL library + a small base model:
- **Base** · `meta-llama/Llama-3.2-3B-Instruct`
- **Fine-tune A** · on operator-approved SMS replies → "NickGPT" SMS drafter in operator voice
- **Fine-tune B** · on declined-work outcomes → predicts which estimates will convert
- **Fine-tune C** · on operator's brain-memory entries → personalized synthesis tone

**Port destination** · LoRA fine-tuning on Modal · ~$50 + 4hr per run · deployed via Ollama on Railway. Every week of approved replies → re-fine-tune → sharper. **The moat compounds.**

## The top 5 to ship this week

| # | What | Why | Setup time |
|---|---|---|---|
| 1 | **`BAAI/bge-reranker-v2-m3`** | Slot into PORT 6 (#317 hybrid-search rebuild). Massive /brain recall jump. | 1 day |
| 2 | **`MoritzLaurer/deberta-v3-large-zeroshot-v2.0`** + **`protectai/deberta-v3-base-prompt-injection-v2`** | Intent classification + prompt-injection defense. Cuts LLM volume + adds security layer. | 2 days |
| 3 | **`Salesforce/blip2-flan-t5-xl`** OR **`Qwen/Qwen2-VL-72B-Instruct`** on Replicate | Photo-damage feature · NEW revenue channel. | 1 week |
| 4 | **`intfloat/multilingual-e5-large`** | Embedding swap · opens Spanish + cheaper than OpenAI. | 2 days |
| 5 | **`coqui-ai/XTTS-v2`** | Voice clone for personalized outbound · conversion multiplier. | 3 days |

## The single biggest compound move

**Fine-tune a 3B model on the SMS-reply corpus.**

Take `meta-llama/Llama-3.2-3B-Instruct`. Take 2,000 SMS exchanges where operator approved the reply. Run LoRA fine-tuning on Modal (~$50 + 4hr). Deploy on Ollama on a Railway service.

Result · **NickGPT** · drafts SMS replies in operator's exact voice using exact phrasing · never sounds like ChatGPT · runs at $0.0001/reply instead of $0.005/reply on Claude.

Every week → more operator-approved replies → re-fine-tune → sharper. **No competitor can copy this** even if they fork the public repo · the conversation-history data is the moat.

## Anti-patterns

### "Swap Claude for Llama on customer-facing"

The wrong unit of leverage. Frontier models earn their cost where quality matters — VAPI live conversation, /brain synthesis, agent reasoning. Llama hits these flat-out worse. HF wins are SPECIALISTS that replace one expensive call with a free 50ms classifier · NOT generalists replacing frontier models.

### "Self-host everything"

Operations cost. Hosting a 70B model on a GPU service means $400+/mo just for the box. HF Inference API at $0.0001/call covers tens of millions of calls before the breakeven flip. Default to managed inference · self-host only when call volume × per-call > $50/mo.

### "Fine-tune before validating zero-shot"

Skip fine-tuning until you've proven the off-the-shelf model already works at 70%+. Otherwise you fine-tune on noise. The discipline · zero-shot → few-shot → fine-tune, in that order.

### "Pick model first, then deployment"

Deployment matrix above is the real decision. A great model on the wrong venue is expensive. Always pick venue → constraint that picks model.

### "Ignore Transformers.js"

Free runtime at the edge of the customer's browser. Most operators sleep on it because "AI in browser sounds weird." It runs · it's fast · it's free · ship it.

## Implementation plan (queued)

1. **Embeddings swap** (Cat 1) · audit `apps/statenour/lib/ai/embeddings.ts` · A/B `bge-large-en-v1.5` vs current OpenAI on 100 sample queries · ship if recall ≥ 95% of current
2. **Reranker layer** (Cat 2) · add as Stage 3 in PORT 6 hybrid-search · BM25 → vector → cross-encoder rerank
3. **Classifier service** (Cat 3) · `apps/nickstire/server/services/classifiers.ts` · wire prompt-injection screener as pre-filter on VAPI + chat inputs · wire intent classifier as SMS-router pre-filter
4. **Photo-assess MVP** (Cat 4) · `/api/photo-assess` route · Qwen2-VL on Replicate · MMS webhook → vision call → SMS reply
5. **Bulk Whisper** (Cat 5) · Modal job over VAPI archive · output to a new `vapi_call_transcripts_bulk` table for eval + RAG corpus
6. **XTTS-v2 outbound** (Cat 6) · 6s sample of operator voice → cloned model · new outbound voicemail service
7. **Ollama-on-Railway** (Cat 7) · 1 new service in natural-appreciation · improve-agent + content drafts route here
8. **FLUX self-host** (Cat 8) · Replicate · default for blog/OG/programmatic images
9. **Transformers.js widget** (Cat 9) · tire-size detection + Spanish auto-detect in nickstire client
10. **Bilingual SMS** (Cat 10) · classifier-routed Spanish replies · multilingual embeddings already live from Step 1
11. **Dataset scan** (Cat 11) · search HF Hub · candidate datasets vetted
12. **NickGPT fine-tune** (Cat 12) · LoRA run on 2k operator-approved SMS exchanges · the moat starts compounding

## Skill-port lineage

Bundle of HF-* skill family ports. Pairs with:
- PORT 6 / audit #317 · hybrid-search rebuild (Cat 2 reranker is the missing third stage)
- PORT 10 / audit #321 · VAPI eval pipeline (Cat 5 bulk Whisper feeds the eval corpus)
- audit #126 · improve-agent cron cost (Cat 7 self-hosted LLM is the fix)
- B6 viral content engine (Cat 8 FLUX self-host powers image gen at scale)
- F25e SMS gateway · Cat 4 photo-assess outputs route via `{ via: "shop" }` · same plumbing
- A4 tool-builder patterns · classifier service follows the same shape

Future · hugging-face-paper-publisher skill enables publishing fine-tuned NickGPT as an HF model card · brand authority + recruiting signal · "Cleveland tire shop publishing on HuggingFace" is the kind of differentiator no competitor will match.
