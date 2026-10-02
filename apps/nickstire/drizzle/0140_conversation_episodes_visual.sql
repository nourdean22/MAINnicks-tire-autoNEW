-- 0140 · conversation_episodes.visual — what the office camera SAW during a counter conversation
--
-- WHY (2026-10-02). The office lane only listened: Eufy motion/person events woke a bounded audio
-- capture, and no code ever looked at the picture. The producer now posts a few still frames per
-- episode (camera-bridge officewake, OFFICE_VISUAL_ENABLED); the server sends them to a vision model
-- and stores ONLY the resulting description here. Frames are never stored.
--
-- Shape (services/officeVisual.ts OfficeVisual):
--   {status: DONE|FAILED, summary, peopleCount, activities[], waitingUnattended, frameCount,
--    provider, model, latencyMs, error}
-- NULL means no frames were sent (or the episode predates this column) — distinct from a FAILED
-- object, which means frames arrived and the vision call could not describe them.
--
-- Additive, nullable, idempotent. Deploy order: the code ships FIRST and checks
-- information_schema for this column before calling the vision model or selecting it, so until
-- this is applied episodes post exactly as before. Applied through Admin -> Run migrations
-- (server/routers/nick/intelligence.ts carries the same statement).

ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS visual JSON NULL;
