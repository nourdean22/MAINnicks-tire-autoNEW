-- 0090: widen reel_jobs.payload from TEXT (64KB) to MEDIUMTEXT (16MB).
--
-- The Creative Compiler 2.0 prompt pack repeats the locked visual-continuity
-- invariants + the continuity block per beat, so the serialized brief exceeds
-- 64KB on richer briefs. A TEXT column threw "Data too long for column
-- 'payload'" and intermittently failed enqueueReelJob AFTER it had already
-- reserved a content-governor slot — leaking a reservation and, on the
-- autonomous daily path, silently dropping the day's reel.
--
-- Surfaced by the CC2 live-render acceptance drive: the enqueued brief measured
-- 69,599 bytes (> 65,535). Widening is additive + non-destructive (no data
-- narrowing). Idempotent: MODIFY to an already-MEDIUMTEXT column is a no-op.
--
-- Additive only. Hand-applied via scripts/apply-0090-reel-payload-mediumtext.mts
-- (runner marks tracked without executing — the 0083-0087 trap).

ALTER TABLE `reel_jobs` MODIFY `payload` MEDIUMTEXT NOT NULL;
