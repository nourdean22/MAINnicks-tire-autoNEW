# Pending migrations · awaiting production DB access

Migrations parked here are NOT in the live `prisma/migrations/`
directory · `prisma migrate deploy` will not apply them. Move
them back when ready.

> **Preferred path — no prod creds needed (use this).** Apply via the guarded
> endpoint `POST /api/system/apply-pending-migration { name }`. It runs an
> idempotent (IF NOT EXISTS) copy of the migration's statements from inside the
> deployed app — which has the prod `DATABASE_URL`. It deliberately does NOT
> write `_prisma_migrations` (2026-07-29: hand-inserted rows for names with no
> `prisma/migrations/<name>/` dir turned `prisma migrate status` red — see
> docs/STATENOUR-OBSERVABILITY-TRUTH-ARC.2026-07-29.cgd.md). After applying,
> promote the SQL into `prisma/migrations/<name>/` and run
> `prisma migrate resolve --applied <name>` so status stays green.
> Steps: add the SQL to that route's `MIGRATIONS`
> registry → deploy → from the authed app tab run
> `fetch('/api/system/apply-pending-migration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'<name>'}),credentials:'include'})`.
> The dev/agent env has NO prod creds and there is NO statenour Vercel project,
> so the `vercel env pull` route below is usually a dead end.

## How to apply a parked migration (legacy / with-creds path)

1. Confirm DATABASE_URL points at production (Neon)
   ```bash
   echo $DATABASE_URL  # should NOT be localhost:5432
   # If it is, pull prod env first:
   vercel env pull .env.production.local
   # OR run from a Vercel deployment shell that has prod env vars
   ```

2. Move the migration back into the live folder
   ```bash
   mv prisma/migrations-pending/<NAME> prisma/migrations/<NAME>
   ```

3. Apply the migration
   ```bash
   pnpm release:db   # = prisma migrate deploy
   ```

4. Restore the schema fields that the migration adds (the rollback
   commit removed them so the live code matches the un-migrated
   prod DB · with the migration applied, the fields can come back
   in)

5. Verify
   ```bash
   pnpm prisma migrate status   # shows migration as applied
   ```

6. Commit + push the schema-restore + the migration move

## Parked migrations

### `20260806120000_drop_duplicate_indexes` — ✅ APPLIED 2026-08-06 (directly, one transaction)

Dropped 42 duplicate indexes across 24 tables (~18.7 MB). Indexes only — no data touched.

