# Track 7 — Durable Execution + Observability + Deployment (verified 2026-09-03)

All version/license/activity data from the GitHub API and vendor primary sources, 2026-09-03.
**This track read the actual codebase rather than assuming.**

## A1. Measured position in THIS codebase
| Fact | Value |
|---|---|
| Inngest SDK | `inngest@4.4.0` |
| Inngest functions | **25** |
| `step.run` call sites | **101** |
| `step.waitForEvent` | 6 |
| `step.sleep` | 3 |
| Largest single function | **11 steps** (`lib/inngest/functions/intelligence-brief.ts`) |
| Tracing | `@langfuse/otel@5.10.1` + `@opentelemetry/sdk-node@0.221.0` (**OTel-native**) |
| Errors | `@sentry/nextjs@10.73.0` |
| Evals | vitest — `tests/ai/judge-eval*.test.ts`, `tests/lib/evals/memory-evals.test.ts`, `tests/brain/recall-eval.test.ts` |

> **Max function is 11 steps against a 1,000-step ceiling — ~1% of the binding constraint.
> This single number invalidates most of the "you'll outgrow Inngest" argument.**

## A2. Comparison
| Project | License | Latest | Stars | Maintainer diversity | Self-host $ | OSS crippled? |
|---|---|---|---|---|---|---|
| Temporal | MIT | v1.31.2 · 2026-07-08 | 22.8k | **Strong** | ~$25–60/mo | **No** — OSS is full-featured |
| Hatchet | MIT | v0.105.16 · 2026-08-31 | 7.8k | Moderate | ~$10–30/mo | No |
| **Inngest** | **SSPL-1.0** (+Apache-2.0 after 3 yrs) | v1.44.0 · 2026-08-26 | 5.8k | **Weak** (top1 = 2× #2; 52 contributors) | $0–15/mo | Cloud adds ops, not features |
| Trigger.dev | Apache-2.0 | v4.5.16 · 2026-09-02 | 16.2k | Moderate | ~$30–70/mo | **YES — see A4** |
| Restate | **BUSL-1.1** → Apache @4yrs | v1.7.8 · 2026-08-27 | 4.4k | Weak-moderate | ~$10–25/mo | No |
| **DBOS Transact (TS)** | **MIT** | v4.27 · 2026-08-25 | 1.3k | **Weak** (25 contributors) | **$0** — library on your existing Postgres | Conductor UI is paid |
| Windmill | AGPL + proprietary EE | v1.803.0 · 2026-09-03 | 17.8k | **Very weak** (top1 = 9× #2) | ~$20–50/mo | Yes |
| n8n | **Sustainable Use License** (not OSI) | daily | 203k | Moderate | ~$15–40/mo | Yes |
| pg-boss | MIT | daily | 3.9k | **Very weak — bus factor 1** (1,344 vs 78) | **$0** | No |
| BullMQ | MIT | daily | 9.4k | Moderate | ~$5–10/mo | BullMQ Pro is paid |

**2026 newcomers:** `microsoft/pg_durable` (PostgreSQL License, v0.2.7 2026-09-01, 2.8k stars) —
**DO NOT USE: needs `shared_preload_libraries` + a bgworker + `CREATE EXTENSION`, and Neon has a
fixed extension allowlist that excludes it.** Its own README disqualifies this environment. Also
authored in SQL, not TS. `SokratisVidros/pg-workflows` — 58 stars, single author, DO NOT USE.

## A3. License traps (read from the actual LICENSE files)
**Inngest is SSPL-1.0, not Apache/MIT** (GitHub reports `NOASSERTION`). SSPL §13 triggers only on
*offering the software's functionality as a service to third parties* — **internal use for a personal
agent does not trigger it.** But know your job engine is SSPL.

Others: **Nomad → BUSL-1.1, licensor is now IBM** · **Sentry → FSL-1.1-Apache-2.0** ·
**Arize Phoenix → Elastic License 2.0** (source-available, not OSI) ·
**n8n → "Content of branches other than the main branch are not licensed"**.

## A4. ⛔ The finding that eliminates self-hosted Trigger.dev
Its own docs list what self-host does **not** get: warm starts · auto-scaling · **checkpoints** · support.

> **Checkpoints are the mechanism that makes a multi-day wait cheap.** Without them, self-hosted
> waits are *blocking* — a workflow sleeping two days pins a worker for two days. For a
> "minutes-to-days" scope this is structurally disqualifying. Durability survives; economics don't.

## A5. Inngest's real constraints — the actionable engineering finding
| Limit | Value | Headroom here |
|---|---|---|
| Steps/function | 1,000 | 11 max → **99%** |
| Step output size | 4 MiB | watch LLM transcripts |
| **Total run state** | **32 MiB** | **the real ceiling for agent loops** |
| Step timeout | 2 hrs | fine |
| Sleep | 1 yr paid / **7 days free** | 3 uses |
| Free tier | 50k runs/mo, concurrency 5 | fine |

**Execution model — what actually bites.** Inngest memoizes *by step*, and its docs are explicit that
non-deterministic side effects must live inside `step.run()`. **Code outside `step.run()` is re-entered
across step boundaries.** With 101 `step.run` calls the discipline is mostly there — but
**audit for LLM calls, Prisma writes, or `Date.now()`/`Math.random()` sitting between steps. That is
the highest-value hour available on this stack.**

**Accumulating full agent transcripts across steps is what hits the 32 MiB run-state cap** — not the
step count. Store transcripts in Postgres/blob; pass IDs between steps.

## A7. The orchestration/reasoning boundary — the core architecture rule
Temporal states it cleanly: *"While Temporal requires that your Workflow code is deterministic, your
AI Agent can absolutely make decisions based on non-deterministic LLM outcomes."*

> **Nondeterminism is not eliminated — it is RECORDED.** The LLM's output is captured on first
> execution and replayed from history thereafter. The agent stays creative; orchestration stays replayable.

| Deterministic (orchestrator owns) | Nondeterministic (must be a checkpointed step) |
|---|---|
| The agent loop itself | LLM inference calls |
| Iteration/termination conditions | Tool/API executions |
| Which step runs next | DB reads and writes |
| Budget + step-count accounting | `Date.now()`, `Math.random()`, UUIDs |
| Fan-out/join structure | File/network I/O |

Four non-obvious rules:
1. **The orchestrator owns the loop, never the model.** The model is invoked *inside* an iteration;
   it does not control iteration. Also the mitigation for runaway loops (arXiv 2607.01641,
   *When Agents Do Not Stop*).
2. Checkpoints land at the step boundary, not inside inference — a crash mid-inference re-runs that call.
3. **Every tool call needs an idempotency key** — retry semantics are at-least-once.
4. Validate/sanitize model output at the boundary where it exits the LLM step, before it can
   influence control flow.

**Where Inngest differs favorably:** it does not require full deterministic replay of the workflow
body — it memoizes by step ID. That is a **lower correctness burden than Temporal for this exact
workload.** A real reason to stay.

## B1. OTel GenAI semconv status — **still Development, nothing stable, nothing to pin**
| Fact | Evidence |
|---|---|
| Dedicated repo | `open-telemetry/semantic-conventions-genai`, created **2026-05-05** |
| Releases / tags | **ZERO / ZERO** |
| Every `gen_ai.*` attribute | marked `Development` |
| Only Stable attributes on GenAI spans | `error.type`, `server.address`, `server.port` — borrowed from core semconv v1.44.0 |

**You cannot pin a schema URL.** Pin a commit or your instrumentation version; plan for churn.

Exists today: span/agent/event/metric/exception docs + **`mcp.md`**; provider docs for Anthropic,
OpenAI, Bedrock, Azure. Span naming `{gen_ai.operation.name} {gen_ai.request.model}`, kind CLIENT.
Agent attrs `gen_ai.agent.{id,name,description,version}`, `gen_ai.conversation.id`,
`gen_ai.tool.definitions`, `gen_ai.input/output.messages`. **Token accounting is notably granular** —
`cache_read`/`cache_write` + per-modality text/image/audio, which is how you get honest cost tracking
with prompt caching. MCP attrs: `mcp.method.name`, `mcp.session.id`, `mcp.protocol.version`.

> **You are already correctly positioned.** `@langfuse/otel` + `@opentelemetry/sdk-node` is the
> OTel-native path — if Langfuse ever has to go, your spans survive the swap. **Do not trade that away.**

## B2. Platforms
| Platform | License | Latest | Self-host | Infra needed |
|---|---|---|---|---|
| **Langfuse** | **MIT core + `ee/` commercial**, © **ClickHouse, Inc.** | v4.28.0 · 2026-09-03 | ✅ full | Postgres + **ClickHouse + Redis + S3** + 2 containers |
| Arize Phoenix | **Elastic License 2.0** (not OSI) | v20.6.0 · 2026-09-03 | ✅ genuinely ungated | 1 container |
| Comet Opik | **Apache-2.0** | 2.2.49 · 2026-09-03 | ✅ | ClickHouse + MySQL + Redis |
| Braintrust / LangSmith | Proprietary | — | **Enterprise only** (LangSmith reportedly $100k+) | — |
| Helicone | Apache-2.0 | **v2025.08.21 (>12mo)**, 7 commits/90d | ✅ | proxy + ClickHouse |

**ClickHouse, Inc. acquired Langfuse — announced 2026-01-16** ($400M Series D, $15B valuation).
LICENSE now reads © ClickHouse, Inc. **The EE gate is irrelevant here** — everything behind the
license key is enterprise governance (RBAC, audit logs, SCIM, data masking).

> **Self-host cost reality: Langfuse v3+ needs 5–6 services ≈ $40–80/mo on Railway plus a real ops
> surface. Langfuse Cloud Hobby is 50k units/mo free. For one operator, Cloud is cheaper in BOTH
> dollars and hours.**

## B3. Eval frameworks
| Framework | License | Latest | Health |
|---|---|---|---|
| promptfoo | MIT | 0.122.2 · 2026-08-28 | ✅ very active |
| DeepEval | Apache-2.0 | v4.2.0 · 2026-08-24 | ✅ active |
| **Inspect AI** | MIT | **0.3.262 · 2026-09-03** | ✅ very active — **UK AI Security Institute** |
| **Ragas** | Apache-2.0 | v0.4.3 · **2026-01-13** | ❌ **STALLED** |
| openai/evals | NOASSERTION | — | ❌ **DEAD**, 0 commits/90d |

⚠ **Ragas is effectively abandoned — and this contradicts every secondary source.** A web search
claimed it "remains actively maintained as of 2026." **False.** Repo moved
`explodinggradients/ragas` → `vibrantlabsai/ragas`; last commit to `main` **2026-02-24**;
**0 commits to `main` in 90 days**; **592 open issues**; community PRs still arriving daily
(#2991, #2990 on 2026-09-03) with **none being merged**. Classic abandoned-upstream-with-live-community
signature. **DO NOT USE for anything new.**

⚠ **promptfoo was acquired by OpenAI (2026-03-09).** Public commitment to stay open source under the
current license. **KEEP but WATCH — an eval tool owned by a model vendor has a structural conflict
of interest when used to compare that vendor's models.**

## B4. Eval methodology
| Task | What works | Anti-pattern |
|---|---|---|
| Tool-call success | Execution-based verification against **end state**, not trajectory match (τ-bench checks resulting DB state). Use **pass^k** (succeeds k times running), not pass@k | Judging the tool-call text |
| Coding | Run the test suite — binary, cheap, unfakeable | LLM-judging diffs |
| Browser | Deterministic DOM/state assertions + screenshot diffs | Free-text "did it work?" |
| **Research citations** | **Three axes, separately:** link resolves / content relevant / **fact supported** | Assuming a citation exists ⇒ it's right |
| Memory | LongMemEval/LoCoMo shape. **Score retrieval in isolation from generation** | End-answer only — the generator papers over bad retrieval |
| Structured output | **Zod/JSON-Schema parse — deterministic, free, zero-noise** | Judge-based schema checking |
| CI gating | Deterministic assertions gate the merge; judge scores advisory | Blocking merges on a noisy judge |

**The single most important empirical result for a research agent** — *Cited but Not Verified*
(arXiv 2605.06635): frontier models keep **link validity >94%** and **relevance >80%**, but achieve
only **39–77% factual accuracy against the cited source**. And **Fact-Check accuracy drops ~42% on
average as tool calls scale from 2 to 150.**

> **More retrieval makes citations worse, not better. A well-formed citation is near-zero evidence
> that the claim is supported.** You need a fact-check axis and a tool-call cap.

## B5. LLM-as-judge — the reliability trap
*Reliability without Validity* (arXiv 2606.19544): **high test-retest reliability (>0.95) coexists
with severe position bias (>0.10) in production-deployed judges**, and judge rankings shift by
**up to 14 positions** across benchmarks.

> **A judge that agrees with itself is not a judge that is right.** Consistency is what you'll
> accidentally measure; validity is what you need.

| Failure mode | Magnitude | Mitigation |
|---|---|---|
| Position bias | up to **75%** preference for whichever is first | randomize order; run both and average |
| Self-preference | GPT-4 ~+10%, Claude-v1 ~+25% on own outputs | **never judge a model family with itself** |
| Verbosity bias | longer ⇒ higher, content fixed | length-normalize |
| Style bias | markdown/bullets dominate substance | strip formatting before judging |

**Calibration protocol:** hand-label 50–100 examples → measure **Cohen's κ** → trust the judge only
in the band where κ is acceptable.
**This codebase already has `judge-eval-rubric.test.ts` + `judge-eval.test.ts`. The gap is not having
judges — it's proving they're calibrated.** Add a κ check and a position-swap control.

## C. Deployment for one operator
**k8s essentially never pays off here** — it costs **20–40% of one engineer's time** on upgrades,
node patching, cert rotation, etcd backups. **KEEP Railway. k8s = DO NOT USE. Nomad = DO NOT USE
(BUSL-1.1 under IBM).**

**Reverse proxy:** Railway terminates TLS today. **Neither Caddy nor Traefik is needed. Do not add one.**

**Secrets: SOPS (MPL-2.0) + age (BSD-3) is the correct answer for one operator** — encrypted secrets
in git, key you hold, no service, $0. Its weaknesses (no approval UI, no env hierarchy) are team
problems you don't have. **OpenBao = DO NOT USE** (Vault fork, org-scale complexity).
*Grounding: the memory index records `~/.railway-nickstire-token` dead and `RAILWAY_TOKEN` shadowing
the working CLI session — exactly the class of bug single-source SOPS secrets prevent.*

### 🔴 C4. THE HIGHEST-SEVERITY FINDING IN THE PROGRAM: the DR gap
| Neon plan | Instant-restore window |
|---|---|
| **Free** | **6 HOURS** |
| Launch | 1 day default, up to 7 |
| Scale | 1 day default, up to 30 |

> **A 6-hour window IS your disaster-recovery posture. A bad migration discovered the next morning
> is unrecoverable via PITR.** Given hand-applied migrations and a real prior `task_events`
> double-write incident, this is the highest-severity gap found anywhere in this research.

**Minimum viable DR, all $0:**
1. Nightly `pg_dump` → object storage, 30-day retention (Inngest cron — the primitive already exists).
2. **Monthly automated restore drill** — *a backup never restored has an unknown success rate*.
   Restore into a **Neon branch** (copy-on-write, near-free) so drilling is cheap enough to actually do.
3. Verify at four levels: file exists → integrity (`pg_verifybackup`) → schema restores →
   **app connects and business logic works**.
4. **Before every hand-applied migration, take a Neon branch as an explicit rollback point.**

**Feature flags:** ⚠ correction — secondary sources claim "Unleash OSS is deprecated, EOL 2026-12-31."
**Wrong.** The deprecation is scoped to **Unleash *Edge* Open Source**, not the server.
For one operator: **a typed config table in your existing Postgres behind the OpenFeature interface
is the $0 answer.** If you want a service, **GO Feature Flag** (MIT, single binary, no DB) beats
Unleash on both license and footprint.

## C6. SLOs + chaos testing
Agent SLIs, all derivable from the OTel GenAI metrics above: task success rate · tool-call error rate ·
steps-to-completion (runaway detector) · cost per task · TTFT · workflow completion rate.

**AgentChaos** (arXiv 2608.06790, ASE 2026) injects crash/omission/value faults at the shared HTTP
layer with no source changes:
> **All systems degrade under fault injection, with pass@1 dropping by up to 50 percentage points.
> Robustness ranking stayed consistent across LLMs — YOUR IMPLEMENTATION, NOT THE MODEL, DETERMINES
> RESILIENCE. You cannot buy agent reliability by upgrading the model.**

Drills, cheapest first: (1) HTTP fault injection on the LLM provider — 5xx, truncated responses,
malformed tool-call JSON; (2) kill a worker mid-`step.run`, verify Inngest resumes and **no side
effect double-fired**; (3) corrupt a memoized step output, verify downstream fails loudly rather than
silently; (4) tool timeout/latency spike, verify budget cascade + cancellation; (5) monthly Neon
restore drill.

*Precedent from the memory index: four consecutive rounds where a hostile pass found real defects in
work already called done, and "a failed read rendering as a confident zero" appearing 10×. That
defect class — **silent failure presented as a valid result** — is exactly what fault injection
catches and unit tests miss.*

## Bottom line
| Component | Verdict |
|---|---|
| **Inngest** | **KEEP** — 11/1000 steps; best TS DX; SSPL doesn't bite internal use |
| **Langfuse (Cloud)** | **KEEP** — MIT core, EE gate is enterprise-only, already OTel-native |
| **Sentry (hosted)** | **KEEP** — self-host is ~20 containers / 16GB RAM and officially unsupported |
| **Neon** | **KEEP — fix the DR gap** |
| **Railway** | **KEEP** |
| **vitest evals** | **KEEP + AUGMENT** — needs judge calibration + CI gate |

**Nothing in this stack should be replaced. That finding survived a deliberate search for reasons to change.**

### The five things worth doing, in order
1. 🔴 **Fix the DR gap** — nightly dump + monthly restore drill into a Neon branch. $0. *Highest severity.*
2. **Audit for side effects between steps** — hunt LLM calls, Prisma writes, `Date.now()`/`Math.random()`
   outside `step.run()`. $0, ~1 hour, **highest ROI**.
3. **Calibrate the judges** — Cohen's κ vs 50–100 hand labels + position-swap control. $0.
4. **Add a CI eval gate** — deterministic assertions (Zod validity, tool-call success, cost/latency
   ceilings) block the merge; judge scores advisory. $0.
5. **Run AgentChaos-style fault injection.** $0.

### Watch-list (~6 months)
Inngest (SSPL + weakest contributor diversity; migration target = **Hatchet**, MIT) · Langfuse under
ClickHouse · promptfoo under OpenAI (judge-neutrality conflict) · OTel GenAI semconv first tagged
release · DBOS Transact TS (thin at 25 contributors, but MIT + $0 + runs on existing Neon — the
natural augmentation if a workflow outgrows Inngest's 32 MiB run-state cap).

### Data-quality note
Two secondary-source claims were **false** and corrected against primary sources:
(1) "Ragas is actively maintained" — **0 commits to `main` in 90 days**;
(2) "Unleash Open Source is EOL" — deprecation is scoped to **Unleash Edge**, not the server.
