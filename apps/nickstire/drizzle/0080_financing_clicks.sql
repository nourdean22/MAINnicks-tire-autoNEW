-- 2026-07-12 · drizzle/0080_financing_clicks.sql
--
-- Financing provider-click ledger. trackApplication (financing router) wrote
-- clicks ONLY to Google Sheets (append-only, unjoinable) plus a synthetic
-- emit.leadCaptured({id:0}) -- so an "Apply Now" click could never be tied back
-- to the customer's lead/booking. This table persists each click with the
-- visitor sessionId (already sent by the client's getUtmData() spread, just
-- zod-stripped server-side until now), so clicks LEFT JOIN leads on sessionId.
--
-- ⚠️ OPERATOR-APPLIED (railway-run pattern, per nickstire migration rules).
--    NEVER auto-apply. Pure CREATE TABLE, no backfill. INSERTs are best-effort
--    try/catch (non-blocking) so a lagging migration never breaks click tracking.

CREATE TABLE `financing_clicks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `provider` ENUM('acima','snap','koalafi','american-first') NOT NULL,
  `sourcePage` VARCHAR(500) NULL,
  `customerName` VARCHAR(200) NULL,
  `customerPhone` VARCHAR(20) NULL,
  `customerEmail` VARCHAR(254) NULL,
  `estimatedAmount` VARCHAR(20) NULL,
  `sessionId` VARCHAR(64) NULL,
  `utmSource` VARCHAR(100) NULL,
  `utmMedium` VARCHAR(100) NULL,
  `utmCampaign` VARCHAR(255) NULL,
  `landingPage` VARCHAR(500) NULL,
  `referrer` VARCHAR(500) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_fc_session` (`sessionId`),
  INDEX `idx_fc_created` (`createdAt`)
);
