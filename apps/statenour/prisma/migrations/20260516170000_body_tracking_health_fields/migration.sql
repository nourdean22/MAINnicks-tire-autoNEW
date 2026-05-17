-- v10.0.529.106 · Wave 63 · health-as-decision-variable.
--
-- Pre-Wave-63 BodyTracking captured weight + body fat only. Sleep +
-- workout + energy were architecturally important (MODE classifier
-- should trigger RECOVERY when sleep < 6h, morning brief should adapt
-- to body state) but the schema had no slots. Adding them directly
-- here so daily check-in stays single-table.

ALTER TABLE "body_tracking"
  ADD COLUMN "sleep_hours" DOUBLE PRECISION,
  ADD COLUMN "workout_done" BOOLEAN,
  ADD COLUMN "energy" SMALLINT,
  ADD COLUMN "stress" SMALLINT;
