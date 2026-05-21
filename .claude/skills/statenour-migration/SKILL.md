---
name: statenour-migration
description: Use when changing the statenour Prisma schema (apps/statenour/prisma/schema.prisma) — migrations are hand-applied and one wrong flag silently drops pgvector data.
---

# statenour-migration

statenour's Prisma migrations are NOT auto-applied. A schema change
needs a deliberate, prod-verified apply.

## Hard rules

- **NEVER `prisma db push --accept-data-loss`** — and never put that
  flag in a `package.json` script or CI. pgvector
  (`vector_embeddings.embedding_vec*`) and the `chat_messages`
  tsvector generated column live partly outside Prisma's model view;
  `--accept-data-loss` silently drops them. A pre-push gate guards
  against this — don't defeat it. Recovery is
  `scripts/recover-pgvector-*.ts`.
- **`prisma migrate status` against prod Neon is the source of truth** —
  not "I ran release:db". Local success messaging can lie when the prod
  DB is unreachable or auth fails silently (the v10.0.473 incident).

## Workflow

1. Edit `prisma/schema.prisma`.
2. Generate the migration SQL; park it under `prisma/migrations-pending/`
   if prod connectivity isn't confirmed yet.
3. Apply with `scripts/apply-pending-migration.ts` — it uses an
   autocommit pg driver, required for `CREATE INDEX CONCURRENTLY`
   (which cannot run inside Prisma's implicit transaction wrap).
4. Record it: `prisma migrate resolve --applied <name>`.
5. Confirm: `prisma migrate status` shows clean.
6. `pnpm typecheck` — the generated client changed.

## When NOT to use

nickstire migrations — different conventions (hand-applied SQL in
`apps/nickstire/drizzle/NNNN_*.sql`, no Prisma).
