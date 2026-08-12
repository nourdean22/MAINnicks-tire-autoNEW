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

---

# Addendum — plans #19 and #20 (arrived mid-session, same day)

**Plan #19 ("Ollama-First VNext blueprint"):** Prisma-7 and Stagehand-v4 claims FALSE again
(third and second sightings of each); "Llama 3.1 / Qwen 2.5" era-naming vs the live catalog
(deepseek-v4 / glm-5.x / kimi-k3 / qwen3.5); the "125% cache penalty" repeats the number the
first synthesis already corrected to a 25% write premium; **idempotency claim REFUTED** — markers
already release on reported-failure AND throw (`lib/ai/tools/tool-idempotency.ts:96/101`, documented
in its own header). **Accepted from it:** server-derived claim verification (shipped as
`parseClaimLedger`) and the `CONSEQUENTIAL_RE` update|save|upload gap (real; shipped).

**Plan #20 ("Canonical Ollama-First"):** the strongest of the four — its routing/shadow-state
description matches code, and its #1486 correction (session-briefing memory controller ≠
BrainMemory commit gateway) is RIGHT. All three of its #1513 review findings resolved this
session: refusal copy's routing promise deleted; `pinEffort` now refuses a conversation-level
`max` pin (real justify-bypass, confirmed by code-read); caller-supplied verification already
fixed. Its P0 cost firewall SHIPPED (see the second-wave RECONCILIATION entry). Its "REJECT
mandatory Fable bake-off" was honored — the bake-off that ran was Ollama-only on the flat
subscription, per the operator's own zero-spend directive.

**Operator-verified same session:** `ANTHROPIC_MODEL=claude-fable-5` is SET on statenour-web
(operator-instructed flip) but **no ANTHROPIC_API_KEY exists on statenour-web OR nickstire** —
the canary is armed and cold; the route comment at `route.ts:397` already documented the keyless
state. Memory gateway shadow review: **1,788 receipts / 7 days — noop 846 (47%) at 0% legacy
agreement, add 535 @ 100%, review_required 349, update 58, genuine independent reinforce ≈ 0.**

**Plan #21 ("Canonical Ollama-First Edition", dated 08-12):** the most rigorous of the five, and
its #1513/routing verification is accurate — yet it STILL asserts "Prisma 7 (`@prisma/adapter-neon
^7.6.0`)" (fourth sighting of the falsehood; installed 6.19.3, no adapter-neon anywhere). Its
Mythos self-retraction matches what #1513 already encoded. Of its six 48-hour items, three were
already live from this session before it arrived (IDK incentive fix · refusal-first-class · $0
firewall + lane transparency — ours is the stricter COST-CLOSED variant per plan #20 and the
operator's own directive; the `NICK_COST_FIREWALL=0` kill-switch is its "liveness valve"). Its two
big remaining SHIPs are **deliberately NOT blind-shipped**: a hard tool budget K≤5 must first
solve the forced-tool inclusion problem (the toolChoice ladder step-0-pins tools a blind cap could
exclude — the 2026-07-29 pruner-gap incident is the precedent) and the Skeptic-default persona is
an every-turn behavior change that its own additive-migration rule routes through the golden-set
A/B. **Next-wave queue, in its order:** tool budget (with forced-tool union) → instruction
inventory + prompt compilation → Skeptic-default A/B → deterministic memory conflict resolution
(max() over serial — pairs with Phase-2 supersession) → two-turn evidence extraction → golden set
40-60 wired into verify:hard → intra-Ollama capability-router graduation.
