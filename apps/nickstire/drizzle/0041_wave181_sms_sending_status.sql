-- wave-181.59 · add "sending" to sms_messages.status enum
--
-- Closes a MEDIUM-severity audit finding in server/sms.ts
-- startDelayedQueueProcessor() rehydrate path. That code was marking
-- DB rows as status="sent" the moment they were rehydrated from disk
-- back into the in-memory delayedQueue — BEFORE the gateway had been
-- called. Net effect: every restart inflated the "sent" count by the
-- number of pending messages and put a green checkmark on deliveries
-- that hadn't happened yet. Operators reading the SMS dashboard saw
-- success for sends that were still queued.
--
-- The new "sending" value lets the rehydrate path atomically claim a
-- row (queued -> sending, WHERE status='queued') so a concurrent worker
-- can't double-claim, while keeping the row honestly marked as
-- in-flight rather than falsely complete. Later, when the actual send
-- lands via processDelayedQueue -> sendSms, the persisted-write path
-- inserts the real send row with status="sent" (unchanged).
--
-- The status enum is MySQL-native; adding a value requires MODIFY COLUMN
-- with the full new enum list. Default stays "queued".
--
-- DDL SAFETY: "sending" is APPENDED at the END of the enum list. MySQL/
-- TiDB stores enums as 1-2 byte integer indexes into the value list;
-- inserting a value in the middle would shift every subsequent value's
-- storage index and force a full-table rewrite that remaps every existing
-- row. Appending is a metadata-only change — instant, lock-free, safe on
-- a multi-million-row table.
--
-- Admin UI impact: SmsSection.tsx already has a string fallback
-- (`m.status === "sent" ? "Sent" : m.status`), so a "sending" status
-- renders as the literal string with no template breakage. No other
-- reader depends on the enum being exactly the old 5 values.
--
-- FAIL-OPEN at the application layer: server/sms.ts rehydrate is wrapped
-- in try/catch with log-only on error. Safe to apply at any time; the
-- code change pairs with this migration but does not strictly require
-- the migration to be present (an unapplied migration just means the
-- rehydrate UPDATE fails its enum constraint and the catch logs it).
--
-- ROLLBACK (only safe if no row currently has status='sending'):
--   UPDATE sms_messages SET status='queued' WHERE status='sending';
--   ALTER TABLE sms_messages
--     MODIFY COLUMN status
--       ENUM('queued','sent','delivered','failed','received')
--       NOT NULL DEFAULT 'queued';

ALTER TABLE sms_messages
  MODIFY COLUMN status
    ENUM('queued','sent','delivered','failed','received','sending')
    NOT NULL DEFAULT 'queued';
