-- 0108: content experiment registry + watch-time columns on the metric snapshots.
--
-- TiDB: ONE schema change per ALTER (combined clauses throw) — see 0106.
-- Every statement here is ADDITIVE (ADD COLUMN / CREATE TABLE IF NOT EXISTS);
-- nothing is dropped, renamed or retyped, so a partial apply is recoverable by
-- re-running.
--
-- Hand-applied via scripts/apply-0108-content-experiments.mjs. Do NOT use the
-- generic runner: it marks migrations tracked WITHOUT executing them (the
-- 0083-0087 trap recorded in 0106).
--
-- WHY: `ig_metric_snapshots` already captures reach/saved/views/shares
-- append-only (75 rows), which is most of the 24/72h/7d requirement. It was
-- missing the two metrics that decide a DISCOVERY objective — average watch
-- time and skip rate — which is why no reel could be scored on the thing
-- Instagram actually distributes on.
--
-- avg_watch_time_ms is MILLISECONDS, matching `ig_reels_avg_watch_time` from
-- the Graph API. Stored in native units and named for it: a silent ms->s
-- conversion is how a metric ends up wrong by 1000x with nothing to catch it.
-- NULL means NOT REPORTED and must never be read as zero — "nobody watched"
-- and "Instagram did not return this" are different facts.

ALTER TABLE `ig_metric_snapshots` ADD COLUMN `avg_watch_time_ms` int NULL;
--> statement-breakpoint
ALTER TABLE `ig_metric_snapshots` ADD COLUMN `skip_rate` decimal(6,4) NULL;
--> statement-breakpoint

-- One row per experiment. `primary_variable` is the ONLY dimension the arms may
-- differ on; the evaluator refuses a verdict when anything else diverges.
CREATE TABLE IF NOT EXISTS `content_experiments` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `experiment_id` varchar(100) NOT NULL,
  `primary_variable` varchar(40) NOT NULL,
  `objective` varchar(20) NOT NULL,
  `primary_metric` varchar(60) NOT NULL,
  `arms_json` json NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'running',
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `concluded_at` timestamp NULL,
  -- The verdict is PERSISTED with its reasoning, including the refusals
  -- (insufficient_data / no_signal / invalid_design). A refusal is a result and
  -- must survive, or the next run silently re-decides it.
  `verdict_status` varchar(24) NULL,
  `verdict_note` text NULL,
  UNIQUE KEY `uk_content_experiment_id` (`experiment_id`),
  KEY `idx_content_exp_status` (`status`)
);
--> statement-breakpoint

-- One row per published episode that belongs to an experiment. This is the
-- traceability record: every input that could explain the outcome is captured
-- at assignment time, so a result can never be attributed to a variable nobody
-- wrote down.
CREATE TABLE IF NOT EXISTS `content_experiment_assignments` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `experiment_id` varchar(100) NOT NULL,
  `arm_id` varchar(60) NOT NULL,
  `episode_key` varchar(160) NOT NULL,
  `media_id` varchar(100) NULL,
  `reel_job_id` int NULL,
  `franchise_id` varchar(60) NULL,
  `cta_type` varchar(20) NULL,
  `content_origin` varchar(30) NULL,
  `posting_slot` varchar(20) NULL,
  `provider` varchar(40) NULL,
  `model` varchar(80) NULL,
  `prompt_version` varchar(40) NULL,
  `assigned_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `published_at` timestamp NULL,
  -- Assignment is deterministic on episode_key, so the same episode must never
  -- appear twice under one experiment. This constraint is what stops a retry
  -- from reassigning an arm and corrupting a running test.
  UNIQUE KEY `uk_exp_episode` (`experiment_id`, `episode_key`),
  KEY `idx_exp_assign_media` (`media_id`),
  KEY `idx_exp_assign_arm` (`experiment_id`, `arm_id`)
);
