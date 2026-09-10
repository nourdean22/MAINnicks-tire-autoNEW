-- 0121 · commissioning_runs + commissioning_truth_events — the human witness.
--
-- WHY. Migration 0120 gave a visit a `dataClass`, so a test drive stops counting as a
-- customer. This is the other half: a place to record what a HUMAN observed during that
-- drive, so the machine's answer can be compared against ground truth instead of against
-- a feeling. Without it, "the camera saw the car" is unfalsifiable.
--
-- THREE CLOCKS PER EVENT, and this is the point of the table.
--   phoneWallAt       the phone's own wall clock at the tap. Android's clock can be off
--                     by seconds; trusting it would put the error budget in the wrong
--                     place and make a correct pipeline look late.
--   phoneMonoMs       milliseconds since the run started, from a MONOTONIC source. Immune
--                     to a clock that steps mid-run (NTP correction, timezone change),
--                     which wall time is not.
--   serverReceivedAt  when the cloud got it. Network delay lives between this and the
--                     phone's clock, and separating them is what lets a report say
--                     "the camera was 285 ms behind the human" rather than
--                     "something somewhere took 1.4 s".
-- `correctedAt` is phoneWallAt adjusted by the run's measured offset; it is DERIVED and
-- stored so a report is reproducible even after the offset is re-measured.
--
-- Additive and idempotent. TIMESTAMP(3) for millisecond precision -- a portal crossing
-- and a button press are hundreds of milliseconds apart, and whole seconds would round
-- the very quantity being measured. Never DATETIME (driver-parsed TiDB DATETIME shifts).

CREATE TABLE IF NOT EXISTS commissioning_runs (
  runId VARCHAR(64) NOT NULL,
  camera VARCHAR(64) NOT NULL,
  label VARCHAR(191) NULL,
  startedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  endedAt TIMESTAMP(3) NULL DEFAULT NULL,
  startedBy VARCHAR(191) NULL,
  -- Clock sync measured at run start, from several round trips. NULL means "not
  -- measured", which a report must disclose rather than silently assuming zero.
  clockOffsetMs INT NULL,
  clockRttMs INT NULL,
  clockSamples INT NULL,
  -- The PHONE's own zero point for `phoneMonoMs`, corrected by the measured offset.
  -- Anchoring to `startedAt` instead would fold the entire start-request latency into
  -- every reconstructed tap as a constant error -- and a slow start would then look like
  -- a wall-clock step, or push a valid run past the match tolerance.
  monoOriginAt TIMESTAMP(3) NULL DEFAULT NULL,
  verdict VARCHAR(16) NULL,
  verdictReason VARCHAR(500) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (runId),
  INDEX idx_commissioning_runs_camera (camera, startedAt)
);

CREATE TABLE IF NOT EXISTS commissioning_truth_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  runId VARCHAR(64) NOT NULL,
  event VARCHAR(24) NOT NULL,
  phoneWallAt TIMESTAMP(3) NOT NULL,
  phoneMonoMs BIGINT NULL,
  serverReceivedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  correctedAt TIMESTAMP(3) NULL DEFAULT NULL,
  note VARCHAR(191) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_truth_events_run (runId, phoneWallAt)
);
