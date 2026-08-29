-- 0112: reel_publish_approvals — human consent as a precondition for publishing.
--
-- WHY. Measured in prod 2026-08-29: REEL_PUBLISH_ENABLED=true,
-- REEL_AUTOPOST_ENABLED=true and IG_AUTOPOST_DRYRUN="false" are all armed, and
-- cron/jobs/dailyReelPost.ts publishes an `assembled` job by itself with no
-- approval step. The only thing preventing a live post was that the head of the
-- queue (job 1710001) carries template-stock clips the stock_guard rejects, so
-- the cron held on that same row every ~60s. A defect is not a control: repair
-- or clear that row and the next clean reel publishes with nobody's consent.
--
-- WHAT A ROW MEANS. One recorded, attributable human yes, bound to the EXACT
-- caption bytes (caption_sha) and the EXACT rendered asset (video_url) that
-- were approved. Change either and shared/reelApproval.ts voids the approval
-- rather than honouring it — the owner approves specific wording, so an
-- approval that survives an edit would publish words nobody cleared.
--
-- FAIL-CLOSED, INCLUDING BEFORE THIS RUNS. server/services/reelApproval.ts
-- treats a missing table, a dead database and an unreadable row as "blocked".
-- That is deliberate: until this DDL is hand-applied there are zero approvals,
-- so the autonomous lane is held, which is the correct state.
--
-- RELATIONSHIP TO social_content_approvals. That table is the same idea for the
-- Studio lane, keyed on (inventory_id, version) with brief/media hashes and a
-- 72h TTL. Reels published through Studio already go through it. The AUTONOMOUS
-- cron does not: it works off reel_jobs rows, which carry no inventory_id, so
-- there is nothing for that table to key on - which is precisely how
-- dailyReelPost came to publish with no approval check at all. This table is
-- the reel_jobs-keyed equivalent, deliberately NOT a second general approval
-- system: same TTL semantics, same bind-to-content principle, different key.
--
-- revoked_at is a withdrawal, not a delete: the ledger of who approved what,
-- and when it was taken back, is the audit trail.
--
-- reel_job_id is `int` to match reel_jobs.id (int autoincrement) — a bigint
-- here would silently widen the join.
--
-- status/actor widths follow 0111. Every statement is ADDITIVE
-- (CREATE TABLE IF NOT EXISTS); a partial apply is recoverable by re-running.
--
-- HAND-APPLIED ONLY, and only on an explicit operator instruction. Do NOT use
-- the generic runner (0083-0087 trap, recorded in 0106).

CREATE TABLE IF NOT EXISTS `reel_publish_approvals` (
  `id` varchar(36) PRIMARY KEY,
  `reel_job_id` int NOT NULL,
  `caption_sha` char(64) NOT NULL,
  `video_url` varchar(1000) NOT NULL,
  `approved_by` varchar(100) NOT NULL,
  `approved_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- One yes authorizes for REEL_APPROVAL_TTL_HOURS (72). Parity with
  -- social_content_approvals.expires_at. NULL is honoured as legacy, matching
  -- how that table treats its pre-0087 rows - a migration must not brick a queue.
  `expires_at` timestamp NULL,
  `revoked_at` timestamp NULL,
  `revoked_by` varchar(100) NULL,
  `note` varchar(500) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_reel_approvals_job` (`reel_job_id`, `revoked_at`)
);
