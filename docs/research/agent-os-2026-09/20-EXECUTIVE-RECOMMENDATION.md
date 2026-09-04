# bdnick.info → Personal Agent OS — Executive Recommendation
**2026-09-03 · grounded in 9 research tracks + a measured host audit + direct code reading**

---

## 1. THE HEADLINE

**bdnick.info does not need a rewrite. It needs instrumentation, a DR net, and three targeted
subsystems. Almost everything the research recommends, you already have.**

That is not flattery — it is the finding that survived a deliberate search for reasons to change.
2,581 TS files, 103 Prisma models, Inngest, Sentry, Langfuse (all OTel-native), Playwright, a
7,108-test vitest suite, MCP surface snapshot tests, and 20+ gates in `verify:hard`. Track 7's
verdict, after auditing every alternative: **"Nothing in your stack should be replaced."**

**The single most important number found:** your largest Inngest function uses **11 steps against a
1,000-step ceiling** — 1% of the binding constraint. The "you'll outgrow this" argument is dead.

### The four things that actually matter
| # | Finding | Severity |
|---|---|---|
| 1 | 🔴 **Neon free-tier PITR is a 6-HOUR window.** A bad migration found next morning is unrecoverable. With hand-applied migrations and a prior `task_events` double-write incident, this is the highest-severity gap anywhere in the program. | **CRITICAL** |
| 2 | 🔴 **No local model on this machine can drive a reliable tool-calling agent loop.** Intel Arc 140V iGPU, 15.72 GB non-upgradeable RAM, no CUDA. Hosted API for reasoning is a *hardware fact*, not a preference. | **ARCHITECTURAL** |
| 3 | 🟠 **Tool *execution* telemetry is excellent; tool *selection* telemetry does not exist.** 181 tools, 24/turn (13%), chosen by ~40 hand-written regexes with no record of what was dropped. `searchTools` firing is the model literally reporting a pruner miss — and it's unlogged. | **HIGH** |
| 4 | 🟠 **Scaffold ≈ 1–3 points; model ≈ 20 points.** A 100-line bash agent scores 76.8% on SWE-bench Verified vs a full platform's 77.6%. **MiniMax M2.5: 75.8% at $0.073/instance vs Claude 4.5 Opus 76.8% at $0.754.** Stop optimizing scaffolding; optimize routing. | **STRATEGIC** |

---

## 2. CAPABILITY GAP MATRIX vs ChatGPT Work / Claude Code

| Capability | ChatGPT Work / Claude Code | bdnick today | Gap | Closeable at $0? |
|---|---|---|---|---|
| Chat + streaming + tools | ✅ | ✅ | **none** | — |
| Durable long-running tasks | ✅ | ✅ Inngest, 25 fns | **none** | ✅ |
| Tracing / observability | ✅ | ✅ Langfuse + Sentry, OTel-native | **none** | ✅ |
| Eval harness | ✅ | ✅ vitest + judges | **judges uncalibrated** | ✅ |
| **Tool reliability at scale** | tool-search / deferred defs | 24-of-181 hard budget + regex | **selection is unmeasurable** | ✅ |
| **Coding agent** | Claude Code | ❌ none in-app | **large** | ✅ (OpenCode/Codex CLI, external) |
| **Artifact workspace** | ✅ Canvas/Cowork | partial (chat + pages) | **large** | ✅ (Plate + Typst) |
| **Doc/slide/sheet generation** | ✅ | ❌ | **large** | ✅ (Typst + docx/PptxGenJS) |
| **Visual validation of artifacts** | partial | ❌ | **medium** — and this is where "good" comes from | ✅ |
| **Browser use** | ✅ | Playwright present, not agent-driven | **medium** | ✅ (bundled `playwright mcp`) |
| **Computer use** | ✅ (OSWorld ~83%) | ❌ | **DO NOT BUILD** — open weights 47.5% | n/a |
| **Deep research w/ citations** | ✅ | partial | **medium** | ⚠ search APIs cost |
| Memory | ✅ | ✅ **better than most frameworks** | **provenance/trust tiers missing** | ✅ |
| **Sandboxed code execution** | ✅ | ❌ | **medium** | ✅ (srt + Vercel Sandbox free tier) |
| Voice | ✅ | partial | **medium** | ✅ |
| Mobile/PWA control | ✅ | ✅ installed PWA | **none** | ✅ |
| **DR / backup** | vendor-managed | 🔴 **6-hour window** | **CRITICAL** | ✅ |

