-- v7.3 · Apr 29 · ChatMessage.attachments JSON column for image/file
-- attachments. Without this, mobile-uploaded images vanish from chat
-- history on reload — the live AI SDK stream sees them, but the DB
-- only ever kept text. Now the dbWritePromise persists `parts` of
-- type "file" alongside content, and the GET /api/ai/chat/[id] route
-- hydrates them back so the image bubble renders on reload.

ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "attachments" JSONB;
