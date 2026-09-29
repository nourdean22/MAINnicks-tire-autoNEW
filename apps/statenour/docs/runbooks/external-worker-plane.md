# Runbook · External worker plane — subscription/local execution

- **Status:** active · **Domain:** ai-runtime · **Risk:** high · **Last verified:** 2026-09-29
- **When to use:** installing, routing, debugging, or proving NattyNour external-worker execution.
- **Source of truth:** `lib/workers/external-worker.ts`, `lib/workers/contracts.ts`, `local-agent/external_worker_agent.py`, `lib/services/runner-state.ts`.

## Architecture

StateNour keeps one durable machine-job plane: existing `WorkItem` + `RunnerNode`.
The cloud control plane queues an explicit external-worker envelope; a Windows worker polls outbound,
reports lane health/quota, claims a job, executes one approved candidate lane, and completes the same
WorkItem. Do not create a second queue, second task database, or inbound desktop RPC server.

The four current lanes are:
- `codex` — ChatGPT/Codex subscription authentication.
- `claude-code` — Claude subscription authentication.
- `antigravity` — Google Antigravity account authentication.
- `local-qwen` — local OpenAI-compatible gateway at `127.0.0.1:11436`.

OpenWebUI is a local chat surface over that gateway. It is not the worker orchestrator.
## Safety + routing rules

1. The server chooses the ordered `candidateLaneIds`; the machine may only choose from that list.
2. `AUTO` never silently crosses into `METERED_PAID`. Subscription-included and local-free are distinct from API billing.
3. Worker subprocesses remove `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, Gemini/Google API-key variables, and Codex API-token variables.
4. Read-only jobs may fall through to the next already-approved candidate on quota/provider failure.
5. Write jobs never auto-fallback after execution begins. A partial edit plus a second agent would create duplicate/conflicting side effects.
6. Workspace writes require both `allowWorkspaceWrite=true` on the job and machine policy `NOUR_EXTERNAL_WORKER_ALLOW_WRITES=1`.
7. Missing/empty output, denied required Antigravity actions, timeout, or nonzero exit is failure — never success by process-exit guesswork.
8. Quota exhaustion updates the lane heartbeat immediately; stale/unavailable lanes must not be selected as healthy.
9. Worker communication is outbound HTTPS to bdnick.info using `RUNNER_SHARED_SECRET`; do not expose a public local-agent port.

## Install / persistence

Only install/start after the matching server code and schema migration are live:

```powershell
cd C:\Users\nourd\NOURCITY\apps\statenour
.\local-agent\install-external-worker.ps1 -BaseUrl https://bdnick.info
```

The installer copies the worker under `%LOCALAPPDATA%\StateNour\external-worker`, stores the runner
secret with Windows current-user DPAPI, registers `StateNour-ExternalWorker-NattyNour`, restarts on
failure, and leaves machine writes OFF unless `-EnableWrites` is deliberately supplied.
## Verification sequence

1. **Local contract:** `python -m unittest local-agent\test_external_worker_agent.py local-agent\test_external_worker_installer.py`.
2. **Router oracle:** `pnpm eval:router-oracle` — AUTO/no-consent, paid-only fail-closed, MAX+consent, quota fallback, FREE, privacy boundary.
3. **Lane probe:** confirm Codex/Claude/Antigravity/local-Qwen health reflects real auth/quota, not merely binary presence.
4. **Runner receipt:** start the task and verify a fresh RunnerNode heartbeat + lane metadata from `getExternalWorkerStatus`.
5. **Read-only job:** queue `queueExternalWorkerJob` with `allowWorkspaceWrite=false`; read it with `getExternalWorkerJob`; require durable completed status plus Reality Ledger phase receipts.
6. **Fallback canary:** with Codex quota exhausted, a read-only candidate list may complete on Claude/local; prove selected lane in the persisted result.
7. **Write canary:** keep writes OFF by default. When explicitly authorized later, use an isolated disposable workspace and verify no second-lane execution occurs after a failure.

## Failure / recovery

- A WorkItem stuck PENDING/CLAIMED for >15 minutes is already handled by the autonomic orchestrator:
  it becomes FAILED/STALLED and emits a P0 coach event. Do not add another reaper.
- Stop the host lane with `Stop-ScheduledTask -TaskName StateNour-ExternalWorker-NattyNour`.
- Read `%LOCALAPPDATA%\StateNour\external-worker\external-worker.log` before restarting.
- If auth expires, repair the subscription CLI session locally; do not substitute an API key.
- If production schema/server is behind the worker contract, leave the task stopped until deploy/migration read-back is green.

## Rollback

Stop/unregister the scheduled task and remove the copied runtime directory. Server-side code is additive;
pending WorkItems remain visible/terminal through the existing queue. Reverting this capability must not
delete historical WorkItems, RunnerNodes, or Reality Ledger receipts.
