-- 2026-05-27 · drizzle/0062_search_performance_dedupe.sql
--
-- Fix audit #79's data-integrity bombshell: `search_performance` was
-- accumulating duplicate rows on every gsc-pipeline run. The sync
-- function (`syncSearchPerformance` in server/pipelines/gsc-data.ts)
-- did a plain INSERT with no upsert · the schema had no unique
-- constraint on (date, query, page) · result: every overlap day's
-- data got re-inserted into perpetuity. Cross-checked against live
-- GSC: aggregates ran ~30-60× too high (e.g. 6,949 reported vs 166
-- real for 90-day clicks).
--
-- This migration:
--   1. Normalizes NULL pages to '' so the unique key works against
--      all rows (MySQL treats NULL != NULL in UNIQUE constraints).
--      GSC API always returns a page for `dimensions: [query, page,
--      date]` so NULLs only exist as historical artifact.
--   2. Deduplicates by deleting all but the max(id) row per
--      (date, query, page). Max(id) = latest write, which holds the
--      most-recent GSC numbers · safest "keep one" choice. The
--      duplicates are identical-shape rows so summing was always
--      wrong by a multiplier, not by content.
--   3. Adds UNIQUE KEY on (date, query, page) so future syncs MUST
--      use ON DUPLICATE KEY UPDATE (the app code change ships in
--      the same commit · see syncSearchPerformance).
--
-- After applying: aggregates will reconcile to GSC headlines within
-- the expected ~2-day GSC delay window. No re-sync needed · existing
-- max(id) rows hold the most-recent values for each cell.
--
-- Safe to re-run (DELETE+JOIN is idempotent once duplicates are gone ·
-- UNIQUE KEY add throws on second run · wrap in `IF NOT EXISTS` if
-- TiDB supports it; otherwise rely on `ALTER TABLE ... DROP KEY` if
-- you need to redo).

-- Step 1 · normalize NULL pages
UPDATE search_performance SET page = '' WHERE page IS NULL;

-- Step 2 · deduplicate · keep only the max(id) per (date, query, page).
-- This is a self-join DELETE · the row to keep is the one with the
-- LARGEST id (most recent insert) · all earlier duplicates go.
DELETE sp1 FROM search_performance sp1
INNER JOIN search_performance sp2
WHERE sp1.id < sp2.id
  AND sp1.date = sp2.date
  AND sp1.query = sp2.query
  AND sp1.page = sp2.page;

-- Step 3 · add the constraint that should have existed from day one
ALTER TABLE search_performance
  ADD UNIQUE KEY uq_search_perf_date_query_page (date, query, page);
