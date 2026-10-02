# Perplexity Enterprise -> StateNour MCP activation

**Date:** 2026-10-02
**Owner:** Nour
**Surface:** StateNour / bdnick.info
**Endpoint:** `https://bdnick.info/api/mcp`

## Purpose

Use Perplexity Enterprise as an operator-triggered external research workstation while StateNour remains the private system of record. This path does **not** depend on the Perplexity API credential or Perplexity API billing. Perplexity connects to StateNour as a remote MCP client.

```text
Perplexity Enterprise
        |
        | custom remote MCP
        v
https://bdnick.info/api/mcp
        |
        +-- StateNour read tools
        +-- save_research_report
        +-- propose_research_action
```

## Security contract

A dedicated production secret named `AGENT_BRIDGE_TOKEN_PERPLEXITY` authenticates this client. The value is never committed, logged, or stored in this document.

The token resolves to:

- `clientId = perplexity-enterprise`
- `scope = research`

The research scope is intentionally separate from both existing `read` and `tasks` clients.

It may:

- use the curated StateNour read surface;
- save a completed external research report;
- save a bounded research action proposal.

It may **not**:

- create or complete Tasks;
- send Telegram or customer messages;
- publish social content;
- execute code or device commands;
- run autonomous browser actions;
- invoke any HARD_DENY tool.

All normal bridge audit logging and origin validation still apply.

## Research return channel

### `save_research_report`

Persists a finished Perplexity research artifact as `BrainMemory(category=research_pack)` with:

- `source=perplexity-enterprise:mcp`
- `createdBy=perplexity-enterprise`
- `trustTier=EXTERNAL_CONTENT`
- citations, findings, recommendations, question, research timestamp, and confidence in metadata
- deterministic/deduplicated update semantics

External content is therefore not promoted into operator truth or system-derived memory.

### `propose_research_action`

Persists a proposal as `BrainMemory(category=research_action)` with `status=proposed`.

It explicitly returns `executed=false`. It does not create a Task or execute the recommendation.

## Connector compatibility

The bridge accepts the existing canonical Bearer form and also `x-api-key` / `api-key` headers through the exact same constant-time token-to-scope resolver.

Exact hosted web origins added:

- `perplexity.ai`
- `www.perplexity.ai`

No wildcard origin is allowed.

## MCP schema repair discovered during this activation

StateNour's adapter still looked for the legacy AI SDK `parameters` property even though current tools are declared with `inputSchema`.

That meant modern tools could be advertised to MCP clients with an empty `{}` schema and their bridge-side Zod validation could be skipped.

The adapter now resolves:

```ts
tool.inputSchema ?? tool.parameters
```

for both JSON Schema advertisement and execution validation. The legacy fallback remains for compatibility.

## Verification receipts

Local dedicated worktree:

`C:\Users\nourd\Documents\Codex\perplexity-mcp-20261002`

Branch:

`statenour/perplexity-enterprise-mcp-20261002`

Targeted tests:

- `tests/agent-bridge/perplexity-enterprise-mcp.test.ts`
- `tests/agent-bridge/bridge-hardening.test.ts`
- `tests/agent-bridge/mcp-origin-validation.test.ts`
- `tests/ai/tool-catalog.test.ts`

Result: **44/44 passed**.

Additional gates:

- targeted ESLint: **PASS**
- StateNour raw TypeScript check: **PASS**
- secret scan: **PASS, 0 findings**
- `git diff --check`: **PASS**

## Perplexity operator instruction

Use this instruction in the Perplexity research workspace/Space that has the StateNour connector enabled:

> You are the external research arm of NOUR OS. Use Perplexity web research for current external reality and the StateNour MCP connector for Nour's internal operating reality. Never guess internal facts. Inspect relevant StateNour context, research current external evidence, reconcile contradictions, cite primary sources, separate fact from inference, identify what materially changed, and recommend only actions supported by evidence. Save substantive finished research with `save_research_report`. Use `propose_research_action` only for recommendations worth Nour reviewing. Never treat a proposal as approved or executed.

## Activation ledger

| Layer | Status |
|---|---|
| Dedicated research scope | BUILT + TESTED |
| Dedicated auth identity | BUILT + TESTED |
| Perplexity exact origins | BUILT + TESTED |
| MCP JSON Schema compatibility repair | BUILT + TESTED |
| Save research report | BUILT + TESTED |
| Propose research action | BUILT + TESTED |
| Secret excluded from repo | VERIFIED |
| Production secret configured | CONFIGURED (deploy intentionally skipped until code merge) |
| Main merge | PENDING |
| Railway production deployment | PENDING |
| Production MCP canary | PENDING |
| Perplexity website connector | USER UI LAST MILE |
