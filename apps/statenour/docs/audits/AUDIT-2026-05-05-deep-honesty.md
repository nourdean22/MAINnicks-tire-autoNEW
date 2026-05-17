# Deep honesty audit — 2026-05-05 wrap session

Driver: "no more unknown issues before I close the laptop." Ran 9 forensic probes against the live DB + direct provider APIs. Below is everything green-checked vs. everything that's actually busted, separated cleanly.

---

## ✅ Verified green (mechanical proof)

| Surface | Probe | Result |
|---|---|---|
| Production build (next build, dummy env) | `pnpm build` | passes locally + CI |
| TypeScript | `pnpm tsc --noEmit` | 0 errors |
| Tests | `pnpm vitest run` | **925/925 pass** |
| Pre-push gate | scripts/pre-push-check.sh | **14/14** (build now mandatory) |
| Vector storage / pgvector / HNSW | smoke check_4 | 2592 rows · 100% vec_filled · uniform 1024d |
| Brain bus consumer | scripts/probe-bus-consumer.mjs | brain-bus-backfill firing every ~2min, healthy |
| Brain bus dual-write handler | scripts/force-fire-autonomous.mjs | both writes succeeded for synthetic event |
| AutonomousEvent table post-deploy | smoke check_8 | typed=2 legacy=2 (perfect parity) |
| BrainMemory tombstones | smoke check_7 | 1/2020 (0%) — clean |
| Bus stuck rows | smoke check_2 | 0 stuck >1h !done !failed_terminal |
| Cron heartbeat | smoke check_1 | 51 distinct jobs in 24h, only ingest-calendar(1/1) |
| Budget gate setting + tracking | smoke-budget-gate.mjs | $5/day cap set, AiGeneration tracking working (109 calls yesterday $0.50) |
| Direct API: Venice + Ollama + OpenAI keys (local) | scripts/probe-providers-direct.mjs | all 200 OK |
| BrainBusEvent autonomous.fired delivery | scripts/probe-bus-trace.mjs | 10/10 events processed in 24h, lastError=null |

## 🔴 Real bugs — code already shipped (v10.0.209-213)

| # | Bug | Status |
|---|-----|--------|
| 1 | v10.0.208 prod build break (provider.ts dynamic-import → prisma → fs in client bundle) | FIXED v10.0.209 (server-only on budget.ts) |
| 2 | Pre-push gate skipped `next build` on codex/ollama-local pushes | FIXED v10.0.213 (mandatory build gate, all branches) |
| 3 | Silent `.catch(() => undefined)` on dual-write paths hid all errors | FIXED v10.0.210 (logger.warn + structured fields) |
| 4 | aiChat() per-provider failure detail invisible (only Vercel runtime logs) | FIXED v10.0.212 (failures[] in AiResponse, persisted to agent_traces.metadata) |
| 5 | Smoke probe used 24h window before deploy time → false "broken extraction" alarm | FIXED v10.0.213 (deploy-anchored windows) |

## 🔴 Real bugs — REQUIRE USER ACTION

| # | Issue | Evidence | Action |
|---|-------|----------|--------|
| A | **`OLLAMA_API_KEY` missing in Vercel env** | provider_pings cron records `error_class="no key"` for every Ollama ping. Local .env.local has the key (57ch) and works. | **Add OLLAMA_API_KEY to Vercel project env** (production + preview). |
| B | **OpenAI account 429 on every ping** | provider_pings shows `error_class="429"` on every OpenAI POST. Direct GET /v1/models works (different rate bucket). | **Check OpenAI dashboard for credit balance + rate limits.** Likely either out of credits or tier limit. |
| C | **`ANTHROPIC_API_KEY` not configured** | Direct probe shows `MISSING`. Provider chain falls through silently. | **Add ANTHROPIC_API_KEY to Vercel env** if you want the safety-net tier. Currently a 4-attempt chain across 3 distinct providers. |

## 🟡 Operational signals to watch

| Signal | Last reading | Implication |
|---|---|---|
| `thinking-engine` emergency rate | 50% (4/8 in 6h, was 29% prior 18h) | **Trending worse** since v10.0.195. v10.0.212 instrumentation just shipped — read agent_traces.metadata.providerFailures after next fire |
| Today's chat liveness | 0 msgs (7d avg = 55) | Operator-mode artifact — not a bug, but means budget gate / chat path is unproven today |
| Today's AI spend | $0.00 / $5.00 cap | All 32 versions today were code-only, no AI calls fired |
| ToolVerbRatio writers | 0 since v10.0.197 deploy | Waiting on chat activity to validate |

## 🟢 Things that LOOKED broken but aren't

| Thing | Initial signal | Actual reality |
|---|---|---|
| AutonomousEvent dual-write | "0 typed in 24h" | Deploy was 1.5h before probe; 95% of window was pre-deploy. Force-fire confirmed handler works. |
| ToolVerbRatio dual-write | "0 ALL-TIME" | Deploy was 1.7h ago + 0 chat msgs today = no upstream events to write. Code path verified by inspection. |
| Vector storage | text=2568 raised "is HNSW even working?" | All 2568 vec columns ARE populated. HNSW index from v10.0.205 IS active. |
| Bus consumer dead | force-fire timed out at 90s | Backfill cron runs every ~2min; my 90s timeout was too short. 4-min retry confirmed processing. |

## Forensic infrastructure (durable, run anytime)

```
scripts/smoke-deep-fit.mjs         # 9-check honesty pass · deploy-aware
scripts/smoke-v208-fit.mjs         # 5-check shallow honesty pass
scripts/smoke-budget-gate.mjs      # budget gate non-mutating verification
scripts/probe-providers-direct.mjs # bypass cron + SDK · direct API health
scripts/probe-thinking-engine-errors.mjs # error class drill + trend
scripts/probe-emergency-trace.mjs  # latest provider_emergency trace detail
scripts/probe-bus-trace.mjs        # autonomous.fired path through brain-bus
scripts/probe-bus-consumer.mjs     # bus consumer cron health
scripts/probe-typed-write-error.mjs # direct insert sanity check
scripts/probe-memkey-collision.mjs # memKey @unique truncation audit
scripts/probe-ping-error.mjs       # ProviderPing failure class breakdown
scripts/force-fire-autonomous.mjs  # synthetic autonomous event end-to-end
```

Run before/after any AI-pipeline ship. Catches:
- Silent .catch swallowers (post-v10.0.210 dual-writes)
- Missing API keys / config drift
- Provider account 429s / quotas
- Deploy-window false positives (post-v10.0.213)
- Stuck bus events

## Next deploy hypothesis (v10.0.212 just shipped)

After v10.0.212 lands and the next thinking-engine fire happens
(~10-30 min cadence), agent_traces.metadata.providerFailures will
contain the per-provider {failureClass, message, durationMs} for
each tier. That tells us EXACTLY why the chain emergencies — likely
either:
  · OpenAI 429 cascading (matches the cron-ping data)
  · Ollama "no key" (matches the cron-ping data)
  · Some Venice SDK issue under load

Read with: `node --env-file=.env.local scripts/probe-emergency-trace.mjs`
