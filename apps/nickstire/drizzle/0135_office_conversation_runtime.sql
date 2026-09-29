-- 0135 · Office conversation intelligence runtime truth
--
-- The Office Eufy camera and the conversation worker are related but not identical.
-- camera_runtime remains the ONE current-state record for the Office lane; these nullable
-- fields let Admin tell "camera healthy, worker stopped" from "worker ready, no customer"
-- without inventing a second health table.
--
-- NULL = not reported / not commissioned. False/0 = measured failure/zero.
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationWorkerOk BOOLEAN NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationWorkerState VARCHAR(32) NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationWorkerHeartbeatAt TIMESTAMP NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationAudioSource VARCHAR(64) NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationCaptureHost VARCHAR(64) NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationSttEngine VARCHAR(128) NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationQueueDepth INT NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationLastTrigger VARCHAR(32) NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationEventAt TIMESTAMP NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationCaptureAt TIMESTAMP NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationSttAt TIMESTAMP NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationPostAt TIMESTAMP NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationSummaryAt TIMESTAMP NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationCoverage DECIMAL(5,4) NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationFailuresToday INT NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationLastError VARCHAR(500) NULL;

-- Episode provenance. These stay nullable for pre-0135 history and self-tests.
ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS cameraSerial VARCHAR(64) NULL;
ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS captureHost VARCHAR(64) NULL;
ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS triggerType VARCHAR(32) NULL;
ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS triggeredAt TIMESTAMP NULL;
ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS sttModel VARCHAR(128) NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_camera_started
  ON conversation_episodes (cameraSerial, startedAt);
