# NICK trust architecture v2 — verified edition

**2026-09-10.** Supersedes `NICK-TRUST-ARCHITECTURE-2026-09-10.md` (below, "v1"). v1 was written from the code alone; this one adds primary-source verification of every external claim, red-teams v1, and corrects it where it was wrong.

## 0. How to read this

Provenance is marked, because a document whose subject is fabricated citations has no standing to make any.

| Tag | Means |
|---|---|
| **CONFIRMED-CODE** | I read the file in this checkout. `path:line` is literal. Not a report of a report. |
| **CONFIRMED-EXT** | A primary source was fetched on 2026-09-10 — GitHub API, arXiv abs page, official docs, MITRE CVE API. URL given. |
| **INFERRED** | Reasoning over confirmed facts. Could be wrong. |
| **UNVERIFIED** | Believed, not checked. Listed in §12 rather than used. |

One structural note, since the brief raised it: **the NICK source repository *is* available here** — this runs inside the NOURCITY worktree. v1's `path:line` claims were reads, not assertions, and the fixes are merged in [PR #2267](https://github.com/nourdean22/MAINnicks-tire-autoNEW/pull/2267). Where v1 was wrong, it was wrong by over-reach in *reasoning*, not by inventing lines. §1 says where.

---

## 1. Where the v1 report is right, wrong, and unproven

### 1.1 Right, and load-bearing

- **The gate had no fact-check input.** `runReplyGate(reply, userText, critic, turnSignal)` — four parameters, none of them evidence. `unverifiedCount` is computed at `persist-assistant-turn.ts:405` and written to the panel payload; nothing reads it back. CONFIRMED-CODE.
- **The 525-word arithmetic.** Hard tier is `words > ceiling * 1.8` = 540 (`output-guardian.ts:292`); warn tier `> 1.4` = 420 sets `lengthScore = 60`; only `<= 30` is a critical axis (`:322`). CONFIRMED-CODE.
- **The gate cannot block post-flush.** `onFinish` cannot fire before the last token; first flush at `build-stream-config.ts:340`. CONFIRMED-CODE. This is the finding that most changes what to build.
- **`stripVerifierBanner` existed with zero callers** (`fabrication-rewriter.ts:135`). CONFIRMED-CODE.
- **`memory-recall.ts:7` advertises "Hybrid search (FTS + KNN)" over two pure-KNN queries.** CONFIRMED-CODE, and the most damaging single line in the codebase, because it stops anyone looking.

### 1.2 Wrong, or overstated

**a) "Eleven dark wires" conflated three different things.** Honest split: **6 genuine orphans** (`stripVerifierBanner`, `trustTier`, `queryPlan.exactTerms`, `posture`/`depth`, `nick-prime-context`, `behavior-directive`), **4 default-off experimental flags** — which are a legitimate pattern, not a defect — and **1 misleading comment**. The lying comment and the orphaned column are serious; a flag that is off on purpose is not. v1 inflated a real pattern into a bigger number than the evidence supports.

**b) "A genuine zero is near-impossible" was too strong.** The durable lane does filter `bm.category = ANY($2)` and `confidence >= 0.3` (`memory-recall.ts:334`), so if the corpus is thin in those categories a true zero is reachable. Correct claim: *a zero is more likely to be a failed read than a miss, and the actual rate is unmeasured.* That is experiment E2, and it is the reason provenance shipped before any retrieval tuning.

**c) The 92/100 reconstruction assumed three axis values.** `100*.35 + 100*.25 + 100*.20 + 60*.20 = 92` is consistent and is the clean solution, but spec/cliche/anti were reverse-engineered from the observed total, not read from a trace. INFERRED, not CONFIRMED.

**d) The Cohere `search_query` recommendation rested on an unchecked premise.** `input_type: "search_document"` at `provider.ts:1590` is CONFIRMED-CODE. That Cohere expects `search_query` for queries is training knowledge; more importantly, **I never verified which provider actually serves `getEmbedding` in production.** If the chain routes elsewhere, the whole finding is moot. Downgraded to a hypothesis with a prerequisite: *first prove Cohere serves query embeddings in prod.*

