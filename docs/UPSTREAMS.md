# Upstream disposition register

**Purpose:** the single place where "should we adopt X?" gets a durable
answer. Nine external audits in two days (2026-07-28/29) re-proposed
platforms this monorepo had already adopted, already rejected with
receipts, or already built natively — twelve incumbent-collisions were
caught only because each proposal was re-gated by hand. This register
ends that loop the same way the contracts registry ended vocabulary
reinvention: **check here before proposing, and update here when a
verdict changes.**

**Verdict vocabulary** (from the blueprint's disposition scorecard):
- **ADOPTED** — running in production, receipt linked
- **NATIVE** — the capability exists as first-party code; adopting the
  upstream would duplicate a live lane
- **PATTERN** — we took the design, not the dependency
- **WATCH** — real value, missing prerequisite; concrete revisit trigger
  stated (never "later")
- **REJECT** — wrong for this system; reason stated
- **DEAD** — upstream unmaintained or unverifiable

| Upstream | Capability | Verdict | Grounds + receipt |
|---|---|---|---|
| Health Auto Export | Apple Health → own endpoint | **ADOPTED** (2026-07-28) | on-device exporter, no third-party server; smoke-proven end-to-end incl. dedupe replay (#1182/#1183); runbook `apps/statenour/docs/runbooks/apple-health-sync.md` |
| yt-dlp | video transcripts | **ADOPTED** (2026-07-28) | policy-guarded, fenced like firecrawl (#1173); pinned in Dockerfile |
| Inngest | durable workflows | **ADOPTED** (long-standing) | 24 registered functions; self-sync + heartbeat + out-of-band liveness (#1166+) |
| Stagehand / Browserbase | agent browser automation | **ADOPTED** (2026-07-22) | live (#1030/#1032); Ollama Cloud lane |
| Camoufox | stealth browser automation | **REJECT** (duplicate) | Stagehand lane is live; stealth adds anti-detection baggage. Reopen trigger: Browserbase cost bites. Reopen MECHANISM (audit-#10's good idea): a second provider behind the EXISTING `browser_do`/`browser_navigate`/`browser_act`/`browser_observe` names, env-flagged — never `camofox_*` tool sprawl |
| Open WebUI | AI workspace (chat/RAG/RBAC/evals) | **REJECT** (duplicate) | its own guidance: "don't replace an existing chat app." All four porting targets exist: owner auth, brain RAG (pgvector), calibration/eval arena, fleet-truth observability |
| HyperFrames | HTML→video rendering | **REJECT** (duplicate) | `@nour/reel-engine` (Remotion) + `@nour/social-assets` (Satori) + creative compiler already produce autonomous reels, and chat-side video generation is LIVE (`moneyprinter` tool, sideEffecting, in-flight-guarded). The keeper from audit-#10 is the EVAL, not the engine: "never claim video created without an artifact id" — WP-18 |
| Claude Ads | capability-gated ads agent | **PATTERN** (already native) | read-only default / manifests / deterministic audits / approval-gated mutations = the shipped doctrine (#1180 read-mode hard gate, receipts, approvals); ads ops live in `@nour/meta-ads-architect` + GBP publisher |
| assistant-ui | typed generative UI | **PATTERN** (2026-07-28) | typed renderer registry built natively (#1176); grow the Surface vocabulary per A2UI below |
| Unsloth / Axolotl | local fine-tuning | **WATCH** (prerequisite: training data) | zero labeled corpus today. **Reopen trigger:** `outcomesNeedingReview` has ~200+ real correction cases AND the recall-eval corpus shows prompt-tuning plateaued on measured recall. First-model candidates when it reopens (audit-#10): task classifier · memory-recall judge · fabrication critic · briefing compressor — small task models, Unsloth first, Axolotl only when configs get serious |
| AutoTrain Advanced | no-code training | **DEAD** | upstream README declares itself unmaintained (verified live by the 2026-07-29 audit); recommends Axolotl/TRL |
| Vibe-Trading / Fincept Terminal | finance research / trading | **REJECT** (wrong for this system) | personal-finance tab sits in retired-state pending WP-9; live-execution finance is out of the agent's operating bounds regardless. Fincept: AGPL — license review mandatory before any code reuse |
| "Nano Banana" / Open-Gen-AI | multimodal launcher | **DEAD** (unverifiable) | the proposing audit could not pin the repo; neither could we |
| Langfuse | LLM observability | **REJECT** (2026-07-28, #1173) | self-host = web+worker+Postgres+ClickHouse+Redis+S3 for one operator; native receipts + AgentTrace + trace pages cover the need. OTel export stays a future option |
| Trigger.dev / n8n (as runtime) | orchestration | **REJECT** (2026-07-28) | five dispatch classes already run and are census-guarded (`check:crons` [7/7]); a sixth job system is the disease the blueprint treats. n8n for *peripheral* integrations = separate future question, same register |
| A2A (Agent2Agent) | inter-agent protocol | **WATCH** | v1.0 under Linux Foundation, real. **Reopen trigger:** a second genuinely independent agent exists (voice loop is the only candidate) |
| A2UI | agent-driven UI spec | **PATTERN → WATCH** | "UI as data, client-owned catalog" is exactly the renderer registry's shape; adopt its Surface-type vocabulary as WP-11 grows, protocol itself only if an external agent ever renders into the app |
| ARD (Agentic Resource Discovery) | capability discovery spec | **WATCH** | v0.9 draft, a month old. Internal concept already shipped as the capability registry (#1180); public spec when it stabilizes AND an external consumer exists |
| Plausible / PostHog | analytics / experiments | **WATCH** (2026-07-28, #1173) | **Reopen trigger:** outcome ledger + fleet metrics accrue enough volume that questions outgrow first-party receipts (~weeks) |
| Cal.com | scheduling | **WATCH** | no booking-volume evidence; nickstire booking flows exist. Reopen on real scheduling pain |
| LangGraph | orchestration kernel | **REJECT** (2026-07-29 audit's own conclusion) | "the answer is to formalize the machinery already present" — done: execution-class vocabulary in `@nour/utils` contracts |
| OTel GenAI semconv | trace field standards | **ADOPT-PATTERN** (audit-#12) | map AgentTrace/ai-cost fields to `gen_ai.*` names — no new infra, standards alignment only; blueprint WP-20. Never log raw prompts unredacted |
| Braintrust | eval experiments | **ADOPTED** (verified: dep 3.10.0, `braintrust-wrap.ts` live) | extend, don't add: recall failures + claim warnings + operator verdicts → versioned eval datasets (WP-21); local no-send first |
| Phoenix (Arize) | OSS trace/eval workbench | **WATCH** | same class as Langfuse but OSS/local; reopen only if AgentTrace + /system/ai-cost prove insufficient for a NAMED question |
| GBP Performance API | local-search metrics | **ADOPTED** (#1193; runtime gated by Google) | Shipped read-only: `gbp.performance` proc + service (fail-closed until Connect; "<N" thresholds stay strings). Runtime blocked: project 740034351591 quota=0 on all GBP APIs until the access form is approved (state + ownership map: nickstire INTEGRATION_REGISTRY GBP note). GSC+calls+bookings join = remaining WP-22 legs |
| NHTSA vPIC + recalls | vehicle data (free, gov) | **ADOPT-CANDIDATE** | VIN/YMM normalization + recall-aware lead enrichment, read-only advisor framing, cached + source-labeled; WP-23 |
| GA4 Data API | post-click attribution | **PARTIAL-INCUMBENT** | wired (`server/analytics.ts`); the delta is the GSC×GA4×leads JOIN, not the API |
| Lighthouse CI + CrUX | web-vitals regression + field data | **ADOPT-CANDIDATE** | public-site budget gates + field LCP/INP/CLS into the SEO cockpit; WP-22 companion |
| ActivityWatch | local activity truth | **WATCH** (personal-OS lane) | aggregates-only ingest (never raw window titles) after the health lane proves the ingest pattern; same inlet architecture as Apple Health |
| Home Assistant | device hub | **WATCH** | camera-bridge + SmartDevice are the incumbents; HA reopens if device count outgrows them — consume state, approval-gate commands |
| Actual Budget | personal finance | **REGISTERED as the WP-9 answer** | if the Money tabs come back, IMPORT Actual summaries — never rebuild a finance app in-repo |
| AI SDK 7 | agent SDK major | **WATCH** | on v6 today; reopen on a NAMED v7 feature need (tool approvals exist natively; `@ai-sdk/otel` pairs with WP-20) |
| OWASP LLM Top-10 · NIST AI RMF · MITRE ATLAS · CSA | AI security governance | **ADOPT-AS-CHECKLIST** | threat-model references for the existing fencing/approval/injection gates — audit lens, not dependency |
| OpenBB | finance data connectors | **REJECT-for-now** | same verdict as Fincept/Vibe; only relevant if money rebuilds as BUSINESS research |
| Promptfoo | prompt/agent eval + red-team | **WATCH** (audit-#13) | incumbent lane is WP-21 (Braintrust dataset spine) + native `tests/eval/run-suite.ts`, `lib/evals/`, `pnpm eval:memory`. **Reopen trigger:** WP-21 ships AND a NAMED adversarial question the native suite cannot express (injection/tool-poisoning corpora are the strongest candidate) |
| `@openrouter/ai-sdk-provider` | official OpenRouter provider | **WATCH** (audit-#13) | the manual glue is 14 lines and load-bearing: `provider.ts` must call `openrouter.chat()` because @ai-sdk/openai v3's bare callable defaults to the **Responses API** — that shipped the prod `invalid_prompt`/`invalid_union` 400s (poison-pill incident), and `build-model-messages.ts`'s item_reference sanitizer targets Chat Completions. "Official is tidier" is not a reason to re-open a lane that already bled. **Reopen trigger:** an actual OpenRouter response-shape drift the manual provider mishandles |
| BAML | cross-model structured output | **WATCH** (audit-#13) | zod v4 + `zod-to-json-schema` are the incumbents. **Reopen trigger:** a NAMED extraction lane measurably failing across models |
| Ax (DSPy-for-TS) | optimized typed programs | **WATCH — same prerequisite as Unsloth/Axolotl** (audit-#13) | audit-#13 proposed Ax for *verbatim the same four* first-model candidates already listed in the Unsloth row (task classifier · memory-recall judge · fabrication critic · briefing compressor). Same blocker: zero labeled corpus. Inherits that row's reopen trigger exactly — do not treat "different framework" as a different prerequisite |
| MarkItDown | fast Office/PDF/HTML→Markdown | **WATCH** (audit-#13) | `pdf-parse` + `mammoth` + `exceljs` already cover the common path; MarkItDown's win is breadth, not quality. **Reopen trigger:** an ingest format the incumbents drop |
| Docling | scanned-PDF / layout / table OCR | **ADOPT-CANDIDATE (sidecar)** (audit-#13) | genuinely additive — the incumbents have no OCR/table-structure lane at all. Python CLI sidecar ONLY (never a Next.js dep), read-only, output normalized to one SourceDocument shape with chunk provenance. Same inlet architecture as Apple Health |
| Crawl4AI | self-hosted crawling | **WATCH** (audit-#13) | Firecrawl is the live lane (`lib/integrations/firecrawl.ts`, SSRF-guarded + fenced). **Reopen trigger:** Firecrawl cost/quota bites — and then via the **Camoufox mechanism**: a second provider behind the EXISTING tool names, env-flagged, never `crawl4ai_*` tool sprawl |
| Graphiti | bi-temporal knowledge graph | **PATTERN** (audit-#13) | take the supersession/invalidation/provenance *design* into BrainMemory's schema; do not add a Python graph dependency to a pgvector system that works. Adoption question only survives if the benchmark row below says pgvector lost |
| mem0 `memory-benchmarks` | LOCOMO / LongMemEval corpora | **ADOPT-AS-BENCHMARK** (audit-#13) | the keeper of this audit alongside Docling: test *data*, not a dependency — the thing that converts "should we swap memory?" from vibes into a measured answer. Gate every memory-stack proposal (Graphiti, GraphRAG, LightRAG) behind it |
| GraphRAG / LightRAG | graph-structured RAG | **WATCH** (audit-#13) | **Reopen trigger:** the mem0 benchmark above shows pgvector recall capped on a NAMED curated corpus. Never index the whole monorepo/brain blindly |
| mcp-scan | MCP tool-poisoning scanner | **ADOPT-CANDIDATE** (audit-#13) | cheap, read-only, `uvx`-runnable; extends the existing `check:prompt-injection` + `fenceContent()` doctrine to external MCP surfaces. Same genre as the OWASP checklist row |
| OpenAI Agents JS | multi-agent runtime | **REJECT** (duplicate) (audit-#13) | guardrails/handoffs/approvals/tracing all exist natively (guardian, approval policies, AgentTrace, capability registry); Inngest owns durability. Identical to the LangGraph verdict — "formalize the machinery already present" |
| LiveKit Agents | voice agent framework | **ADOPTED — already running** (audit-#13) | `apps/voice/` **is** a Python LiveKit Agents loop (Deepgram STT → statenour `/api/agent` → Cartesia TTS), own Dockerfile + requirements.txt. Audit-#13 proposed `pnpm add @livekit/agents` without seeing it — incumbent collision #13 |
| Pipecat | voice/multimodal framework | **WATCH** (audit-#13) | study-only alternative to the live LiveKit lane. **Reopen trigger:** LiveKit Agents blocks a named voice requirement |

**Rules of the register:** every verdict cites a receipt or a trigger —
no vibes; WATCH entries must state the concrete reopen condition;
changing a verdict is a PR touching THIS file with the new evidence;
external audits proposing anything listed here get pointed at the row,
not re-litigated.

**For external auditors (recurring failure modes, ten audits in):**
1. The live repo is `C:\Users\nourd\NOURCITY` — audit-#10 read a stale
   OneDrive copy (`…OLD\nick-opsOLDDDD\…`) and reported months-old tool
   counts as current. 2. `apps/statenour` is not the whole system —
   `packages/*` (reel-engine, social-assets, meta-ads-architect, utils
   contracts) and `apps/nickstire` hold half the incumbents audits
   propose rebuilding. 3. Prose counts are banned — the tool count is
   `TOOL_CATALOG.length`, pinned bidirectionally by
   `tests/ai/catalog-integrity.test.ts` (2026-07-29: header said 114,
   truth was 174). 4. **A stale-looking status field may be a kill
   switch.** Audit-#13 correctly found `browser.*` claiming "Stagehand
   SDK not installed" while the SDK had been a pinned dep since
   2026-07-22 — then prescribed "fix registry truth: active/restricted
   if env present." `status: "inert"` is a HARD EXECUTION GATE
   (`tool-policy.ts` denies inert/scaffolded outright), and `browser.act`
   is riskClass "critical" with `externalMutation: true`; that "fix"
   arms it on env presence alone. The entry welded a rotted clause to a
   deliberate one. **Correct the false clause, never the gate** — the
   operator owns activation. Both halves are now pinned by
   `tests/tools/registry-claims.test.ts`. 5. `TOOL_CATALOG` (174, full
   tool list) and `TOOL_REGISTRY` (28, curated operator-facing risk
   registry) are **different scopes, not duplicates** — audit-#13 read
   them as drifting copies and proposed unifying them. WP-17 already
   rejected adding a manual status field as "the ceremony the original
   note warned against"; `getToolHealthSummary()` is the measured lane.
