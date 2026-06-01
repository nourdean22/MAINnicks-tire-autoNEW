-- 2026-06-01 · Journal Brain · Phase 0 foundation migration
-- Spec: docs/journal-brain-redesign.md
--
-- ADDITIVE · idempotent (IF NOT EXISTS on cols/indexes/table; FK ADD
-- CONSTRAINT re-run warns "already exists" — non-fatal in the apply script).
-- No data movement. Promotes journal classification + grounding/scoring
-- columns onto the 4 journal silos and adds the single-row JournalSettings.
--
-- NO BEGIN/COMMIT and NO `DO $$` blocks — scripts/apply-pending-migration.ts
-- splits on `;` and runs each statement autocommit/best-effort.
--
-- HOW TO APPLY (prod Neon)
--   set -a && . ./.env.local && set +a
--   pnpm tsx scripts/apply-pending-migration.ts \
--     prisma/migrations/20260601_journal_brain_foundation/migration.sql
--   pnpm exec prisma migrate resolve --applied 20260601_journal_brain_foundation
--   pnpm exec prisma migrate status   # must show clean
--
-- ROLLBACK
--   DROP TABLE IF EXISTS journal_settings;
--   ALTER TABLE "brain_dumps"     DROP COLUMN IF EXISTS "entry_type", DROP COLUMN IF EXISTS "goal_id", DROP COLUMN IF EXISTS "mission_id", DROP COLUMN IF EXISTS "link_confidence", DROP COLUMN IF EXISTS "link_status", DROP COLUMN IF EXISTS "enriched_at";
--   ALTER TABLE "reflections"     DROP COLUMN IF EXISTS "goal_id", DROP COLUMN IF EXISTS "mission_id", DROP COLUMN IF EXISTS "link_confidence", DROP COLUMN IF EXISTS "link_status", DROP COLUMN IF EXISTS "enriched_at";
--   ALTER TABLE "situation_logs"  DROP COLUMN IF EXISTS "goal_id", DROP COLUMN IF EXISTS "mission_id", DROP COLUMN IF EXISTS "link_confidence", DROP COLUMN IF EXISTS "link_status", DROP COLUMN IF EXISTS "enriched_at";
--   ALTER TABLE "decision_replays" DROP COLUMN IF EXISTS "goal_id", DROP COLUMN IF EXISTS "mission_id", DROP COLUMN IF EXISTS "link_confidence", DROP COLUMN IF EXISTS "link_status", DROP COLUMN IF EXISTS "enriched_at";

-- ── Columns ────────────────────────────────────────────────────────────────
ALTER TABLE "brain_dumps"
  ADD COLUMN IF NOT EXISTS "entry_type"      TEXT,
  ADD COLUMN IF NOT EXISTS "goal_id"         TEXT,
  ADD COLUMN IF NOT EXISTS "mission_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "link_confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "link_status"     TEXT,
  ADD COLUMN IF NOT EXISTS "enriched_at"     TIMESTAMP(3);

ALTER TABLE "reflections"
  ADD COLUMN IF NOT EXISTS "goal_id"         TEXT,
  ADD COLUMN IF NOT EXISTS "mission_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "link_confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "link_status"     TEXT,
  ADD COLUMN IF NOT EXISTS "enriched_at"     TIMESTAMP(3);

ALTER TABLE "situation_logs"
  ADD COLUMN IF NOT EXISTS "goal_id"         TEXT,
  ADD COLUMN IF NOT EXISTS "mission_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "link_confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "link_status"     TEXT,
  ADD COLUMN IF NOT EXISTS "enriched_at"     TIMESTAMP(3);

ALTER TABLE "decision_replays"
  ADD COLUMN IF NOT EXISTS "goal_id"         TEXT,
  ADD COLUMN IF NOT EXISTS "mission_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "link_confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "link_status"     TEXT,
  ADD COLUMN IF NOT EXISTS "enriched_at"     TIMESTAMP(3);

-- ── Foreign keys (SetNull · matches Prisma onDelete: SetNull) ────────────────
ALTER TABLE "brain_dumps"      ADD CONSTRAINT "brain_dumps_goal_id_fkey"        FOREIGN KEY ("goal_id")    REFERENCES "life_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "brain_dumps"      ADD CONSTRAINT "brain_dumps_mission_id_fkey"     FOREIGN KEY ("mission_id") REFERENCES "Mission"("id")     ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reflections"      ADD CONSTRAINT "reflections_goal_id_fkey"        FOREIGN KEY ("goal_id")    REFERENCES "life_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reflections"      ADD CONSTRAINT "reflections_mission_id_fkey"     FOREIGN KEY ("mission_id") REFERENCES "Mission"("id")     ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "situation_logs"   ADD CONSTRAINT "situation_logs_goal_id_fkey"     FOREIGN KEY ("goal_id")    REFERENCES "life_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "situation_logs"   ADD CONSTRAINT "situation_logs_mission_id_fkey"  FOREIGN KEY ("mission_id") REFERENCES "Mission"("id")     ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "decision_replays" ADD CONSTRAINT "decision_replays_goal_id_fkey"   FOREIGN KEY ("goal_id")    REFERENCES "life_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "decision_replays" ADD CONSTRAINT "decision_replays_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "Mission"("id")    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Indexes (queryable feed filter + enriched_at cron re-sweep target) ───────
CREATE INDEX IF NOT EXISTS "brain_dumps_entry_type_idx"      ON "brain_dumps" ("entry_type");
CREATE INDEX IF NOT EXISTS "brain_dumps_goal_id_idx"         ON "brain_dumps" ("goal_id");
CREATE INDEX IF NOT EXISTS "brain_dumps_enriched_at_idx"     ON "brain_dumps" ("enriched_at");
CREATE INDEX IF NOT EXISTS "reflections_goal_id_idx"         ON "reflections" ("goal_id");
CREATE INDEX IF NOT EXISTS "reflections_enriched_at_idx"     ON "reflections" ("enriched_at");
CREATE INDEX IF NOT EXISTS "situation_logs_goal_id_idx"      ON "situation_logs" ("goal_id");
CREATE INDEX IF NOT EXISTS "situation_logs_enriched_at_idx"  ON "situation_logs" ("enriched_at");
CREATE INDEX IF NOT EXISTS "decision_replays_goal_id_idx"    ON "decision_replays" ("goal_id");
CREATE INDEX IF NOT EXISTS "decision_replays_enriched_at_idx" ON "decision_replays" ("enriched_at");

-- ── JournalSettings (single-row · id = 'singleton') ──────────────────────────
CREATE TABLE IF NOT EXISTS "journal_settings" (
  "id"                     TEXT PRIMARY KEY,
  "baseline_xp"            DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "baseline_enabled"       BOOLEAN          NOT NULL DEFAULT true,
  "quality_floor_chars"    INTEGER          NOT NULL DEFAULT 40,
  "grounded_xp_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  "auto_confirm_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "challenge_cadence"      TEXT             NOT NULL DEFAULT 'daily',
  "creative_intensity"     TEXT             NOT NULL DEFAULT 'bold',
  "updated_at"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
