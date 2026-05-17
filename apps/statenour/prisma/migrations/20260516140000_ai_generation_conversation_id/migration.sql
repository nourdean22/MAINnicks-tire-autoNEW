-- v10.0.529.106 · Wave 59 · per-conversation cost attribution.
--
-- Pre-Wave-59 lib/services/cost-slo.ts:topConversationsByCost had to
-- fall back to grouping by `feature` name (which lost the per-
-- conversation breakdown). Adding `conversation_id` as a nullable
-- column keeps existing non-chat writes (cron/brain/social) working
-- while enabling proper attribution for new chat writes.

ALTER TABLE "ai_generations"
  ADD COLUMN "conversation_id" TEXT;

CREATE INDEX "ai_generations_conversation_id_created_at_idx"
  ON "ai_generations" ("conversation_id", "created_at");
