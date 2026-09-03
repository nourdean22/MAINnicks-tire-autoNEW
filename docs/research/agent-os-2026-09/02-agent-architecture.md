# Track 2 — Intelligence Architecture + Coding Agents (verified 2026-09-03)

All repo/package figures pulled live 2026-09-03 via GitHub REST+GraphQL, npm registry, PyPI.

## ⚠ GROUND-TRUTH CORRECTIONS TO THE ORIGINAL BRIEF
Verified directly against `apps/statenour/package.json` on 2026-09-03:

| Fact | Brief said | **Actual** |
|---|---|---|
| Next.js | 15 | **`next@^16.2.11`** |
| Agent layer | "choose one" | **AI SDK is already the incumbent — `ai@6.0.162` (exact pin)** |
| `ai` v6 line head | — | **`6.0.275`** (2026-09-02) — **113 patch releases behind** |
| `ai` stable | — | **`7.0.91`** — **v7 GA since 2026-06-25**, one full major ahead |
| Langfuse | — | `@langfuse/otel@5.10.1` — OTel-native path, correct for AI SDK |
| Others | — | `inngest@4.4.0`, `@sentry/nextjs@10.73.0`, `zod@^4.4.3`, Prisma ^6.3.1 |
| `apps/nickstire` | — | **no AI SDK / agent framework at all** |

**This is not a greenfield choice.** The question is not "which framework" but "upgrade the incumbent or add a second one." The answer is upgrade.

## A. Architecture patterns
| Pattern | Context economics | Crash resumability | Debuggability | Cost/task | Fit |
|---|---|---|---|---|---|
| Single general agent + tool belt | one linear context; degrades as tool count grows; schemas alone eat 10–30k tokens | **none** — process death = lost run | **highest**: one trace | 1× | **Default.** Correct for interactive chat + most jobs |
| Supervisor + specialists | sub-contexts isolated (real win as **context firewalls**) but supervisor must re-absorb summaries — lossy | only if each hop is durable | **poor**: N traces, ambiguous blame | **4–15×** | Only **read-only, parallel, fan-out** work |
| Explicit graph / state machine | best control over what enters each node | good *with* a checkpointer | good — node-level replay | 1–1.5× | Only when flows genuinely branch and repeat |
| Event-driven actors | coordination cost pushed to the bus | depends on bus | hard — causality reconstruction | 1–2× | **Already have via Inngest** — keep at the *job* layer, not inside the reasoning loop |
| **Durable-workflow-backed agent** | same as single agent, each tool call a replayable step | **strongest** — survives deploys, restarts, multi-day approval waits | strong: step log is a first-class artifact | **~1.05×** (overhead is persistence, not extra LLM calls) | **Highest-leverage upgrade for this stack** |
| **Hybrid: durable single agent + rare read-only fan-out** | linear main thread, isolated ephemeral researchers | full | good | 1.1×, spikes on fan-out | **RECOMMENDED TARGET** |

### Multi-agent failure evidence — primary sources
| Source | Date | Finding |
|---|---|---|
| **Cognition — "Don't Build Multi-Agents"** (Walden Yan) | 2025-06-12 | *"Share context, and share full agent traces, not just individual messages"*; *"Actions carry implicit decisions, and conflicting decisions carry bad results."* Failure mode: parallel sub-agents from a shared brief **silently diverge** (one builds Mario-style assets, another Flappy Bird) and the integrator inherits an impossible merge. Conclusion: **single-threaded linear agents are the reliable production choice.** |
| **Anthropic — "How we built our multi-agent research system"** | 2025-06-13 | *"agents typically use about **4× more tokens** than chat interactions, and multi-agent systems use about **15× more tokens** than chats."* Gain: **+90.2% over single-agent Opus 4 on their internal research eval.** Early failures: *"spawning 50 subagents for simple queries"*, *"scouring the web endlessly for nonexistent sources"*. They scope it: *"most coding tasks involve fewer truly parallelizable tasks than research"*; domains that *"share the same context or involve many dependencies"* are poor fits. |

**Synthesis:** multi-agent pays only when sub-tasks are (a) genuinely parallel, (b) read-only, (c) cheap to summarize. Anthropic's +90% is on **search fan-out** — the one shape satisfying all three. Every other shape is where **multi-agent theater** lives: a 4–15× token multiplier that reintroduces coordination bugs a single context never had.

