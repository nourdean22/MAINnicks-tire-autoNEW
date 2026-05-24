-- 2026-05-23 · drizzle/0056_customer_psycho_profile.sql
--
-- Persists customer psychographic profile (10 segments) on the customers
-- row. Powers profile-aware SMS routing, admin chip rendering, and
-- analytics segmentation. Daily cron refreshes via psychoProfileRefresh.
--
-- Why on `customers` and not `customer_metrics`:
--   - customers.segment already lives here (recency bucket · DIFFERENT field)
--   - customers.id is the natural FK for SMS routing
--   - keeping the chip column on customers avoids the LEFT JOIN when
--     only filtering, which the admin list query does often
--
-- Don't reuse customers.segment — that's the recency bucket used by
-- retention crons (D45/D90/D180/D365). Overloading it would break
-- retentionSequences.ts.

ALTER TABLE customers ADD COLUMN psycho_profile VARCHAR(32) DEFAULT NULL;
ALTER TABLE customers ADD COLUMN psycho_profile_score INT DEFAULT NULL;
ALTER TABLE customers ADD COLUMN psycho_profile_at TIMESTAMP NULL DEFAULT NULL;
CREATE INDEX idx_customer_psycho ON customers (psycho_profile);
