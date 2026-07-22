-- 20260722000000_page_snapshots · 2026-07-22 · change-detection-lite sensor.
--
-- STATUS: apply to prod via POST /api/system/apply-pending-migration
--   { "name": "20260722000000_page_snapshots" } from an authed bdnick.info tab,
--   OR scripts/apply-pending-migration.ts with the prod DATABASE_URL. The
--   apply-pending-migration route's MIGRATIONS registry mirrors this SQL.
--   Additive · idempotent (IF NOT EXISTS) · zero data loss — a new table only,
--   nothing existing is touched, so ordering vs the code deploy is unconstrained.
--
-- Rollback (manual): DROP TABLE IF EXISTS "page_snapshots";

CREATE TABLE IF NOT EXISTS "page_snapshots" (
  "id"           TEXT NOT NULL,
  "url"          TEXT NOT NULL,
  "label"        TEXT,
  "content_hash" TEXT NOT NULL,
  "content"      TEXT NOT NULL,
  "changed"      BOOLEAN NOT NULL DEFAULT false,
  "checked_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "page_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "page_snapshots_url_checked_at_idx" ON "page_snapshots" ("url", "checked_at");

CREATE INDEX IF NOT EXISTS "page_snapshots_changed_checked_at_idx" ON "page_snapshots" ("changed", "checked_at");