> **Applied to bdnick:** a personal operator agent is dependency-heavy and write-heavy (DB writes, pushes, posts). It is the **anti-profile** for multi-agent. Sub-agents are justified for exactly one reason: **context firewalling** a large read (log sweep, repo scan, multi-source research) so raw tokens never enter the main thread.
> *(This session is itself the evidence: research fan-out worked; two agents that spawned children to do coordination returned status lines instead of findings.)*

## B. Framework health (GitHub/npm API, 2026-09-03)
| Framework | License | Latest | Commits/30d | Concentration | Stars | Verdict |
|---|---|---|---|---|---|---|
| **Vercel AI SDK** `vercel/ai` | **Apache-2.0** | **`ai@7.0.91` · 2026-09-02** | 531 | top1 29% (`lgrammel`), top5 61% of 7,069 | 26.6k | **KEEP** — the incumbent |
| Vercel Workflow SDK | Apache-2.0 | `workflow@4.8.5` · 2026-08-25 | 100+ | top5 68% | 2.4k | **AUGMENT** (but see `WorkflowAgent` caveat) |
| **Mastra** | Apache-2.0 **except `ee/`** (proprietary, Kepler Software Inc.) | `@mastra/core@1.64.0` · 2026-09-03 | **1,423** | 466 contributors, top5 41% — **but that's employees + an in-house bot** | 27.7k | **WATCH** — open-core |
| LangGraph.js | MIT | 1.4.13 · 2026-08-26 | 41 | top5 64% | 3.2k | **AUGMENT (narrow)** |
| PydanticAI | MIT | 2.38.0 · 2026-09-03 | 100+ | top5 67% | 19.7k | **DO NOT USE** — Python-only |
| OpenAI Agents SDK (JS) | MIT | `0.17.0` · 2026-08-19 | 170 | **`seratch` = 67% of commits** | 3.8k | **WATCH** — still 0.x after 18mo; **no documented Langfuse path in JS** |
| Google ADK | Apache-2.0 | 2.8.0 · 2026-08-26 | 100+ | 24 authors | 21.4k | **DO NOT USE** here — Python/Java |
| Cloudflare Agents | MIT | `agents@0.22.0` · 2026-08-27 | 66 | **top1 59%** | 5.5k | **DO NOT USE** — see below |
| smolagents | Apache-2.0 | `1.26.0` · **2026-05-29** | **2** | 3 authors/3mo | 29.1k | **DO NOT USE** — stalled + Python |
| **AutoGen** | CC-BY-4.0 | **`0.7.5` · 2025-09-30** | **0**, last push 2026-04-15 | — | 60.8k | **DO NOT USE — DEAD.** Merged into MS Agent Framework 1.0 (2026-04-03); AutoGen is in maintenance mode |
| AG2 (AutoGen fork) | Apache-2.0 | 1.0.3 · 2026-08-28 | 62 | 17 authors | 4.9k | **WATCH** — the live lineage, but Python |
| MS Agent Framework | MIT | v1.0 · 2026-04-03 | 100+ | **38 authors — best diversity** | 13.3k | **WATCH** — .NET/Python, no TS |
| **Inngest AgentKit** | Apache-2.0 | **`0.13.2` · 2025-11-13** | last push 2026-04-29 | — | 926 | **DO NOT USE as a foundation** |

### Two findings that contradict the common recommendation set
1. **AutoGen is dead.** Zero 2026 releases; Microsoft merged AutoGen + Semantic Kernel into **Microsoft Agent Framework 1.0 (2026-04-03)**. Anyone citing AutoGen in a 2026 architecture doc is on stale data.
2. **Inngest AgentKit is effectively abandoned** — despite Inngest itself being healthy and already in this stack. One 2026 publish (an alpha), no stable since 2025-11-13. **Keep Inngest for scheduling; do not build the agent loop on AgentKit.**

### Issue responsiveness, 30d (GraphQL, 2026-08-04 → 2026-09-03)
`vercel/ai` **1.75× (459 closed / 262 opened — burning the backlog down)** · Mastra 1.09× · openai-agents-js 1.19× · cloudflare/agents 0.83× · **claude-agent-sdk-python 0.30×** · **claude-agent-sdk-typescript 0.12×**.

