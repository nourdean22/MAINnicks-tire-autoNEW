# Track 1 — Model + Inference Layer (researched 2026-09-03)

> **Source-quality warning.** Much of what ranks for these queries in 2026 is SEO content-farm
> material with contradictory numbers (one "2026 guide" calls the RTX 5090 a 24GB card; another
> quotes its price at both $1,999 and $3,699). Treat tok/s and price figures as order-of-magnitude.
> The GitHub API scorecard (§7) is hard primary data pulled live 2026-09-03.

## 1. Open-weight models

### Reasoning / coding
| Model | Params (total/active) | License | Released | Notes |
|---|---|---|---|---|
| Kimi K3 | 2.8T / 50B MoE | Modified MIT (**restricted**) | Jul 2026 | 93.5% GPQA Diamond. ~1.5TB weights, 16x B200. NOT self-hostable by an individual. |
| GLM-5.2 (Zhipu) | 744B / 40B MoE | MIT | 2026-06-13 | Tops open-weight coding. 1M ctx. ~245GB @ 2-bit. |
| DeepSeek V4-Pro | 1.6T / 49B MoE | MIT | 2026-04-24 | 1M ctx. Cluster only. |
| **DeepSeek V4-Flash** | 284B / 13B MoE | MIT | Apr 2026 | 91.6% LiveCodeBench. **2xA100 viable** = realistic serious self-host ceiling. |
| **Qwen3.8-27B** | 27.8B dense | Apache-2.0 (verify card) | 2026 | **73.0% Terminal-Bench 2.1** — best agentic score in its size class. Most interesting model for this use case. |
| Mistral Small 4 | 119B / 6.5B MoE | Apache-2.0 | Mar 2026 | ~111GB FP8. Genuinely permissive. |
| Qwen3-32B / Qwen3.5-35B-A3B | 32B dense / 35B-A3B | Apache-2.0 | 2025-26 | The 24-32GB VRAM sweet spot. MoE variant runs on 12GB w/ expert offload. |
| Llama 4 Maverick | 400B / 17B | Llama 4 Community (**700M MAU clause**) | Apr 2025 | Increasingly irrelevant vs Chinese open weights. |

**License caution:** "Modified MIT" on Kimi is NOT MIT. Qwen is family-branded Apache-2.0 but
individual checkpoints differ — read the model card, never the family brand. Llama 4 has a hard
commercial ceiling.

### Vision / screenshot
- **Qwen3-VL-235B-A22B** (Apache-2.0) — native 256K->1M ctx, **explicitly trained to operate GUIs**
  (recognizes UI elements + their function, drives tool calls), 32-language OCR. Correct default
  for screenshot agents.
- **InternVL3-78B** (MIT) — strongest fully-MIT alternative; InternVL 2.5 8B strong at UI for its size.

### Embeddings / reranking — **open weights LEAD here**
- **Qwen3-Embedding-8B/4B/0.6B** — #1 MTEB multilingual (70.58) and #1 Jan-2026 English (70.6),
  ahead of every proprietary API. Instruction-conditioned, 100+ languages.
- **Qwen3-Reranker** (same family) / Jina v3.5 / BGE-Reranker-v2-M3.
- 0.6B embedder + reranker run on CPU. **No reason to pay for embeddings in 2026.**

### STT — **meets or beats commercial APIs**
Parakeet TDT (fastest batch) · Canary-Qwen 2.5B (English accuracy) · Whisper large-v3 (MIT, best
multilingual all-rounder) · Moonshine (edge/low-latency).

### TTS — **open now beats commercial on blind preference**
- **Kokoro 82M (Apache-2.0)** — astonishing quality-per-byte, CPU-capable. Default agent voice.
- **Breeze TTS 2** (2026-08-25) — 1,215 Elo on Artificial Analysis Speech Arena, **beating
  ElevenLabs Eleven v3 (1,177)**.

