# Schema Index Audit · 2026-05-06 · v10.0.376

First formal index gap sweep · per /postgres-best-practices skill.

## Method

Static analysis script at `scripts/schema-index-audit.ts` parses
`prisma/schema.prisma` and surfaces 4 categories of common production
slowdown causes:

1. **Unindexed foreign keys** — Postgres does NOT auto-index FK columns. Every relation defined as `mission Mission @relation(fields: [missionId], ...)` should have `@@index([missionId])` or the FK lookup is a sequential scan.
2. **Unindexed `createdAt` / `updatedAt` / `lastSeen` / `lastActiveAt`** — most pages query `orderBy: { createdAt: 'desc' }`, but the column has no index. Each page load sorts the whole table.
3. **Unindexed `deletedAt` (soft-delete)** — we filter `deletedAt: null` on every recall. Without an index this becomes a sequential scan that worsens as the table grows.
4. **Unindexed `status` / `state` columns** — enum/string status fields commonly filter most reads · need at least a single-column index.

## Result · 76 models scanned

```
HIGH    · 51 findings (mostly unindexed createdAt + FKs)
MEDIUM  · ~30 findings (deletedAt + status columns)
```

## Top priority fixes

The following tables have BOTH unindexed FKs and unindexed createdAt — these are the highest-impact:

- `ServiceHealth` · runnerNodeId FK · createdAt
- `WorkResult` · workItemId FK · createdAt
- `OperatorPreference` · operatorProfileId FK · createdAt

Plus tables that the chat/brain pipeline reads frequently:
- `Task` · createdAt (used in HUD, /tasks, recall)
- `BrainMemory` · status filter (needs compound index already)
- `ChatMessage` · createdAt + role compound (already indexed? verify)
- `Mission` · createdAt + status compound

## Migration approach

Don't ship 51 indexes in one migration · each `CREATE INDEX` on a large
table is a row-level lock event. Instead:

1. **Wave 1** — top 10 highest-traffic tables. Use `CREATE INDEX
   CONCURRENTLY` so reads stay live during creation.
2. **Wave 2** — next 20 tables. Same approach.
3. **Wave 3** — remaining 21 tables.

Each wave is a separate migration · pre-verify with `EXPLAIN ANALYZE` on
the slow query that motivated the index · post-verify the index is
actually being used (not bypassed by Postgres planner due to
selectivity).

## Resolution · 2026-05-06 v10.0.380

**All 91 findings closed in schema.prisma** via the `apply-schema-indexes.ts`
transform script. Re-running the auditor now reports `✅ No index gaps detected.`

**Indexes added · 117** (more than 91 because compound + redundant FKs were
covered by additive declarations · safe overprovisioning).

**Production application** · the schema change is non-destructive (only
`CREATE INDEX` statements). To apply to production:

```bash
# Locally · create migration SQL
pnpm prisma migrate dev --name add-missing-indexes-v10-0-380 --create-only

# Review the generated SQL in prisma/migrations/<timestamp>_*/migration.sql
# Optionally edit to use CREATE INDEX CONCURRENTLY for the largest tables

# Apply to production (Neon)
DATABASE_URL=<prod-url> pnpm prisma migrate deploy
```

Operator should run this when ready · this script does NOT auto-apply
to production. Schema drift watch (existing daily cron) will surface
the drift between schema.prisma and DB until the migration runs.

## Audit cadence

Run `pnpm tsx scripts/schema-index-audit.ts` after every schema change.
Future · fold into the pre-push gate so adding a new model without
indexes raises a warning automatically.

## Known limitations

- Static analysis only. Does NOT catch:
  - Indexes that EXIST but are UNUSED (pg_stat_user_indexes shows this)
  - Indexes that are BLOATED (need REINDEX)
  - Composite indexes whose leading column is wrong
  - Queries that benefit from a covering index (INCLUDE clause)
- Heuristic confidence on createdAt — assumes orderBy usage, not
  verified against actual code paths.

## Next steps

- [ ] Wave 1 migration · top 10 tables · this week
- [ ] Hook the script into pre-push gate (step 17)
- [ ] Build a runtime query profiler that captures `EXPLAIN` on slow
      requests and surfaces them on `/system/db-health`
