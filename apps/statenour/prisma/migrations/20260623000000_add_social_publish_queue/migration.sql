-- 2026-06-23 · Social Publish Queue · Unified Queue table
-- Spec: apps/statenour/docs/superpowers/plans/2026-06-23-social-intelligence-engine-phase-3.md
--
-- ADDITIVE · safe to re-run via IF NOT EXISTS guards · no data movement.
-- Creates social_publish_queue table + indexes + foreign key.
--
-- pgvector-safe: touches only ordinary columns. NEVER run via
-- `prisma db push --accept-data-loss`.
--
-- HOW TO APPLY
--   pnpm tsx scripts/apply-social-publish-queue.ts
--

CREATE TABLE IF NOT EXISTS "social_publish_queue" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "image_url" TEXT,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scheduled_for" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "publish_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kind" TEXT NOT NULL DEFAULT 'post',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_metadata" JSONB,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "mission_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "social_publish_queue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "social_publish_queue_status_scheduled_for_idx" ON "social_publish_queue"("status", "scheduled_for");
CREATE INDEX IF NOT EXISTS "social_publish_queue_mission_id_idx" ON "social_publish_queue"("mission_id");
CREATE INDEX IF NOT EXISTS "social_publish_queue_created_at_idx" ON "social_publish_queue"("created_at");
CREATE INDEX IF NOT EXISTS "social_publish_queue_deleted_at_idx" ON "social_publish_queue"("deleted_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_publish_queue_mission_id_fkey') THEN
    ALTER TABLE "social_publish_queue"
      ADD CONSTRAINT "social_publish_queue_mission_id_fkey"
      FOREIGN KEY ("mission_id") REFERENCES "Mission"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
