-- 0143 · DVI measurements, multiple photos, post-work verification
--
-- WHY (2026-10-07). An inspection item carried one condition colour, free
-- text, and ONE photo. Three gaps, all on the EXISTING inspection_items table
-- (camelCase column convention preserved, as 0101 did):
--
--   1. Measurements lived in `notes` as prose ("pads at 3mm"), so nothing could
--      read them back, grade them, or compare before and after. measurementsJson
--      holds an array of { metric, value, position?, spec? } — the vocabulary
--      and the shop-guidance grading are in shared/inspectionMeasurements.ts.
--   2. One photo per finding. photoUrlsJson holds every photo; the first one is
--      mirrored into the existing photoUrl so every current reader (the customer
--      page, the opportunity queue's evidence class) keeps working unchanged.
--   3. No proof the approved work was done. The verification* columns record
--      who verified, when, a note, the AFTER photos and the AFTER measurements.
--      A verified item is complete: the opportunity queue stops chasing it and
--      the customer page shows the before/after.
--
-- Additive nullable columns only; no data movement; re-running is a no-op.
-- JSON, not ENUM: the metric list will grow and an out-of-enum write loses the
-- row under STRICT_TRANS_TABLES. verifiedBy is VARCHAR(255) to match
-- technicianName. TiDB needs one ALTER per column.
--
-- Hand-apply: pnpm exec tsx scripts/migrations/apply-dvi-measurements.ts
-- (idempotent, INFORMATION_SCHEMA-guarded, records itself in __drizzle_migrations).

ALTER TABLE inspection_items ADD COLUMN measurementsJson JSON NULL;
ALTER TABLE inspection_items ADD COLUMN photoUrlsJson JSON NULL;
ALTER TABLE inspection_items ADD COLUMN verifiedAt TIMESTAMP NULL;
ALTER TABLE inspection_items ADD COLUMN verifiedBy VARCHAR(255) NULL;
ALTER TABLE inspection_items ADD COLUMN verificationNote VARCHAR(500) NULL;
ALTER TABLE inspection_items ADD COLUMN verificationPhotoUrlsJson JSON NULL;
ALTER TABLE inspection_items ADD COLUMN verificationMeasurementsJson JSON NULL;
