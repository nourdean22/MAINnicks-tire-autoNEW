-- 2026-07-03 · drizzle/0075_invoice_booking_unique.sql
--
-- Backstops the auto-invoice dedup guard (autoCreateInvoiceFromBooking skips if
-- a booking already has an invoice, PR #496 wave 4) with a DB-level UNIQUE
-- constraint on invoices.bookingId. bookingId is nullable → MySQL/TiDB allows
-- multiple NULLs, so manual / non-booking invoices are unaffected; only
-- non-null bookingIds must be unique. This is a HARDENING backstop — the app
-- already prevents duplicates for new bookings.
--
-- ⚠️ PRE-CHECK — MUST return 0 rows before applying. Duplicate invoices created
--    BEFORE the wave-4 guard would make CREATE UNIQUE INDEX fail. Resolve any
--    duplicates first (e.g. keep the earliest invoice per bookingId, null the
--    bookingId on the rest, or void the extras):
--
--   SELECT bookingId, COUNT(*) AS n
--     FROM invoices
--    WHERE bookingId IS NOT NULL
--    GROUP BY bookingId
--   HAVING COUNT(*) > 1;
--
-- Ordering below is deliberately safe: create the UNIQUE index FIRST (it fails
-- harmlessly and leaves the existing plain index intact if duplicates remain),
-- and only drop the now-redundant plain index once the unique one exists.
--
-- HAND-APPLY to prod TiDB, then run `pnpm run check`. Nothing auto-migrates on
-- deploy.

CREATE UNIQUE INDEX uniq_invoice_booking ON invoices (bookingId);
DROP INDEX idx_invoice_booking ON invoices;
