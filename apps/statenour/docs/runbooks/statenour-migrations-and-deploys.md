# Runbook · Migrations + deploys

- **Status:** active · **Domain:** database · **Risk:** high · **Last verified:** 2026-06-09
- **When to use:** any schema change, migration, or deploy question.
- **Source of truth:** [`../DB-MIGRATION-POLICY.md`](../DB-MIGRATION-POLICY.md), [`../../lib/db/schema-sentinel.ts`](../../lib/db/schema-sentinel.ts), [`../CURRENT-TRUTH.md`](../CURRENT-TRUTH.md).

## Rules

1. **Column-first.** Add columns before any code reads them. Never ship code that reads a column the migration hasn't safely added.
2. **Dry run + rollback first.** Have a verified rollback before any destructive move (DATABASE-ARCHITECT lens: backups before destructive moves).
3. **No prod claim unless applied + verified.** Only claim a migration is applied to prod when it ran via the guarded `apply-pending-migration` endpoint **and** `prisma migrate status` confirms it. "I ran release:db" is not proof.
4. **Never `--accept-data-loss`.** It silently drops pgvector/tsvector columns that live outside Prisma's view.
5. **Deploy = push to `main` → Railway.** No Vercel, no manual dashboard step (Vercel is retired).

## Commands

```
pnpm exec prisma validate
pnpm check:raw-sql                       # audits camelCase columns in $queryRaw (does NOT scan for --accept-data-loss; the flag ban is policy)
pnpm tsx scripts/run-schema-sentinel.ts  # expectations should be green
```

## Gotchas

- pgvector / tsvector columns are declared `Unsupported(...)` so Prisma sees them; a `db push` without the guard still drops them.

## Verification

- `prisma migrate status` shows the migration applied; schema sentinel green.

## Rollback

- Restore from the pre-migration backup; pgvector recovery scripts exist (`scripts/recover-pgvector-*`).
