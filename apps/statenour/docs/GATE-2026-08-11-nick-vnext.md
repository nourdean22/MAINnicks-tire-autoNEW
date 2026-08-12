# GATE — 2026-08-11 · "NICK VNEXT" master plan (mega-plan #18)

**Input:** two pasted synthesized blueprints ("NICK VNEXT — MASTER PLAN" + "NICK × FABLE 5 — Canonical
Frontier Architecture"), both proposing a rebuild of the chat OS around Claude Fable 5 / Mythos 5.
**Verdict: ~70% incumbent, refuted, or deferred by the plans' own sequencing. The verified-new
48-hour remainder shipped in [#1513](https://github.com/nourdean22/MAINnicks-tire-autoNEW/pull/1513)
(`891722ac9`).** Everything below was verified against this checkout on 2026-08-11 — not taken from
either report's own "verified" tables, one of which was false (see Refuted).

## The 48-hour ask, item by item

| # | Plan item | Verdict | Receipt |
|---|---|---|---|
| 1 | Fable compatibility adapter (strip temperature/top_p/top_k; decouple output budget from visible brevity) | **NEW → SHIPPED** | Blockers real: `build-stream-config.ts` sends `temperature: turnSignal.temperature` on every turn; caps run 80–1600 (chat) / 1500–8000 (aiChat). Shipped as `lib/ai/claude5-compat.ts` middleware at the `createAnthropicModel()` choke point — same pattern as the incumbent `createOllamaModel` fetch-interceptor. `claude-sonnet-5` deliberately untouched. |
| 2 | Effort parameter support | **SMALLER THAN CLAIMED → SHIPPED (passthrough + router)** | Both reports assumed an SDK gap. Installed `@ai-sdk/anthropic ^3.0.64` **already exposes** `effort: low\|medium\|high\|xhigh\|max`, `taskBudget`, `speed`, `contextManagement` (dist `index.d.ts:219`). The adapter passes providerOptions through; the router owns choosing effort. |
| 3 | Refusal as first-class outcome | **PARTIALLY INCUMBENT → CLASSIFICATION SHIPPED** | Refusals already rotated the aiChat chain — stop_reason `refusal` → finishReason `"content-filter"` → empty text → the garbage gate — but were **mislabeled `garbage_response`**. Now `failureClass: "refusal"` + `provider.refusal` log; stream path's `emptyResponseFallback` names the refusal honestly. Deliberate deviation from report B: a refusal does NOT mark the provider failed (prompt-specific, not an outage). |
| 4 | Per-turn model/effort/fallback transparency | **~80% INCUMBENT** | `StreamAttempt[]` (per-attempt provider+modelId+error), `buildOnFinish` persistence of provider/modelId, `provider.success` logs, cache telemetry — all pre-existing. Shipped delta: refusal visibility + `turnMetaSchema` (shadow) for the Context & Evidence panel. Effort display is meaningless until the router goes live. |
| 5 | Capability/effort router | **NEW → SHIPPED (SHADOW)** | `lib/ai/vnext/effort-policy.ts`, zero live callers. Untrusted→fable always; mythos strictly behind `ANTHROPIC_MYTHOS_ENABLED` attestation (report 2's Glasswing correction adopted over report A's unconditional Mythos-primary); hard→opus-5 pending bake-off; frontier→fable·max justify-gated; effort pinned per conversation. |
| 6 | Claim/Evidence typed schemas (shadow) | **HALF-NEW → SHIPPED REUSING INCUMBENT VOCABULARY** | The chat-side Claim ledger is new; the evidence taxonomy is NOT — `MemoryEvidenceClass` + strength ladder have lived in `lib/brain/memory-commit-gateway.ts` since spine-2. `lib/ai/vnext/truth/claims.ts` imports that vocabulary type-locked both ways instead of minting `PRIMARY_SOURCE`-style parallel enums. Only TRUSTED evidence supports; blocking-verifier gate = materiality × uncertainty × irreversibility. |
| 7 | Model registration (fable/mythos/opus-5) | **SHIPPED VIA COMPAT + ROUTER** | `classifyModelId` already classifies any `claude-*` id to the anthropic lane (registry substring). No `config/ai-providers.ts` change needed — zero live-routing risk. Flip = env var. |
| 8 | Private Lab retention truthfulness | **REAL GAP → SHIPPED** | Banner said "no history · no memory · no learning" (app-level claims, all true) but was silent on provider retention; 5-family requires 30-day provider retention, no ZDR. Now: "provider retention applies". |
| 9 | Baseline telemetry (tokens/TTFT/cost per turn) | **INCUMBENT** | usage+cost in `AiResponse`, cache telemetry (`recordCacheUsage`), TTFT via `firstTokenRef` onChunk, OTel traces, `/system/agent-traces`. Nothing shipped; nothing needed. |
| 10 | 50-task shadow bake-off (fable/mythos/opus × effort) | **NOT RUN — operator-blocked** | Needs Anthropic spend authorization + golden tasks from real usage (prod reads). Ollama Cloud remains the one funded lane (2026-07-22 note). The router's `hard` band documents the pending mythos-xhigh vs opus-5 decision. |

## Refuted — claims the reports made about this codebase

| Claim | Reality |
|---|---|
| Report A §0: "**VERIFIED TRUTH: Prisma 7** (`@prisma/adapter-neon ^7.6.0`)" | **FALSE.** Workspace catalog pins `prisma: ^6.3.1`; installed `@prisma/client` is **6.19.3**. No `@prisma/adapter-neon` in statenour's package.json. The report's own "ground-truth reconciliation" table failed its own protocol — re-verify even "code-read-verified" claims. |
| Report B (earlier iteration): "Stagehand v4" | **FALSE** — `@browserbasehq/stagehand: 3.7.0` (report 2 itself corrected this; confirmed against package.json). |
| "No refusal handling exists" | **Partially false** — rotation existed; only the classification was wrong (see item 3). |
| "Claim/evidence ledger is net-new" | **Half-false** — the evidence half of the vocabulary is incumbent (item 6). |
| Report A: "Mythos 5 primary (near-certain)" | **REJECTED as unconditional.** Mythos is approved-orgs-only; the router treats it as attestation-gated, never assumed. Report 2's correction adopted. |
| "The current CoVe is external verification" (implied by neither — both correctly flagged it) | Confirmed as consistency-check-not-verification; the true evidence-verification pass is a 7-30d item, not shipped here. |

## Deferred by the plans' own sequencing (NOT built — do not re-propose as "missing")

Durable runs (`/runs` + RunEvent) · JIT/deferred tool discovery · conformal per-field risk tiers ·
MIST memory-gateway graduation · context manifest + prompt minimization A/B · proactivity budget ·
verbalized sampling · outcome eval gates on Braintrust · untrusted-content dual-LLM boundary.
All are 7-to-30-day items in BOTH reports. Each needs its own gate against incumbents first —
in particular memory graduation (gateway ALREADY WIRED per the 2026-08-10 #1486 gate) and
receipts/provenance (~90% incumbent per the 2026-08-10 Completion-Authority gate).

## DO-NOT-BUILD list — honored

No multi-agent swarm, no always-max Fable, no bigger monolithic prompt, no Outlines/vLLM
(UPSTREAMS row added), no engagement optimizer, no uncalibrated "confidence %", no RAG-on-everything.

## Receipts

typecheck 0 · lint 0 errors (170 pre-existing warnings) · `tests/ai` **105 files / 1,558 passed,
exit 0** · targeted 5 files / 51 passed · check:raw-sql ✅ · check:crons ✅ · check:stale-docs
(strict) ✅ · prompt:size-check PASS · prisma validate ✅ · pre-push turbo-build-affected 80.65s ✅.