**e) v1 created a dark wire while criticising eleven.** It shipped `describeRecallState()` with no consumer. Fixed in the follow-up commit — provenance now reaches the Memory Inspector — but the lesson is the honest one: **this failure mode is easy enough that it happened inside the change that named it.**

### 1.3 Unproven and now checked — the audit's memory section does not survive

The original audit built its memory architecture on mem0's published benchmarks. All CONFIRMED-EXT:

**In mem0's own peer-reviewed ECAI 2025 paper ([arXiv 2504.19413](https://arxiv.org/abs/2504.19413)), the full-context baseline scores 72.90 and mem0 scores 66.88.** Doing nothing — stuffing the whole context — beats mem0 by **6 points of accuracy**. mem0's real win is latency (p95 1.44s vs 17.12s) and token cost. Those are worth having. They are not what the audit cited them for.

- mem0's docs concede the advertised LoCoMo 92.5 / LongMemEval 94.4 come from **a managed platform with "proprietary optimizations not available in the open-source SDK"** ([docs](https://docs.mem0.ai/core-concepts/memory-evaluation)). The package you would install cannot reproduce them.
- The widely-cited "independent replication" that rescored Zep from 84% to 58% ([issue](https://github.com/getzep/zep-papers/issues/5)) **was filed by mem0's own CTO**, who says so in the first line. It is a competitor filing, not a replication. Zep's rebuttal is equally partisan and concedes its own arithmetic error.
- The one genuinely third-party evaluation, **ConvoMem** ([arXiv 2511.10523](https://arxiv.org/abs/2511.10523)), puts mem0 at **30–45%** where long-context baselines reach 70–82%.
- **LoCoMo itself is broken for our purpose.** An [independent audit](https://github.com/dial481/locomo-audit) finds **6.4% of golden answers wrong** and the judge accepting **62.8% of deliberately wrong answers**; **22.5% of questions are adversarial and never scored**. Worse for NICK specifically: the dropped questions are the ones where refusal is correct, and the harness instructs the model never to abstain. **LoCoMo structurally cannot measure the single behaviour an anti-fabrication system most needs.**
- [arXiv 2605.24060](https://arxiv.org/abs/2605.24060) shows changing only the scoring target moves nDCG on **83–94% of shared queries** and **flips architecture rankings** on both LoCoMo and LongMemEval-S.

**Consequence:** every "adopt mem0's architecture" instinct should be re-derived from mechanism, not from its numbers. Two of its ideas remain right *on their merits* — multi-signal retrieval and actor attribution — and both are already half-present in this codebase.

---

## 2. What both reports missed

Beyond v1's list, found by reading the seams rather than the features:

1. **The receipt content existed and was discarded.** `walkToolTelemetry` read `call.result` to detect soft errors, then kept only `{name, ok, durationMs, args}`. CONFIRMED-CODE. So *any* receipt-based check was structurally blind — it could see that a tool fired, never what it resolved. Fixed: `resultDigest`.
2. **Recall had no lexical fallback, so an embedding blip was indistinguishable from amnesia.** The lane is hard-gated on `userEmbedding.length > 0` (`brain-context.ts:319`) and, uniquely among four lanes, does not accept `|| forceRecall`. CONFIRMED-CODE. Fixed: the tsvector lane needs no query vector, so recall now degrades instead of going dark.
3. **The Hybrid Recall block is not marked `critical`** (`brain-context.ts:463`), so the 0.12 reranker cutoff can drop it from the prompt *even when hits exist*. The panel then truthfully reports memories the model never saw. **This is a second, distinct failure nobody has been looking for**, and it would read to the operator exactly like the first.
4. **The category filter runs after the KNN** (`:425`), and the file's own comment measures it at **hit@5 = 0/28**. Post-filtering a fixed candidate set is a classic recall killer.
5. **`trustTier` exists in the schema with the right four values and zero readers or writers.** CONFIRMED-CODE (`prisma/schema.prisma:1756`). A scraped article ranks identically to something Nour said. The audit asked for actor attribution; the column has been sitting there.
6. **Deletion does not propagate to embeddings.** `brain_memories.deleted_at` is honoured in recall SQL, but `vector_embeddings` rows are not removed. A deleted memory's vector survives. INFERRED from the schema and the recall filters; needs a row-count check. This is exactly OWASP AISVS **8.3.1**.
7. **No abstention metric anywhere.** Every scorer measures what was said; none measures whether "I don't know" was correct. Given LoCoMo's identical blind spot, this is an industry-wide hole, not just NICK's.

---

## 3. Threat model — NICK is a high-privilege agent, and the standards moved

All CONFIRMED-EXT, fetched 2026-09-10. **Three framing assumptions in circulation are stale:**

- **OWASP Top 10 for LLM Applications is the 2026 edition** (published Aug 2026), not 2025. [Resource](https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/) · [categories](https://github.com/GenAI-Security-Project/GenAI-LLM-Top10/tree/main/2026/final). **"System Prompt Leakage" was retired** and replaced by **LLM08 Hidden Context Exposure**, which explicitly covers *retrieved documents, memory, user information, application state and tool responses*. NICK's memory store is now inside an OWASP Top 10 category by name. **Excessive Agency moved 6th → 3rd.**
- **There is a dedicated agentic list**: [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) (Dec 2025). **ASI06 is "Memory & Context Poisoning"** — the precise threat class here.
- **NIST AI RMF is still 1.0** (Jan 2023) with the [GenAI Profile AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) (Jul 2024). There is no 2.0.

**The most useful artifact is the one nobody cites: [OWASP AISVS](https://github.com/OWASP/AISVS)**, because it has *testable requirements* rather than themes. **C08 — Memory, Embeddings and Vector Database** contains, verbatim:

> **8.2.3** Verify that agent outputs and tool outputs are not automatically written to trusted agent memory without explicit source validation.

That is the control that stops the SpAIware class, and it is directly implementable against `trustTier`. Also **8.2.4** (reject content crafted to manipulate retrieval before vectorization), **8.3.1** (expired vectors excluded), **8.3.2** (memory can be reset).

**Memory poisoning is demonstrated, not theoretical.** [Gemini long-term memory corruption](https://embracethered.com/blog/posts/2025/gemini-memory-persistence-prompt-injection/) plants a *conditional* instruction that fires on a later benign "yes" — which **defeats the naive defence of "don't write memory while untrusted data is in context."** [SpAIware](https://embracethered.com/blog/posts/2024/chatgpt-macos-app-persistent-data-exfiltration/) persists across all future sessions. Research: [arXiv 2607.05189](https://arxiv.org/abs/2607.05189) reports **87.5% end-to-end success** injecting persistent memory in a personal-agent setting, invisible in user-facing replies; [arXiv 2606.04329](https://arxiv.org/abs/2606.04329) concludes **"existing prompt injection defenses fail to cover memory poisoning attacks"** and that *agents which write memory more aggressively are more exploitable*. [arXiv 2604.16548](https://arxiv.org/abs/2604.16548): security **"cannot be retrofitted at retrieval or execution time alone, but must be anchored in storage-time provenance."**

**MCP.** Spec is [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) and is now **stateless** — "Session Hijacking" was replaced by **State Handle Hijacking**, so older MCP security notes are stale. Real CVEs, all verified PUBLISHED via MITRE: **CVE-2025-49596** (MCP Inspector, CVSS 9.4), **CVE-2025-6514** (`mcp-remote`, 9.6), and **three in Anthropic's own reference `mcp-server-git`** (CVE-2025-68143/68144/68145). *First-party MCP servers are not a trusted baseline.* Tool poisoning / rug-pull / cross-server shadowing come from [Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks), not the spec.

**The defence worth designing toward: [CaMeL](https://arxiv.org/abs/2503.18813)** (Google DeepMind / ETH, [code](https://github.com/google-research/camel-prompt-injection), Apache-2.0). A privileged LLM plans from the trusted query; a quarantined LLM handles untrusted data **with no tool access**; an interpreter tracks provenance and enforces capability policy *before every tool call*, so untrusted data can never influence control flow. **77% of AgentDojo tasks solved with provable security vs 84% undefended — a measured 7-point capability tax.** This is the only approach in the literature with a security *proof* rather than a detection rate, and its shape maps onto NICK's tool layer.

### FMEA — top failure modes

| # | Failure | Sev | Likelihood | Detectability *(today)* | Mitigation |
|---|---|---|---|---|---|
| 1 | Fabricated named resource ships as fact | High | **Observed** | Was nil; now shadow-gated | Receipt gate + enforcement (built) |
| 2 | Memory read fails, renders as "believes nothing" | High | **Observed** | Was nil; now three-state | Provenance + lexical degrade (shipped) |
| 3 | Poisoned memory written from tool output | **Critical** | Unmeasured | **Nil** | AISVS 8.2.3: `trustTier` on write, never auto-trust tool output |
| 4 | Deleted memory survives in `vector_embeddings` | High | INFERRED likely | **Nil** | AISVS 8.3.1: cascade delete + a test |
| 5 | Recall block dropped by reranker while panel shows hits | Med | Unmeasured | **Nil** | Mark Hybrid Recall `critical` |
| 6 | Indirect injection via scraped content | High | Unmeasured | Partial (`fenceContent`) | CaMeL-shaped quarantine for tool output |
| 7 | Over-blocking gate degrades good replies | Med | Unmeasured | Shadow metrics | E4 before enforcement |

Row 3 is the one to act on next. Rows 1–2 are the ones already closed.

---

## 4. Verified component landscape

Every row CONFIRMED-EXT on 2026-09-10 via the GitHub/HF APIs. **The most valuable output of this sweep is the rejection list** — four components that a plausible-sounding report would have recommended are dead.

### 4.1 Dead or stalled — do not adopt

| Project | Status |
|---|---|
| `protectai/rebuff` | **ARCHIVED.** Last commit 2024-08-07 |
| `protectai/llm-guard` | **ARCHIVED** |
| `vibrantlabsai/ragas` (moved from `explodinggradients`) | **No commits on any branch since 2026-02-24**, README still presents it as maintained |
| `mattpocock/evalite` | Dormant since 2025-11 — and it was the Vitest-native TS eval runner that would have fit this stack perfectly |
| `traceloop/openllmetry-js` | **JS SDK stalled** (0 commits in 2 months) though the Python side is healthy |
| `AgentOps-AI/agentops` | Dormant |
| **Graphiti** | Alive and excellent, but requires **Neo4j / FalkorDB / Neptune**. Postgres is not a supported backend, and the OSS framework is Python-only. **Wrong shape for this stack** |
| **Zep Community Edition** | *"no longer supported"*; code moved to `legacy/` |
| **pgmq / pgflow** | pgmq is **not on Neon's supported-extension list** |
| Every **Jina** reranker | All **cc-by-nc-4.0**. Best ONNX story in the category, unusable commercially |
| `bespokelabs/Bespoke-MiniCheck-7B` | cc-by-nc — and **the repo has no license field**, so automated checks wave it through |

### 4.2 Canonical stack

| Role | Choice | Why it wins |
|---|---|---|
| **Claim ↔ evidence entailment** | [`cross-encoder/nli-deberta-v3-base`](https://huggingface.co/cross-encoder/nli-deberta-v3-base) — 184M, Apache-2.0, **9 ONNX variants in-repo**, 354k downloads | The single highest-value find. Runs **in-process in Node** via [transformers.js](https://github.com/huggingface/transformers.js); no Python sidecar. Turns claim verification from an LLM call into a local classifier |
| **Reranking** | [`Alibaba-NLP/gte-reranker-modernbert-base`](https://huggingface.co/Alibaba-NLP/gte-reranker-modernbert-base) — 150M, Apache-2.0, **2.6M downloads**, ONNX in-repo | Highest adoption of any modern reranker verified; official quantized ONNX in the same repo. Not on anyone's shortlist |
| **Evals** | [promptfoo](https://github.com/promptfoo/promptfoo) — MIT, 0.123.0 (2026-09-10), 25k★ | Only serious harness that runs natively here without Python; large *deterministic* assertion set separate from LLM-judge metrics |
| **Tracing** | [Langfuse](https://github.com/langfuse/langfuse) v4 — MIT core, OTel-native | **Install `@langfuse/*`, not `langfuse`** (that npm package is legacy v3). Note: **acquired by ClickHouse**, LICENSE now reads ClickHouse Inc. |
| **Hybrid search** | **The tsvector lane already in this repo** | See §5. No new dependency, no license, no Neon constraint |
| **Durable execution** | **None yet** | See below |

### 4.3 Second choice / prototype

- **[Opik](https://github.com/comet-ml/opik)** — 21.9k★, **fully Apache-2.0** with no open-core carve-out, tracing *and* evals. The most overlooked serious option in observability; a better license story than Langfuse or Phoenix.
- **[DBOS Transact](https://github.com/dbos-inc/dbos-transact-ts)** — MIT, the **only** verified durable-execution option that is a pure library with Postgres as its sole dependency. Everything else (Temporal, Restate, Inngest, Trigger.dev, Hatchet) needs a server a single operator cannot justify. **Caveat that matters: DBOS docs show Express examples and never mention Next.js.** Treat App Router compatibility as unproven until prototyped.
- **[Cognee](https://github.com/topoteretes/cognee)** — the only memory framework that runs its whole layer on one Postgres (relational + pgvector + graph) and ships a TypeScript SDK. If NICK ever buys a memory framework, this is the one to evaluate — but see §6: it probably shouldn't.
- **Arize Phoenix** — usable, but the self-hosted server is **Elastic-2.0, not OSI**; only the JS clients are Apache-2.0. Don't call it open source without the qualifier.

### 4.4 On prompt-injection classifiers

The marquee names are unusable in-process: Llama Guard 3/4, ShieldGemma and Granite Guardian are **1B–12B generative models**, gated, and ship no ONNX. Only ~90–300M encoders with shipped ONNX can run in Node. Best candidates: `protectai/deberta-v3-base-prompt-injection-v2` (837k downloads, Apache-2.0 — but **weights frozen since 2024-04**) and `patronus-studio/wolf-defender-prompt-injection-small` (140M, updated 2026-09-08, but only 3.1k downloads). Also note **OpenAI's moderation endpoint has no prompt-injection category at all** — it is content-harm only, and is not an injection defence.

---

## 5. Retrieval: the answer was already in the repo

The audit prescribed adopting mem0's multi-signal retrieval. NICK already had multi-signal retrieval — in the wrong file.

| Lane | Dense | Lexical | Feeds the counted panel | `critical` in prompt |
|---|---|---|---|---|
| `memory-recall` | yes | **was: no** | **yes** | **no** |
| `contextual-recall` | yes | **yes** (`:487-495`) | no | yes |
| `chat-recall` | yes | no | no | — |

**Shipped:** the tsvector lane lifted into `memory-recall` and fused as a third RRF input, with `rrfMergeHitOrders` taking it optionally so the existing durable-lane canary keeps byte-identical two-lane behaviour (asserted, 9 pre-existing tests still green).

Two properties dense retrieval structurally cannot have:
1. **Exact terms survive paraphrase.** "the taper plan" can sit far away in embedding space while sharing the literal token.
2. **It needs no query vector** — so an embedding outage degrades ranking instead of erasing memory. That was the actual mechanism behind "(0)".

**Still open:** mark Hybrid Recall `critical`; move or delete the post-KNN category filter (its own comment measures it at hit@5 = 0/28); feed `queryPlan.exactTerms`, which is currently computed and `console.info`'d.

**Explicitly rejected: ParadeDB / `pg_search`.** Real and healthy (9.2k★, v0.25.6, 2026-08-27) — and **AGPL-3.0**, on **Neon**, which gates extensions. Adopting a search engine to fix a wiring problem is the most seductive available mistake.

---

## 6. Build vs buy — and where the moat is

**Buy/adopt:** eval harness, tracing, ONNX verifier models, reranker. All commodity, all replaceable, none differentiating.

**Do not buy a memory framework.** After §1.3, the evidence for any of them beating a well-built hybrid retriever on a single-user corpus is **vendor-only or thin**. mem0's own graph ablation buys **+1.56 points for ~2× p95 latency** — measured by a company that sells graph memory. The one independent longitudinal study's winner is a **hybrid**, not a graph — on ~30–60 records per user, three orders of magnitude below NICK's target, so it barely transfers either.

**The moat is not the retriever.** Anyone can install pgvector. NICK's defensible assets are:
1. **The evidence ledger** — tool receipts bound to claims bound to replies. Nobody else has the operator's action history with provenance.
2. **The transcript-derived eval corpus** — real failures with known-correct behaviour. This compounds and cannot be bought.
3. **The longitudinal operator model** *with trust tiers*, so an inference is never confused with a statement.

Note what is *not* on that list: the model, the prompt, the retrieval algorithm. Those are commodity and will keep getting better for free.

---

## 7. Self-healing as a control system

Split by **blast radius**, not by cleverness.

| Tier | Autonomous? | Controls |
|---|---|---|
| **A. Runtime recovery** — retry with backoff+jitter, circuit-break a failing tool, provider failover, **degrade dense→lexical** | **Yes** | Idempotency keys; bounded retries; **never retry a side-effecting call without one**; every recovery **increments an alarmable counter** |
| **B. Diagnosis + eval generation** — cluster failures, mint a regression case from a failed turn, open an incident | **Yes** | Write-only to eval/incident stores; a generated case cannot auto-merge into the blocking set |
| **C. Config change under canary** — retrieval weights, rerank cutoffs, routing thresholds | **Conditionally** | Shadow → canary ≤10% → auto-rollback on regression; **the metric that triggers a change may not be the metric that validates it**, or the loop optimises its own trigger |
| **D. Prompt / code / security-policy mutation** | **No** | Human review, always. A system that can rewrite its own gate has no gate |

Two rules earned from this codebase:
- **Degradation without a metric is concealment.** Five layers of `catch → []` were "graceful degradation" and hid a broken retrieval lane for an unknown period. Tier A is only safe when every recovery is *counted*.
- **A kill switch that requires the system to be healthy in order to fire is not a kill switch.** Static config, read every turn, deterministic default, exercised on a schedule.

Explicitly **not** self-healing: the reply gate. A gate that relaxes its own thresholds when it blocks too much converges on blocking nothing — the exact state we started in.

---

## 8. Evals

**Nine of eleven golden cases from the observed failures are deterministic** — set intersections, receipt lookups, regex, row counts. Reach for a judge only on register appropriateness and hedge adequacy, and only after measuring inter-rater agreement against your own labels.

**Do not use LoCoMo as a target.** §1.3: 6.4% wrong keys, a judge that accepts 62.8% of wrong answers, 22.5% of questions unscored, and a harness that forbids abstention. Use it, at most, as a smoke test. **Build the abstention metric nobody has**: of turns where the correct answer was "I don't know / I didn't check", how often did NICK say so? That is the metric this whole programme exists to move, and no public benchmark measures it.

**Anti-Goodhart, from incidents in this repo:**
1. Every gate ships a **canary pair** — break it and assert failure; run clean and assert pass.
2. Every new detector ships a **positive control**. A new function cannot regress against code that never called it.
3. **When a test resists a correct fix, read the test as a finding.** Precedent: `expect(view.score).toBe(7)` on an empty ledger encoded the bug it was written during.
4. **Never assert source text.** It false-fails on a reformat and passes on a rename.

**Alarm on silence.** A gate that never fires and a gate that is switched off produce identical dashboards. `verdict == "block"` for 24h is an alert.

---

## 9. What shipped, and what is next

**Merged / committed** (102 tests, typecheck exit 0):

| Layer | Status |
|---|---|
| Evidence gate with severity floors + `verdict` | shipped (#2267) |
| Named-source receipt check + unearned-tag strip | shipped |
| Verifier banner stripped at render; history note de-first-personed | shipped |
| Three-state recall provenance → **rendered in the Memory Inspector** | shipped |
| `resultDigest` receipts captured | shipped |
| Evidence gate running per turn in **shadow** | shipped |
| Enforcement (deterministic repair → one re-gate → constant fallback) | built + tested, **not yet wired** |
| Lexical lane fused; embedding outage degrades instead of blanking | shipped |
| Register classifier reaching the prompt (countermands the hard-coded imperative close) | shipped |
| Recommendation novelty, injected **pre**-generation | shipped |

**Next, in order:**
1. **Read the shadow numbers** (E2/E4). Nothing else is gated on opinion.
2. **AISVS 8.2.3** — write `trustTier` on ingest; never auto-trust tool output into memory. Highest-severity open item (FMEA #3).
3. **Mark Hybrid Recall `critical`**; delete or move the category filter.
4. **Check deletion propagation into `vector_embeddings`** (FMEA #4) — one query answers it.
5. **Wire enforcement on the buffered path**, once E4 says the FP rate is tolerable.
6. **Prototype the ONNX NLI verifier** in-process for claim↔evidence entailment.

**Do NOT build yet:** a memory framework, a graph store, durable execution, multi-agent debate, a second database. None is justified by evidence at one operator's scale.

---

## 10. Adversarial pass against this document

**"It is still overengineered."** Partly. §4's component list is interesting; only three items (NLI verifier, reranker, promptfoo) have a concrete job. The rest is a map, not a plan.

**"The receipt gate will over-block."** The real risk, unresolved. It is why enforcement ships **shadow-first** and why the false-positive floor is a first-class test. If E4 says >5% FP, the named-source signal is demoted from `block` to `repair` and the design survives.

**"Trust tiers make NICK confidently wrong."** Yes — a confidently wrong memory is worse than a vague one. Inferences must render as inferences.

**"CaMeL is a research paper, not a product."** Correct. It is cited for its *shape*, not proposed for adoption. Its 7-point capability tax is real and would be felt.

**"You are optimising to your own evals."** The sharpest one. Nine deterministic cases bound it; the gate scores **evidence, never style**; and the false-positive floor guards against hedge-creep. But the transcript-derived corpus is small, and small corpora overfit.

**"Rejecting every memory framework is convenient."** It is also what the evidence says — and the same skepticism was applied to the incumbent: NICK's own recall was found to be lying in its header comment.

### The reduced architecture

If only four things ship: **the receipt gate wired to real evidence (done), three-state recall provenance (done), the lexical lane (done), and `trustTier` enforced on write (next).** Those four address every failure actually observed plus the highest-severity unobserved one. Everything else in this document is compounding, not critical path.

---

## 11. Experiments, ranked by information gain per unit cost

| # | Question | Method | Cost |
|---|---|---|---|
| **E2** | How often does recall actually fail? | Read `recall_provenance` for 7 days — **already instrumented** | zero |
| **E4** | Does the named-source check over-block? | Read `evidence_gate_shadow` for 7 days — **already instrumented** | zero |
| **E3** | What share of turns are high-risk? | `assessTurnRisk` is pure; replay over stored transcripts | ~1h |
| **E7** | Do deleted memories survive in `vector_embeddings`? | One SQL join | minutes |
| **E8** | Is Hybrid Recall being dropped by the reranker? | Log block-survival | ~1h |
| **E5** | Does removing the category filter improve hit@5? | Offline, labelled corpus | ~half day |
| **E1** | Does `search_query` help? | **Prerequisite: confirm Cohere serves query embeddings in prod** | ~half day |
| **E9** | Can the ONNX NLI model judge claim↔evidence in-process? | Prototype on 50 transcript claims | ~1 day |

**E2, E4 and E7 cost essentially nothing and gate everything after them.**

---

## 12. Unknown unknowns — not converted into diagnoses

| Unknown | Instrumentation |
|---|---|
| Real recall failure rate | E2 (shipped) |
| Named-source FP rate on real traffic | E4 (shipped) |
| Which provider actually serves `getEmbedding` in prod | Log the provider on the embedding call |
| Whether `deleted_at` propagates to vectors | E7 |
| Whether Hybrid Recall reaches the prompt | E8 |
| Corpus size by category | `SELECT category, count(*)` |
| Real turn distribution / buffered share | E3 |
| Whether DBOS works under Next.js App Router | Prototype (docs show Express only) |
| Latency/cost per turn today | No unit-economics instrumentation exists at all |

**External claims I did NOT verify** and which must not be repeated as fact: the NSA MCP guidance (403 on every fetch; date disputed between 2026-05-20 and 2026-06-02), OpenAI's prompt-injection wording (403; quotes came from search extraction), AISVS's "14 chapters / 514 requirements / June 2026" figures (the repo shows C01–C12), LoCoMo's ACL 2024 acceptance, and every memory framework's self-published benchmark including supermemory's and MemOS's.

**One correction worth carrying:** a search summary claimed a third party "reproduced mem0's LoCoMo at 29.3%". Traced to source, **29.3 is mem0's own claimed +29.3-point improvement** on temporal queries. It is not a replication and not a score. That is precisely how a fabricated citation is born — a number detached from its sentence — which is the same defect class as the one this whole programme exists to fix.
