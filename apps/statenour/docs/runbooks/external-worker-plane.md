# Runbook · External worker plane — subscription/local execution

- **Status:** active · **Domain:** ai-runtime · **Risk:** high · **Last verified:** 2026-10-01
- **When to use:** installing, routing, debugging, or proving NattyNour external-worker execution.
- **Source of truth:** `lib/workers/external-worker.ts`, `lib/workers/contracts.ts`, `local-agent/external_worker_agent.py`, `local-agent/nour-local-gateway.js`, `lib/services/runner-state.ts`.

## Architecture

StateNour keeps one durable machine-job plane: existing `WorkItem` + `RunnerNode`.
The cloud control plane queues an explicit external-worker envelope; a Windows worker polls outbound,
reports lane health/quota, claims a job, executes one approved candidate lane, and completes the same
WorkItem. Do not create a second queue, second task database, or inbound desktop RPC server.

The current worker lanes are:
- `chatgpt-plan` — optional Sign in with ChatGPT plan-usage OAuth. It uses only the granted plan bearer, stores renewable credentials with Windows CurrentUser DPAPI, and has no API-key fallback. If consent, plan scope, account eligibility, or workspace policy denies access, the lane stays unavailable.
- `codex` — ChatGPT/Codex subscription authentication.
- `claude-code` — Claude subscription authentication.
- `antigravity` — Google Antigravity account authentication.
- `local-qwen` — local OpenAI-compatible gateway at `127.0.0.1:11436`.

OpenWebUI is a local chat surface over that gateway. It is not the worker orchestrator. The gateway also exposes `nour-research` as an **interactive logical model**, not a sixth durable worker queue. Research reuses the same read-only subscription adapters and writes only local research receipts.
## Safety + routing rules

