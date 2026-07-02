# StateNour Command MCP Bridge

This implements StateNour’s external command port through MCP. The goal is not to build a second AI brain. The goal is to expose StateNour’s existing intelligence, tools, memory, tasks, system state, and business bridge to ChatGPT through a controlled, audited, high-leverage MCP surface.

The first version is read-dominant, but the architecture is designed for aggressive operator control: inspect live state, recommend the move, create tasks, set MITs, capture thoughts, run diagnostics, and eventually execute approved workflows.

## Core Principle

Do not duplicate StateNour logic.

MCP is only a facade.

`ChatGPT → MCP bridge → existing StateNour tools/services → Prisma/BrainMemory/Tasks/Nick’s Tire bridge`

The canonical source remains StateNour. MCP only exposes selected capabilities.

## Permission Model

### Tier 1 — Read-Only Spyglass
Enabled in v1.

Allowed:
* `getTasks`
* `getMissions`
* `getCommitments`
* `getTodaySchedule`
* `getFinancialSnapshot`
* `getDriftAlerts`
* `getDecisionsDueForReplay`
* `searchDocuments`
* `searchMemories`
* `findRelatedConversations`
* `toolHealth`
* `getCronStatus`
* `getShopSnapshot`
* `getMarketingAttribution`
* `getEstimateLeaks`
* `getAttentionAlerts`

Rules:
* No mutation.
* No external messages.
* No device commands.
* No browser automation.
* No generated images.
* No customer communication.
* No code execution.
* No raw secrets returned.
* Every call is audited.

### Tier 2 — Safe Operator Writes
Not enabled until Tier 1 is stable.

Rules:
* Writes must be reversible or low-risk.
* Each write must create an audit row.
* Each write must return a before/after summary.
* Destructive changes require explicit confirmation.

### Tier 3 — Controlled Execution
Disabled in v1. Enable only after approval queue exists.

Rules:
* Tool quota required.
* Explicit operator approval required.
* High-cost and external tools must show estimated impact before execution.
* No silent background execution.

### Tier 4 — Dangerous / Forbidden by Default
Do not expose until there is a full command approval system.

Forbidden:
* `runDeviceCommand`
* delete/archive tools
* raw SQL
* deployment commands
* payment actions
* customer SMS/email
* GitHub write/commit/PR tools
* browser automation with logged-in sessions
* anything that can spend money, contact people, unlock/lock devices, modify production, or destroy data

## Authentication Posture

Use two layers.

### Dev / local tunnel
Use:
`Authorization: Bearer ${MCP_SECRET_TOKEN}`
This is acceptable for ngrok/local testing.

### Production
Use:
1. `MCP_SECRET_TOKEN`
2. scoped token metadata
3. request audit
4. rate limit
5. IP / origin logging where possible
6. rotation plan
7. kill switch

Environment variables:
```txt
MCP_ENABLED=false
MCP_SECRET_TOKEN=
MCP_ALLOWED_TOOLS=
MCP_WRITE_MODE=off
MCP_REQUIRE_CONFIRMATION=true
```

`MCP_ENABLED=false` by default. Production must opt in.

## Deployment / Test Instructions

### Local Testing

```bash
cd C:\Users\nourd\NOURCITY\.worktrees\mcp-bridge\apps\statenour

set MCP_ENABLED=true
set MCP_SECRET_TOKEN=dev-secret
pnpm dev
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:3000/api/mcp --transport http
```

### Public Tunnel

Use the public tunnel only after local inspector succeeds:

```bash
ngrok http 3000
```

Connector URL in ChatGPT:
```txt
https://<ngrok-subdomain>.ngrok.app/api/mcp
```
