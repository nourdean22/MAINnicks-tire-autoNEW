# Agent bridge hardening — scoped, audited, protected-ops-denied

**Status (2026-08-27):** shipped. The bridge is default-deny and scoped; the
audit is durable; no consumer is provisioned yet (hardening ships first,
consumer second — a deliberate sequence).

## What changed, and the defect it closes

Measured 2026-08-27: `POST /api/mcp` exposed the FULL 181-tool catalog behind
one flat bearer, and its only risk gate was a comment —
*"Full Operational Mode Activated: the operator assumes full responsibility."*
A sentence guarding `runPython`, `runDeviceCommand`, and `sendOpportunitySms`
(customer SMS). Zero measured callers, so latent — but the first client would
inherit an ungated code-execution surface. Hardened before that client exists.

| Layer | Before | After |
|---|---|---|
| Surface | full catalog (179 published) | scoped allowlists — **33 tools**, protected ops removed |
| Risk gate | a comment | `assertBridgeToolAllowed` throws; `BRIDGE_HARD_DENY` computed from the catalog |
| Auth | one flat token → everything incl. `runPython` | per-client tokens → `read` / `tasks` scope |
| Audit | `console.log` only (unanswerable "who called last month") | durable `bridge_call_logs` row per call, incl. denials |

## Scopes

- **`read`** — read-only tools (shop, revenue, brain, tasks-read, research).
  Dispatch-safe: cannot mutate anything.
- **`tasks`** — `read` plus writes to the operator's OWN data:
  `createTask`, `completeTask`, `pinMemory`, `triggerBrief`, `sendTelegram`.

**HARD_DENY** (never reachable on any scope, computed + explicit):
`runPython`, `runDeviceCommand` (code/device execution), `sendOpportunitySms`,
`stageCustomerAlert` (customer-facing), `triggerInstagramAutopost`,
`setInstagramAutopostConfig` (social publishing), `browseAndDo`,
`githubCreatePR`, every `business_write`, every `critical`-risk tool. A new
critical tool is denied the day it lands — no edit here.

## New capability: `triggerBrief`

The one gap in the four things an external agent needs (invoices, cron, brain,
brief). `tasks`-scope only. Recomposes the daily brief from CURRENT ingested
data and stores a `briefing_logs` row — it does **not** re-run ingestion (that
heavier path stays the cron / `POST /api/intelligence/briefs/generate`), so it
is fast and touches no external API. Self-scoped, no customer effect.

## Provisioning (operator — none done yet, dormant-but-visible)

Set in Railway → statenour-web (protected operation, never agent-initiated):

- `AGENT_BRIDGE_ENABLED="true"` — master switch (unset = bridge fails closed).
- `AGENT_BRIDGE_TOKEN_READ` — hand to a read-only consumer.
- `AGENT_BRIDGE_TOKEN_TASKS` — hand to a consumer that may write Nour's own data.
- `AGENT_BRIDGE_SECRET_TOKEN` (legacy) — now **read-only**; prefer the scoped tokens.

With no token set the bridge answers a fail-closed misconfiguration and audits
it. **Hand Dispatch the READ token first**; upgrade to TASKS only when it needs
to create tasks or trigger the brief.

## Audit

Every call — success, error, or **denied** — writes one `bridge_call_logs` row:
`clientId` (token NAME, never the value), `scope`, `toolName`, `status`,
`riskClass`, `latencyMs`, `inputHash` (sha256 of args — raw args are never
stored), `createdAt`. A scope/HARD_DENY refusal is audited as `denied`, so a
probe against a protected tool is detectable, not silent. The write is
fault-tolerant (CIITTY: never crash the API on a missing table) — it degrades to
the console line rather than failing a good call.

## Canaries

`tests/agent-bridge/bridge-hardening.test.ts` — every property carries its
positive control. Verified by mutation before merge: removing the HARD_DENY
subtraction leaks a protected op (red); deleting the gate re-opens
full-operational (red); widening the legacy token to `tasks` (red); a read
scope reaching a write (red). Plus end-to-end: `handleToolsCall` on a refused
tool emits a `denied` audit (a protected op is audited as denied, not silently
"unknown"). The dual-protocol test was INVERTED from "MCP retains full
capability" to "MCP exposes no protected op."
