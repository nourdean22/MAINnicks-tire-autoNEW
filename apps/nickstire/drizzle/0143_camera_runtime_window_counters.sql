-- 0143 - camera_runtime rolling-window plausibility counters
--
-- Two for the vehicle lane: `lastInferenceAt` (0120) says the detector RAN; these say what it
-- SAW over the last 10 / 60 minutes. Frames fine + zero detections for an hour inside business
-- hours is DEGRADED_VISION, and before these existed that day rendered "steady" (2026-10-05:
-- the SHOPSIGN lane counted 4 arrivals on a ~40-car day and every dashboard was green).
--
-- Six for the office conversation worker: what the last hour of LISTENING looked like, from
-- officewake.py's local receipt via the Eufy agent heartbeat. Coverage is capture seconds over
-- schedule-eligible seconds. "Alive and heard nothing" and "deaf" used to be the same READY.
--
-- NULL = this producer does not report the window. 0 = it looked and found none.
-- Hand-applied, idempotent, additive. Mirrored in routers/nick/intelligence.ts
-- handleRunMigrations. APPLY BEFORE the writer deploys where possible; the heartbeat route also
-- intersects its column list with INFORMATION_SCHEMA so a late apply drops only these fields
-- (logged once) instead of rejecting every camera heartbeat.
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS detectionsLast10m INT NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS portalCrossingsLast60m INT NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationListeningCoverage60m DECIMAL(5,4) NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationCaptureSecondsLast60m INT NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationCapturesLast60m INT NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationCaptureFailuresLast60m INT NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationWakeTriggersLast60m INT NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationTranscribeBacklog INT NULL;
