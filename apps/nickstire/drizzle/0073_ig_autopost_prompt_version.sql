-- 2026-06-20 · drizzle/0073_ig_autopost_prompt_version.sql
--
-- Adds promptVersion to ig_autopost_log so IG-autopost prompt edits become
-- attributable — a content-quality shift can be tied to the prompt version
-- (PROMPT_VERSION in server/services/igAutopost.ts) that produced the run.
-- camelCase column name matches this table's existing convention (conceptKey,
-- slotDate, igPostId, ...). Additive only; idempotent on TiDB via IF NOT EXISTS.
--
-- HAND-APPLY to prod TiDB, then run `pnpm run check`. Nothing auto-migrates.

ALTER TABLE ig_autopost_log ADD COLUMN IF NOT EXISTS promptVersion VARCHAR(32) NULL DEFAULT NULL;