1. The server chooses the ordered `candidateLaneIds`; the machine may only choose from that list.
2. `AUTO` never silently crosses into `METERED_PAID`. Subscription-included and local-free are distinct from API billing.
3. Worker subprocesses remove `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, Gemini/Google API-key variables, and Codex API-token variables. Claude worker sessions also run in `--safe-mode` with no session persistence so interactive CLAUDE.md/hooks/plugins/MCP/skills cannot inflate or alter bounded worker context.
4. Codex write execution uses the current CLI's `--approve-for-me` path without also forcing `-s workspace-write`; those flags conflict on current Codex builds. Read-only Codex remains explicitly sandboxed `read-only`.
5. Read-only jobs may fall through to the next already-approved candidate on quota/provider failure.
6. Write jobs never auto-fallback after execution begins. A partial edit plus a second agent would create duplicate/conflicting side effects.
7. Workspace writes require both `allowWorkspaceWrite=true` on the job and machine policy `NOUR_EXTERNAL_WORKER_ALLOW_WRITES=1`.
8. Missing/empty output, denied required Antigravity actions, timeout, or nonzero exit is failure — never success by process-exit guesswork.
9. Quota exhaustion updates the lane heartbeat immediately; stale/unavailable lanes must not be selected as healthy.
10. Worker communication is outbound HTTPS to bdnick.info using `RUNNER_SHARED_SECRET`; do not expose a public local-agent port.
11. Research source truth comes from provider tool-result telemetry. URL-shaped text in a model answer is never promoted into the evidence ledger. Each round records WebSearch/WebFetch receipts, and a report cannot be `complete` unless at least one page was actually fetched.
12. Research web content is untrusted data. Evidence prompts explicitly forbid treating page content as instructions, and research runs remain read-only even when the machine's separate durable-write gate is enabled. Page-derived memos reach the critic and synthesizer only inside `<research_data>` fences, and the critic's `gap` is reduced to a plain search query (no URLs, IPs, paths or control characters, max 200 chars) before it can steer a WebFetch round. The research CLI runs from a fresh empty temp directory, never the repo checkout; it is removed best-effort afterwards and needs no Python-version-specific keyword. `install-external-worker.ps1` does not pin a Python version (it uses whatever `python.exe` is on PATH); the gateway spawns interactive and research runs with its own hard-coded Python 3.14 path. WebFetch is not restricted from private/metadata addresses: Claude Code `WebFetch(domain:...)` rules match the hostname string only (no CIDR, no resolved-IP check), so a deny list would not stop a public name that resolves to a private address.
13. The local gateway (`127.0.0.1:11436`) refuses browser-originated calls. Every route, GET included, requires a loopback `Host` (`127.0.0.1`, `localhost` or `[::1]`, any port) and answers 403 otherwise; this is what stops a DNS-rebinding page from reading `/v1/models` or `/health/lanes`. A present non-loopback `Origin` also gets 403, and a `POST /v1/*` without `content-type: application/json` gets 415. Only one research run executes at a time: the worker holds an OS file lock (`%TEMP%\nour-research.lock`, override `NOUR_RESEARCH_LOCK_PATH`) for both `nour-research` and a `nour-auto` it promotes to research, and a second run gets 429 `nour_research_busy`. The OS releases the lock if the run is killed. Callers that send no `Origin` and use a loopback name (OpenWebUI at `127.0.0.1:8080`, the worker, OpenCode/Goose, curl) are unaffected. A client addressing the gateway as `host.docker.internal` (for example OpenWebUI in Docker) would be refused, and the refusal is logged as `reason=host`. There is no bearer token yet.
14. Lane subprocesses never inherit `RUNNER_SHARED_SECRET`; only the worker process itself uses it.
15. Interactive OpenAI-style tool calling is transport-only at the NOUR gateway. A request carrying `tools` / `tool_choice` is converted into a strict tool-decision envelope for the already-selected read-only lane; the gateway validates any returned tool name against the caller-supplied definitions and emits standard OpenAI `tool_calls` (including streaming deltas). Prior assistant tool calls and tool-result messages are serialized back into the next reasoning turn. `tool_choice=none` bypasses the tool protocol, and an unknown tool name is never forwarded. The gateway itself does not execute shell/filesystem tools and this does not enable `NOUR_EXTERNAL_WORKER_ALLOW_WRITES`; execution authority stays with the client (for example an isolated OpenCode worktree/session).


## Install / persistence

Only install/start after the matching server code and schema migration are live. Run the
installer **from a current source checkout**; the protected runtime-write worktree is the execution
target, not the installer source:

```powershell
# From a current MAINnicks-tire-autoNEW checkout:
cd apps\statenour
.\local-agent\install-external-worker.ps1 -BaseUrl https://bdnick.info -WorkspaceRoot C:\Users\nourd\Documents\Codex\NATTYNOUR-RUNTIME-WRITES-DO-NOT-CLEAN
```

The installer copies the worker and adjacent `chatgpt-plan-bridge.mjs` under
`%LOCALAPPDATA%\StateNour\external-worker`, pins workspace aliases to the supplied protected
workspace root, stores the runner secret with Windows current-user DPAPI, and registers
`StateNour-ExternalWorker-NattyNour` as a
**manual-only task with no automatic triggers**. It can start on battery, restarts on failure once
manually started, and leaves machine writes OFF unless `-EnableWrites` is deliberately supplied.
NattyNour's operator control is `NOUR External Worker Toggle.lnk`; OFF must mean task `Ready`, zero
triggers, and zero `external_worker_agent.py` processes.

## Verification sequence

1. **Local contract:** `python -m unittest local-agent\test_external_worker_agent.py local-agent\test_external_worker_installer.py local-agent\test_nour_local_gateway.py` (the gateway test needs `node` and stubs every lane).
2. **Router oracle:** `pnpm eval:router-oracle` — AUTO/no-consent, paid-only fail-closed, MAX+consent, quota fallback, FREE, privacy boundary.
3. **Lane probe:** confirm ChatGPT-plan/Codex/Claude/Antigravity/local-Qwen health reflects real auth/quota/policy, not merely binary presence.
4. **Interactive tool-loop canary:** on an isolated gateway/OpenCode pair, require one harmless tool request to persist a completed OpenCode tool part, then require a second model turn to consume that exact tool result and produce the final answer. A model-selected tool name outside the caller's tool list must not execute.
5. **Runner receipt:** start the task and verify a fresh RunnerNode heartbeat + lane metadata from `getExternalWorkerStatus`.
6. **Read-only job:** queue `queueExternalWorkerJob` with `allowWorkspaceWrite=false`; read it with `getExternalWorkerJob`; require durable completed status plus Reality Ledger phase receipts.
7. **Fallback canary:** with Codex quota exhausted, a read-only candidate list may complete on Claude/local; prove selected lane in the persisted result.
8. **Research canary:** run `nour-research` against a current factual question. Require a persisted receipt, at least one verified WebFetch page for `complete`, and zero promotion of text-only URLs into sources.
9. **ChatGPT-plan canary:** run `chatgpt-plan-bridge.mjs --self-test`, then OAuth sign-in only when the selected account/workspace permits delegated plan use. A policy denial is an unavailable lane, not permission to substitute an API key.
10. **Write canary:** keep writes OFF by default. When explicitly authorized later, use an isolated disposable workspace and verify no second-lane execution occurs after a failure.

## Failure / recovery

- A WorkItem stuck PENDING/CLAIMED for >15 minutes is already handled by the autonomic orchestrator:
  it becomes FAILED/STALLED and emits a P0 coach event. Do not add another reaper.
- Prefer the desktop toggle for OFF. If stopping manually, stop the task **and** verify/terminate only the exact `external_worker_agent.py` child; `Stop-ScheduledTask` alone can leave that child orphaned.
- Read `%LOCALAPPDATA%\StateNour\external-worker\external-worker.log` before restarting.
- If auth expires, repair the subscription CLI session locally; do not substitute an API key.
- If production schema/server is behind the worker contract, leave the task stopped until deploy/migration read-back is green.

## Rollback

Stop/unregister the scheduled task and remove the copied runtime directory. Server-side code is additive;
pending WorkItems remain visible/terminal through the existing queue. Reverting this capability must not
delete historical WorkItems, RunnerNodes, or Reality Ledger receipts.
