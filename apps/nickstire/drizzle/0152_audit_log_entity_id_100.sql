-- 0152 · audit_log.entity_id: varchar(36) -> varchar(100)
--
-- WHY (2026-10-26, found while building the Settings flag history). featureFlags.toggle writes an audit row
-- with entity_id = the flag key. The key web_experiment_home_hero_subline_2026_09 is 40 characters, so under
-- STRICT_TRANS_TABLES the insert is rejected and logAdminAction swallows the miss (it returns false, nothing
-- throws): that flag could be flipped with no who/when on record. server/auditLogEntityIdWidth.test.ts now
-- pins that every FLAG_DEFINITIONS key fits the width schema.ts declares.
--
-- Shape: the column stays NULLable with no default, exactly as drizzle/schema.ts declares it. Widening a VARCHAR
-- within the same charset is a metadata-only change on TiDB (no data rewrite). Index idx_audit_entity
-- (entity_type, entity_id) stays: (50 + 100) x 4 bytes is well under TiDB's 3072-byte key limit.
-- Re-running is a no-op (the column is already 100 wide).
--
-- Hand-applied: Settings > Run Migrations (server/routers/nick/intelligence.ts carries the same statement)
-- or one scoped runner per prod-db-guard. Never run from a worktree.

ALTER TABLE audit_log MODIFY COLUMN entity_id VARCHAR(100) NULL;
