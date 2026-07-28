-- 0101 · DVI evidence-to-approval — customer decisions + view tracking
--
-- Completes the drop-off Digital Vehicle Inspection loop on the two
-- EXISTING tables (vehicle_inspections / inspection_items, camelCase
-- column convention preserved). Additive nullable columns only.
--
--   - View tracking: firstViewedAt + viewCount on the packet — "did the
--     customer even open it" is the first evidence question.
--   - Per-item customer decisions: approved | declined | question, with
--     timestamp + optional free-text note (their words, never invented).
--
-- Hand-apply: pnpm exec tsx scripts/migrations/apply-dvi-decisions.ts

ALTER TABLE vehicle_inspections ADD COLUMN firstViewedAt TIMESTAMP NULL;
ALTER TABLE vehicle_inspections ADD COLUMN viewCount INT NOT NULL DEFAULT 0;
ALTER TABLE inspection_items ADD COLUMN decision VARCHAR(16) NULL;
ALTER TABLE inspection_items ADD COLUMN decisionAt TIMESTAMP NULL;
ALTER TABLE inspection_items ADD COLUMN customerNote VARCHAR(500) NULL;
