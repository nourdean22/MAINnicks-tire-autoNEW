-- 2026-06-09 · drizzle/0067_attribution_columns.sql
--
-- Attribution-holds wave · ADDITIVE + NULLABLE ONLY (operator-approved).
--
-- A. tire_orders — the money path had ZERO attribution columns; the owner
--    could never answer "which page/campaign produced this tire order."
--    Adds the same 5 fields leads/bookings carry (placeOrder zod + client
--    getUtmData spread wired in the same wave).
-- B. utmContent / utmTerm — captured by lib/utm.ts since wave-125 and
--    already SENT by every form spread, but zod-stripped because no column
--    existed. Adds the columns to leads + callback_requests (+ bookings
--    guarded — its schema already declares them; IF NOT EXISTS makes this
--    a no-op there if prod already has them).
--
-- SAFETY: every statement is ADD COLUMN IF NOT EXISTS (TiDB-supported),
-- nullable, no defaults, no backfill, no index changes. Old code ignores
-- the new columns; new code tolerates NULL. Rollback (NOT to be run
-- without operator approval): ALTER TABLE <t> DROP COLUMN <c>; -- per col.
--
-- Apply: hand-applied per repo convention (journal drifted at 0050; this
-- file is applied directly against prod TiDB with the service DATABASE_URL).

ALTER TABLE tire_orders ADD COLUMN IF NOT EXISTS utmSource VARCHAR(100) NULL;
--> statement-breakpoint
ALTER TABLE tire_orders ADD COLUMN IF NOT EXISTS utmMedium VARCHAR(100) NULL;
--> statement-breakpoint
ALTER TABLE tire_orders ADD COLUMN IF NOT EXISTS utmCampaign VARCHAR(255) NULL;
--> statement-breakpoint
ALTER TABLE tire_orders ADD COLUMN IF NOT EXISTS landingPage VARCHAR(500) NULL;
--> statement-breakpoint
ALTER TABLE tire_orders ADD COLUMN IF NOT EXISTS referrer VARCHAR(500) NULL;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utmContent VARCHAR(255) NULL;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utmTerm VARCHAR(255) NULL;
--> statement-breakpoint
ALTER TABLE callback_requests ADD COLUMN IF NOT EXISTS utmContent VARCHAR(255) NULL;
--> statement-breakpoint
ALTER TABLE callback_requests ADD COLUMN IF NOT EXISTS utmTerm VARCHAR(255) NULL;
--> statement-breakpoint
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utmContent VARCHAR(255) NULL;
--> statement-breakpoint
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utmTerm VARCHAR(255) NULL;
