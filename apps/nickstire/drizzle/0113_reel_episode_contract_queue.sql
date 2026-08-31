-- 0113: durable Reel Episode Contract identity, queue state, and production slot.
--
-- This is additive and HAND-APPLIED ONLY. Do not apply it from an agent or from
-- the generic migration runner. Until these columns and indexes exist,
-- enqueueReelJob fails closed with REEL_EPISODE_SCHEMA_NOT_APPLIED.
--
-- TiDB/MySQL accepts ADD COLUMN IF NOT EXISTS. The index guards use the
-- INFORMATION_SCHEMA so a partially applied migration can be safely completed
-- by an operator without dropping or rewriting existing reel_jobs rows.

ALTER TABLE `reel_jobs`
  ADD COLUMN IF NOT EXISTS `episode_id` varchar(191) NULL,
  ADD COLUMN IF NOT EXISTS `episode_version` varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS `idempotency_key` varchar(191) NULL,
  ADD COLUMN IF NOT EXISTS `queue_state` varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS `production_slot` varchar(16) NULL,
  ADD COLUMN IF NOT EXISTS `production_ready_at` timestamp NULL,
  ADD COLUMN IF NOT EXISTS `publication_scheduled_at` timestamp NULL;

SET @reel_jobs_episode_version_index = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `reel_jobs` ADD UNIQUE KEY `uniq_reel_jobs_episode_version` (`episode_id`, `episode_version`)',
    'SELECT 1')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reel_jobs'
    AND INDEX_NAME = 'uniq_reel_jobs_episode_version'
);
PREPARE reel_jobs_episode_version_stmt FROM @reel_jobs_episode_version_index;
EXECUTE reel_jobs_episode_version_stmt;
DEALLOCATE PREPARE reel_jobs_episode_version_stmt;

SET @reel_jobs_idempotency_index = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `reel_jobs` ADD UNIQUE KEY `uniq_reel_jobs_idempotency` (`idempotency_key`)',
    'SELECT 1')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reel_jobs'
    AND INDEX_NAME = 'uniq_reel_jobs_idempotency'
);
PREPARE reel_jobs_idempotency_stmt FROM @reel_jobs_idempotency_index;
EXECUTE reel_jobs_idempotency_stmt;
DEALLOCATE PREPARE reel_jobs_idempotency_stmt;

SET @reel_jobs_queue_index = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `reel_jobs` ADD KEY `idx_reel_jobs_queue` (`queue_state`, `production_slot`, `createdAt`)',
    'SELECT 1')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reel_jobs'
    AND INDEX_NAME = 'idx_reel_jobs_queue'
);
PREPARE reel_jobs_queue_stmt FROM @reel_jobs_queue_index;
EXECUTE reel_jobs_queue_stmt;
DEALLOCATE PREPARE reel_jobs_queue_stmt;
