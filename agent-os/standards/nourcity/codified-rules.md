> **Canonical source:** the `check:*` / `lint:*` scripts themselves
> This file is a **cached copy for context injection**. If it disagrees with
> the canonical source, **the source wins** — re-run `/discover-standards` to refresh.

# Codified Rules

Each `check:*` / `lint:*` script is a rule codified after production broke. Read
the script header before working around a failure. Never disable a gate; never
weaken one to make a test pass.

## Raw SQL must name the real column

`check:raw-sql` (statenour) · `lint:sql` (nickstire)

- Postgres lowercases unquoted identifiers. MySQL only complains at runtime.
- `tsc` cannot see inside a template string; the ORM hides the mismatch for
  query-builder calls only.
- nickstire mixes conventions **per table** — `cron_log` and
  `social_content_inventory` snake_case; `bookings`, `invoices`,
  `ig_autopost_log` camelCase.

```ts
// BAD — real column is createdAt, no @map
await prisma.$queryRaw`SELECT created_at FROM task`;        // 42703
await db.execute(sql`SELECT c.first_name FROM customers c`);

// GOOD — match the real column, or quote it
await prisma.$queryRaw`SELECT "createdAt" FROM task`;
await db.execute(sql`SELECT c.firstName FROM customers c`);
```

Receipt: 3 prod defects in one day — `#1125` A/B arm empty for months, `#1131`
forecast reported `completed` and never produced a forecast, seo-forensic. Each
threw, was swallowed by a catch, and recorded success.

## Filter deletedAt on every aggregate

`check:soft-delete` — the contract is opt-**in** per query, so omission is invisible.

```ts
// BAD
await prisma.task.count();
// GOOD
await prisma.task.count({ where: { deletedAt: null } });   // or activeOnly()
```

- Narrow by design: `count` / `groupBy` / `aggregate` only. `findMany` /
  `findFirst` carry the same hazard and are **not** yet swept.

Receipt (2026-07-16): 109 of 150 call sites had forgotten. `/api/health` reported
161 tasks / 52 INBOX; truth was 57 / 0.

## Auth is per handler, never per file

`check:get-auth` · `check:mutations`

```ts
// BAD — a file-level grep for requireSession passes on this file
export async function GET() { return prisma.conversation.findUnique(...); }
export async function PATCH(req) { await requireSession(req); /* ... */ }
```

- Verify the specific handler body — in review, not just in CI.
- `check:mutations` claims two axes mechanically: **auth** (procedure builder —
  `operatorProcedure` gated, `publicProcedure` open) and **audit** (durable trail
  written). It does *not* claim idempotency or undo coverage.

Receipt: `/api/ai/chat/[id]/route.ts` shipped an unauthed GET exactly this way;
fixed v10.0.183.

## Every cron needs an AutomationPolicy row

`check:policy-coverage` — every active/folded cron in `config/crons.ts` needs a
matching row, or new automations ship unaudited.

- Soft (warn) by default · `POLICY_GATE_HARD=1` fails closed · `POLICY_GATE_SOFT=1` demotes.
- Tools, slash actions and webhooks aren't enumerable from one file — they are
  covered by feature tests calling `findMissingPolicies`.

## Prompt-injection rules

`check:prompt-injection` — any code piping user input into an LLM.

| ID | Rule |
|---|---|
| PI-001 | No template-string user content in `aiChat()` message content |
| PI-002 | `requireSession` on routes under `/api/nick/*` and `/api/operator/*` |
| PI-003 | `checkBudget` on a new POST under `/api/nick/*` reaching the reasoning engine |
| PI-004 | No `dangerouslySetInnerHTML` in an operator surface |
| PI-005 | No `console.log` of `req.body` or session details |

```ts
// BAD — PI-001, user text becomes instruction
await aiChat({ messages: [{ role: "user", content: `Summarize: ${userText}` }] });
// GOOD — user text stays data
await aiChat({ messages: [{ role: "user", content: userText }] });
```

Suppress a genuine false positive with an allow comment; do not delete the rule.

## No PII in logs or prompts

`lint:pii` — phone (full or last-10 normalized), email, full customer name, VIN,
street address, card number, SSN/TaxID, driver's licence.

```ts
// BAD
logger.info(`lead ${customer.firstName} ${customer.phone}`);
// GOOD
logger.info("lead created", { leadId });
```

Receipt: `#102` firstName in Railway logs · `#128` raw PII in venice prompt sizes
· `#223` logger scrubbing gap.

## No AI-slop UI defaults

`check:anti-slop` — fails on **any** new occurrence under `app/` or `components/`:

- Inter font (`next/font/google` Inter, `"Inter"`, googleapis Inter)
- Purple-on-white SaaS gradients (`from-purple-` / `to-purple-`)
- Roboto / Arial system-font imports

Baseline to match or beat: the link-review editorial spread (DFII 15). Emergency
override only: `ANTI_SLOP_GATE_SOFT=1`.

## No dialog globals in client code

`lint:source` — `client/src` must not call `alert()` / `confirm()` / `prompt()`.

- Both web apps run as installed iOS PWAs where all three are **silently
  suppressed** — the operator sees nothing.
- Use sonner toasts and in-DOM two-tap confirms (`FollowUpButton.tsx`,
  `ConfirmDialog.tsx`).

Receipt: the SMS approval screen shipped an `alert()` flow and gave zero feedback
on the operator's phone.

Same script: `server/` must not call `console.log` / `.warn` / `.error` — use
`createLogger()`. `.info` and `.debug` are allowed.

## No hooks after an early return

`lint:hooks`

```tsx
// BAD — "Rendered more hooks than during the previous render"
if (isLoading) return <Spinner />;
const x = useMemo(() => compute(data), [data]);
```

- Detection is by indent: statements at the component body's first indent are
  top-level; deeper ones live inside callbacks and are fine.

Receipt: Wave-73, `OverviewSection`.

## Route registry parity

`validate:routes` (nickstire)

1. Every `<Route path="...">` in `client/src/App.tsx` exists in
   `shared/routes.ts` — dynamic `:param` routes exempt.
2. Entries with `prerender: true` need a non-empty title **and** description.
3. Title <= 60 chars · description <= 160 chars.

The prerender pipeline sniffs bot user-agents. A route missing from the registry
serves bots a blank shell — a silent SEO regression.

## Soft reports — tracked, not enforced

`lint:source` also counts `: any` / `as any`, TODO/FIXME, raw SQL in routers, and
client `as` casts on tRPC data. Take the last seriously: an `as` cast invents a
shape the server never returns, and the compiler agrees all the way to the
runtime crash.