## 2. Serving runtimes
| Runtime | License | Latest | Best at | Structured output | Burden |
|---|---|---|---|---|---|
| **vLLM** | Apache-2.0 | v0.28.0 (2026-08-26) | High-concurrency, widest coverage, no compile step | guided decode (xgrammar/outlines) | Medium |
| **SGLang** | Apache-2.0 | v0.5.18 (2026-08-22) | **Agent loops** — RadixAttention TTFT win w/ shared prefixes; lowest latency for constrained JSON + repeated tool calls | native, first-class | Medium |
| **llama.cpp** | MIT | (versioning reset) | CPU, Apple, single-user, GGUF | GBNF grammars | Low |
| TensorRT-LLM | NOASSERTION | **v1.2.1 (2026-04-20)** | Peak NVIDIA throughput IF pre-compiled | limited | **High** |
| Ollama | MIT | v0.33.2 (2026-08-27) | Frictionless single-user; **v0.19 added MLX backend** | JSON schema; tool-calling historically weakest link | Very low |
| **MLX / mlx-lm** | MIT | v0.31.3 (2026-04-22) | **Apple Silicon, 30-50% faster than llama.cpp** | via wrappers | Low |
| LocalAI | MIT | v4.9.0 (2026-08-20) | All-in-one OpenAI-compatible facade (LLM+STT+TTS+embed) | yes | Low |
| HF TGI | Apache-2.0 | v3.3.7 (2025-12-19), last push 2026-03-21 | — | — | **ABANDONED** |

**Apple numbers:** M4 Max 128GB, Qwen3.5-35B-A3B: MLX **130 tok/s** vs Ollama-legacy 43.5.
Ollama 0.19 MLX backend, M5 Max, NVFP4: prefill 1,154->1,810 tok/s, decode 58->112.
On any 2026 Mac, MLX-backed tooling is the only correct choice.

**Watch:** `vllm-mlx`, plus vLLM plugin backends for ROCm/TPU/Gaudi/Apple — vLLM is going
hardware-agnostic, weakening TensorRT-LLM's remaining case.

## 3. Hardware viability
| Tier | Runs | tok/s | Verdict |
|---|---|---|---|
| CPU-only | <=8B Q4; embeddings; Kokoro; Whisper | 3-10 gen | Fine for embed/TTS/STT. **Not viable for an agent loop.** |
| 8GB | 7-8B Q4 | 40-70 | Chat-capable, agent-incapable. Tool-calling reliability is the failure point, not speed. |
| 12GB | 7-13B dense; **35B-A3B MoE via llama.cpp `-ncmoe` expert pinning** | 50-62 | MoE-offload trick = highest-leverage config at this tier. |
| 16GB | 14-20B Q4 | 40-60 | Comfortable daily driver. |
| **24GB (4090/3090)** | Dense 27-32B Q4 (Qwen3-32B best quality/VRAM) | 60-90 | **First tier where an agent is genuinely usable.** |
| 32GB (5090) | + headroom for long ctx/KV | 60-213 | Best single-card consumer option 2026. |
| 48GB+/2xA100 | DeepSeek V4-Flash, Qwen3-VL-235B quant | — | Realistic ceiling for near-frontier self-host. |
| Apple | 64-128GB unified: 35B-A3B @ 112-130 tok/s | — | Cheapest path to LARGE models; prefill is the weak axis vs NVIDIA. |

## 4. Local vs rented economics
Rental $/hr: RTX 4090 $0.34 (RunPod) · **RTX 5090 $0.69 on-demand / $0.44 spot** · A100 80GB
$1.19-1.39 · H100 $1.99-2.89. Vast.ai unverified-host pricing is NOT comparable to verified DC
and carries real data-handling risk for a personal agent holding personal data.

Electricity: 5090 ~450-575W. 8h/day @ $0.15/kWh = ~$75/mo; 2h/day realistic = ~$19/mo.

