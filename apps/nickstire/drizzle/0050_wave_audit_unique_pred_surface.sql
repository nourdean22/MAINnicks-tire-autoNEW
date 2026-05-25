-- wave-fix-2026-05-25 (audit #100) · UNIQUE KEY on prediction_impressions
--
-- Background: migration 0061 (which is 0050 in this checkout — slot drift)
-- shipped prediction_impressions WITHOUT a uniqueness constraint on
-- (prediction_id, surface). cross-sell-outreach.ts writes one impression
-- per prediction per cron tick. When the cron tier moves from daily to
-- hourly (wave-fix-2026-05-25 audit #98 · ships in same commit), the
-- same prediction would generate 12× more duplicate impression rows per
-- day until a fresh compute replaces it. That bloats the table and
-- breaks any "distinct shown_at per prediction" analytics.
--
-- The INSERT IGNORE pattern (added in same wave) requires this UNIQUE
-- key to be meaningful — without it, INSERT IGNORE is a no-op because
-- there's no duplicate-key error to ignore.
--
-- This migration also dedupes any existing rows before adding the key.
-- As of 2026-05-25 the table has ~zero rows because cross-sell-outreach
-- ran once per day for ~24h since activation · the dedup is defensive
-- in case any duplicates exist.
--
-- Hand-applied per CLAUDE.md "Migrations are hand-applied SQL".

-- Step 1: Dedupe existing rows (keep oldest impression per pred+surface pair).
DELETE FROM `prediction_impressions`
WHERE `id` NOT IN (
  SELECT * FROM (
    SELECT MIN(`id`)
    FROM `prediction_impressions`
    GROUP BY `prediction_id`, `surface`
  ) AS keepers
);

-- Step 2: Add the UNIQUE KEY.
ALTER TABLE `prediction_impressions`
  ADD UNIQUE KEY `uk_prediction_surface` (`prediction_id`, `surface`);
