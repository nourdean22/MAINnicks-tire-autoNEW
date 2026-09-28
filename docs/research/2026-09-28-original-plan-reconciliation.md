# Original-plan reconciliation — 2026-09-28

## Post-ledger completion receipts

- **#2724 merged:** `f59ed3d0ef4323b273c7464c33059c80fd8a5995`. This made the ledger + Railway source-of-truth hardening durable.
- **#2725 merged:** `7fbeb855d5bc12a33e5592d09380ab081f86f6cb`. StateNour web deployment `bdfe33a5-0a80-48e0-b992-b9662ae42079` is SUCCESS on that exact commit. Current production cardinality: 36,042 eligible memories, 3,632 full rollup rows needed; the new two-phase reader avoids full-payload loading for ~89.9% of eligible rows while preserving individual/archive completeness.
- **#2726 merged:** `18db7de13af5fe0f6f4f2fb62456e371db3dd698`. Worker deployment `aa4db42e-5b0e-4611-a461-2338d3d7f12c` is SUCCESS on that exact commit; StateNour web deployment `f14abc77-e0cb-4e90-915a-250a21bdee0a` was still BUILDING at this receipt. The worker remains private; deploy-drift/smoke now observe persisted worker-forward freshness instead of a public worker URL.
- **GitHub open PR count after this wave:** 0.

Scope: §15 "What only Nour can do" from `2026-09-23-estate-master-architecture.md`, reconciled against live Railway, Neon, GitHub, production logs, and current `origin/main`.

## Ground truth

| # | Slice | Status | Receipt |
|---|---|---|---|
| 1 | TiDB backups / retention / restore drill | OPEN — operator console | No new verified receipt in this pass. |
| 2 | SMS gateway phone online + choose texting route | PARTIAL | Gateway accepted sends repeatedly on 2026-09-27; one offline event occurred at 14:17Z and recovered. Vendor/route decision remains open. |
| 3 | Remove public Redis TCP proxy | DONE + VERIFIED | 2026-09-28 live Railway config now exposes only `privateNetworkEndpoint: redis`; public 6379 proxy removed. |
| 4 | Revoke/replace legacy credentials | PARTIAL — operator security action | Deepgram + LiveKit vars are absent from all live Railway services. Worker still carries inherited secrets (including DB/GitHub) that its canonical runtime contract does not read; removal/rotation remains an explicit security cutover, not an automatic deletion. |
| 5 | Review old Vapi confirmation drafts | OPEN — operator queue action | Q-41 fixed future recaps; historic drafts still require send/discard review. |
| 6 | Q-01 Railway deploy hygiene / watch paths | DONE + VERIFIED | Live Nick + worker watch patterns now contain tested negations; regression suite 28/28. |
| 7 | Retire Perplexica + SearXNG | DONE | Already absent from live Railway inventory before this pass. |
| 8 | Retire Redis service + volume + REDIS_URL | BLOCKED — Railway dashboard 2FA | Retirement patch was cleanly staged, but Railway rejected API/MCP commit because destructive deletion requires 2FA. Live Redis remains internal-only. |
| 9 | Create Railway deploy webhook | OPEN | `RAILWAY_WEBHOOK_TOKEN` exists on StateNour; live project webhook list is empty. |
| 10 | Set 30s deployment draining on Nick's | PARTIAL / platform value hidden | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` exists live. App-side SIGTERM drain is runtime-proven at 25,000 ms with clean exits; the hidden Railway platform value itself cannot be verified as exactly 30s through the connector. |
| 11 | Push Q-41 Vapi assistant config | DONE + LIVE-VERIFIED | Real 2026-09-27 `sendConfirmationSms` calls have arg keys `callId, phone, summary` only — no `mapLink`. |
| 12 | Check/remove stale `ANTHROPIC_MODEL` | PARTIAL — real reader exists | StateNour still reads `ANTHROPIC_MODEL`; Nick's does not declare it. No recent Anthropic production log receipt exposed the actual model value/liveness, so removing the override blindly would be wrong. |
| 13 | Worker east4 + private StateNour route + no public domain | DONE + RUNTIME-VERIFIED | Worker is in `us-east4-eqdc4a`, has no public domain, targets `http://statenour-web.railway.internal:8080`, and forwards continue returning OK. |
| 14 | Turn on Wait for CI | OPEN — Railway dashboard only | Engineering prerequisite is satisfied: multiple workflows run on push to `main`. Generic API silently drops `source.checkSuites`, and current Railway IaC docs do not support it, so the remaining work is only the Railway dashboard toggle per app service. |
| 15 | Choose release cadence | OPEN — decision | No new decision receipt in this pass. |
| 16 | Choose shop-data path / QuickBooks option | OPEN — decision | No new decision receipt in this pass. |
| 17 | Choose texting vendor / 10DLC registration | OPEN — decision | No new decision receipt in this pass. |
| 18 | Counsel review | OPEN — external decision | No legal-decision receipt in this pass. |
| 19 | Seal production secrets before staging | OPEN — dashboard verification | Railway API hides values but does not expose sealed/unsealed metadata, so this cannot be truthfully verified outside the dashboard. |
| 20 | Enable `pg_stat_statements` on Neon | DONE + VERIFIED | Migration tested on temp branch, explicitly approved, applied to production, temp branch deleted; extension v1.11 live and slow-query reads work. |
| 21 | Give agents read-only Railway/DB eyes | OPEN | Neon has no custom SELECT-only role; only platform/owner roles are present. |
| 22 | Submit Google Business Profile API access | OPEN — operator/vendor | No approval receipt in this pass. |
| 23 | Pick Langfuse vs Braintrust dataset store | OPEN — decision | Both integrations remain represented; no new decision receipt. |
| 24 | Merge loop PRs / stop control | RECONCILIATION WAVE CLOSED; portfolio ongoing | #2724/#2725/#2726 merged with zero open PRs immediately after this wave. Broader portfolio execution remains ongoing and sibling work must still be reconciled by current tree/PR truth. |

## New production evidence unlocked by #20

`pg_stat_statements` immediately exposed several high-cost StateNour paths worth a separate tuning slice:

- A `brain_memories` pagination query: 744 calls, ~502.7s cumulative execution, ~26.46M rows returned, and ~1.68M temp blocks read/written.
- A vector source-unavailable cleanup update: 4 calls, ~7.26s mean execution.
- A large pairwise vector comparison query: 4 calls, ~2.94s mean execution with ~13.6M shared-buffer hits.
- Brain-dump full-text retrieval: 60 calls, ~798ms mean execution.

These were previously invisible because `pg_stat_statements` was absent. Treat this as a new evidence-backed performance workstream, not proof that those queries are wrong until plans and application intent are checked.