**Break-even (honest):** 5090 @ $1,999 vs $0.69/hr = **~2,900 GPU-hours ~= 18 months** at 40h/wk
before power. At $3,699 street = ~5,400h ~= 2.6 years. The blogosphere's "4-8 month breakeven"
compares a local 4090 against **H100 rental at $2-4/hr** — apples-to-oranges. **Depreciation ~30%/yr
is omitted everywhere.**

**Verdict: duty cycle is the whole argument.** A personal agent is bursty — minutes/day, not hours.
Rent or use hosted APIs for big models; own a 24-32GB card only for privacy, offline, or fine-tuning.
**Buy for sovereignty, not savings.** The savings case does not close at personal duty cycles.

## 5. Routing / provider abstraction
| Tool | License | Health | Verdict |
|---|---|---|---|
| LiteLLM | **NOASSERTION** (marketing says MIT *and* Apache-2.0 — audit LICENSE yourself; enterprise separately licensed) | 57.9k stars, v1.99.1 (2026-09-02), **4,948 open issues**, contributors Berri-employee-dominated | **AUGMENT w/ hard caveat** |
| OpenRouter | proprietary SaaS | healthy | KEEP as a provider *behind* your gateway, not as the gateway |
| LocalAI | MIT | 48.8k stars, v4.9.0 | **KEEP** — genuine OpenAI-compatible local facade |

**LiteLLM supply-chain incident, March 2026:** PyPI **1.82.7 and 1.82.8 were compromised with
credential-stealing malware**; clean release v1.83.0, Mandiant engaged. For an agent holding every
API key you own this is the highest-consequence risk in this report. If deployed: **pin versions,
verify hashes, container with no ambient cloud credentials.** Low maintainer diversity + huge open
issue count + live supply-chain history = **do not treat as infrastructure-grade.**

## 6. Where open weights CANNOT match frontier
| Capability | Frontier closed | Best open weight | Gap |
|---|---|---|---|
| **Terminal-Bench 2.1 (long-horizon agentic)** | **GPT-5.6 Sol 85.77%** (89.5% xhigh); Fable 5.1 85.02%; Opus 5 84.64% (89.1% max) | **Qwen3.8-27B 73.0%** | **~13-16 pts — the decisive gap for an agent** |
| SWE-bench Verified | Opus 5 / Sonnet 5 / Fable 5 ~95% | — | Not close |
| SWE-bench Pro | Opus 4.8 69.2%; Opus 5 63.2%; GPT-5.5 58.6% | DeepSeek V4-Pro claims 80.6% "SWE-Bench" (**unqualified variant — treat as marketing**) | Unresolvable from public data |
| **Computer use (OSWorld)** | Opus 4.8 **83.4%**, GPT-5.5 78.7% (both above 72.4% human-expert baseline) | no comparable published open score | **Effectively no open-weight competitor** |
| Tool-calling under long ctx | robust | degrades; small models fail schema | Constrained decoding recovers *syntactic* validity, NOT *judgment* |
| Embeddings/rerank, STT, TTS | — | **open leads or matches** | Open wins |

**Benchmark gaming called out:** GLM-5.2's "99.23% AIME 2026" is a contamination signal, not
capability — discard. Terminal-Bench scores are **effort-conditioned** ("max effort", "xhigh");
vendors quote the expensive config, users get the cheap one. SWE-bench has 3+ incompatible variants
routinely conflated — any unqualified "SWE-bench" number is unusable. Vendor-reported scores
dominate; prefer Vals.ai / Artificial Analysis / Snorkel.

**Bottom line:** perception/retrieval/voice can be 100% open weight today with no quality loss.
The **agentic orchestration brain cannot** — ~13-16 pts of terminal-agent success rate, which
compounds multiplicatively across multi-step tasks. **Hybrid is the honest architecture.**

