# Original-plan reconciliation — 2026-09-28

Scope: §15 "What only Nour can do" from `2026-09-23-estate-master-architecture.md`, reconciled against live Railway, Neon, GitHub, production logs, and current `origin/main`.

## Ground truth

| # | Slice | Status | Receipt |
|---|---|---|---|
| 1 | TiDB backups / retention / restore drill | OPEN — operator console | No new verified receipt in this pass. |
| 2 | SMS gateway phone online + choose texting route | PARTIAL | Gateway accepted sends repeatedly on 2026-09-27; one offline event occurred at 14:17Z and recovered. Vendor/route decision remains open. |
| 3 | Remove public Redis TCP proxy | DONE + VERIFIED | 2026-09-28 live Railway config now exposes only `privateNetworkEndpoint: redis`; public 6379 proxy removed. |
| 4 | Revoke/replace legacy credentials | OPEN — operator security action | No verified completion receipt in this pass. |
| 5 | Review old Vapi confirmation drafts | OPEN — operator queue action | Q-41 fixed future recaps; historic drafts still require send/discard review. |
| 6 | Q-01 Railway deploy hygiene / watch paths | DONE + VERIFIED | Live Nick + worker watch patterns now contain tested negations; regression suite 28/28. |
| 7 | Retire Perplexica + SearXNG | DONE | Already absent from live Railway inventory before this pass. |
| 8 | Retire Redis service + volume + REDIS_URL | BLOCKED — Railway dashboard 2FA | Retirement patch was cleanly staged, but Railway rejected API/MCP commit because destructive deletion requires 2FA. Live Redis remains internal-only. |
| 9 | Create Railway deploy webhook | OPEN | `RAILWAY_WEBHOOK_TOKEN` exists on StateNour; live project webhook list is empty. |
| 10 | Set 30s deployment draining on Nick's | PARTIAL / value hidden | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` exists live; connector intentionally hides its value, so equality to 30 is unverified. |
| 11 | Push Q-41 Vapi assistant config | DONE + LIVE-VERIFIED | Real 2026-09-27 `sendConfirmationSms` calls have arg keys `callId, phone, summary` only — no `mapLink`. |
| 12 | Check/remove stale `ANTHROPIC_MODEL` | PARTIAL | StateNour has the variable set; Nick's does not declare it. Value is hidden, so model liveness is not proven here. |
| 13 | Worker east4 + private StateNour route + no public domain | DONE + RUNTIME-VERIFIED | Worker is in `us-east4-eqdc4a`, has no public domain, targets `http://statenour-web.railway.internal:8080`, and forwards continue returning OK. |
| 14 | Turn on Wait for CI | OPEN — Railway dashboard | Generic API silently drops `source.checkSuites`; current Railway IaC docs do not support the field. Dashboard toggle remains required. |
| 15 | Choose release cadence | OPEN — decision | No new decision receipt in this pass. |
| 16 | Choose shop-data path / QuickBooks option | OPEN — decision | No new decision receipt in this pass. |
| 17 | Choose texting vendor / 10DLC registration | OPEN — decision | No new decision receipt in this pass. |
| 18 | Counsel review | OPEN — external decision | No legal-decision receipt in this pass. |
| 19 | Seal production secrets before staging | OPEN | No verified completion receipt in this pass. |
| 20 | Enable `pg_stat_statements` on Neon | DONE + VERIFIED | Migration tested on temp branch, explicitly approved, applied to production, temp branch deleted; extension v1.11 live and slow-query reads work. |
| 21 | Give agents read-only Railway/DB eyes | OPEN | Neon has no custom SELECT-only role; only platform/owner roles are present. |
| 22 | Submit Google Business Profile API access | OPEN — operator/vendor | No approval receipt in this pass. |
| 23 | Pick Langfuse vs Braintrust dataset store | OPEN — decision | Both integrations remain represented; no new decision receipt. |
| 24 | Merge loop PRs / stop control | ONGOING | Portfolio execution continues; this pass intentionally avoided unrelated sibling work. |

## New production evidence unlocked by #20

`pg_stat_statements` immediately exposed several high-cost StateNour paths worth a separate tuning slice:

- A `brain_memories` pagination query: 744 calls, ~502.7s cumulative execution, ~26.46M rows returned, and ~1.68M temp blocks read/written.
- A vector source-unavailable cleanup update: 4 calls, ~7.26s mean execution.
- A large pairwise vector comparison query: 4 calls, ~2.94s mean execution with ~13.6M shared-buffer hits.
- Brain-dump full-text retrieval: 60 calls, ~798ms mean execution.

These were previously invisible because `pg_stat_statements` was absent. Treat this as a new evidence-backed performance workstream, not proof that those queries are wrong until plans and application intent are checked.
