-- 2026-09-22 · visit episode identity + stitch counters
--
-- A tracker id is not a vehicle. `camera-bridge/vision/stitch.py` (PR #2493) decides when
-- a new track CONTINUES an earlier one and carries the original arrival instant forward,
-- but the shop table had nowhere to record WHICH tracks were folded together -- so the
-- corrected `arrivedAt` landed with no way to audit how it was assembled.
--
-- Measured 2026-09-22 on the edge ledger: shop-left 152 track deaths in a day against
-- 1-6 invoiced jobs, only 13.8% ever re-acquired; shop-right 81 / 18.5%.
--
-- EVERY COLUMN IS NULLABLE, on purpose and for the same reason drizzle/0124 gave:
-- a producer predating these sends none of them, and NULL must read as "not reported"
-- rather than as a confident zero or an empty trail.
--
-- APPLY THIS BEFORE deploying the code that writes them. The visit upsert names every
-- column, so the reverse order breaks ingest for every camera.

ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS episodeId VARCHAR(64) NULL;
ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS continuesVisitId VARCHAR(64) NULL;
ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS memberTrackIds JSON NULL;

-- Grouping every fragment of one visit is the whole point of the episode id, so it needs
-- an index or the Lot board's "show me this visit's pieces" is a table scan.
-- IF NOT EXISTS because handleRunMigrations re-runs this list on every invocation; a bare
-- CREATE INDEX would throw on the second pass and abort the statements after it.
CREATE INDEX IF NOT EXISTS idx_vehicle_visits_episode ON vehicle_visits (episodeId);

-- Camera-level stitch counters, mirroring the relocateFailures/preexistingCrossed pair
-- added in 0124. `arrivalsAfterStitch` is the de-duplicated shadow of `arrivals`: it is
-- reported ALONGSIDE the headline count, never instead of it, per the operator's
-- 2026-09-18 instruction to keep the counter running and unhidden.
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS arrivalsAfterStitch INT NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS stitchedTotal INT NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS stitchRefusedAmbiguous INT NULL;
