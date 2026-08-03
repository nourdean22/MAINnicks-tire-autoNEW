-- Render LEASE for social_publish_queue · 2026-08-03 · ADDITIVE, zero data loss.
--
-- /api/sync/queue/render claims a reel by setting status='rendering'. If the
-- worker dies after that write the row is stuck in 'rendering' forever: never
-- re-claimed, never published, and invisible because a stuck row looks exactly
-- like one being actively worked.
--
-- These columns are also the DISCRIMINATOR that makes reclaim safe. 'rendering'
-- is OVERLOADED — social-publish.ts and social-actions.ts set the same status to
-- mean "publishing underway". Those paths never write a lease, so their rows
-- keep render_lease_expires_at = NULL and can never be reclaimed by the render
-- lane. Only a row this lane leased is eligible.
--
-- Every statement is IF NOT EXISTS so a re-run is a no-op, per the guarded
-- endpoint's contract.

ALTER TABLE "social_publish_queue" ADD COLUMN IF NOT EXISTS "render_claimed_at" TIMESTAMP(3);
ALTER TABLE "social_publish_queue" ADD COLUMN IF NOT EXISTS "render_lease_expires_at" TIMESTAMP(3);
ALTER TABLE "social_publish_queue" ADD COLUMN IF NOT EXISTS "render_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "social_publish_queue" ADD COLUMN IF NOT EXISTS "last_render_error" TEXT;

-- Drives the reclaim scan without a table scan.
CREATE INDEX IF NOT EXISTS "social_publish_queue_render_lease_expires_at_idx"
  ON "social_publish_queue"("render_lease_expires_at");
