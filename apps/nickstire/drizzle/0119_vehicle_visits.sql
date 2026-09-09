-- 0119 · vehicle_visits — the shop-side read model for camera visit truth.
--
-- Product boundary (ADR-0017, refined 2026-09-09): operational shop intelligence
-- belongs in nickstire.org/admin. StateNour receives owner-level summaries and
-- anomalies, not the primary shop-operations cockpit. Until now the only durable
-- camera record lived in StateNour's `device_events`, so the shop had nowhere to
-- read "who is on the lot right now".
--
-- One row per VISIT (not per event), written through POST /api/camera/visits;
-- `seq` carries the last applied emission sequence so an out-of-order or duplicate
-- delivery cannot move a visit backwards.
--
-- PRODUCER STATUS (corrected 2026-09-09; the original note below it is superseded).
-- Two producers now exist, both on branches open at the time of writing:
--   * camera-bridge/vision/run_live.py -- VisitSink + --post-to, so the vision
--     pipeline's emissions can be posted straight at this route.
--   * camera-bridge/visitd/shop_mirror.py -- a best-effort mirror wired into
--     visitd's after_step, accumulating per-visit rows because the ingest does a
--     guarded full-column replace. send() never raises, so a shop-side outage
--     cannot take visitd down.
-- The ORIGINAL note here read "NO PRODUCER IS WIRED YET ... nothing in
-- camera-bridge/ references the nickstire ingest route". That was true when this
-- migration was written and is now false; it is corrected rather than deleted so
-- the change of state is visible.
--
-- What is still true, and is the operationally important part: applying this
-- migration is SAFE AND INERT. It is CREATE TABLE IF NOT EXISTS, it is additive,
-- it drops nothing, and until a producer actually runs against a live camera the
-- table stays empty and the Lot section correctly reports "awaiting first event"
-- rather than inventing a lot state.
--
-- Every timestamp is NULLABLE on purpose: an unknown time stays unknown rather
-- than being back-filled with a plausible guess. `estimatedFields` records which
-- values were inferred rather than observed.
--
-- Hand-applied (both apps migrate by hand; there is no auto-migrate).
--
-- COLUMN WIDTHS ARE SIZED AGAINST WHAT THE CODE WRITES, NOT WHAT READS NICELY.
-- TiDB runs STRICT_TRANS_TABLES: an over-width write is REJECTED and the row is
-- LOST, not truncated. Two columns here were originally one character from that:
--   detectorName  -- "openvino:person-vehicle-bike-detection-crossroad-1016+adjudicated"
--                    is exactly 64 chars, so varchar(64) would have silently
--                    dropped every escalated-detection row. Now 128.
--   entryEvidence -- the portal's longest rejection reason, "no outside history:
--                    born inside the property (not an entry)", is 58 chars, and
--                    these strings are prose that will grow. Now 191.
-- Status columns follow the repo's varchar(32) convention rather than being sized
-- to today's longest value; ENUM is deliberately avoided because an out-of-enum
-- write loses the row and every new state would need an ALTER.

CREATE TABLE IF NOT EXISTS vehicle_visits (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,

  visitId          VARCHAR(64)  NOT NULL,
  camera           VARCHAR(64)  NOT NULL,
  state            VARCHAR(32)  NOT NULL,
  seq              INT          NOT NULL DEFAULT 0,

  -- lifecycle. NULL means "not observed", never "zero".
  -- TIMESTAMP NULL DEFAULT NULL, not DATETIME. DATETIME carries no timezone and
  -- AGENTS.md records that driver-parsed TiDB DATETIME values come back shifted on
  -- ET, which would silently corrupt every wait time and day bucket computed from
  -- them. The explicit DEFAULT NULL also suppresses MySQL's implicit
  -- auto-initialise on the first TIMESTAMP column.
  arrivedAt        TIMESTAMP    NULL DEFAULT NULL,
  waitStartedAt    TIMESTAMP    NULL DEFAULT NULL,
  bayEnteredAt     TIMESTAMP    NULL DEFAULT NULL,
  bayExitedAt      TIMESTAMP    NULL DEFAULT NULL,
  departedAt       TIMESTAMP    NULL DEFAULT NULL,
  bay              VARCHAR(32)  NULL,

  -- identity. Advisory until EXACT or staff-confirmed.
  plateText        VARCHAR(16)  NULL,
  plateStatus      VARCHAR(32)  NOT NULL DEFAULT 'NONE',
  customerMatch    VARCHAR(32)  NOT NULL DEFAULT 'NONE',
  customerId       INT          NULL,

  -- provenance: why the system believed this
  preexisting      TINYINT(1)   NOT NULL DEFAULT 0,
  entryEvidence    VARCHAR(191) NULL,
  estimatedFields  JSON         NULL,
  evidenceRef      VARCHAR(255) NULL,
  sourceGeneration VARCHAR(64)  NULL,
  cameraPose       VARCHAR(64)  NULL,
  detectorName     VARCHAR(128) NULL,
  calibrationVersion VARCHAR(32) NULL,

  createdAt        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_vehicle_visits_visitId (visitId),
  KEY idx_vehicle_visits_state (state),
  KEY idx_vehicle_visits_arrivedAt (arrivedAt),
  KEY idx_vehicle_visits_departedAt (departedAt),
  KEY idx_vehicle_visits_bay (bay),
  KEY idx_vehicle_visits_plateText (plateText)
);