## 7. Repo scorecard (GitHub API, live 2026-09-03)
| Repo | License | Stars | Last push | Latest release | Open iss | Diversity | Verdict |
|---|---|---|---|---|---|---|---|
| ggml-org/llama.cpp | MIT | 126,906 | 2026-09-03 | tag v0.3.0 (2026-08-25, **versioning reset — not immature**) | 2,393 | High | **KEEP** |
| vllm-project/vllm | Apache-2.0 | 90,886 | 2026-09-03 | v0.28.0 | 7,449 | High | **KEEP** (issues reflect scale, not rot) |
| sgl-project/sglang | Apache-2.0 | 33,835 | 2026-09-03 | v0.5.18 | 5,144 | Good | **AUGMENT** — add alongside vLLM for agent/structured workloads |
| ollama/ollama | MIT | 180,046 | 2026-09-03 | v0.33.2 | 3,889 | **Concentrated (single company)** | KEEP for dev/laptop; **REPLACE for concurrent load** |
| ml-explore/mlx-lm | MIT | 6,882 | 2026-09-03 | v0.31.3 (**4.5mo stale despite daily commits**) | 257 | Apple-concentrated | **KEEP on Apple; install from git not tag** |
| NVIDIA/TensorRT-LLM | NOASSERTION | 14,539 | 2026-09-03 | **v1.2.1 (2026-04-20)** | 1,431 | Single-vendor | **WATCH** — engine-build burden unjustifiable at personal scale |
| BerriAI/litellm | NOASSERTION | 57,941 | 2026-09-03 | v1.99.1 | 4,948 | **Low** | **AUGMENT w/ caution** (Mar 2026 PyPI compromise) |
| mudler/LocalAI | MIT | 48,845 | 2026-09-03 | v4.9.0 | 202 | **Low — effectively one human** | **AUGMENT** — real bus-factor risk |
| huggingface/TGI | Apache-2.0 | 10,892 | **2026-03-21 (5.5mo dead)** | v3.3.7 | 324 | — | **DO NOT USE** |
| lmstudio-ai | closed core | — | — | — | — | — | **WATCH** — closed source disqualifies as infra |

## 8. Recommended stack
1. **Serving:** vLLM default; **SGLang for the agent loop** (RadixAttention + first-class constrained
   decoding worth the second process). llama.cpp/MLX on laptop/Apple.
2. **Brain:** **Qwen3.8-27B** (Apache-2.0, 24-32GB) as local default — only open weight in
   single-GPU range with credible agentic numbers. **Route long-horizon planning + computer use to a
   frontier API; do not pretend the gap is closed.**
3. **Vision:** Qwen3-VL (Apache-2.0), purpose-built for GUI/screenshot operation.
4. **Retrieval:** Qwen3-Embedding-0.6B/4B + Qwen3-Reranker. Stop paying for embeddings.
5. **Voice:** Parakeet TDT or Whisper large-v3 in; Kokoro out.
6. **Gateway:** LocalAI for local OpenAI-compatible surface; LiteLLM only if multi-provider routing
   needed — pinned, hash-verified, credential-sandboxed.
7. **Economics:** rent the big stuff; own 24-32GB only for privacy/offline/fine-tune.

## Sources
Thunder Compute (best OSS LLMs / best GPU 2026) · Wavect open-weight comparison · Morph
(coding model 2026, Claude benchmarks) · Artificial Analysis + Snorkel + Vals.ai Terminal-Bench
v2.1 leaderboards · Yotta Labs vLLM-vs-SGLang · Spheron (engine benchmarks, GPU pricing) · VRLA
Tech engine comparison · ollama.com/blog/mlx · compute-market MLX-vs-llama.cpp · qwenlm.github.io
Qwen3-Embedding · BentoML (embeddings, VLMs, TTS guides) · Northflank + AssemblyAI STT ·
Speakeasy OSS TTS · FreeAPIHub Qwen3-VL · Presenc open-weight VLMs · RunPod pricing ·
kunalganglani local-LLM break-even · Aliteq RTX 5090 · Contabo LiteLLM-vs-OpenRouter ·
llmgateway.io OSS alternatives · localllm.in VRAM guides · GitHub REST API v3 (2026-09-03).