### Vendor-specific traps found
- **AI SDK `WorkflowAgent` requires Vercel Workflow** — the docs give **no self-hosting path**. It is the sharpest lock-in vector in the AI SDK, **and it duplicates what Inngest already does. Use Inngest, not `WorkflowAgent`.**
- **AI SDK resumable streams need Redis** (`resumable-stream` pkg + Redis + your own DB) — new infra this stack doesn't have.
- **Mastra** would mean a **second Langfuse ingestion path** outside `@langfuse/otel` (its tracing is a bespoke span system, not OTel-native), plus 6+ packages on a ~3.5-day release cadence, plus `ee/` proprietary dirs. Its **`@mastra/inngest` adapter is genuinely excellent** and `inngest@4.4.0` satisfies its `^4` requirement — the single reason to revisit. Re-evaluate at 2.0, or if `OtelBridge` unifies tracing.
- **Anthropic Claude Agent SDK (TS) has no `src/`** — the repo is a changelog/examples shell for a **closed-source npm artifact** under **Anthropic Commercial ToS** (the *Python* SDK is MIT and ships source). It bundles a Claude Code binary and **spawns it as a subprocess** (zero runtime deps, 8 platform-specific optionalDeps, 4.8 MB). **Wrong shape for a Next.js route handler; right shape for dev/ops tooling.** No OTel/Langfuse path documented. Branding rules forbid "Claude Code" naming, and offering claude.ai login/rate limits to end users is prohibited.
- **Cloudflare Agents: "the agent IS a Durable Object."** Hard runtime dependency, **external PRs explicitly closed** ("We are not accepting external pull requests at this time"), 0.x after 11.5 months, trails AI SDK by a major. Its `runFiber`/`stash` **synchronous checkpointing** is the best durable primitive in the set — **read `docs/agents/durable-execution.md` for ideas to implement on Inngest**, then walk away.

### v6 → v7 breaking changes (budget for these)
Node ≥22, **ESM-only (CommonJS removed)** · `system`→`instructions` (system messages inside `messages` now rejected) · `onFinish`→`onEnd`, `onStepFinish`→`onStepEnd` · **OTel moved to `@ai-sdk/otel`; telemetry now opt-OUT** · `result.fullStream`→`result.stream` · **top-level `usage` now accumulates across all steps** (was final-step only) — *will break cost math* · `needsApproval`→`toolApproval` · `{type:'image'}`→`{type:'file'}` with `mediaType` · codemod: `npx @ai-sdk/codemod v7`.
Langfuse swap: `LangfuseSpanProcessor` → `LangfuseVercelAiSdkIntegration` (`@langfuse/vercel-ai-sdk@5.9.0`).

## C. Scope A — top 3
1. **Keep a single durable agent; upgrade to AI SDK v7 `ToolLoopAgent`.** Apache-2.0, healthiest TS agent runtime by a wide margin, only OTel-native Langfuse path matching `@langfuse/otel`. v7 ships exactly what a personal operator agent needs: `stopWhen`/`prepareStep` loop control, `toolApproval`, timeouts, sandboxing.
2. **Back durability with Inngest, which is already installed** — *not* `WorkflowAgent` (Vercel-only), *not* Temporal (new cluster), *not* Mastra (second framework). This converts every cron and long tool call from "dies on redeploy" into a replayable step log, which also lets the vitest eval harness replay real traces.
3. **Reserve sub-agents for read-only fan-out only, as context firewalls.** Per Cognition + Anthropic evidence above.

