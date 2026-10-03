-- 0142 · chat_sessions.messagesJson TEXT -> MEDIUMTEXT
--
-- WHY (2026-10-03). server/routers/chat.ts persists JSON.stringify(sessionMessages) of the WHOLE
-- conversation into messagesJson on every turn. TEXT caps at 65,535 bytes; TiDB runs
-- STRICT_TRANS_TABLES, so a long chat's write is REJECTED (not truncated) and the transcript is
-- lost. chat.ts catches the persist failure and still replies, so the loss was silent.
-- MEDIUMTEXT holds 16,777,215 bytes. chat.ts also caps the serialized transcript at that limit
-- (dropping the OLDEST messages) so a pathological chat can never be rejected outright.
--
-- Nullability/default preserved exactly as schema.ts and 0003 declare: NOT NULL, no default.
-- Widening only (no data rewrite); re-running is a no-op. Applied through Admin -> Run migrations
-- (server/routers/nick/intelligence.ts carries the same statement).

ALTER TABLE chat_sessions MODIFY COLUMN messagesJson MEDIUMTEXT NOT NULL;
