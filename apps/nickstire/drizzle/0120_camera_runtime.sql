-- 0120 · camera_runtime + camera_health_events + vehicle_visits.dataClass
--
-- WHY. `lot.health` derived the camera list from `vehicle_visits` rows, so a
-- perfectly healthy producer that had not yet seen a car was indistinguishable
-- from no producer ever existing: the admin rendered `cameras: []` for both.
-- Zero visits is a BUSINESS fact; producer health is an INFRASTRUCTURE fact.
-- They must not share one timestamp. This migration gives the infrastructure
-- fact its own row.
--
-- camera_runtime        latest heartbeat per camera (one row, upserted). Every
--                       field is what the PRODUCER observed; `receivedAt` is when
--                       the cloud got it, so clock skew and transport delay can be
--                       told apart. Idempotency key = (producerInstanceId,
--                       heartbeatSeq): a replayed or reordered heartbeat from the
--                       SAME instance cannot move the row backwards; a NEW instance
--                       (restart) legitimately resets the sequence.
-- camera_health_events  transitions only, never every heartbeat. Written by the
--                       ingest when the producer-reported state changes or the
--                       producer instance changes (a restart). Liveness states
--                       (STALE / PRODUCER_OFFLINE) are derived at READ time from
--                       age and are not logged here -- no heartbeat arrives to log
--                       them.
-- vehicle_visits        dataClass PRODUCTION | COMMISSIONING | REPLAY, so the
--                       first controlled test drive is not "today's customer
--                       arrival". Every KPI query filters PRODUCTION by default;
--                       commissioning rows are excluded, never deleted.
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- (TiDB supports both). TIMESTAMP everywhere, never DATETIME (AGENTS.md: driver-
-- parsed TiDB DATETIME comes back shifted on ET).

CREATE TABLE IF NOT EXISTS camera_runtime (
  camera VARCHAR(64) NOT NULL,
  producerInstanceId VARCHAR(64) NOT NULL,
  producerVersion VARCHAR(64) NULL,
  gitSha VARCHAR(40) NULL,
  heartbeatSeq INT NOT NULL DEFAULT 0,
  observedAtEdge TIMESTAMP NULL DEFAULT NULL,
  receivedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mode VARCHAR(16) NOT NULL DEFAULT 'PRODUCTION',
  commissioningRunId VARCHAR(64) NULL,
  sourceType VARCHAR(32) NULL,
  sourceGeneration VARCHAR(64) NULL,
  sourceConnected TINYINT(1) NULL,
  lastFrameAt TIMESTAMP NULL DEFAULT NULL,
  lastHealthyFrameAt TIMESTAMP NULL DEFAULT NULL,
  captureFps FLOAT NULL,
  frameOk TINYINT(1) NULL,
  poseOk TINYINT(1) NULL,
  poseDelta FLOAT NULL,
  calibrationVersion VARCHAR(32) NULL,
  detectorName VARCHAR(128) NULL,
  modelSha256 VARCHAR(64) NULL,
  lastInferenceAt TIMESTAMP NULL DEFAULT NULL,
  inferenceP95Ms FLOAT NULL,
  openVisits INT NULL,
  outboxDepth INT NULL,
  oldestOutboxAgeSeconds INT NULL,
  deadLetterDepth INT NULL,
  lastCloudAckAt TIMESTAMP NULL DEFAULT NULL,
  diskFreeBytes BIGINT NULL,
  restores INT NULL,
  state VARCHAR(32) NOT NULL,
  stateSince TIMESTAMP NULL DEFAULT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (camera),
  INDEX idx_camera_runtime_receivedAt (receivedAt)
);

CREATE TABLE IF NOT EXISTS camera_health_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  camera VARCHAR(64) NOT NULL,
  fromState VARCHAR(32) NULL,
  toState VARCHAR(32) NOT NULL,
  reason VARCHAR(191) NULL,
  producerInstanceId VARCHAR(64) NULL,
  sourceGeneration VARCHAR(64) NULL,
  at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_camera_health_events_camera_at (camera, at)
);

ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS dataClass VARCHAR(16) NOT NULL DEFAULT 'PRODUCTION';
ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS commissioningRunId VARCHAR(64) NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_visits_dataClass ON vehicle_visits (dataClass);
