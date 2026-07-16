ALTER TABLE `users`
  ADD COLUMN `adminRole` enum('owner','manager','front_desk','tech','accountant','viewer') NULL AFTER `role`,
  ADD COLUMN `mfaEnabled` boolean NOT NULL DEFAULT false AFTER `adminRole`,
  ADD COLUMN `mfaSecretEncrypted` text NULL AFTER `mfaEnabled`,
  ADD COLUMN `mfaVerifiedAt` timestamp NULL AFTER `mfaSecretEncrypted`;

UPDATE `users`
SET `adminRole` = 'owner'
WHERE `role` = 'admin' AND `adminRole` IS NULL;

CREATE INDEX `idx_users_admin_role` ON `users` (`adminRole`);
