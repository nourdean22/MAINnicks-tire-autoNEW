-- v7.9.1 · Apr 29 · IdentitySnapshot soft-delete fix
-- ============================================================
-- The v7.9 soft-delete pattern needs to support "redo today's
-- snapshot" — soft-delete the prior alive row, then let the cron
-- write a fresh one. The pre-existing `date` UNIQUE constraint
-- blocked this: a soft-deleted row still occupied the unique slot
-- and threw P2002 on the next cron insert.
--
-- Fix: drop the regular UNIQUE; replace with a regular index. Daily-
-- uniqueness among ALIVE rows is now enforced in app code via
-- `findFirst({ date, deletedAt: null }) → create-or-update`.
-- (See lib/brain/thinking-engine.ts trackIdentityEvolution.)
--
-- IF EXISTS / IF NOT EXISTS so this is safe to re-run on Vercel
-- cold starts where `prisma db push --accept-data-loss` may have
-- already torn it down.
-- ============================================================

ALTER TABLE "identity_snapshots"
  DROP CONSTRAINT IF EXISTS "IdentitySnapshot_date_key";
DROP INDEX IF EXISTS "IdentitySnapshot_date_key";
DROP INDEX IF EXISTS "identity_snapshots_date_key";

CREATE INDEX IF NOT EXISTS "identity_snapshots_date_idx"
  ON "identity_snapshots"("date");