**Honest ceiling:** you can match ChatGPT Work's *workflow* almost entirely at ~$0 in software. You
**cannot** match frontier *reasoning* with local weights on this hardware — Track 1 measured the gap
at **~13–16 points of Terminal-Bench 2.1** even on a 24 GB card you don't have. **Budget for API
reasoning; take everything else for free.**

---

## 3. WHAT TO KEEP / AUGMENT / REPLACE / DELETE

**KEEP (do not touch):** Next.js 16 · Prisma/Neon · **Inngest** · **Langfuse Cloud** · Sentry hosted ·
Railway · Playwright · vitest evals · the existing memory schema (`BrainMemory`, `MemoryEdge`,
`SemanticEdge`, `Contradiction`, `PersonProfile`, `VectorEmbedding`) · `searchTools`/`invokeTool`
recovery lane · `tool_telemetry` + circuit breaker · `verify:hard`.

**AUGMENT:** tool selection → add telemetry, then retrieval · memory → add trust tiers + bi-temporal
edges · evals → calibrate judges, add CI gate · people-search → RRF instead of the 0.4/0.6 blend ·
Playwright → bundled MCP + healer + skill-distillation.

**REPLACE:** the ~40-regex tier-4 pruner (with retrieval, **once data justifies it**) · Monaco (if
present) → CodeMirror 6 + Shiki.

**DELETE / DO NOT ADD:** a second agent framework · a vector DB · a graph DB · a search engine · a
memory framework · an MCP gateway · Kubernetes · Redis (unless resumable streams demand it) ·
GraphRAG · tldraw · ONLYOFFICE · Skyvern · browserless · npm `xlsx` · openWakeWord's pretrained
models · XTTS v2 · Aider · Roo Code · Continue · AutoGen · `@inngest/agent-kit`.

---

## 4. END-STATE ARCHITECTURE

```
                         ┌──────────── iOS PWA (control plane only) ────────────┐
                         │ cmd palette · approvals · trace · diff · cost meter  │
                         │ ⚠ NO background sync, NO silent push — server sched  │
                         └───────────────────────┬──────────────────────────────┘
                                                 │ HTTPS (Tailscale for private plane)
┌────────────────────────────────────────────────▼─────────────────────────────────────┐
│ Next.js 16 (Railway)                                                                 │
│                                                                                      │
│  ┌── CHAT / AGENT LOOP ────────────────────────────────────────────────────────────┐ │
│  │ AI SDK v6.0.275 → v7 ToolLoopAgent   stopWhen · prepareStep · toolApproval      │ │
│  │        │                                                                        │ │
│  │        ├─► TOOL GATEWAY  ◄── THE KEY NEW COMPONENT                             │ │
│  │        │   resolve(): {ALLOWED}|{DENIED,reason}|{NOT_FOUND,near[]}|{BUDGETED,rank}│
│  │        │   → tool_gate_decision row EVERY TIME (a gate that can't emit a        │ │
│  │        │     denial row is a gate that fails silently)                          │ │
│  │        │   zod in + out · idempotency key · timeout · breaker · egress allowlist │ │
│  │        │                                                                        │ │
│  │        └─► MODEL ROUTER   cheap-open-weights API default → frontier on escalation│ │
│  │            budget caps (402 on breach) · per-run tool-call ceiling · kill switch │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  ┌── ARTIFACTS ─────────┐ ┌── RESEARCH ────────┐ ┌── WORKSPACE ───────────────────┐ │
│  │ Typst → PDF/PNG/SVG  │ │ evidence + claim   │ │ Plate (MIT) + Yjs editor-only  │ │
│  │ docx/PptxGenJS/xlsx  │ │ rows; cite-as-you- │ │ Excalidraw · Mermaid           │ │
│  │ TWO-GATE VALIDATION: │ │ write; 3-level     │ │ CodeMirror 6 edit / Shiki read │ │
│  │  geometry → vision   │ │ dedup; A–D grading │ │ ⚠ sheets+slides = DELEGATE     │ │
│  │  ≤3 rounds, monotonic│ │ verify before emit │ └────────────────────────────────┘ │
│  └──────────────────────┘ └────────────────────┘                                    │
└──────┬──────────────────────────┬────────────────────────────┬──────────────────────┘
       │                          │                            │
┌──────▼────────┐  ┌──────────────▼──────────────┐  ┌──────────▼────────────────────┐
│ INNGEST       │  │ NEON POSTGRES (sole SoT)    │  │ SANDBOX / BROWSER             │
│ 25 fns, 11/1k │  │ 103 models + tool_gate_     │  │ L0 API → L1 committed script  │
│ steps used    │  │ decision, evidence, claim,  │  │ → L2 playwright-mcp a11y      │
│ ⚠ 32 MiB run  │  │ trust tiers, bi-temporal    │  │ → L3 vision (last resort)     │
│   state = the │  │ pgvector + tsvector + RRF   │  │ → L4 HUMAN                    │
│   real ceiling│  │ 🔴 nightly dump + MONTHLY   │  │ srt local · Vercel Sandbox    │
│               │  │    RESTORE DRILL            │  │ free tier remote              │
└───────────────┘  └─────────────────────────────┘  └───────────────────────────────┘
       └──────────────► Langfuse (OTel GenAI: invoke_agent → chat → execute_tool)
```

