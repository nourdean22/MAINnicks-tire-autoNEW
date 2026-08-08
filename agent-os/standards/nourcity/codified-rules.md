# Codified Rules

Every gate in `enforced-gates.md` exists because something broke in production.
This file is the *why* — the rule plus the receipt that bought it. A gate is not
style preference; it is an incident that already happened once.

When a gate fires, read the script header before arguing with it. Never disable
a gate to unblock yourself, and never weaken one to make a test pass.

## Data access

### Raw SQL must name the column the database actually has

Both apps ship a linter for this because it is the single most expensive bug
class in the repo.

- **statenour** (`check:raw-sql`) — Postgres lowercases unquoted identifiers, so
  `created_at` in a `$queryRaw` against a Prisma field `createdAt` with no
  `@map` fails with `42703: column "created_at" does not exist`.
- **nickstire** (`lint:sql`) — the database mixes conventions **per table**:
  `cron_log` and `social_content_inventory` are snake_case; `bookings`,
  `invoices` and `ig_autopost_log` are camelCase. Drizzle hides the difference
  for query-builder calls, but raw `` sql`...` `` templates are unchecked
  strings — `tsc` cannot see inside them and MySQL only complains at runtime.

**Receipt:** three independent production defects in a single day, all this
shape — cross-sell outreach (`#1125`, the A/B treatment arm had been empty for
*months*), monte-carlo forecast (`#1131`, the job reported `completed` on every
run and had **never** produced a forecast), and seo-forensic. Each failed
silently: the query threw, a catch swallowed it, the job recorded success.
Nothing was observable from the outside.

### Soft-delete is opt-in — filter it on every aggregate

`check:soft-delete`. Every `count` / `groupBy` / `aggregate` on a soft-delete
model must filter `deletedAt` (or use `activeOnly()`). The contract in
`lib/db/soft-delete.ts` is opt-**in** per query, so omission is invisible.

**Receipt (2026-07-16):** 109 of 150 aggregate call sites had forgotten — a 73%
failure rate, which is a property of the contract, not of the authors. Live prod
at the sweep: `Task` 104 of 161 rows soft-deleted (64.6%), `BrainMemory` 6,319
of 17,926 (35.3%). `/api/health` reported 161 tasks / 52 INBOX when the truth was
57 / 0 — the operator's entire inbox backlog was fictional, and drift-engine
alerts were firing on deleted rows.

**Scope is deliberately narrow.** `findMany` / `findFirst` carry the same hazard
but there are hundreds and most already filter. This guard holds the line on the
numbers only.

## Auth

### Auth is verified per handler, never per file

`check:get-auth` and `check:mutations` both scope the auth signal to a single
handler **body**. This is not pedantry.

**Receipt:** the predecessor gate did a file-level `grep requireSession`. In
`/api/ai/chat/[id]/route.ts` the `PATCH` handler was guarded and the `GET` beside
it was not — the grep matched the PATCH, the gate passed, and the unauthed GET
shipped. Fixed in v10.0.183 by lexically scanning each handler's body.

**This applies to review, not just CI.** Never conclude a route is guarded from a
whole-file grep — locate the specific handler.

`check:mutations` re-derives an executable census of all mutation entry points
(195 tRPC mutations, 157 route files with mutating verbs) on every run, claiming
exactly two axes mechanically: **auth** (the procedure builder at the call site —
`operatorProcedure` gated, `publicProcedure` open) and **audit** (whether the
module writes a durable trail). It deliberately does *not* claim idempotency or
undo coverage — don't read those in.

### Every cron needs an AutomationPolicy row

`check:policy-coverage`. Every active or folded cron in `config/crons.ts` must
have a matching `AutomationPolicy` row. This is the rule that stops new
automations slipping in unaudited.

Soft (warn-only) by default; `POLICY_GATE_HARD=1` fails closed,
`POLICY_GATE_SOFT=1` demotes after ratchet. Tools, slash actions, autonomous
actions and webhooks aren't enumerable from a single source-of-truth file, so
they're covered by feature-specific tests calling `findMissingPolicies`.

## AI surfaces

`check:prompt-injection` enforces five rules on code that pipes user input into
an LLM:

| ID | Rule |
|---|---|
| PI-001 | No template-string user content in `aiChat()` message content — the classic injection vector |
| PI-002 | `requireSession` required on routes under `/api/nick/*` and `/api/operator/*` |
| PI-003 | `checkBudget` required on a new POST under `/api/nick/*` that reaches the reasoning engine |
| PI-004 | No `dangerouslySetInnerHTML` in any operator surface |
| PI-005 | No `console.log` of `req.body` or session details — logs leak |

Suppress a genuine false positive with an allow comment; do not delete the rule.

## Privacy

### PII must not reach logs or prompts

`lint:pii` (nickstire). PII means phone numbers (full or last-10 normalized),
email addresses, full customer names, VINs, street addresses, payment card
numbers, SSN/TaxID, and driver's licence numbers.

**Receipt:** audit findings `#102` (firstName in Railway logs), `#128` (venice
prompt sizes carrying raw PII), `#223` (logger PII-scrubbing gap). The gate
exists to stop the next ten of the same class.

## UI

### No AI-slop defaults

`check:anti-slop` fails the push on **any** new occurrence under `app/` or
`components/`: the Inter font, purple-on-white SaaS gradients
(`from-purple-` / `to-purple-`), and Roboto/Arial system-font imports. These are
the AI defaults every generated template reaches for.

Baseline to match or exceed is the link-review editorial spread (DFII 15).
Emergency override only: `ANTI_SLOP_GATE_SOFT=1`.

### No browser dialog globals in client code

`lint:source` — `client/src` must not call `alert()`, `confirm()` or `prompt()`.

**Receipt:** both web apps run as installed iOS PWAs, where all three are
**silently suppressed**. The SMS approval screen shipped an `alert()`-based flow
and gave the operator zero feedback on their phone. Use sonner toasts and in-DOM
two-tap confirms — see `FollowUpButton.tsx` / `ConfirmDialog.tsx`.

### No console logging in server code

`lint:source` — `server/` must not call `console.log` / `.warn` / `.error`; use
`createLogger()`. `console.info` and `console.debug` are allowed.

### No hooks after an early return

`lint:hooks`. A top-level early return followed by a hook at the same indent
level crashes React with "Rendered more hooks than during the previous render".

**Receipt:** Wave-73 caught exactly this in `OverviewSection`. The Wave-76
rewrite detects it by indent matching — statements at the component body's first
indent level are top-level; deeper ones are inside callbacks and are fine.

## SEO

### Route registry parity

`validate:routes` (nickstire):

1. Every `<Route path="...">` in `client/src/App.tsx` must exist in
   `shared/routes.ts` — unless it is a dynamic `:param` route.
2. Every `shared/routes.ts` entry with `prerender: true` needs a non-empty title
   and description.
3. Titles <= 60 chars, descriptions <= 160 chars.

**Why:** the prerender pipeline sniffs bot user-agents and serves pre-rendered
HTML. A route added to `App.tsx` but missing from the registry means bots get a
blank shell — a silent SEO regression.

## Soft reports — tracked, not enforced

`lint:source` also counts `: any` / `as any` usage, TODO/FIXME markers, raw SQL
in routers, and client-side `as` casts on tRPC data. These warn without failing.

Treat the cast counter seriously despite being soft: an `as` cast on tRPC data
invents a shape the server never returns, and the compiler will agree with you
all the way to the runtime crash.
