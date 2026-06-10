-- 2026-06-10 · drizzle/0068_journey_session_keys.sql
--
-- Journey-join foundation (autonomous attribution completion wave).
-- ADDITIVE + NULLABLE ONLY.
--
-- A. call_events + sessionId + eventId — the phone-click row gains the
--    localStorage visitor id (same key customer_events.sessionId has
--    carried since the visual-engagement wave) and the Meta-pixel
--    event_id (trackPhoneCall already generates + returns it; it was
--    discarded). eventId also future-proofs pixel<->CAPI Contact dedup.
-- B. leads / bookings / callback_requests / tire_orders + sessionId —
--    every conversion surface carries the same exact-join key, enabling
--    truthful same-visitor journeys (click -> lead -> booking) with NO
--    time-window guessing. Historical rows stay NULL (honest blind spot).
--
-- SAFETY: ADD COLUMN IF NOT EXISTS (TiDB), nullable, no defaults, no
-- backfill, no index changes. Old code ignores the columns; new code
-- tolerates NULL. Rollback (operator-gated, not to be run casually):
-- ALTER TABLE <t> DROP COLUMN <c>; per column.
--
-- Apply: hand-applied directly against prod TiDB (journal drifted at 0050).

ALTER TABLE call_events ADD COLUMN IF NOT EXISTS sessionId VARCHAR(64) NULL;
--> statement-breakpoint
ALTER TABLE call_events ADD COLUMN IF NOT EXISTS eventId VARCHAR(64) NULL;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sessionId VARCHAR(64) NULL;
--> statement-breakpoint
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sessionId VARCHAR(64) NULL;
--> statement-breakpoint
ALTER TABLE callback_requests ADD COLUMN IF NOT EXISTS sessionId VARCHAR(64) NULL;
--> statement-breakpoint
ALTER TABLE tire_orders ADD COLUMN IF NOT EXISTS sessionId VARCHAR(64) NULL;
