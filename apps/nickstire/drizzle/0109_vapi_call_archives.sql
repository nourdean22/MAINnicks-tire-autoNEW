-- 0109: vapi_call_archives — durable vault for VAPI call artifacts.
--
-- WHY: VAPI retains transcripts/recordings for 14 days upstream, then deletes
-- them. vapi_call_logs stores only a summary, eval fields and provider URLs —
-- the URLs die with retention, so the raw transcript of every call is
-- permanently destroyed on a rolling fuse (~27 calls/day at current volume).
-- The daily eval cron already fetches detail.transcript and discards it; this
-- table is where that fetch now lands. `transcript` NULL = not yet available
-- upstream (the archive pass retries until the call ages out of retention).
--
-- Every statement is ADDITIVE (CREATE TABLE IF NOT EXISTS); nothing is
-- dropped, renamed or retyped, so a partial apply is recoverable by re-running.
--
-- Hand-applied via scripts/apply-0109-vapi-call-archives.mjs. Do NOT use the
-- generic runner: it marks migrations tracked WITHOUT executing them (the
-- 0083-0087 trap recorded in 0106).

CREATE TABLE IF NOT EXISTS `vapi_call_archives` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `vapi_call_id` varchar(64) NOT NULL,
  `phone_number` varchar(30) NULL,
  `call_type` varchar(32) NULL,
  `ended_reason` varchar(64) NULL,
  `started_at` timestamp NULL,
  `ended_at` timestamp NULL,
  `duration_seconds` int NULL,
  `transcript` mediumtext NULL,
  `messages_json` json NULL,
  `recording_url` varchar(500) NULL,
  `stereo_recording_url` varchar(500) NULL,
  `summary` text NULL,
  `analysis_json` json NULL,
  `cost_total` decimal(10,4) NULL,
  `transcript_captured_at` timestamp NULL,
  `archived_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `vapi_call_archives_vapi_call_id_unique` (`vapi_call_id`),
  KEY `idx_vapi_archive_started` (`started_at`)
);
