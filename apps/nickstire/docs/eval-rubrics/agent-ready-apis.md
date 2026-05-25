# Agent-Ready APIs Framework

**Skill port:** A2 · postman:agent-ready-apis
**Applies to:** every tRPC procedure in `apps/nickstire/server/routers/*` + bridge endpoints in `apps/nickstire/server/_core/bridge-routes.ts` + statenour API routes.
**Authored:** 2026-05-26.

## Why this doc exists

Future agent surfaces (operator asks "show me overdue invoices via voice", a new internal agent needs to query customer state, an MCP server expose nickstire data to Claude Code) all need to discover what the API can do. If every consumer has to hand-wire each endpoint, adding new agents is N×M work.

Agent-ready means · the API self-describes enough that an LLM or a tool generator can call it correctly the first time. No human-in-the-loop required to know which procedure to call, what args it needs, or what shape comes back.

## The 8 pillars of agent-readiness (from the audit's postman:agent-ready-apis spec)

### 1 · Discoverable

Every procedure has metadata accessible at runtime · a list endpoint OR an OpenAPI spec OR a structured manifest. An agent can ask "what procedures exist?" and get a machine-readable answer.

**State:** tRPC v11 has `createCaller` introspection but it's not exposed as an HTTP endpoint. Action · add `/api/_meta/procedures` that returns the procedure list with input/output schemas.

### 2 · Self-describing

Each procedure has a `.meta()` block with:
- `description`: one-paragraph what it does
- `tier`: from autonomous-action-tiers.md
- `caller`: who can use it (admin/operator/voice/internal/public)
- `examples`: 1-3 representative input/output pairs

```typescript
listOverdueInvoices: adminProcedure
  .meta({
    description: "Return invoices past their promised completion date, paid OR unpaid. Used by /admin/today + voice receptionist.",
    tier: "tier-4",  // read-only
    caller: ["admin", "voice", "internal"],
    examples: [
      { input: { daysPast: 7 }, output: { count: 3, invoices: [/* ... */] } }
    ],
  })
  .input(...)
  .query(...)
```

### 3 · Stable input contracts

Zod schemas with explicit `.min()`, `.max()`, `.default()`. No `.optional()` without a documented behavior · `.optional()` should always have a `.transform()` or `.default()` so the handler sees a deterministic shape.

**Action item:** audit found `z.number().optional()` patterns without `.min(0)` (e.g., #114 confirmCheckout amount). Lint rule queued.

### 4 · Stable output contracts

Output is ALSO zod-validated · `.output(z.object({...}))`. The agent can rely on the shape. Bug class to prevent · handler returns slightly different shape under different code paths.

### 5 · Idempotent by default

Mutations that touch real state include an idempotency key in input. Caller retries don't double-write. `placeOrder` already does this · pattern should generalize.

### 6 · Errored cleanly

Every error path returns a structured `TRPCError` with a stable `code` (BAD_REQUEST / NOT_FOUND / FORBIDDEN / INTERNAL_SERVER_ERROR / TIMEOUT / CONFLICT) · NEVER a raw `throw new Error("bad thing")`. The agent can program against the code.

### 7 · Rate-limited transparently

Rate limits surface as `429 + retry-after` · not as silent failure or unexplained "INTERNAL_SERVER_ERROR." The tool-use-guardian wrapper (A1) emits these.

### 8 · Versioned

Breaking changes get a v2 route OR a deprecation header. Agents shipped against v1 keep working until v1 is removed (with notice). Statenour `runMigrations` tRPC is the model · same shape, different implementations land via the inlined SQL approach.

## Per-router compliance audit

| Router | Pillar 1 | Pillar 2 | Pillar 3 | Pillar 4 | Pillar 5 | Pillar 6 | Pillar 7 | Pillar 8 |
|---|---|---|---|---|---|---|---|---|
| `gatewayTire` | partial | none | yes | partial | yes (placeOrder) | yes | no | none |
| `voiceAgent` | partial | none | yes | partial | partial | yes | partial | none |
| `bookings` | partial | none | partial | partial | no | partial | no | none |
| `customers` | partial | none | partial | partial | no | partial | no | none |
| `referrals` | partial | none | yes | partial | partial (Wave N) | partial | no | none |
| `intelligence` | partial | partial | yes | yes | yes | yes | no | partial |

Most routers are ~3 of 8 pillars compliant. The path forward · add `.meta()` to each procedure first (Pillar 2), then add output schemas (Pillar 4), then add the discovery endpoint (Pillar 1).

## Anti-patterns

### "Comments instead of meta"

JSDoc comments are for humans. Agents need machine-readable `.meta()` blocks. Comments don't help an LLM choose the right procedure.

### "Implicit caller"

Every procedure should declare WHO can call it (admin / public / voice / internal). Right now this is encoded in the procedure type (`adminProcedure` vs `publicProcedure`) · expand into `.meta({ caller: [...] })` for finer control.

### "Output shape drift"

The same procedure returning `{ data: [...] }` in one branch and `{ items: [...] }` in another. Add `.output()` zod validation · fails the build if the handler returns a non-matching shape.

### "Error message as flow control"

`if (err.message.includes("not found"))` is brittle · agents can't program against it. Use `err.code === "NOT_FOUND"` · stable, machine-checkable.

## Implementation plan (queued)

1. Define a project `TRPCMeta` type that requires `description`, `tier`, `caller`, optionally `examples`
2. Add `.meta()` to the 6 highest-traffic procedures (`gatewayTire.publicSearch`, `gatewayTire.placeOrder`, `voiceAgent.bookSlot`, `voiceAgent.tireInquiry`, `customers.list`, `invoices.list`)
3. Build `/api/_meta/procedures` route that walks the tRPC router tree and emits the meta JSON
4. Wire it to a future Claude MCP server · agent-side discovery becomes one fetch
5. Add lint rule that fails CI if a new procedure ships without `.meta()`

## Skill-port lineage

A2 from the audit's Round 2. Pairs with:
- A1 · tool-use-guardian (the protective wrapper around procedures the agent calls)
- A4 · agent-tool-builder + mcp-builder (the design framework for NEW tools)
- Wave R · voice-agent eval rubric (calls the agent-ready procedures)

Future · combined with A4 and A1, the trio is a full agent-API contract: discover (A2) → design (A4) → invoke safely (A1) → score (Wave R).
