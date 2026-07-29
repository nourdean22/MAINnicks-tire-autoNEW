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
| Camoufox | stealth browser automation | **REJECT** (duplicate) | Stagehand lane is live; stealth adds anti-detection baggage. Footnote: acceptable **fallback engine** if Browserbase cost ever bites — that event is the only reopen trigger |
| Open WebUI | AI workspace (chat/RAG/RBAC/evals) | **REJECT** (duplicate) | its own guidance: "don't replace an existing chat app." All four porting targets exist: owner auth, brain RAG (pgvector), calibration/eval arena, fleet-truth observability |
| HyperFrames | HTML→video rendering | **REJECT** (duplicate) | `@nour/reel-engine` (Remotion) + `@nour/social-assets` (Satori) + creative compiler already produce autonomous reels; a second render engine is sprawl |
| Claude Ads | capability-gated ads agent | **PATTERN** (already native) | read-only default / manifests / deterministic audits / approval-gated mutations = the shipped doctrine (#1180 read-mode hard gate, receipts, approvals); ads ops live in `@nour/meta-ads-architect` + GBP publisher |
| assistant-ui | typed generative UI | **PATTERN** (2026-07-28) | typed renderer registry built natively (#1176); grow the Surface vocabulary per A2UI below |
| Unsloth / Axolotl | local fine-tuning | **WATCH** (prerequisite: training data) | zero labeled corpus today. **Reopen trigger:** `outcomesNeedingReview` has ~200+ real correction cases AND the recall-eval corpus shows prompt-tuning plateaued on measured recall. Standing up trainers before data exists is capability cosplay |
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

**Rules of the register:** every verdict cites a receipt or a trigger —
no vibes; WATCH entries must state the concrete reopen condition;
changing a verdict is a PR touching THIS file with the new evidence;
external audits proposing anything listed here get pointed at the row,
not re-litigated.
