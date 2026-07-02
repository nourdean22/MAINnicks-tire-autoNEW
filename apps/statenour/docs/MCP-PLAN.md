# MCP-PLAN — StateNour Command bridge (external control port)

**Status:** Phase 1 shipped (read-only spyglash) · **Wave:** `mcp · StateNour Command read-only bridge`
**Endpoint:** `POST /api/mcp` (MCP Streamable HTTP · JSON-RPC 2.0 · stateless)
**Owner:** Nour (single-operator system — this is a private operator API, not a public app)

---

## 1 · What this is (and is not)

StateNour already owns the truth: Prisma/Neon state, BrainMemory, tasks, missions,
commitments, and the nickstire bridge. External AI clients (ChatGPT via the Apps
SDK / connectors, Claude, any MCP client) should **inspect** that truth through a
thin facade — never through a duplicate brain.

```
ChatGPT / Claude / MCP client
  ↓
StateNour MCP facade            app/api/mcp/route.ts
  ↓
Existing tool registry          lib/ai/tools (nourTools) + lib/ai/tools/catalog.ts
  ↓
Prisma / Neon / BrainMemory / Tasks / nickstire bridge
```

**Non-goals:** a second MCP server with its own business logic; auto-exposing all
143+ nourTools; any UI. The catalog (`lib/ai/tools/catalog.ts`) stays the single
authoritative tool index — MCP *consumes* it, it never forks it.

The precedent inside this repo is `lib/ai/reasoning/reasoning-tools.ts`: a strict
read-only whitelist over nourTools. `lib/mcp/` follows the identical pattern, one
layer further out.

## 2 · Permission tiers

| Tier | Meaning | Status |
|------|---------|--------|
| **0 — disabled** | `MCP_ACCESS_TOKEN` unset → endpoint answers 503 for every call. Default posture. | live |
| **1 — read-only** | The hard-coded allowlist in `lib/mcp/tool-allowlist.ts` (12 tools, below). Every entry must be `battle: true` and NOT `sideEffecting` in the catalog — tests enforce it. | **live (v1)** |
| **2 — safe writes** | `captureThought`-style append-only writes: `createTask` (draft), `setMit`, `journalDecision`, `pinMemory`, `logSituation`. Each call audited; no irreversible effects. | not built |
| **3 — controlled external actions** | `createQuickQuote`, `sendTelegram`, `generateImage`. Requires per-call confirmation UX on the client + audit. | not built |
| **4 — forbidden until manual review** | `runDeviceCommand`, any delete/archive, deploys, customer comms, payment/CRM mutations, `triggerInstagramAutopost`, `setInstagramAutopostConfig`, `syncDriveMemory`, `syncKnowledge`, `githubCreateIssue`, `githubCreatePR`, `stageCustomerAlert`, `resolveContradiction`, `moneyprinter`, browser tools. | never auto-exposed |

Tier promotion is a code change (edit allowlist + tests + this doc), never a
runtime toggle. `tests/mcp/tool-allowlist.test.ts` fails the suite if a
side-effecting or non-battle-safe tool appears in the v1 allowlist.

## 3 · v1 exposed tools (Tier 1)

MCP names are `snake_case` of the nourTools key. Ring tags enforce the
personal/business boundary (see §5).

| MCP name | nourTools key | Ring | Why |
|---|---|---|---|
| `get_tasks` | `getTasks` | personal | live task state |
| `get_missions` | `getMissions` | personal | mission/project state |
| `get_commitments` | `getCommitments` | personal | promises + deadlines |
| `get_today_schedule` | `getTodaySchedule` | personal | calendar for "what now" |
| `get_drift_alerts` | `getDriftAlerts` | personal | drift/risk surface |
| `get_decision_replays` | `getDecisionReplays` | personal | decision journal reads |
| `get_financial_snapshot` | `getFinancialSnapshot` | personal | money state |
| `get_brain_health` | `getBrainHealth` | personal | memory-system health |
| `search_documents` | `searchDocuments` | personal | doc Q&A (embedding knn) |
| `search_memories` | `searchMemories` | personal | BrainMemory recall |
| `get_shop_snapshot` | `getShopSnapshot` | business | live shop summary (bridge) |
| `get_marketing_attribution` | `getMarketingAttribution` | business | what's converting (bridge) |

