-- 0064_sms_phone_normalize_merge.sql
-- HAND-APPLIED ONLY · NOT auto-run · DRAFT pending operator sign-off.
--
-- WHAT: cleans the historical SMS phone-format split surfaced by the
-- 2026-06-01 data profile — 70 sms_conversations.phone in E.164 ("+12168620005")
-- vs 178 in 10-digit ("2168620005"), 31 of which are DUPLICATE threads for the
-- same customer (same person, two threads). The CODE fix (commit 26341543)
-- already canonicalized all NEW conversation keys to 10-digit, so this is a
-- one-time backfill, not a recurring need.
--
-- SAFETY: UPDATE-only. No DELETE. The 31 dup rows are ARCHIVED + re-keyed to a
-- "merged-…" sentinel (reversible), never dropped. Messages are reassigned to
-- the surviving 10-digit thread, never lost. Wrap in the transaction below and
-- VERIFY before COMMIT.
--
-- ── 0. BACKUP FIRST (run + keep the output): ───────────────────────────────
--   SELECT c.*, (SELECT COUNT(*) FROM sms_messages m WHERE m.conversationId=c.id) msgs
--   FROM sms_conversations c WHERE c.phone LIKE '+%';
--
-- ── 0b. DRY-RUN the 31 merge pairs — eyeball them before Step 1: ────────────
--   SELECT dup.id dup_id, dup.phone dup_phone, canon.id canon_id, canon.phone canon_phone,
--          (SELECT COUNT(*) FROM sms_messages m WHERE m.conversationId=dup.id) dup_msgs
--   FROM sms_conversations dup
--   JOIN sms_conversations canon
--     ON canon.phone = RIGHT(REGEXP_REPLACE(dup.phone,'[^0-9]',''),10) AND canon.id <> dup.id
--   WHERE dup.phone LIKE '+%';
-- ───────────────────────────────────────────────────────────────────────────

START TRANSACTION;

-- Step 1 — reassign messages from each "+1…" dup thread to its 10-digit twin.
UPDATE sms_messages m
JOIN sms_conversations dup   ON m.conversationId = dup.id AND dup.phone LIKE '+%'
JOIN sms_conversations canon ON canon.phone = RIGHT(REGEXP_REPLACE(dup.phone,'[^0-9]',''),10)
                            AND canon.id <> dup.id
SET m.conversationId = canon.id;

-- Step 2 — archive the now-empty "+1…" dup rows (NOT deleted). Re-key the phone
-- to a sentinel so it can't collide with Step 3 and is obviously a merged row.
UPDATE sms_conversations dup
JOIN sms_conversations canon ON canon.phone = RIGHT(REGEXP_REPLACE(dup.phone,'[^0-9]',''),10)
                            AND canon.id <> dup.id
SET dup.status = 'archived',
    dup.phone  = CONCAT('merged-', dup.id, '-', RIGHT(REGEXP_REPLACE(dup.phone,'[^0-9]',''),10))
WHERE dup.phone LIKE '+%';

-- Step 3 — normalize the remaining (non-dup) "+1…" rows to 10-digit. After
-- Step 2 the dup rows are "merged-…", so this only touches the ~39 with no twin.
UPDATE sms_conversations
SET phone = RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)
WHERE phone LIKE '+%';

-- Step 4 — clear stuck "sending" orphans (gateway never confirmed, >1h old).
-- 2026-07-11 · re-run safety (journal reconciliation): pinned the moving
-- NOW() window to the migration's own era so a re-run on prod cannot
-- fail-mark messages that are legitimately in flight TODAY. Fresh envs
-- get the identical historical cleanup.
UPDATE sms_messages
SET status = 'failed'
WHERE status = 'sending' AND createdAt < '2026-06-02 00:00:00';

-- ── VERIFY before COMMIT (expect both 0): ──────────────────────────────────
--   SELECT COUNT(*) plus_left  FROM sms_conversations WHERE phone LIKE '+%';
--   SELECT COUNT(*) stuck_left FROM sms_messages WHERE status='sending' AND createdAt < NOW()-INTERVAL 1 HOUR;
-- If wrong: ROLLBACK;  else:
COMMIT;

-- Step 5 (SEPARATE, code-only, AFTER this migration is verified live):
--   switch smsInstrumentation.recordSmsReply / recordSmsConversion (lines ~71/134)
--   from the RIGHT(REPLACE(phone)) full-scan match to indexed eq(phone) — now
--   safe because every conversation key is 10-digit. (Perf win; ship as code.)
