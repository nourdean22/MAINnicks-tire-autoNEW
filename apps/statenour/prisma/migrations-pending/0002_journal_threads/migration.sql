-- Phase D · journal pattern-radar (ADR-0013)
-- 2026-05-18 · parked per WAVE-200-PLAN non-negotiable #1
-- ("No prod DB schema changes without a parked migration first").
--
-- Apply to Neon prod when ready:
--   1. Verify schema.prisma matches (no other drift)
--   2. Open Neon SQL editor (or psql via DATABASE_URL)
--   3. Run the statements below as a single transaction
--   4. Run `prisma generate` locally to refresh client types
--   5. Redeploy statenour-web on Railway
--
-- Rollback is trivial · DROP both tables. Cascade handles memberships.

BEGIN;

-- Threads · operator-named clusters of converging journal entries
-- ADR-0013 + vector-database-engineer audit: centroid cached on the
-- row + memberCount as the rolling-avg denominator · saves an N×M
-- fetch on every capture (scoreEntryAgainstActiveThreads).
CREATE TABLE "journal_threads" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "summary"     TEXT,
  "status"      TEXT NOT NULL DEFAULT 'active',
  "coherence"   DOUBLE PRECISION,
  "detectedAt"  TIMESTAMP(3) NOT NULL,
  "namedAt"     TIMESTAMP(3) NOT NULL,
  "lastJoinAt"  TIMESTAMP(3),
  "centroid"    TEXT,
  "memberCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3)
);

CREATE INDEX "journal_threads_status_idx"     ON "journal_threads" ("status");
CREATE INDEX "journal_threads_lastJoinAt_idx" ON "journal_threads" ("lastJoinAt");
CREATE INDEX "journal_threads_deletedAt_idx"  ON "journal_threads" ("deletedAt");

-- Memberships · polymorphic (entrySource, entryId) into the 4 source tables
CREATE TABLE "journal_thread_memberships" (
  "id"          TEXT PRIMARY KEY,
  "threadId"    TEXT NOT NULL,
  "entrySource" TEXT NOT NULL,
  "entryId"     TEXT NOT NULL,
  "similarity"  DOUBLE PRECISION NOT NULL,
  "joinedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "joinMode"    TEXT NOT NULL,
  CONSTRAINT "journal_thread_memberships_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "journal_threads"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "journal_thread_memberships_unique_idx"
  ON "journal_thread_memberships" ("threadId", "entrySource", "entryId");
CREATE INDEX "journal_thread_memberships_threadId_idx"
  ON "journal_thread_memberships" ("threadId");
CREATE INDEX "journal_thread_memberships_entrySource_entryId_idx"
  ON "journal_thread_memberships" ("entrySource", "entryId");

COMMIT;
