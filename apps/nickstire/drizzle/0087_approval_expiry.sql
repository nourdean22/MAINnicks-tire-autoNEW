-- Durable approval semantics (post-#821 directive milestone 10): approvals
-- expire and record the governing policy version. Hand-apply via
-- scripts/apply-0087-approval-expiry.mts (runner marks tracked without executing).
ALTER TABLE `social_content_approvals` ADD COLUMN `expires_at` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `social_content_approvals` ADD COLUMN `policy_version` int NULL;
