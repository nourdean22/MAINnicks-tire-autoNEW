-- 20260711000000_assistant_reply_uniq
--
-- Closes the duplicate-assistant race (glitch-taxonomy Cat 4, the
-- cmou6xugm double-reply bug). The app-level check-then-insert guard in
-- lib/services/chat/persist-assistant-turn.ts has a race window between
-- findFirst and create — prod probe 2026-07-11 found 8 duplicate groups
-- / 9 extra rows, including one from 2026-07-11 itself (1ms apart).
--
-- Semantics mirror the app guard EXACTLY: one assistant reply per
-- (conversation, parent user message, branch), enforced only when
-- parent_message_id is set (the guard skips null parents). branch_id
-- COALESCEd because it is nullable; the live path writes
-- branchId = parentMessageId.
--
-- Probe verified 0 child rows reference any duplicate → plain delete of
-- the later rows is safe ("first message wins", same as the app guard).
-- Statements are idempotent; CONCURRENTLY requires the autocommit
-- apply script (scripts/apply-pending-migration.ts), never plain
-- prisma db execute.

-- 1 · dedupe existing violations: keep the EARLIEST row per key
DELETE FROM chat_messages cm
USING (
  SELECT unnest((array_agg(id ORDER BY created_at ASC))[2:]) AS dupe_id
  FROM chat_messages
  WHERE role = 'assistant' AND parent_message_id IS NOT NULL
  GROUP BY conversation_id, parent_message_id, COALESCE(branch_id, '')
  HAVING COUNT(*) > 1
) d
WHERE cm.id = d.dupe_id;

-- 2 · the constraint · partial expression unique index
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS chat_messages_assistant_reply_uniq
ON chat_messages (conversation_id, parent_message_id, COALESCE(branch_id, ''))
WHERE role = 'assistant' AND parent_message_id IS NOT NULL;

-- 3 · record as applied so migrate deploy/status stay clean
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'manual-apply-assistant-reply-uniq-2026-07-11', NOW(), '20260711000000_assistant_reply_uniq', NULL, NULL, NOW(), 1)
ON CONFLICT DO NOTHING;
