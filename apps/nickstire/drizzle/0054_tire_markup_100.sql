-- 2026-05-23 · Force tire markup to 100% (cost × 2)
--
-- Why: Admin UI had `value={customMarkup || "50"}` — defaulted the input
-- to 50% instead of 100%. If an operator clicked SAVE without changing it,
-- DB stored markup=50 silently. Backend code default is 100, but DB takes
-- precedence if a row exists.
--
-- This migration ensures the canonical 100% markup is what every tire
-- quote uses going forward. Idempotent — INSERT IGNORE skips if a row
-- already exists, then UPDATE forces value to 100.

INSERT IGNORE INTO shop_settings (`key`, value, category, label, updatedBy)
VALUES ('tireMarkup', '100', 'pricing', 'Tire Markup %', 'system-migration-0054');

UPDATE shop_settings
SET value = '100', updatedBy = 'system-migration-0054'
WHERE `key` = 'tireMarkup';