Cause: `scripts/emit-index-migration.ts` built index NAMES from Prisma FIELD names while building
index BODIES from `@map`'d COLUMN names, so `CREATE INDEX IF NOT EXISTS "Mission_deletedAt_idx"`
never matched the existing `Mission_deleted_at_idx` and created a byte-identical twin instead of
no-opping. Generator fixed at the source in the same PR (#1409), so re-running it is now genuinely
idempotent and will not recreate them.

Applied as a single transaction against the production branch (project `statenour`,
`spring-art-47050555`) rather than via the endpoint — every statement is `DROP INDEX IF EXISTS`,
so it is idempotent and safe to re-run.

**Verified after applying**, both checks in this directory's `migration.sql` header:
- the duplicate-pair query returns **0 rows** (was 42)
- all **42 surviving twins** confirmed present by name

**Rollback**: `rollback.sql` in this directory holds the exact `pg_indexes.indexdef` for all 42,
captured immediately before the drop. Those definitions also document why the drop is plan-neutral:
every one was a plain btree over the same column list as its twin — no UNIQUE, no partial
predicate, no expression or differing opclass.

Left in this folder on purpose, same as `0003_ambition_engine` below: it is already applied, and
moving it into `prisma/migrations/` could trip migrate-deploy ordering. `_prisma_migrations` was
deliberately NOT hand-written (see the header note at the top of this file about that turning
`prisma migrate status` red).


### `20260722120000_experiment_factory` — ✅ APPLIED 2026-07-22 (COLUMN-FIRST, via `apply.mjs`)

Closed-loop Experiment factory: new `experiments` table (1:1 with an accepted `opportunity_logs` row, FK to `intelligence_sources`) + nullable columns `opportunity_logs.source_id`, `intelligence_sources.auth_score_updated_at` / `auth_score_samples`. Additive, idempotent, pgvector-verified untouched. **COLUMN-FIRST**: applied to prod Neon BEFORE the schema-bearing deploy (the two `ADD COLUMN`s touch hot tables the regenerated Prisma client SELECTs — deploying first would 500 every read until apply). Applied via the DO-`$$`-aware `apply.mjs` in the migration dir (`railway run … node apply.mjs`), NOT the legacy `;`-split script. Also mirrored in the `apply-pending-migration` route's `MIGRATIONS` map (idempotent re-apply path).

### `20260625000000_action_receipts_and_completion_criteria` — ✅ APPLIED 2026-06-26 (via script)

Patience XP ledger and auto-closer migration (adds `completionCriteria` column to `Mission` table and `action_receipts` table for logging). Applied directly to Neon database and registered in `apply-pending-migration` route's `MIGRATIONS` map.

### `20260618000000_consolidated_models` — ⏳ REGISTERED, awaiting apply (PR #217)

The NOUR OS consolidation (#206) added 10 Prisma models — `ContentNode`,
`Contact`, `Booking`, `Agreement`, `Product`, `Order`, `FinancialTransaction`,
`InvestmentHolding`, `ShortLink`, `LinkClick` — backing `/crm` `/wealth`
`/finance` `/links`. Their idempotent DDL (`CREATE TABLE IF NOT EXISTS` +
indexes + FKs) is registered in the `apply-pending-migration` route's
`MIGRATIONS` map under key `20260618000000_consolidated_models` (PR #217).

**Registered ≠ applied.** To apply to prod, from the authed app tab run:
```js
fetch('/api/system/apply-pending-migration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'20260618000000_consolidated_models'}),credentials:'include'})
```
then confirm with `prisma migrate status`. DDL is idempotent — safe to re-run.
DDL ↔ `schema.prisma` parity verified for all 10 tables (column names/types,
nullability, defaults, `@unique`, indexes, FK `onDelete`).

### `0003_ambition_engine` — ✅ APPLIED 2026-05-30 (via endpoint)

Ambition Engine P1 (the `/stats` goals redesign · 8 additive `life_goals`
columns + a `goal_stats` join table + a self-relation). Applied to production
Neon on 2026-05-30 through the guarded endpoint described above, recorded in
`_prisma_migrations` as `0003_ambition_engine`; the schema fields were restored
+ shipped in `e285e9dc`. Left in this folder on purpose (see the header note in
`0003_ambition_engine/migration.sql`) — moving it into `prisma/migrations/`
could trip migrate-deploy ordering. Drift-safe: the apply is already recorded
and `migrate deploy` only touches the live folder.

### `20260508001336_add_updated_at_to_8_mutable_models`

Originally shipped at v10.0.462. The deploy sequence assumed
`pnpm release:db` had been run against production before the code
was pushed · in fact the local DATABASE_URL pointed at a
non-running localhost:5432, so the migration never reached
production Neon. Production tables (`brain_dumps`, `mission_links`,
`WorkResult`, `mastery_scores`, `body_tracking`, `financial_snapshots`,
`contradictions`, `vector_embeddings`) didn't get the `updated_at`
column, but the deployed Prisma client expected it · every CRUD on
those tables failed at runtime with "column does not exist" until
v10.0.473 rolled the schema back.

When restoring this migration · the schema additions are:

```prisma
// MissionLink, MasteryScore, BodyTracking, FinancialSnapshot,
// BrainDump, Contradiction · @map("updated_at") column name
updatedAt DateTime @updatedAt @map("updated_at")

// WorkResult, VectorEmbedding · default PascalCase column "updatedAt"
updatedAt DateTime @updatedAt
```

The audit trail for which models needed this is in the v10.0.462
commit body (HEAD~10 from this README · `git log --grep "v10.0.462"`).

The 8 confirmed-mutable models came out of a code-explorer agent
audit at v10.0.462 (1 already-tracked-via-editedAt: ChatMessage ·
2 immutable-zero-update-sites: CommandResolution · ToolVerbRatio).
