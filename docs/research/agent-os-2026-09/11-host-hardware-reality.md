# Host Hardware Reality — MEASURED 2026-09-03

**This document overrides every "run it locally" recommendation elsewhere in this research set.**
Everything below was measured on the actual machine, not inferred.

## Measured facts
| Probe | Value | Source |
|---|---|---|
| OS | Windows 11 Pro, build **10.0.26200.9168** | measured |
| CPU | **Intel Core Ultra 7 266V** (Lunar Lake), 8 cores / **8 logical** (no HT) | measured |
| **GPU** | **Intel Arc 140V iGPU** — driver 32.0.101.8425. **No NVIDIA. No CUDA. `nvidia-smi` absent.** | measured |
| **RAM** | **15.72 GB total.** Lunar Lake = **on-package LPDDR5X → NOT upgradeable, ever** | measured |
| **Free disk C:** | **14.92 GB / 237 GB** | measured |
| Hypervisor / VBS | HypervisorPresent **True**, VBS running, WHP **enabled** | measured |
| WSL | v2.6.3.0, kernel 6.6.87.2 — **but ZERO distros installed** | measured |
| Docker | CLI installed, **engine not running** | measured |
| `.wslconfig` | `memory=6GB`, `processors=4` — the entire Linux budget | measured |

## ⇒ What this INVALIDATES

Track 1 (model layer) recommended **Qwen3.8-27B on a 24–32GB NVIDIA card** as the local agent brain,
and vLLM/SGLang as the serving runtime. **None of that is reachable on this machine.**

| Track 1 recommendation | Reality here |
|---|---|
| Qwen3.8-27B (24–32GB VRAM) as local brain | **Impossible.** 8GB *shared* iGPU memory carved out of 15.72GB system RAM |
| vLLM / SGLang | **CUDA-first.** Intel paths exist (IPEX-LLM/SYCL) but are second-class and fragile |
| "24GB is the first tier where an agent is genuinely usable" | This box is **below** that tier by a wide margin |
| Speculative decoding, prefix cache, high concurrency | Irrelevant at this scale |

**Track 1's own words applied here:** *"8GB: chat-capable, agent-incapable. Tool-calling reliability
at 8B is the failure point."* And that assumed 8GB of **dedicated** VRAM; this is shared.

## ⇒ What IS viable locally on this box
| Workload | Viable? | Notes |
|---|---|---|
| **Embeddings** (Qwen3-Embedding-0.6B) | ✅ **Yes** | CPU-fine. Track 1: open weights *lead* here. Genuine $0 win |
| **Reranking** (bge-reranker-v2-m3 / Qwen3-Reranker-0.6B via ONNX) | ✅ **Yes** | ONNX/transformers.js runs in-process in Node |
| **STT** (whisper.cpp / faster-whisper small) | ✅ Yes | CPU or Arc via OpenVINO |
| **TTS** (Kokoro 82M) | ✅ Yes | CPU-capable by design |
| **7–8B Q4 chat model** | ⚠️ Marginal | llama.cpp + Vulkan/SYCL on Arc. Slow; competes with the OS for RAM |
| **Agent reasoning brain** | ❌ **No** | Must be a hosted API. This is a hardware fact, not a preference |
| **Vision / GUI grounding (Holo-3.1-4B)** | ⚠️ Marginal | 4B Q4 ~3GB might fit; 9B will not |

## ⇒ Cost-architecture consequence
The user's goal is "without paying for shit." The honest answer on **this** hardware:

- **$0 is achievable for:** embeddings, reranking, hybrid search, STT, TTS, all deterministic
  automation, browser automation (Playwright), document parsing (Docling on CPU), and the entire
  app/infra layer.
- **$0 is NOT achievable for the agent brain.** There is no local model on this machine that can
  drive a reliable tool-calling agent loop. Track 1 measured the gap as **~13–16 points of
  Terminal-Bench 2.1** even on a 24GB card; here there is no contender at all.
- **Therefore: hosted frontier API for reasoning is the only credible path**, and the cost
  discipline must come from *routing and caching*, not from local inference.

Corroborating evidence from Track 2's SWE-bench cost table — **open-weights hosted APIs are the
cheap middle ground, not local inference**:
| Model | SWE-bench Verified | $/instance |
|---|---|---|
| Claude 4.5 Opus (high) | 76.8% | $0.754 |
| **MiniMax M2.5 (high) — open weights, hosted** | **75.8%** | **$0.073** |
| Gemini 3 Pro (high) | 69.6% | $0.960 |

**MiniMax M2.5 scores 6.2 points higher than Gemini 3 Pro at ~1/13th the cost.** That is the real
"$0-adjacent" lever available on this hardware: route to cheap open-weights **APIs**, not to a local GPU.

## ⇒ Sandbox consequence (from the measured host audit)
| Option | On this box |
|---|---|
| **Anthropic `srt` (sandbox-runtime)** | ✅ **Works natively today** — Windows alpha: dedicated `srt-sandbox` user + WFP egress fence + per-session ACEs. Apache-2.0, v0.0.75 (2026-09-01). **Adopt first.** |
| **microsandbox** | ✅ **WHP already enabled** → one install command. ⚠️ beta, 2-human bus factor, no memory snapshot |
| **Windows Sandbox** (`.wsb`) | ✅ Built in, disposable, can disable networking |
| **gVisor** | ⚠️ Needs a WSL distro first (none installed). systrap needs only seccomp, no KVM |
| **Firecracker** | ⚠️ Needs WSL distro; nested virt defaults on for Win11 x86 — **unverified, no distro to test** |
| **Claude Code `/sandbox`** | ❌ **Blocked** — docs: *"Native Windows is not supported."* Needs WSL2 |
| **E2B self-host** | ❌ Impossible — GCP/AWS only, 5-node floor, ~$1.5–2.5k/mo |
| **k3s / K8s** | ❌ Impractical — min 2c/2GB inside a 6GB WSL budget with 15GB disk |

**Best remote lane at $0: Vercel Sandbox Hobby** — 5 active-CPU-hr + 420 GB-hr + 5,000 creations
+ 20 GB egress + 15 GB snapshots **per month, free**, real Firecracker microVMs, full egress
firewall (free since 2026-08-05), **overage pauses creation rather than billing you**, and the
`cle1` region is **Cleveland**. Callable from Railway with an access token — no Vercel hosting needed.

## 🔴 BLOCKING CONSTRAINT: disk
**14.92 GB free.** A WSL distro + images + Firecracker kernels will not fit comfortably.
Memory index flags `NOURCITY\.turbo\cache` as the repeat offender (was 20 GB once).
**Free disk before installing any Linux-side tooling.**

## Open questions requiring operator input
1. Is there another machine (desktop w/ NVIDIA, spare box, Mac) available? That single fact changes
   the local-inference answer completely.
2. Willing to spend the ~$5–20/mo that buys disproportionate value (cheap open-weights API routing),
   or is hard $0 the constraint even at the cost of capability?
3. OK to install a WSL2 distro (unlocks gVisor + Claude Code `/sandbox`), given the disk situation?
