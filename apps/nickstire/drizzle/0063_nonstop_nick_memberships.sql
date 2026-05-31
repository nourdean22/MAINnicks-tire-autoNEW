-- 2026-05-30 · drizzle/0063_nonstop_nick_memberships.sql
--
-- Nonstop Nick membership ($7.99/mo tire membership · chunk 2/5).
-- Creates the `memberships` table that backs the program. One row per paid
-- membership; status mirrors the Stripe subscription so the counter can verify
-- a member by phone WITHOUT a live Stripe call.
--
-- Access patterns this schema serves (why each index exists):
--   1. Counter lookup — "is this phone an active member?"  → idx_membership_phone
--      + idx_membership_status (the operational make-or-break of the program).
--   2. Stripe webhook upsert — find the row by subscriptionId to flip status
--      on subscription.created/updated/deleted → uq_membership_stripe_sub.
--   3. One-vehicle binding at FIRST USE (not signup, to keep signup one-tap):
--      vehiclePlate is nullable and set the first time the member pulls up.
--
-- HAND-APPLIED (per apps/nickstire/CLAUDE.md): there is no auto-migrate. Apply
-- this SQL to the DB, then run `pnpm run check`. Safe to re-run — guarded by
-- CREATE TABLE IF NOT EXISTS.
--
-- Rollback (if ever needed): DROP TABLE IF EXISTS `memberships`;
-- (No data depends on it elsewhere — it's a new, standalone table.)

CREATE TABLE IF NOT EXISTS `memberships` (
  `id`                     INT AUTO_INCREMENT PRIMARY KEY,
  `plan`                   VARCHAR(64)  NOT NULL DEFAULT 'nonstop-nick',
  `phone`                  VARCHAR(20)  NOT NULL,
  `name`                   VARCHAR(255) NULL,
  `email`                  VARCHAR(320) NULL,
  `vehiclePlate`           VARCHAR(16)  NULL,
  `vehicleDesc`            VARCHAR(255) NULL,
  `status`                 ENUM('active','past_due','canceled','incomplete') NOT NULL DEFAULT 'incomplete',
  `stripeCustomerId`       VARCHAR(64)  NULL,
  `stripeSubscriptionId`   VARCHAR(64)  NULL,
  `currentPeriodEnd`       TIMESTAMP    NULL,
  `canceledAt`             TIMESTAMP    NULL,
  `createdAt`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_membership_phone`  (`phone`),
  INDEX `idx_membership_status` (`status`),
  UNIQUE KEY `uq_membership_stripe_sub` (`stripeSubscriptionId`)
);