All 12 are `battle: true`, non-side-effecting, `cost: free|cheap` in the catalog.
Business-ring tools return **summarized snapshots only** — they already go through
the nickstire bridge's summarization; raw customer PII stays on the business ring.

## 4 · Auth + audit rules

- **Auth:** `Authorization: Bearer <MCP_ACCESS_TOKEN>` (or `x-mcp-token`).
  Constant-time compare (`node:crypto.timingSafeEqual`). Token unset → **503
  fail-closed** (Tier 0). Wrong/missing token → 401. Implemented in
  `lib/mcp/auth.ts`, deliberately self-contained (does not import
  `lib/auth-guard.ts` because vitest globally mocks that module).
- **Why not session auth:** ChatGPT's connector cannot hold a NextAuth Google
  session. A dedicated bearer secret is revocable independently of everything
  else (rotate by changing the env var on Railway).
- **Audit:** every request (auth failures included) and every tool call goes
  through `lib/mcp/audit.ts` → structured logger surface `mcp` (event name,
  tool, ok, ms, actor `mcp:external`). Tool-call errors are returned as MCP
  `isError` results, never as leaked stack traces.
- **No mutation path exists in v1.** `tools/call` can only reach allowlisted
  read handlers; unknown names get JSON-RPC `-32602`.

## 5 · Two-ring boundary

StateNour = personal ring. nickstire = business ring. The MCP facade tags every
tool with its ring and keeps them separate tools — there is no combined
"mega-state" tool, so raw personal journal text and customer data can never be
returned in one payload. Customer lookup (`findCustomer`) stays unexposed until
Tier 3 review.

## 6 · Protocol notes

- Transport: **Streamable HTTP**, stateless. `POST /api/mcp` with a single
  JSON-RPC message; responses are `application/json`. `GET` (SSE stream) and
  `DELETE` (session teardown) return 405 — this server holds no session state.
- Supported protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05`
  (client's version echoed when supported; otherwise latest).
- JSON-RPC batching is rejected (`-32600`) — removed in 2025-06-18.
- `tools/list` derives each tool's JSON Schema from the zod `inputSchema` via
  zod v4's native `z.toJSONSchema` (fallback: permissive object schema).
  Read-only tools carry `annotations.readOnlyHint: true`.

## 7 · Dev + connect flow

```bash
# 1 · set the secret (32+ random bytes)
echo "MCP_ACCESS_TOKEN=$(openssl rand -hex 32)" >> apps/statenour/.env.local

# 2 · run the app
pnpm dev   # Next dev server → http://localhost:3000/api/mcp

# 3 · inspect
npx @modelcontextprotocol/inspector@latest \
  --server-url http://localhost:3000/api/mcp --transport http
#    (add header Authorization: Bearer <token> in the inspector UI)

# 4 · tunnel for ChatGPT
ngrok http 3000
# ChatGPT → Settings → Apps/Connectors → Create → https://<tunnel>/api/mcp
```

Production: the same route lives at `https://bdnick.info/api/mcp` once
`MCP_ACCESS_TOKEN` is set on Railway. ChatGPT developer mode / full MCP apps
require a Business/Enterprise workspace per OpenAI's current availability notes —
the endpoint itself is client-agnostic (Claude, MCP Inspector, scripts all work).

## 8 · First victory (definition of done for the wave)

> From ChatGPT: “What is my current operating state?”
> → MCP returns live tasks, commitments, schedule, drift alerts, shop snapshot.
> → ChatGPT answers with one grounded next move instead of guessing.

## 9 · Phase roadmap

1. ✅ **Read-only spyglass** — this document's Tier 1 (12 tools).
2. **Adapter hardening** — structured `structuredContent` per tool, pagination.
3. ✅ (day one) **Owner auth + audit** — token + fail-closed + audit log.
4. **Three safe writes** — `capture_thought` (append-only inbox), `create_task_draft`, `set_mit`. Requires DB-backed audit entries first.
5. **Command mode** — a `get_operating_state` composite prompt/resource that fans into the Tier 1 reads.
6. **Ring guardrails** — already structural (separate tools, no mega-tool); revisit before Tier 3.
7. **Deployment** — ngrok dev loop → Railway prod with rotated token.
