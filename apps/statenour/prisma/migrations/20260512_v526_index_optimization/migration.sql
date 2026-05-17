-- v10.0.526 · Index optimization migration
--
-- Source: docs/audits/db-cost-access-patterns-2026-05-12.md (findings
-- M1-M8 missing-index + D1-D11 dead-index + D7 standalone-cleanup).
--
-- WHY THIS FILE LIVES IN `migrations-pending/` NOT `migrations/`
-- ─────────────────────────────────────────────────────────────────
-- This migration uses `CREATE INDEX CONCURRENTLY` and `DROP INDEX
-- CONCURRENTLY` which cannot run inside a transaction. Prisma
-- Migrate wraps every migration in a transaction by default, so
-- it WILL FAIL on `prisma migrate dev` / `prisma migrate deploy`.
--
-- Apply this manually via direct DB connection:
--   psql $DATABASE_URL -f prisma/migrations-pending/20260512_v526_index_optimization/migration.sql
--
-- OR via the Neon SQL editor in the web console.
--
-- After applying, copy this directory into `prisma/migrations/`
-- + add `migration_lock.toml` marker so future `prisma migrate
-- status` doesn't flag it as missing.
--
-- SAFE TO APPLY DURING OPERATION:
--   CONCURRENTLY operations don't take ACCESS EXCLUSIVE locks ·
--   reads + writes continue against the table during index build.
--   The only risk is the OPERATION itself being interrupted ·
--   in which case it leaves an INVALID index that needs cleanup
--   via DROP INDEX <name>.
--
-- VERIFY FIRST · check pg_stat_user_indexes for any "this is
-- supposed to be dead but is actually used" surprises BEFORE
-- running the DROP statements. The verification block at the
-- bottom emits the data you need.

-- ═══════════════════════════════════════════════════════════════
-- PART 1 · MISSING INDEXES · 8 of 10 (M9, M10 deferred)
-- ═══════════════════════════════════════════════════════════════

-- M2 · chat_messages recent-by-role scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "chat_messages_conv_role_created_idx"
  ON "chat_messages"("conversation_id", "role", "created_at" DESC);

-- M3 · brain_memories source-trust analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "brain_memories_source_created_idx"
  ON "brain_memories"("source", "created_at" DESC);

-- M4 · agent_traces label-by-startedAt drill-down
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "agent_traces_label_started_idx"
  ON "agent_traces"("label", "started_at" DESC);

-- M5 · entity_audits per-entity-type creation scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "entity_audits_type_action_created_idx"
  ON "entity_audits"("entity_type", "action", "created_at" DESC);

-- M6 · chat_messages branch tree walk
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "chat_messages_parent_created_idx"
  ON "chat_messages"("parent_message_id", "created_at" ASC);

-- M7 · brain_bus_events per-topic drain
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "brain_bus_events_topic_status_available_idx"
  ON "brain_bus_events"("topic", "status", "available_at" ASC);

-- M8 · audit_events per-actor-per-event filter
-- v10.0.529 fixup · Prisma model AuditEvent has no @@map, so the
-- Postgres table is PascalCase. Same for the columns. Applied
-- 2026-05-12 via scripts/apply-pending-migration.ts.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "audit_events_event_actor_created_idx"
  ON "AuditEvent"("eventType", "actor", "createdAt" DESC);

-- M9 + M10 DEFERRED:
--   M9 · BrainMemory(category, expiresAt) · skip until category-
--        scoped decay ships (writes hot · don't add eagerly).
--   M10 · BrainMemory(category, key) WHERE deletedAt IS NULL ·
--        partial-unique migration needs memory-manager.ts
--        findUnique callers updated to handle the named constraint
--        change. Schedule together with the schema-sentinel update.

-- ═══════════════════════════════════════════════════════════════
-- PART 2 · DEAD-INDEX DROPS · only the LOW-RISK ones (D5, D6, D7)
-- ═══════════════════════════════════════════════════════════════
-- D1-D4 DEFERRED · need pg_stat_user_indexes evidence first.
-- Run the verify block at the bottom · drop manually if idx_scan=0
-- for >30 days.

-- D5 · vector_embeddings standalone (sourceType) is fully covered
-- by the compound (sourceType, sourceId).
DROP INDEX CONCURRENTLY IF EXISTS "vector_embeddings_sourceType_idx";

-- D6 · vector_embeddings(sourceId) standalone is unused · access
-- always filters by sourceType first.
DROP INDEX CONCURRENTLY IF EXISTS "vector_embeddings_sourceId_idx";

-- D7 · Tables with <1000 rows and unique date · createdAt /
-- updatedAt indexes are write-amplification waste. Conservative
-- list (operator can extend after pg_stat_user_indexes audit):
DROP INDEX CONCURRENTLY IF EXISTS "OperatorProfile_createdAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OperatorProfile_updatedAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OperatorPreference_createdAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OperatorPreference_updatedAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "RunnerNode_createdAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "RunnerNode_updatedAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "SystemSnapshot_createdAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "SystemSnapshot_updatedAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Integration_createdAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Integration_updatedAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "strategic_laws_createdAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "strategic_laws_updatedAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "daily_strategies_createdAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "daily_strategies_updatedAt_idx";

-- ═══════════════════════════════════════════════════════════════
-- DEFERRED (NOT IN THIS MIGRATION):
--
-- · M1 covering INCLUDE swap on vector_embeddings · PG14+ syntax
--   confirmed but the swap-drop sequence needs a 5-second window
--   where the index is missing · run during maintenance.
--
-- · M9, M10 · noted above.
--
-- · D1-D4, D8-D11 · need pg_stat_user_indexes evidence first.
--
-- · Partitioning (entity_audits, audit_events, agent_traces,
--   chat_messages) · separate migration, requires DETACH/MOVE
--   coordination + maintenance window.
--
-- · pgvector HNSW tuning (m, ef_construction) · requires REINDEX
--   CONCURRENTLY which is heavy · separate migration.
--
-- · brain_bus_events retention policy · add to config/retention.ts
--   as code change, not schema migration.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- VERIFY BLOCK · run AFTER the above to confirm + plan next round
-- ═══════════════════════════════════════════════════════════════
-- Copy-paste these queries into psql · they don't modify state.
--
-- SELECT indexrelname, idx_scan, idx_tup_read, pg_size_pretty(pg_relation_size(indexrelid)) AS size
--   FROM pg_stat_user_indexes
--   WHERE schemaname = 'public'
--   ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC
--   LIMIT 50;
--
-- The top of this list (idx_scan=0, large size) are the next
-- drop candidates. The bottom of this list (high idx_scan) are
-- the ones to KEEP.
