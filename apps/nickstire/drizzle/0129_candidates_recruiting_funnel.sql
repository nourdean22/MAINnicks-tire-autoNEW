-- 2026-09-23 · candidates: intent lanes, full attribution, dedupe key, follow-up clock
--
-- Recruiting research (docs/recruiting/RECRUITING-ENGINE-2026-09.md) found the careers
-- form captures an APPLICATION and nothing else. An employed technician does not want
-- to apply; he wants to ask a private question, see the shop after hours, or stay on a
-- list until the timing is right. Those are different conversions and the table had no
-- way to tell them apart, so "not ready yet" leads were indistinguishable from
-- applicants and nobody could be followed up on a date.
--
-- EVERY COLUMN IS NULLABLE. Code writes each one only when the caller supplied it, and
-- falls back to the pre-0129 column set on ER_BAD_FIELD_ERROR, so the careers form keeps
-- saving applications in the window between deploy and this DDL being applied.
--
--   intent         apply | confidential | shop_tour | talent_network | apprentice
--                  VARCHAR(32), not ENUM: out-of-enum writes lose the row on TiDB.
--   moveReasons    comma list from the "what would make you move?" self-selector.
--   phoneE164      normalized phone (server/lib/phone.ts) - the duplicate-applicant key.
--   refCode        ?ref=<code> from a personal referral link / QR card.
--   gclid, utmTerm, utmContent  - already captured client-side, previously dropped.
--   nextFollowUpAt - when a not-now / talent-network candidate should be contacted again.
--   ownerAlertedAt - set when the owner alert email was accepted by the mailer.
--
-- Status stays VARCHAR(32); the longer lifecycle (conversation, shop_tour, offer,
-- started, not_now, no_show ...) is app-level validation only - longest value 15 chars.

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS intent VARCHAR(32) NULL;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS moveReasons VARCHAR(500) NULL;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phoneE164 VARCHAR(20) NULL;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS refCode VARCHAR(64) NULL;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS gclid VARCHAR(255) NULL;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS utmTerm VARCHAR(255) NULL;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS utmContent VARCHAR(255) NULL;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS nextFollowUpAt TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS ownerAlertedAt TIMESTAMP NULL DEFAULT NULL;

-- Duplicate detection and referral-source rollups both read by these.
CREATE INDEX IF NOT EXISTS idx_candidate_phone_e164 ON candidates (phoneE164);
CREATE INDEX IF NOT EXISTS idx_candidate_ref_code ON candidates (refCode);
