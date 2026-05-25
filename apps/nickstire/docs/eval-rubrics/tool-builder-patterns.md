# Tool + MCP Builder Patterns

**Skill port:** A4 · agent-tool-builder + mcp-builder
**Applies to:** new VAPI tools, new statenour Mastra tools, future custom MCP server for Nick's Tire (operator-facing AI surface).
**Authored:** 2026-05-26.

## Why this doc exists

Adding a new tool to the VAPI assistant OR designing a custom MCP server for cross-app data needs explicit design discipline. Tools designed by feel produce subtle bugs (#107 convertedToLead race · #285 silent tool-discard · half-fired confirmations) · tools designed by framework produce reliable behavior.

## The 6-question tool design contract

Every new tool answers these BEFORE any code is written:

### 1 · What's the IMPERATIVE name?

Tools are verbs · `bookSlot`, `tireInquiry`, `escalate`, `sendConfirmationSms`. NOT nouns. NOT questions. NOT adjectives.

Test · can you write "the assistant will `<name>`(...)" and have it grammatically sensible? If not, rename.

### 2 · What's the SMALLEST input that fully specifies the action?

Each input field justifies its existence. Fewer fields = fewer ways the LLM can mis-fill them.

For `bookSlot`, the minimal input is `{ name, phone, service }`. The optional fields (`vehicle`, `preferredDay`, `callId`) all have clear reasons. If a field's reason is "we MIGHT need it someday" · remove it.

### 3 · What's the EXACT output shape · including failure?

Both happy + sad paths return a structured object. The LLM can program against the shape.

```typescript
// Good:
{ success: boolean, reference?: string, error?: string }

// Bad:
string  // success?
null    // error?
throw   // forces LLM into an exception handler it doesn't have
```

### 4 · What's the IDEMPOTENCY contract?

If the LLM calls this tool twice with the same args, what happens?
- DB-write tools · idempotency key in args · second call returns the same `reference` as first (no double-write)
- Read tools · same input = same output (cache-eligible)
- Side-effect tools (SMS) · idempotency key + dedup window · second call within window returns "already sent" without re-sending

This is the contract that prevents the #107 race · double-fire wasn't a tool BUG, it was missing IDEMPOTENCY DESIGN.

### 5 · What's the LATENCY budget?

Voice tools · <500ms p95 (caller hears the agent thinking otherwise). Chat tools · <2s p95. Background tools · <30s p95.

If your tool can't hit the budget, split into a fast read-only check + a fire-and-forget queue write. `bookSlot` returns immediately with a `reference` · the actual confirmation SMS fires async.

### 6 · What's the AUDIT shape?

Per tool-use-guardian.md · what fields get logged BEFORE execute? What fields get logged AFTER?

PII-scrubbed by default · `phone-last-4` not `phone`. `customerName: c.firstName?.slice(0, 1)` not the full name.

## MCP server design (Nick's-Tire MCP, queued)

A custom MCP server exposing nickstire data to Claude Code would unlock:
- Operator asks Claude "what's our brake-job conversion rate this week?" without leaving Claude Code
- Cross-session memory of recent operator decisions (statenour brain talks to Nick's MCP)
- Future agents (improve-agent, agentic-auditor) can query real data instead of seeing stale exports

### 4 MCP design questions

#### Q1 · What CAPABILITIES does the MCP expose?

Capability ≠ endpoint · capability is what the LLM caller CAN DO. Examples:
- `query-customer` (search by phone, name, vehicle)
- `query-revenue` (by day, week, month, service-type)
- `query-bookings` (open, completed, overdue)
- `query-leads` (new, in-progress, lost)
- `flag-customer` (mark at-risk, mark VIP)

Per-capability spec → MCP tool definition.

#### Q2 · What RESOURCES does it serve?

Resources are read-only URIs the LLM can fetch. Examples:
- `nicks://customer/<id>` · customer profile
- `nicks://invoice/<id>` · invoice detail
- `nicks://schema/customers` · table shape (for the LLM to understand structure)

Resources for read-context · capabilities for actions. Different intents · different surfaces.

#### Q3 · What's the AUTH model?

MCP can run as:
- Local (only the operator's machine can connect) · simplest
- Remote (any authed Claude session can connect) · needs OAuth or API key

Recommend · start LOCAL · upgrade later if multi-device need emerges.

#### Q4 · How does it COMPOSE with the existing tRPC?

The MCP doesn't reimplement nickstire's logic · it wraps the existing tRPC procedures (which are already getting `.meta()` per A2). MCP capability `query-customer` = a thin shim that calls `customers.list` + reshapes output.

The agent-ready-apis work (A2) is the precondition for clean MCP composition. Build that first, build MCP second.

## Anti-patterns

### "Tool soup"

A new tool that does multiple things (e.g., `bookSlotAndSendConfirmation`). Split · one tool per action · let the LLM compose.

### "Side-effect read tools"

A `getCustomer(id)` tool that incidentally writes a "viewed" timestamp. Reads stay reads. If you need view tracking, expose a separate `markViewed(id)` capability.

### "Magic defaults"

`bookSlot({ phone: "5551234" })` quietly inferring service="oil change" from caller history. The LLM can't reason about magic. Make defaults EXPLICIT · `service: z.string().default("walk-in-check")` · the default IS the contract.

### "Skipping the design questions"

The 6 questions take 15 minutes per tool to answer. Skipping them means debugging the same class of bug later, repeatedly. Per memory, #107 + #285 are the same class · "I designed it by feel" lands silent failures.

## Skill-port lineage

A4 from the audit's Round 2. Companion to:
- A1 · tool-use-guardian (the runtime wrapper for tools designed this way)
- A2 · agent-ready-apis (the discovery contract for tools designed this way)
- Wave R · voice-agent eval rubric (the post-execution scoring of tool calls)
- Wave V · autonomous-action tiers (each tool's tier classification)

Together · A1 + A2 + A4 + Wave R + Wave V = full tool lifecycle from design through execution through evaluation.

Future · build the actual Nick's MCP server after A2 (.meta() audit) completes. ~2 weeks of work, would unlock cross-app AI surface that doesn't exist today.
