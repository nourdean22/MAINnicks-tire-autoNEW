-- 2026-07-16 · drizzle/0082_lead_source_diagnose.sql
--
-- Give /diagnose symptom-checker leads their own canonical source value:
-- ["popup", "chat", "booking", "manual", "callback", "fleet",
--  "financing_preapproval", "sms", "careers", "diagnose"]
--
-- Until now DiagnosePage submitted source="popup" with a
-- "[/diagnose symptom check]" prefix in `problem` — a stopgap, because
-- writing "diagnose" before this DDL lands makes MySQL coerce the column
-- to '' (blank source, invisible to every source rollup).
--
-- SAFETY: MODIFY COLUMN, appending one option at the END of the enum.
-- This does not shrink, drop, or reorder any existing options, ensuring it
-- is backwards-compatible and completely safe (TiDB only supports appending).
--
-- DEPLOY ORDER: the operator must apply this DDL to prod TiDB BEFORE the
-- code that writes source="diagnose" deploys.

ALTER TABLE leads MODIFY COLUMN source ENUM('popup','chat','booking','manual','callback','fleet','financing_preapproval','sms','careers','diagnose') NOT NULL DEFAULT 'popup';
