-- Add OutcomeRating enum and fields to Task
-- 2026-06-28 · Horizon 4: Outcome Benchmarking
--

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OutcomeRating') THEN
    CREATE TYPE "OutcomeRating" AS ENUM ('OUTSTANDING', 'SATISFACTORY', 'SUBSTANDARD', 'FAILED');
  END IF;
END $$;

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "outcome_rating" "OutcomeRating";
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "outcome_lesson" TEXT;
