-- ════════════════════════════════════════════════════════════════════════
-- Universal Audit · createdBy / updatedBy · v7.8 · Apr 29
-- ════════════════════════════════════════════════════════════════════════
--
-- Phase 1 item #3 of the schema audit: every mutating customer-facing /
-- agent-facing table now records WHO did the write.
--
-- Values follow a small, predictable vocabulary:
--   "user"            — explicit Nour click / type from a UI surface
--   "nick"            — AI agent action (chat tool call, autonomous engine)
--   "cron:<jobName>"  — scheduled job (cron:brain-cycle, cron:weekly-review)
--   "bridge:<system>" — cross-system sync inbound (bridge:nickstire)
--   "system"          — internal automation (default for legacy rows)
--
-- The `lib/db/actor.ts` helper resolves the actor from request context:
--   · authenticated request → "user"
--   · chat tool execution   → "nick"
--   · cron handler          → "cron:<jobName>" via cron registry
--   · bridge sync           → "bridge:<source>"
--   · fallback              → "system"
--
-- Tables touched (highest-impact mutating tables):
--   1. Mission           — createdBy + updatedBy (multi-actor mutation)
--   2. Task              — createdBy + updatedBy (chat tool calls + UI)
--   3. LifeGoal          — createdBy + updatedBy
--   4. BrainMemory       — createdBy only (already has `source` partial)
--   5. mastery_decisions — createdBy + updatedBy (manual vs chat-extracted)
--   6. commitments       — createdBy + updatedBy
--
-- All ADD COLUMN IF NOT EXISTS so re-runs are no-ops. DEFAULT 'system'
-- on legacy rows gives a sensible fallback without back-filling.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Mission (Prisma table is "Mission" without @@map; uses default)
ALTER TABLE "Mission"
  ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(64) DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS "updated_by" VARCHAR(64) DEFAULT 'system';

-- 2. Task (Prisma uses default name "Task")
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(64) DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS "updated_by" VARCHAR(64) DEFAULT 'system';

-- 3. life_goals (mapped)
ALTER TABLE "life_goals"
  ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(64) DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS "updated_by" VARCHAR(64) DEFAULT 'system';

-- 4. brain_memories (mapped)
ALTER TABLE "brain_memories"
  ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(64) DEFAULT 'system';

-- 5. mastery_decisions (mapped)
ALTER TABLE "mastery_decisions"
  ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(64) DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS "updated_by" VARCHAR(64) DEFAULT 'system';

-- 6. commitments (mapped)
ALTER TABLE "commitments"
  ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(64) DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS "updated_by" VARCHAR(64) DEFAULT 'system';

-- Indexes for "show me everything Nick auto-created today" style queries.
-- Filtered by createdBy = X, ordered by createdAt — fastest with composite.
CREATE INDEX IF NOT EXISTS "Mission_created_by_idx"
  ON "Mission"("created_by");
CREATE INDEX IF NOT EXISTS "Task_created_by_idx"
  ON "Task"("created_by");
CREATE INDEX IF NOT EXISTS "life_goals_created_by_idx"
  ON "life_goals"("created_by");
CREATE INDEX IF NOT EXISTS "brain_memories_created_by_idx"
  ON "brain_memories"("created_by");
CREATE INDEX IF NOT EXISTS "mastery_decisions_created_by_idx"
  ON "mastery_decisions"("created_by");
CREATE INDEX IF NOT EXISTS "commitments_created_by_idx"
  ON "commitments"("created_by");
