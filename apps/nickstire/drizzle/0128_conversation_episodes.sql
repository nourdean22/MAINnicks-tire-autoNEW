-- 2026-09-22 · conversation_episodes — one counter interaction, with its evidence
--
-- The office Eufy camera at 192.168.0.167 was measured 2026-09-22 to carry a real audio
-- track (aac, 16 kHz, mono) alongside its video, so capturing counter conversations is
-- technically possible. This is where one captured interaction lands.
--
-- SOURCE-AGNOSTIC BY DESIGN. `source` names where the audio came from, because the camera
-- mic may turn out to be unusable at counter distance -- that is an open question a single
-- real recording will settle -- and the answer would be a dedicated counter microphone.
-- Nothing else in this table changes if the source does, which is the point.
--
-- EVERY EXTRACTED FACT CARRIES ITS EVIDENCE. `facts` stores, per fact, the transcript span
-- it came from and a confidence. A summary nobody can trace back to what was actually said
-- is a rumour with a timestamp, and the whole value here is being able to ask "where did it
-- get that?" -- especially when a fact contradicts a repair order.
--
-- LINKS ARE CANDIDATES, NEVER ASSERTIONS. `vehicleVisitId` and `workOrderId` are nullable
-- and carry their own confidence. Binding the wrong conversation to the wrong customer is
-- the expensive failure, and the camera side currently reads ZERO plates (measured: 552
-- visits over 14 days, 0 with plateText), so there is no identity to join on yet.
--
-- RETENTION IS DELIBERATELY SPLIT. `audioRef` is a POINTER, never the audio: raw audio is
-- the most sensitive artefact and should have the shortest life. The transcript outlives it,
-- the structured facts outlive the transcript. Nothing here stores the recording itself.

CREATE TABLE IF NOT EXISTS conversation_episodes (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  episodeId     VARCHAR(64)  NOT NULL,

  -- Where the audio came from. `eufy-office` today; `counter-mic` if the camera mic loses
  -- the intelligibility test. Recorded per row so a mixed deployment stays readable.
  source        VARCHAR(32)  NOT NULL,

  -- TIMESTAMP not DATETIME, matching vehicle_visits: the node driver hands JS a shifted
  -- Date for DATETIME on ET, which would corrupt every duration and day bucket downstream.
  startedAt     TIMESTAMP    NULL DEFAULT NULL,
  endedAt       TIMESTAMP    NULL DEFAULT NULL,
  durationSeconds INT        NULL DEFAULT NULL,

  -- A POINTER to the captured audio, never the audio. NULL once the clip is aged out, which
  -- must stay distinguishable from "never captured" -- hence nullable rather than empty.
  audioRef      VARCHAR(255) NULL DEFAULT NULL,

  -- Measured at capture. This is the intelligibility signal: a quiet mean volume means the
  -- mic was too far from the counter, and it explains a bad transcript without guessing.
  meanVolumeDb  DECIMAL(6,2) NULL DEFAULT NULL,

  -- PENDING | DONE | FAILED | SKIPPED. VARCHAR not ENUM, deliberately: TiDB runs
  -- STRICT_TRANS_TABLES, so an out-of-enum write is REJECTED and the row is LOST -- worst
  -- inside a failure handler trying to record why it failed. Widened past today's longest
  -- value on purpose.
  transcriptStatus VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  transcriptError  VARCHAR(500) NULL DEFAULT NULL,

  -- Timed segments from `transcribeAudio()`. NULL means not transcribed; an empty array
  -- means transcribed and genuinely silent. Those are different facts.
  transcript    JSON         NULL DEFAULT NULL,
  sttEngine     VARCHAR(32)  NULL DEFAULT NULL,
  sttLatencyMs  INT          NULL DEFAULT NULL,

  -- Distinct speakers if diarization ran. NULL = not attempted, which is today's state --
  -- never 0, because "no speakers detected" is a finding and "we did not look" is not.
  speakerCount  INT          NULL DEFAULT NULL,

  -- Extracted facts, each with the transcript span it came from and a confidence.
  facts         JSON         NULL DEFAULT NULL,
  summary       TEXT         NULL DEFAULT NULL,

  -- CANDIDATE links. Never authoritative; always paired with a confidence so a weak guess
  -- cannot be mistaken for a match downstream.
  vehicleVisitId VARCHAR(64) NULL DEFAULT NULL,
  workOrderId    VARCHAR(64) NULL DEFAULT NULL,
  linkConfidence DECIMAL(4,3) NULL DEFAULT NULL,

  createdAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uniq_conversation_episode (episodeId),
  INDEX idx_conversation_started (startedAt),
  INDEX idx_conversation_status (transcriptStatus, startedAt),
  INDEX idx_conversation_visit (vehicleVisitId)
);
