> **Canonical source:** [AGENTS.md § Context routing](../../../AGENTS.md)
> This file is a **cached copy for context injection**. If it disagrees with
> the canonical source, **AGENTS.md wins** — re-run `/discover-standards` to refresh.

# API & Data Contracts

Both web apps share these conventions despite different frameworks.

## tRPC 11 + Zod 4

- Typed client↔server calls go through **tRPC 11** (`@trpc/server`/`@trpc/client`)
  in both `nickstire` and `statenour`.
- **Zod 4** validates at every boundary — inputs, external API responses,
  webhook payloads. Parse, don't assume.
- Plain route handlers are for webhooks, cron, and external callers only.

## Migrations — hand-applied on BOTH sides

| App | Location | Rule |
|---|---|---|
| statenour | `apps/statenour/prisma/**` | Hand-applied. pgvector is **raw SQL only**. `db push --accept-data-loss` silently drops pgvector. |
| nickstire | `apps/nickstire/drizzle/*.sql` | Hand-applied SQL. **No auto-migrate.** Reconcile with `migrations:reconcile` / `migrations:check`. |

Never run a migration or push command on agent initiative. Both are protected
operations requiring an explicit, specific operator instruction.

## Databases

- **statenour** → Neon Postgres. Watch the quota circuit; keep it observable in
  production. Pool connections; expect cold starts.
- **nickstire** → TiDB Cloud (MySQL-compatible, distributed). Expect connection
  limits and eventual metadata. Design idempotent writes.
- **worker** → **no DB client at all.** Every read/write goes over authenticated
  HTTP to statenour-web `/api/cron/*`. Do not add a DB dependency to worker.

## Customer-facing side effects

SMS · voice · email · social/GBP publishing · review replies · ad launches ·
Stripe/refunds · supplier orders.

- Build **preview / draft / copy-only** by default.
- In nickstire the SMS trigger is `activate()`, **not a flag** — setting a flag
  does not make it safe.
- A dry-run flag is not a safety guarantee. One such run deleted 870 rows.

## iOS PWA (both web apps)

`window.confirm` / `alert` / `prompt` are **silently suppressed** in standalone
iOS PWAs. Use in-DOM two-tap confirms; 48×48px minimum touch targets.
