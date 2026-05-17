# v10.0.526 · Index optimization migration · APPLIED 2026-05-12 (v10.0.529.1)

## Application record

- **Applied:** 2026-05-12 via `pnpm tsx scripts/apply-pending-migration.ts`
  against prod Neon (`ep-quiet-wave-am320eo1-pooler`).
- **Result:** 22 of 23 statements OK on first pass · 1 fixup (M8 ·
  the original spec referenced `audit_events` snake_case but the
  Prisma model `AuditEvent` has no `@@map` so the prod table is
  PascalCase) · M8 re-run successful after the SQL was patched ·
  0 net failures.
- **Resolved:** `prisma migrate resolve --applied 20260512_v526_index_optimization`
  recorded in `_prisma_migrations` so `prisma migrate deploy` won't
  re-run this file (CONCURRENTLY would fail under Prisma's transaction
  wrapper · see "Why this lives outside the auto-deploy path" below).

## Why this lives outside the auto-deploy path

`CREATE INDEX CONCURRENTLY` + `DROP INDEX CONCURRENTLY` cannot run
inside a transaction. Prisma Migrate wraps every migration in a
transaction. So `prisma migrate dev` / `prisma migrate deploy` will
fail on this file. The directory was moved into `prisma/migrations/`
AFTER manual application + `prisma migrate resolve --applied`.

## Apply path (for future re-runs in another env)

### Option A · psql against Neon

```bash
psql $DATABASE_URL -f prisma/migrations-pending/20260512_v526_index_optimization/migration.sql
```

You'll see ~20 statements run. Each takes 5-200ms on the current
table sizes. Total wall-clock: under 30 seconds.

### Option B · Neon web SQL editor

1. Open https://console.neon.tech → your project → SQL Editor
2. Paste the contents of `migration.sql`
3. Run

## After applying

1. Run the VERIFY block at the bottom of `migration.sql` to confirm
   index health + plan the next drop round.
2. Move this directory into `prisma/migrations/` so Prisma sees
   it as applied:
   ```bash
   mv prisma/migrations-pending/20260512_v526_index_optimization \
      prisma/migrations/
   ```
3. Run `prisma migrate status` to confirm clean state.

## What this migration does

**Adds (8 missing indexes)** · expected gain: 5-200ms per call
across multiple chat + cron hot paths:

| # | Index | Where it helps |
|---|---|---|
| M2 | `chat_messages_conv_role_created_idx` | system-prompt build · 3 callers |
| M3 | `brain_memories_source_created_idx` | wisdom-source analytics |
| M4 | `agent_traces_label_started_idx` | /system/agent-traces drill-down |
| M5 | `entity_audits_type_action_created_idx` | creation-spike-detect cron |
| M6 | `chat_messages_parent_created_idx` | branch UI tree walk |
| M7 | `brain_bus_events_topic_status_available_idx` | per-topic drain |
| M8 | `audit_events_event_actor_created_idx` | per-actor filtered queries |

**Drops (16 dead/redundant indexes)** · expected savings: 5-10 MB
storage + 5-10% faster INSERT on the affected tables:

- `vector_embeddings_sourceType_idx` (D5) · fully covered by compound
- `vector_embeddings_sourceId_idx` (D6) · unused access pattern
- 14× `(createdAt)` + `(updatedAt)` standalones on tiny tables (D7):
  - OperatorProfile · OperatorPreference · RunnerNode
  - SystemSnapshot · Integration · strategic_laws · daily_strategies

## What this migration does NOT do (deferred)

- **Partitioning** of entity_audits / audit_events / agent_traces ·
  needs DETACH/MOVE coordination + maintenance window. Separate
  migration when ready.
- **M1 covering INCLUDE** swap on vector_embeddings · needs a
  5-second window where the index is missing. Maintenance window.
- **M9, M10** · BrainMemory category-scoped indexes need
  memory-manager.ts callers updated first.
- **D1-D4, D8-D11** · need `pg_stat_user_indexes` evidence first.
  Run the VERIFY block at the bottom of `migration.sql` after this
  one applies · the top of the result is the next drop round.
- **pgvector HNSW tuning** (m, ef_construction) · requires
  `REINDEX CONCURRENTLY` which is heavy. Separate migration.
- **brain_bus_events retention policy** · add to
  `config/retention.ts` as a code change · not a schema migration.

## Rollback

If any single statement fails partway through, the others already
applied are safe to keep. Re-run the file · `IF NOT EXISTS` +
`IF EXISTS` make every statement idempotent.

For a full rollback (unlikely needed since drops are non-destructive
to data):

```sql
-- Re-add the dropped indexes (only if measurably needed):
CREATE INDEX CONCURRENTLY "vector_embeddings_sourceType_idx"
  ON "vector_embeddings"("sourceType");
-- etc · see migration.sql for full list of dropped indexes
```
