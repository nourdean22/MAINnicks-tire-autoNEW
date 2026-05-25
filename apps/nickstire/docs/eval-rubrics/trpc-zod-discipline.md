# tRPC + Zod Validation Discipline

**Skill port:** B8 · trpc-fullstack + zod-validation-expert + tanstack-query-expert
**Applies to:** every tRPC procedure across `apps/nickstire/server/routers/*` and statenour API routes that use zod.
**Authored:** 2026-05-26.

## Why this doc exists

Audit findings #114 (confirmCheckout missing phone validation), #229 (period type-asserted not validated), and dozens of `z.number().optional()` without `.min(0)` are the same class of bug · validation gaps that ship without catching.

This doc codifies the rules. Pre-commit lint rule queued.

## The 6 zod rules (PR-blocking discipline)

### Rule 1 · No `.optional()` without `.default()` OR `.transform()`

A field that may be undefined needs an explicit handler. The procedure's handler should NEVER have to write `input.foo ?? "default"` · zod does it.

**Bad:**
```typescript
input: z.object({ phone: z.string().optional() })
// handler: input.phone ?? "" 
```

**Good:**
```typescript
input: z.object({ phone: z.string().default("") })
```

### Rule 2 · Numbers always have `.min()` + `.max()` AT MINIMUM

Unconstrained numbers are how `pricePerTireCents: 100` ships as $1. Wave B fixed placeOrder · audit found this pattern elsewhere.

**Bad:**
```typescript
amount: z.number()
```

**Good:**
```typescript
amount: z.number().int().min(50).max(10_000_000)  // $0.50 to $100k in cents
```

If you can't say a min and max, the field needs design work, not just zod.

### Rule 3 · Strings always have `.max()` AT MINIMUM

Unbounded strings are how user input becomes 100MB request bodies. Always cap.

**Bad:**
```typescript
notes: z.string().optional()
```

**Good:**
```typescript
notes: z.string().max(2000).default("")
```

### Rule 4 · Enums + zod, not free-string

Any field with a known set of valid values uses `z.enum()` · NEVER a free string the handler later validates.

**Bad:**
```typescript
status: z.string()
// handler: if (input.status === "paid" || input.status === "pending") ...
```

**Good:**
```typescript
status: z.enum(["paid", "pending", "partial", "refunded"])
```

### Rule 5 · Output schemas on read procedures

Every `.query()` declares `.output(z.object({...}))`. Catches shape drift where one branch returns `{ data: [...] }` and another returns `{ items: [...] }`. Surfaces in CI before customers see it.

**Bad:**
```typescript
list: publicProcedure
  .query(async () => {
    return getCustomers();  // What shape? Who knows?
  })
```

**Good:**
```typescript
list: publicProcedure
  .output(z.object({
    customers: z.array(customerSchema),
    total: z.number().int().min(0),
  }))
  .query(async () => { ... })
```

### Rule 6 · Idempotency key on mutations that write

Any mutation that creates real-world side effects (DB row, SMS, payment) takes an idempotency key in input. The handler dedups within a 5-minute window.

```typescript
.input(z.object({
  ...,
  idempotencyKey: z.string().uuid(),  // client supplies UUID
}))
.mutation(async ({ input }) => {
  const existing = await checkIdempotent(input.idempotencyKey);
  if (existing) return existing.result;
  ...
})
```

`placeOrder` does this · `confirmCheckout` does this · most other mutations don't. Audit each.

## TanStack Query patterns (the client side)

### Rule 7 · Stale time matches the procedure's data velocity

Don't use default 0ms stale-time everywhere. Per-query, declare:

- **Real-time** (calls, voice, live revenue) · `staleTime: 0`
- **Operator-session** (LeadsBrief, customers list) · `staleTime: 30 * 1000`
- **Slowly changing** (settings, brand voice config) · `staleTime: 5 * 60 * 1000`
- **Effectively static** (service catalog, business hours) · `staleTime: 60 * 60 * 1000`

Wrong stale-time = thousands of unnecessary refetches/day · cost (TiDB queries) AND UX (loading flickers).

### Rule 8 · Mutation success ALWAYS invalidates ≥1 query

Every successful mutation invalidates the queries that show its data. Wrong invalidation = stale UI state after operator action.

```typescript
const placeOrder = trpc.gatewayTire.placeOrder.useMutation({
  onSuccess: () => {
    utils.gatewayTire.listOrders.invalidate();
    utils.intelligence.dashboardStats.invalidate();
  },
});
```

### Rule 9 · Optimistic updates on UI-critical mutations

For mutations where the UI delay would be noticed (toggle a switch, mark a task done), wire optimistic updates · the UI updates immediately, rolls back on error.

```typescript
const toggleTaskDone = trpc.tasks.toggleDone.useMutation({
  onMutate: async ({ id }) => {
    await utils.tasks.list.cancel();
    const prev = utils.tasks.list.getData();
    utils.tasks.list.setData(undefined, (old) =>
      old?.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
    return { prev };
  },
  onError: (_, __, ctx) => utils.tasks.list.setData(undefined, ctx?.prev),
  onSettled: () => utils.tasks.list.invalidate(),
});
```

## Anti-patterns

### "Type-assert from any"

```typescript
const period = req.query.period as "day" | "week";  // assertion · not validation
```

This is the #229 audit finding shape. ANY external input goes through zod. Assertions hide bugs · validations expose them.

### "Validation in handler"

```typescript
.input(z.object({ id: z.string() }))
.mutation(async ({ input }) => {
  if (input.id.length < 5) throw new Error("invalid");
})
```

Validation belongs in the schema, not the handler. `z.string().min(5)` is the line.

### "Same schema duplicated"

A `customerSchema` defined inline 6 times across 6 procedures · they drift. Pull shared schemas into `apps/nickstire/server/lib/schemas.ts` · import everywhere.

### "Output validation skipped to ship faster"

`.output()` IS the contract the agent (per Wave X A2) and the client both rely on. Skipping it for speed costs more in debugging than it saves in commits.

## Implementation plan (queued)

1. Create `apps/nickstire/server/lib/schemas.ts` with the canonical schemas (customer, invoice, booking, tireOrder, leadingShared)
2. Audit each router · add `.output()` to all queries
3. Audit each mutation · add idempotency key where missing
4. Audit each `z.number()` / `z.string()` · add min/max
5. Lint rule · refuse PRs that introduce `.optional()` without `.default()` or `.transform()`
6. Audit tanstack-query staleTime · set per-query intent

## Skill-port lineage

B8 from the audit's Round 2. Companion to:
- Wave X · A2 agent-ready-apis (the discoverability contract that depends on this)
- Wave X · A1 tool-use-guardian (the runtime wrapper that depends on these schemas)
- Wave Q + T + U · the lint discipline pattern · this becomes a code-level lint rule

Future · auto-generate API docs from the zod schemas via `tRPC-OpenAPI` · powers the MCP server (A4) and any third-party integration.
