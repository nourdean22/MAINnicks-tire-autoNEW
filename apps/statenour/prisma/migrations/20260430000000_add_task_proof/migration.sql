-- v9.0-rc · Apr 30 · Task proof attachment
-- Shape: { urls?: string[]; screenshots?: string[]; metrics?: Record<string,number>; notes?: string; observedAt?: string }
-- Nullable, additive — no backfill needed; existing rows get NULL.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "proof" JSONB;
