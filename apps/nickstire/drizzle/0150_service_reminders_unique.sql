-- 0150 · service_reminders: one row per customer, category and closed job
--
-- WHY (2026-10-22, bug hunt finding 8, approved by Nour). The maintenance-reminder planner
-- (server/services/serviceReminders.ts syncServiceReminders) reads the stored rows, then inserts the
-- planned ones it did not find. Nothing in the table stopped two overlapping runs (the reminder-queue
-- cron and the admin button) from both inserting the same reminder, and a duplicate row means a
-- second text. UNIQUE (phone, serviceType, lastServiceDate) makes the database the judge; the
-- planner inserts with INSERT IGNORE, so a raced duplicate is skipped instead of failing the run.
--
-- Prod read before writing this (manager, SELECT-only, 2026-10-22 17:5xZ): phone varchar(30),
-- serviceType varchar(100), lastServiceDate timestamp; indexes PRIMARY, idx_reminders_status,
-- idx_reminders_next_due; 0 duplicate groups among 167 rows, so the index builds cleanly.
-- Key length (30 + 100) x 4 + 4 bytes, well under TiDB's 3072.
--
-- Code ships first and works without the index (the IGNORE has nothing to ignore until it exists).
-- Idempotent: IF NOT EXISTS makes a re-run a no-op (TiDB accepts it: 0018 and the runner's 0139 line use the same form).
-- Applied through Admin -> Run migrations (server/routers/nick/intelligence.ts carries the same
-- statement).

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_reminders_phone_type_date ON service_reminders (phone, serviceType, lastServiceDate);