**MVP (first 30 days) — build ONLY these four:**
1. Tool gateway + `tool_gate_decision` telemetry
2. DR: nightly dump + monthly restore drill
3. Typst artifact pipeline + two-gate visual validation
4. Judge calibration + CI eval gate

**Explicitly NOT in the MVP:** coding agent in-app, computer use, voice, graph layer, CRDT sync,
research engine v2, model router v2.

---

## 5. SECURITY THREAT MODEL (condensed)

| Threat | Status here | Control to add |
|---|---|---|
| **Prompt injection → memory poisoning** | 🔴 **the largest real gap** — CaMeL *assumes* memory is uncompromised; the six design patterns paper has **no memory case study** | **Trust tiers on `BrainMemory` + `MemoryEdge`.** Never auto-write web/MCP/third-party-agent content. **No row promotes itself by repetition** (that's exactly MINJA/eTAMP). `sourceTraceId` → cascade-quarantine |
| **SSRF via agent browsing** | 🔴 **no egress control** | **Egress allowlist on every URL-fetching tool.** Cheapest high-value control available |
| Secret leakage via tool output | ⚠ partial | Redact before output enters context *or logs* |
| Destructive tool calls | ⚠ prompt-tier | Server-side destructive classification — **never trust `destructiveHint`** (spec says annotations are untrusted) |
| MCP supply chain | ✅ n/a (no third-party servers) | If ever added: pin definition hash, diff on load, `snyk/agent-scan` in CI |
| Cost runaway | 🔴 none | **Budget caps + per-run tool-call ceiling + kill switch, BEFORE any autonomy** |
| Credential theft via browser | ⚠ | `storage_state` from a **human-run** login, mounted read-only. **LLM never touches a credential in any modality** |
| iOS confirm bypass | 🔴 **silent** | In-DOM two-tap; **CI grep for `confirm(`/`alert(`/`prompt(`** |

---

## 6. COST TIERS (honest)

| Tier | Monthly | What you get |
|---|---|---|
| **$0** | $0 + electricity | Everything except frontier reasoning: embeddings (Qwen3-0.6B, **open weights LEAD here**), reranking, hybrid search, STT (whisper.cpp), TTS (Kokoro), Playwright, Typst, Docling, Tailscale, Vercel Sandbox free tier, Langfuse Cloud Hobby (50k units), Inngest free (50k runs) |
| **<$25** | ~$13–20 | + Serper $50/6mo (~$8.34/mo, ~8,300 queries) + Exa free $10 credits + Jina Reader. **This is the recommended tier.** |
| **Performance** | ~$40–120 | + frontier API for long-horizon planning & computer use, routed |

**Where $5–20 buys disproportionate value:** search API access (the free-search era ended — Bing
retired, Brave killed its free tier, Google CSE closed to new customers) and **cheap open-weights
reasoning APIs**. MiniMax M2.5 at **$0.073/instance vs $0.754** is the single best cost lever available.

**What is NOT free, contrary to common belief:** self-hosted SearXNG (a DuckDuckGo proxy without a
proxy pool — Google returns *zero parseable results* from a datacenter IP) · Langfuse self-host
(5–6 services, $40–80/mo — **Cloud is cheaper in dollars AND hours**) · E2B self-host (~$1.5–2.5k/mo
floor) · local inference on this hardware (impossible for the agent brain).

---

## 7. ROADMAP

### 48 hours
1. 🔴 **Nightly `pg_dump` → object storage** via Inngest cron. *(highest severity, ~1h)*
2. 🔴 **Audit for side effects outside `step.run()`** across 101 call sites — LLM calls, Prisma
   writes, `Date.now()`/`Math.random()`. *(highest ROI per Track 7, ~1h)*
3. Add `tool_gate_decision` table + emit from `pruneTools`/`prepare-tools`. *(~3h)*
4. **Cost kill switch**: per-run token + tool-call ceiling. *(~2h)*
5. Root `AGENTS.md` importing `CLAUDE-OPERATING-PROFILE.md` — one file unlocks Codex, OpenCode,
   Crush, Qwen, goose, Kilo, Cline, Zed simultaneously. *(~30m)*

### 7 days
6. **Monthly restore drill** into a Neon branch, automated + alerting.
7. `/system/tool-reachability` panel: top `searchTools` queries, pruner misses, cold-cache rate,
   budget-truncation rate.
8. **Egress allowlist** on URL-fetching tools.
9. Judge calibration: Cohen's κ + position-swap control.
10. CI eval gate: Zod validity + tool-call success + cost ceilings block the merge.

### 30 days
11. Tool gateway discriminated union + idempotency keys + per-tool breaker surfaced on `/brain`.
12. **Typst artifact pipeline + two-gate visual validation.**
13. Memory trust tiers + `sourceTraceId` + bi-temporal `validFrom`/`validTo`.
14. Bundled `playwright mcp` (`--isolated --allowed-origins`) + healer in `verify:hard`.
15. AI SDK v7 spike behind a flag (codemod; watch ESM-only, Node 22, cumulative `usage`).

### 90 days
16. Replace tier-4 regexes with retrieval — **only if the telemetry justifies it**.
17. Webwright-style skill distillation: successful L2 browser run → committed L1 Playwright script.
18. Research engine v2: evidence/claim rows, cite-as-you-write, 3-level dedup, verification pass.
19. Workspace: Plate + Yjs (editor-scoped only) + Excalidraw + Shiki diffs.
20. Model router: cheap-open-weights default, frontier on escalation, eval-driven.

### 6 months
21. Voice (Pipecat + Silero + turn-detector + whisper.cpp + Kokoro).
22. Connector permission tiers + health board.
23. Skill format w/ evals + permissions; self-improvement loop behind flags with auto-rollback.

---

## 8. DO NOT BUILD
Computer-use agent (open weights 47.5% OSWorld — 1-in-2 failure unsupervised) · multi-agent
orchestration for write-heavy work (**4–15× tokens, reintroduces coordination bugs**) · CRDT sync
engine · graph database · vector database · search engine · MCP gateway · Kubernetes · self-hosted
Langfuse/Sentry/E2B · GraphRAG extraction · a second agent framework · your own eval platform.

---

## 9. TOP 10 MISSED OPPORTUNITIES (from track 9's pass)
1. **Cost kill switch before autonomy** — documented $15-in-10-minutes burn.
2. **Open-weight license register** — Llama is a *contract* with geo-exclusions; XTTS/Voxtral TTS are
   non-commercial with no seller left.
3. **EU AI Act Art. 50 went live 2026-08-02** — label synthetic media, disclose the bot. Cheap.
4. **DR drills with the "0" in 3-2-1-1-0** — zero unverified restores.
5. **Agent identity/delegation** — log `(user, agent, tool, scope, hop)` now; retrofitting is worse.
6. **Notification fatigue as an explicit budget** — no silent push on iOS means every message costs attention.
7. **Ohio one-party consent** — you're clear for own-conversation capture; **two-party states flip it**;
   store per-recording state, not a global flag.
8. **Digital legacy** — an agent holding live keys with no successor path is a *business* SPOF.
9. **Browser-local inference** — WebGPU is default-on everywhere incl. iOS 26; Moonshine STT +
   embeddings in the PWA = offline dictation at zero server cost.
10. **Supply-chain attestation is not safety** — the May 2026 worm shipped *valid* provenance.
11. **iOS storage quota is ~60% of disk, not 50 MB** — the old figure is obsolete and under-exploited.
12. **Turn detection ≠ VAD** — conflating them is why home-built voice agents interrupt constantly.

---

## 10. OPERATOR DECISIONS NEEDED
| # | Question | Why it matters |
|---|---|---|
| **1** | **Is there another machine** (desktop w/ NVIDIA, spare box, Mac w/ unified memory)? | Single biggest variable. Changes the entire local-inference answer |
| **2** | **Hard $0, or is ~$15–20/mo acceptable?** | $15/mo buys search APIs + cheap-open-weights routing — the difference between a research agent that works and one that doesn't |
| **3** | **OK to install a WSL2 distro?** (unlocks gVisor + Claude Code `/sandbox`) — ⚠ **only ~15 GB free disk** | Gates the whole sandbox tier |
| **4** | **Neon paid tier for PITR >6h?** (~$5–19/mo) | The nightly dump covers it at $0, but paid PITR is the real net |
| **5** | Coding agent **external (OpenCode/Codex CLI) or in-app?** | External is 10× cheaper to build and better today |