## D. Coding agents (GitHub API, 2026-09-03)
| Agent | Repo | License | Latest | Commits/30d | Concentration | Stars | Open iss | Verdict |
|---|---|---|---|---|---|---|---|---|
| **OpenCode** | **`anomalyco/opencode`** (was `sst/`) | MIT | `v1.18.27` · 2026-09-02 | 100+ | top5 62% of 13,474 | **203.5k** | 5,642 | **KEEP — primary terminal agent** |
| **OpenHands** | **`OpenHands/OpenHands`** (was `All-Hands-AI/`) | MIT | v1.16.0 · 2026-08-27 | 100+ | top1 14% | 86.1k | 641 | **AUGMENT — sandboxed/PR lane** |
| Codex CLI | `openai/codex` | Apache-2.0 | 0.153.0 · 2026-09-03 | 100+ | — | 121.2k | **15,079** | **WATCH** |
| Gemini CLI | `google-gemini/gemini-cli` | Apache-2.0 | 0.58.0 · 2026-09-01 | 100+ | — | 106.8k | 851 | **WATCH** |
| Cline | `cline/cline` | Apache-2.0 | 2026-09-03 | 100+ | top1 38% | 67.4k | 1,194 | **AUGMENT** |
| **Goose** | **`aaif-goose/goose`** (left Block, org created 2026-03-25) | Apache-2.0 | v1.48.0 · 2026-08-27 | 100+ | **top1 6%, top5 28% — best diversity measured** | 53.9k | 270 | **AUGMENT** |
| **Kilo Code** | `Kilo-Org/kilocode` | MIT | v7.5.9 · 2026-09-02 | 100+ | top5 42% of 25,848 | 27.2k | 552 | **AUGMENT — the live Roo/Cline continuation** |
| **mini-SWE-agent** | `SWE-agent/mini-swe-agent` | MIT | v2.4.2 · 2026-09-01 | active | — | 6.9k | — | **AUGMENT — highest ROI for evals** |
| Crush | `charmbracelet/crush` | NOASSERTION | 2026-09-03 | active | — | 27.9k | 688 | **WATCH** |
| Continue | `continuedev/continue` | Apache-2.0 | v2.1.0 · 2026-06-19; **last commit 2026-07-21** | **0** | **top1 46%, top5 79%** | 35.7k | 941 | **WATCH → declining** |
| SWE-agent | `SWE-agent/SWE-agent` | MIT | **v1.1.0 · 2025-05-22** | 0 | **top1 73%** | 20.2k | 91 | **WATCH** — research only |
| **Roo Code** | `RooCodeInc/Roo-Code` | Apache-2.0 | **v3.54.0 · 2026-05-15** | 0 | — | 24.3k | 1,034 | **DO NOT USE — repo is ARCHIVED** |
| **Aider** | `Aider-AI/aider` | Apache-2.0 | **v0.86.0 · 2025-08-09**; last commit **2026-05-22** | **0** | **top1 96% of 13,041** | 48.7k | 1,849 | **REPLACE — unmaintained** |

### Two verdicts most write-ups get wrong
- **Aider is unmaintained.** One person authored **96%** of all commits; last commit 2026-05-22, no release in ~13 months. Open community thread *"Confusion and questions about the current maintenance status of Aider"* (2026-08-28) reports PRs passing CI sitting unmerged and the maintainer unreachable. Plan migration.
- **Roo Code is archived** (`archived: true`, frozen v3.54.0, 1,034 issues left open, no successor notice). **Kilo Code is the live continuation.**
- Org moves that break old links: `sst/opencode`→**`anomalyco/opencode`** · `block/goose`→**`aaif-goose/goose`** (foundation-style org — a governance *improvement*, visible in its 6%/28% concentration) · `All-Hands-AI/OpenHands`→**`OpenHands/OpenHands`**.

### SWE-bench Verified — with the confound made explicit
From `SWE-bench/experiments` official submissions (n=500). `$/instance` is self-declared.

| Scaffold | Model | Resolved | $/inst | Calls/inst |
|---|---|---|---|---|
| live-SWE-agent | Claude 4.5 Opus (medium) | **79.2%** | — | — |
| Sonar Foundation Agent | Claude 4.5 Opus | 79.2% | — | — |
| **OpenHands** (full scaffold) | Claude Opus 4.5 | **77.6%** | — | — |
| **mini-SWE-agent v2.0.0 (bash-only, ~100 lines)** | Claude 4.5 Opus (high) | **76.8%** | $0.754 | 32.9 |
| mini-SWE-agent | Gemini 3 Flash (high) | 75.8% | $0.356 | 56.1 |
| **mini-SWE-agent** | **MiniMax M2.5 (high)** | **75.8%** | **$0.073** | 60.5 |
| mini-SWE-agent | GPT-5.2 (high) | 72.8% | $0.474 | 35.0 |
| mini-SWE-agent | GPT-5 mini | 56.2% | $0.047 | 20.3 |

