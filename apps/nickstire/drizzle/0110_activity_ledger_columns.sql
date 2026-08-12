-- 0110: activity-ledger columns on audit_log — attributed actor class, full
-- before/after snapshots, a proposed-vs-executed status, and a durable
-- idempotency key.
--
-- WHY: audit_log already records admin/system mutations (actor varchar +
-- changes JSON, see schema.ts:2629) but cannot say WHAT KIND of actor wrote a
-- row (human vs AI agent vs the voice receptionist), cannot carry a full
-- before/after snapshot for rows that need one, cannot mark a row as a
-- PROPOSED-not-yet-executed action, and offers no dedup key an at-most-once
-- writer can claim (the JSON_EXTRACT dedup pattern on `changes` silently
-- broke once — see server/routes/nour-os-query.ts:195). These columns are the
-- foundation the ledger middleware (services/activityLedger.ts) and the
-- approval queue (0111) write through.
--
-- Every statement is ADDITIVE (ADD COLUMN / ADD UNIQUE KEY). Nothing is
-- dropped, renamed or retyped, so a partial apply is recoverable by
-- re-running. Existing rows read back with actor_type NULL and status
-- 'executed'. The unique key permits many NULLs, so existing rows are
-- unaffected. TiDB: one ALTER per statement — combined ALTERs are rejected.
--
-- Hand-applied via scripts/apply-0110-activity-ledger.mjs. Do NOT use the
-- generic runner: it marks migrations tracked WITHOUT executing them (the
-- 0083-0087 trap recorded in 0106).

ALTER TABLE `audit_log` ADD COLUMN `actor_type` varchar(24) NULL;
ALTER TABLE `audit_log` ADD COLUMN `before_json` json NULL;
ALTER TABLE `audit_log` ADD COLUMN `after_json` json NULL;
ALTER TABLE `audit_log` ADD COLUMN `status` varchar(32) NOT NULL DEFAULT 'executed';
ALTER TABLE `audit_log` ADD COLUMN `idempotency_key` varchar(191) NULL;
ALTER TABLE `audit_log` ADD UNIQUE KEY `uniq_audit_idem` (`idempotency_key`);
