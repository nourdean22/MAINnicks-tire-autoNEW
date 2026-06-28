-- Create ActionStatus enum if not exists
DO $$ BEGIN
  CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create action_receipts table
CREATE TABLE IF NOT EXISTS "action_receipts" (
  "id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
  "action" VARCHAR(255) NOT NULL,
  "context" TEXT,
  "missionId" TEXT,
  "source_system" TEXT,
  "verification_payload" JSONB,
  "executed_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "action_receipts_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX IF NOT EXISTS "action_receipts_status_created_at_idx" ON "action_receipts"("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "action_receipts_missionId_idx" ON "action_receipts"("missionId");

-- Add foreign key constraint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_receipts_missionId_fkey') THEN
    ALTER TABLE "action_receipts" ADD CONSTRAINT "action_receipts_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Add completionCriteria to Mission table
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "completionCriteria" JSONB;