> **Harness-vs-model confound, quantified: a ~100-line bash-only agent with no index, no repo map, no browser, no custom edit tool lands at 76.8% against a full scaffold's 77.6%. The entire scaffold industry is worth ~1–3 points; the model choice is worth ~20.** Any vendor attributing a large score to its architecture is mostly measuring the model.
>
> **Cost confound: MiniMax M2.5 matches Gemini 3 Flash at 75.8% for $0.073 vs $0.356 — within 1.0 point of Claude 4.5 Opus at 1/10th the cost.** Rank order and cost-efficiency order are almost unrelated, and nobody publishing a ranking shows this column.

**Other gaming vectors:** Verified is 500 hand-filtered instances from **12 Python repos** with dated issues — contamination risk rises with every newer model. pass@k and retry budgets vary without uniform disclosure. **There is no SWE-bench Pro split in the official repo** — treat Pro numbers as vendor-run. **For a TypeScript/Next.js monorepo, Verified has near-zero external validity**; the multilingual split is the only one worth watching.

## E. Scope B — top 3
1. **OpenCode as primary terminal agent (KEEP).** MIT, TypeScript/Bun-native — same language as the monorepo, so config and custom tools are one language. Client/server split gives real long-running background sessions. Native Windows, no WSL. ⚠ 5,642 open issues = real triage backlog, so pin versions.
2. **OpenHands for sandboxed / long-running / PR-shaped work (AUGMENT).** Strongest isolation (Docker/E2B/remote runtimes) + GitHub resolver, and the strongest reproducible full-scaffold Verified number (77.6%). Windows needs Docker/WSL — fine for a background lane, not interactive editing.
3. **mini-SWE-agent wired into the existing vitest eval harness (AUGMENT — highest ROI, lowest effort).** Not a daily driver: **the control arm.** Cheapest way to measure whether added scaffolding actually beats a bash loop *on this repo's tasks*, and to A/B models on cost-per-solved-task. Given scaffold ≈ 1–3 pts and model ≈ 20 pts, that measurement is where the decision lives.

VS Code surface alternative: **Kilo Code** — directly replaces both archived Roo and unmaintained Aider.

## F. Where this track is thin (stated plainly)
- The per-agent **capability matrix is documentation-derived, not measured**. Health/license/release/commit/benchmark data is API-verified; feature cells are not. Verify cells you'll depend on (browser validation, worktree handling) before committing.
- **No SWE-bench Pro / SWE-Lancer / Terminal-Bench numbers** — no Pro split in the official repo, and web-search budget was exhausted.
- **AI SDK `WorkflowAgent` self-hosting is inferred, not confirmed.** Portability was established from the Workflow SDK side ("Worlds" adapters + a production Postgres reference impl), but no doc states `WorkflowAgent` runs unmodified against a self-hosted World. **Prototype before committing.** (Moot if Inngest is used instead — which is the recommendation.)
- **Aider's abandonment rests on one community thread + commit data.** The data is unambiguous; "permanently abandoned" is interpretation, not an official statement.
- **Roo Code's archival has no stated reason**; Kilo Code as successor is inference from shared lineage.
- Unverified: AI SDK EOL/support policy (none published; only evidence is v5 and v6 both patched 2026-09-02) · AI Elements license + min AI-SDK version · Mastra funding dates · Langfuse↔Cloudflare Agents · Langfuse↔Claude Agent SDK (no doc, either language).

## G. Immediate actions
1. **`ai@6.0.162` → `6.0.275`.** Non-breaking, 113 releases of accumulated fixes. **Do this first.**
2. **Spike v7 on a branch** with `npx @ai-sdk/codemod v7`. Gating risks in order: ESM-only + Node 22 floor under `next@^16.2.11`/Turbopack · Langfuse integration swap · telemetry flipping opt-out · `onFinish`→`onEnd` · `fullStream`→`stream` · **cumulative `usage` breaking cost math**.
3. **Do not add a second agent framework.** Every durable/HITL requirement is covered by AI SDK v7 `toolApproval` + existing Inngest — no Vercel Workflow, no Redis, no Mastra.
