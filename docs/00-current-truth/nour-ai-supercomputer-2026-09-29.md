# NOUR AI supercomputer · production closeout 2026-09-29

## Recovered and merged
- Recovered hidden NattyNour work from Desktop Commander history plus C:\Users\nourd\AI\logs\nour-ai-supercomputer-checkpoint-20260929.md.
- Slices 2-3 merged as PR #2793, squash commit 223079d33407b9a6091e34a55032ea935d788e9e.
- Scope: NOUR capability/cost routing contracts, provider integration, MCP v2 migration, protocol hardening, tests, and stale nested StateNour lockfile cleanup.
- PR #2793 gates: Turbo affected verify, StateNour E2E, Completion Authority, Secret Scanning, Agent Policy, Adoption gates, Docker context gate, and Admin completion diagnostic all passed.

## Slice 4 · durable missions · LIVE + VERIFIED
- Reused the existing bounded Inngest durable mission runner; no duplicate mission runtime was created.
- First production checkpoint event was accepted by Inngest but exposed real schema drift: RealityEvent.event_version was missing.
- Production reality_events measured 364 rows / 440 kB before repair.
- Applied the repo-owned additive 20260929123500_reality_event_envelope migration exactly: five columns, two backfills, three indexes, no DROP.
- Read-back: all five columns present, all three indexes present, occurred_at null count = 0.
- Prisma production ledger now records 20260929123500_reality_event_envelope applied; prisma migrate status reports database schema up to date.
- Post-repair direct checkpoint run 5987eb3b-5720-4586-bdcf-2a245154c58d completed with started -> step_started -> step_completed -> completed RealityEvent receipts.
- NICK_DURABLE_MISSIONS promoted ON through the existing DB-backed feature flag override after the live receipt.
- Normal queueDurableMissionExecution proof run c18b6e66-1049-4a6b-8d0f-8295e5ad03a9 persisted queued -> started -> step_started -> step_completed -> completed.
- The runner still does not auto-complete Mission lifecycle state.

## Remaining original-plan scope
- Slice 5: adapters/interfaces for supported Claude Code/Agent SDK, Codex, Antigravity, and local NOUR gateway; expose through bdnick.info, ChatGPT plugin, OpenWebUI; OpenWebUI remains cockpit-only.
- Slice 6: personal benchmarks, Promptfoo oracle, router calibration, cost reports, chaos/failure tests, backups/restore proof, stale-state cleanup, self-diagnosis, unified health/cost/mission dashboard.
- AUTO must never silently enter METERED_PAID.
- Each capability needs external/runtime proof, rollback, and truth-doc evidence before being called complete.

## 2026-09-30 · Slice 5 NattyNour unified interactive AI · LIVE + VERIFIED
- NattyNour owns one interactive path: Open WebUI `127.0.0.1:8080` -> NOUR gateway `127.0.0.1:11436` -> local llama-swap `127.0.0.1:11435` or hardened subscription adapters.
- Open WebUI persistent DB and desktop config both point to the single NOUR gateway; direct connections are disabled. A stale DB override that bypassed NOUR and pointed at raw `11435` was found by rendered-browser proof and repaired.
- The rendered default is `nour-auto`; the picker exposes exactly five intended lanes: `nour-auto`, `qwen35-4b-local`, `nour-codex-chatgpt`, `nour-claude-subscription`, `nour-antigravity`.
- Unified interactive chat is forced read-only. Durable external-worker writes remain a separate manual-only path with machine gate plus per-job `allowWorkspaceWrite`; protected-workspace status was byte-identical before/after interactive canaries.
- Metered provider API credentials plus stale Claude bearer/OAuth/session markers are scrubbed from interactive child environments so subscription/keyring auth wins; no paid API fallback is permitted.
- Claude gateway 503 root cause was stale inherited auth state. After hardening, the live HTTP gateway returned exact `CLAUDE_UI_OK` on lane `claude-code`.
- Antigravity live gateway returned exact `ANTIGRAVITY_UI_OK` without blanket command permission or dangerous bypass.
- Codex explicit lane currently reports subscription/workspace `QUOTA_EXHAUSTED`; the failure is surfaced as HTTP 503 and does not fall through when Codex is explicitly selected.
- AUTO routing live receipts: simple -> `local-qwen`; deep/multi-step -> `claude-code`; code -> Codex first, then Claude when Codex quota is exhausted.
- External interactive prompt contract increased to 80k characters while durable worker jobs retain the tighter 20k-character contract.
- Local Qwen remains Qwen3.5 4B Q4_K_M, 16k context, one slot, Q8 KV, Arc/Vulkan offload, reasoning off. Added Flash Attention auto, 256-token cache reuse, four HTTP threads, metrics, and 300s idle unload.
- Measured local cold load + first answer: ~11.1s. Warm path: ~1.5s end-to-end, 910/928 prompt tokens cached, ~24.8 tok/s generation. After unload, free RAM recovered above 5 GB.
- Open WebUI advanced defaults: AUTO default, five pinned models in deterministic order, model-list timeouts 3s, request timeout 660s, tool server 180s, tool-data 15s, MCP init 30s; DuckDuckGo web search remains enabled.
- OpenCode and Goose remain intentionally on local Qwen through the protected NOUR gateway because the subscription chat adapters are read-only text lanes rather than tool-calling coding-shell providers.
- Open WebUI 0.11.x initial title generation exposed an upstream missing-model-context bug. NattyNour has a narrow self-healing compatibility patch that passes the already-resolved model object; a fresh rendered Claude chat returned `TITLE_FIX2_OK`, generated a title, and produced no title-generation error afterward.
- `nour-doctor.ps1` now checks five-lane topology, kernel, lane auth, read-only policy, one persistent Open WebUI DB route, AUTO defaults/order, bounded timeouts, OpenCode/Goose protected routes, Qwen tuning, title compatibility, autostart, manual-only durable worker, and recovery.
- Machine-local operational helpers are `%USERPROFILE%\\bin\\nour-webui-db-repair.py`, `nour-webui-runtime-patch.py`, `launch-nour-ai.ps1`, and `nour-doctor.ps1`; launcher reapplies DB/runtime invariants after restart or Open WebUI update drift.

### Current caveats
- Codex remains unavailable until the ChatGPT/Codex workspace quota resets or changes; AUTO safely falls through to Claude for coding prompts in the meantime.
- C: free space was ~25.7 GB earlier in the recovery session but later fell below the 25 GB target while other sessions were active. The drop was not attributable to Qwen, pagefile growth, Temp, AI logs, or disposable browser proofs. Do not delete unknown worktrees/caches to chase this without fresh ownership evidence.
- No Neon restore, production database recovery, NicksMax work, production variables, or unrelated active worktrees were touched by this slice.
