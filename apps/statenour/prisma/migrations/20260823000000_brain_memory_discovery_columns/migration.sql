-- Discover verdict columns, promoted out of `metadata` jsonb (2026-08-22).
--
-- ADDITIVE ONLY. Three nullable columns with no default, and one partial
-- index. No drops, no renames, no type narrowing. Code deployed before this
-- migration keeps working unchanged: `metadata` remains the source of truth
-- and these columns are a derived mirror, dual-written from this wave on.
--
-- WHY. The jsonb original could not be filtered in SQL:
--   * listDiscoveries paged up to 300 rows and filtered in JS, so its `unrated`
--     count was a documented FLOOR -- on prod that floor read 56 against a true
--     242, the feature's headline defect.
--   * the natural Prisma predicate NOT(metadata #> '{discoveryVerdict}' =
--     '"noise"') is NULL for any row lacking the key, so it dropped 240 of 241
--     live blind_spot rows when measured against prod.
--
-- ROLLBACK. Safe and lossless UNTIL the code wave that reads these columns
-- deploys; after that, roll the APP back first. Post-deploy, listDiscoveries
-- selects and count()s these columns with no try/catch (nor does its tRPC
-- caller), so dropping them takes the /brain Discover tab down, and
-- getBlindSpotContext's bare `catch { return "" }` would drop the blind-spot
-- section from the system prompt SILENTLY. The columns themselves are derived
-- mirrors of `metadata`, so no data is lost either way.
--   DROP INDEX IF EXISTS brain_memories_discovery_verdict_idx;
--   ALTER TABLE brain_memories
--     DROP COLUMN IF EXISTS discovery_verdict,
--     DROP COLUMN IF EXISTS discovery_rated_at,
--     DROP COLUMN IF EXISTS discovery_provenance;

ALTER TABLE "brain_memories"
  ADD COLUMN IF NOT EXISTS "discovery_verdict"    VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "discovery_rated_at"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "discovery_provenance" VARCHAR(16);

-- Partial on live rows only. NOTE: the predicate is `deleted_at IS NULL`
-- ALONE -- there is no category restriction, so this covers every live row
-- (~93k), not just the four discovery categories. That is intentional (a
-- category-scoped predicate would need a second migration to replace this one,
-- and "additive only" governs this wave), but it means the index is NOT tiny.
-- Declared in lib/db/schema-sentinel.ts because Prisma cannot model a partial
-- index and a `db push` would otherwise drop it silently.
CREATE INDEX IF NOT EXISTS "brain_memories_discovery_verdict_idx"
  ON "brain_memories" ("category", "discovery_verdict", "last_seen" DESC)
  WHERE "deleted_at" IS NULL;
