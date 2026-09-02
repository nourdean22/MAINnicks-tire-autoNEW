-- 20260902000000_restore_idempotency_partials
--
-- Restores six indexes the live database is missing. Reported by the schema
-- sentinel on /system/health (2026-09-02): five HIGH findings plus one MEDIUM.
--
-- ════════════════════════════════════════════════════════════════════════
-- WHAT IS MISSING, AND HOW THAT WAS ESTABLISHED
-- ════════════════════════════════════════════════════════════════════════
--
-- lib/db/schema-sentinel.ts checkPartialUnique() queries pg_indexes by exact
-- (schemaname='public', tablename, indexname). All five findings come from
-- its `rows.length === 0` branch, so the index rows are absent — this is not
-- predicate drift, and it never reached the predicate comparison.
--
-- The names are not the failure. Every one of these models carries the right
-- @@map (scheduled_actions, task_events, goal_events, reflections,
-- decision_replays), so the sentinel is querying the tables that exist. That
-- matters because this file's own repo has been bitten by the opposite case —
-- schema-sentinel.ts carries a note that Mission and Task have NO @@map — and
-- a name mismatch would have made these findings false positives.
--
-- The built-in control: autonomous_actions_idempotency_key_uniq and
-- entity_audits_idempotency_key_uniq use the IDENTICAL expectation shape
-- (kind partial_unique, same predicate string) and do NOT appear in the
-- findings. Same checker, same query, same predicate — two pass, five fail.
-- The checker is working.
--
-- Origin: 20260429190000_universal_idempotency created all six partial uniques
-- in one file, adjacent statements, identical form. Five later went away while
-- one survived. Prisma cannot express a partial unique in @@unique — the
-- AutonomousAction model says exactly that in a comment — so none of these are
-- known to Prisma, and an index Prisma does not know about is an index
-- `prisma db push` will drop. That is failure mode #1 in the sentinel's own
-- header, and it is why the sentinel exists. The GIN index has the same shape:
-- 20260429170000_chat_message_batch_a created chat_messages_searchable_tsv_idx
-- in raw SQL, unmodellable, unguarded until the 2026-08-19 coverage audit.
--
-- ════════════════════════════════════════════════════════════════════════
-- READ THIS BEFORE APPLYING — the unique creates CAN fail, and that is fine
-- ════════════════════════════════════════════════════════════════════════
--
-- These indexes have been absent for some time, and their absence is exactly
-- what lets a re-run insert a duplicate instead of colliding. So duplicate
-- non-null idempotency_key values may already exist, and
-- CREATE UNIQUE INDEX will then fail with:
--
--     could not create unique index "<name>"
--     DETAIL: Key (idempotency_key)=(...) is duplicated.
--
-- That failure is SAFE: no rows are read, written or deleted, and the apply
-- route stops at the failing statement and returns it. Nothing is half-done.
--
-- If it happens, run this READ-ONLY preflight to see the damage before
-- deciding anything (substitute the table):
--
--     SELECT idempotency_key, COUNT(*) AS copies
--     FROM scheduled_actions
--     WHERE idempotency_key IS NOT NULL
--     GROUP BY idempotency_key HAVING COUNT(*) > 1
--     ORDER BY copies DESC LIMIT 50;
--
-- Deduplicating is a DELETE against real operator data and is deliberately
-- NOT in this file. Which copy survives is a judgement call about which
-- reflection, task event or decision replay is the real one — that is the
-- operator's decision, not a migration's.
--
-- ════════════════════════════════════════════════════════════════════════
-- SAFETY
-- ════════════════════════════════════════════════════════════════════════
--
-- Every statement is additive and idempotent (IF NOT EXISTS). No DROP, no
-- DELETE, no TRUNCATE, no ALTER. Re-running is a no-op.
-- tests/security/prod-migration-registry-safety.test.ts asserts that of every
-- statement in the apply route's registry, not just these.
--
-- Plain CREATE INDEX, not CONCURRENTLY, matching every other entry in that
-- registry (0 uses of CONCURRENTLY today). Each takes a brief lock on one
-- table. CONCURRENTLY cannot run inside a transaction and leaves an INVALID
-- index behind on failure, which is a worse trade for a single-operator app
-- than a short lock.
--
-- APPLY: registered in app/api/system/apply-pending-migration/route.ts.
-- Deploy, then from an authenticated app tab:
--   fetch('/api/system/apply-pending-migration',{method:'POST',
--     headers:{'Content-Type':'application/json'},
--     body:JSON.stringify({name:'20260902000000_restore_idempotency_partials'}),
--     credentials:'include'}).then(r=>r.json()).then(console.log)
-- Then confirm on /system/health that the six findings are gone, promote this
-- SQL into prisma/migrations/<name>/ and run
-- `prisma migrate resolve --applied <name>` so migrate status stays green.
-- ════════════════════════════════════════════════════════════════════════

-- 1. scheduled_actions
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_actions_idempotency_key_uniq"
  ON "scheduled_actions"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 2. task_events
CREATE UNIQUE INDEX IF NOT EXISTS "task_events_idempotency_key_uniq"
  ON "task_events"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 3. goal_events
CREATE UNIQUE INDEX IF NOT EXISTS "goal_events_idempotency_key_uniq"
  ON "goal_events"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 4. reflections
CREATE UNIQUE INDEX IF NOT EXISTS "reflections_idempotency_key_uniq"
  ON "reflections"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 5. decision_replays
CREATE UNIQUE INDEX IF NOT EXISTS "decision_replays_idempotency_key_uniq"
  ON "decision_replays"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 6. chat_messages FTS — the GIN serving searchable_tsv. Same name the
--    original 20260429170000_chat_message_batch_a created, so a later reader
--    comparing the two files sees one index, not two.
CREATE INDEX IF NOT EXISTS "chat_messages_searchable_tsv_idx"
  ON "chat_messages" USING GIN ("searchable_tsv");
