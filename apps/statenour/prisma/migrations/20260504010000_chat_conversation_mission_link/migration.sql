ALTER TABLE "chat_conversations"
  ADD COLUMN IF NOT EXISTS "mission_id" TEXT;

CREATE INDEX IF NOT EXISTS "chat_conversations_mission_id_idx"
  ON "chat_conversations"("mission_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_conversations_mission_id_fkey'
  ) THEN
    ALTER TABLE "chat_conversations"
      ADD CONSTRAINT "chat_conversations_mission_id_fkey"
      FOREIGN KEY ("mission_id") REFERENCES "Mission"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
