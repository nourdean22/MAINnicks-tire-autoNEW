-- 2026-05-27 · Power Atlas Phase 0 · foundation migration
-- Spec: docs/superpowers/specs/2026-05-27-power-atlas-design.md
--
-- ADDITIVE · safe to re-run via IF NOT EXISTS guards · no data movement.
-- Adds 15 columns to person_profiles + creates 2 new tables.
--
-- HOW TO APPLY
--   set -a && . ./.env.local && set +a
--   pnpm tsx scripts/apply-pending-migration.ts \
--     prisma/migrations/20260527_power_atlas_foundation/migration.sql
--   pnpm exec prisma migrate resolve --applied 20260527_power_atlas_foundation
--
-- ROLLBACK
--   DROP TABLE relationship_plays;
--   DROP TABLE relationship_ledger;
--   ALTER TABLE person_profiles
--     DROP COLUMN status, DROP COLUMN blown_up_at, DROP COLUMN blow_up_reason,
--     DROP COLUMN birthday, DROP COLUMN anniversary, DROP COLUMN dossier_md,
--     DROP COLUMN dossier_updated_at, DROP COLUMN cadence_days, DROP COLUMN deleted_at,
--     DROP COLUMN greene_type, DROP COLUMN applicable_laws, DROP COLUMN dark_traits,
--     DROP COLUMN seducer_type, DROP COLUMN mentorship_role, DROP COLUMN current_strategy,
--     DROP COLUMN power_balance, DROP COLUMN behavioral_fingerprint,
--     DROP COLUMN psychographic_ladder, DROP COLUMN last_arc_plan,
--     DROP COLUMN power_plays_history;

BEGIN;

ALTER TABLE person_profiles
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS blown_up_at         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS blow_up_reason      TEXT,
  ADD COLUMN IF NOT EXISTS birthday            TEXT,
  ADD COLUMN IF NOT EXISTS anniversary         TEXT,
  ADD COLUMN IF NOT EXISTS dossier_md          TEXT,
  ADD COLUMN IF NOT EXISTS dossier_updated_at  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS cadence_days        INTEGER,
  ADD COLUMN IF NOT EXISTS deleted_at          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS greene_type         TEXT,
  ADD COLUMN IF NOT EXISTS applicable_laws     INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dark_traits         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seducer_type        TEXT,
  ADD COLUMN IF NOT EXISTS mentorship_role     TEXT,
  ADD COLUMN IF NOT EXISTS current_strategy    TEXT,
  ADD COLUMN IF NOT EXISTS power_balance       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS behavioral_fingerprint JSONB,
  ADD COLUMN IF NOT EXISTS psychographic_ladder  JSONB,
  ADD COLUMN IF NOT EXISTS last_arc_plan         JSONB,
  ADD COLUMN IF NOT EXISTS power_plays_history   JSONB;

CREATE INDEX IF NOT EXISTS person_profiles_status_idx              ON person_profiles (status);
CREATE INDEX IF NOT EXISTS person_profiles_role_status_idx         ON person_profiles (role, status);
CREATE INDEX IF NOT EXISTS person_profiles_birthday_idx            ON person_profiles (birthday);
CREATE INDEX IF NOT EXISTS person_profiles_cadence_days_idx        ON person_profiles (cadence_days);
CREATE INDEX IF NOT EXISTS person_profiles_greene_type_idx         ON person_profiles (greene_type);
CREATE INDEX IF NOT EXISTS person_profiles_power_balance_idx       ON person_profiles (power_balance);
CREATE INDEX IF NOT EXISTS person_profiles_deleted_at_idx          ON person_profiles (deleted_at);

CREATE TABLE IF NOT EXISTS relationship_ledger (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES person_profiles(id) ON DELETE RESTRICT,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount      INTEGER NOT NULL,
  note        TEXT NOT NULL,
  source      TEXT NOT NULL,
  metadata    JSONB
);

CREATE INDEX IF NOT EXISTS relationship_ledger_person_id_created_at_idx ON relationship_ledger (person_id, created_at);
CREATE INDEX IF NOT EXISTS relationship_ledger_source_idx               ON relationship_ledger (source);
CREATE INDEX IF NOT EXISTS relationship_ledger_created_at_idx           ON relationship_ledger (created_at);

CREATE TABLE IF NOT EXISTS relationship_plays (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES person_profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind         TEXT NOT NULL,
  input_ctx    JSONB NOT NULL,
  output       JSONB NOT NULL,
  outcome      TEXT,
  outcome_note TEXT
);

CREATE INDEX IF NOT EXISTS relationship_plays_person_id_created_at_idx ON relationship_plays (person_id, created_at);
CREATE INDEX IF NOT EXISTS relationship_plays_kind_idx                 ON relationship_plays (kind);

COMMIT;
