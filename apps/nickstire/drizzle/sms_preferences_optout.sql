-- code-review 2026-07-09 · durable SMS opt-out store (TCPA fix for sms.ts).
--
-- `sms_preferences` is already declared in drizzle/schema.ts:1837 but was
-- ORPHANED (no code referenced it). The opt-out fix now writes/reads it via
-- persistOptOutPreference() + ensureOptOutCache(). If the table already
-- exists in prod (schema.ts is source of truth), this is a no-op — the code
-- degrades gracefully if it is missing, but opt-outs for non-customer phones
-- (leads, VAPI callers) will NOT be durable until this table exists.
--
-- APPLY (hand-applied per nickstire migration policy) ONLY IF the table is
-- absent in prod. Verify first, e.g.:
--   railway run --service MAINnicks-tire-auto -- \
--     mysql -e "SHOW TABLES LIKE 'sms_preferences';"
-- Idempotent: safe to run even if it already exists.

CREATE TABLE IF NOT EXISTS `sms_preferences` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `phone` VARCHAR(20) NOT NULL,
  `opted_out` BOOLEAN NOT NULL DEFAULT FALSE,
  `opt_out_keyword` VARCHAR(20) NULL,
  `opted_out_at` TIMESTAMP NULL,
  `opted_in_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sms_preferences_phone_unique` (`phone`)
);
