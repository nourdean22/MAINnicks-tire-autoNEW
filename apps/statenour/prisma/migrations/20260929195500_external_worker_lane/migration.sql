-- NOUR external subscription/local worker lane.
-- Additive only: one WorkItemType value + one nullable result payload.
ALTER TYPE "WorkItemType" ADD VALUE IF NOT EXISTS 'AI_EXTERNAL_WORKER';

ALTER TABLE "WorkItem"
  ADD COLUMN IF NOT EXISTS "resultPayload" JSONB;
