-- 0122 · candidates — a dedicated home for /careers job applicants, NOT a
-- `leads` row.
--
-- Before this table, Careers.tsx's ApplicationForm submitted through
-- trpc.lead.submit — the same endpoint customer sales inquiries use. That
-- meant every job applicant: got AI-urgency-scored by scoreLead() as if
-- their application text were a car-repair problem; received the generic
-- lead-confirmation SMS, which literally asks "What's going on with the
-- car — tires, brakes, check engine, or something else?" (server/sms.ts,
-- leadConfirmationSms — verified against the live function); and entered
-- every downstream customer-lead system (sales opportunity queue, stale-lead
-- follow-up crons, Meta Conversions API, Google Sheets sync) with no way for
-- any of those systems to know "careers" isn't a sales channel.
--
-- IMPORTANT — this table and its router (server/routers/candidates.ts) are
-- additive and NOT YET wired into Careers.tsx as of this migration landing.
-- Cutting Careers.tsx's ApplicationForm over from lead.submit to
-- candidates.submit is a deliberate follow-up step, gated on THIS migration
-- being applied to production first — apply-then-wire, the same sequencing
-- this repo already uses for a schema change a live code path would
-- otherwise query before the table exists.
--
-- Also adds technician_referrals.candidateId (additive, nullable) — the
-- existing leadId column is kept for rows created before this table existed;
-- once Careers.tsx cuts over, new referral submissions populate candidateId
-- instead. No SQL-level FOREIGN KEY constraint on either column, matching
-- this repo's existing convention (e.g. vehicle_visits.customerId) —
-- referential integrity is app-enforced, not DB-enforced, here.
--
-- Status is VARCHAR, not ENUM, per .claude/skills/nickstire-tidb-ddl: TiDB
-- runs STRICT_TRANS_TABLES, so a write outside an ENUM's declared values is
-- REJECTED and the row is LOST, not defaulted. varchar(32) matches the
-- repo's own status-column convention.
--
-- CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS: additive,
-- idempotent, safe to re-run, drops nothing.
--
-- Hand-applied — there is no auto-migrate in this repo. Do NOT run this
-- against production without explicit operator approval (AGENTS.md
-- "Protected operations — never on agent initiative"). This file was
-- written but NOT applied by the authoring session.

CREATE TABLE IF NOT EXISTS candidates (
  id INT AUTO_INCREMENT PRIMARY KEY,

  name             VARCHAR(255) NOT NULL,
  phone            VARCHAR(30)  NOT NULL,
  email            VARCHAR(320) NULL,
  positionTitle    VARCHAR(100) NULL,
  experienceLevel  VARCHAR(32)  NULL,
  message          TEXT         NULL,

  source           VARCHAR(40)  NOT NULL DEFAULT 'careers',
  status           VARCHAR(32)  NOT NULL DEFAULT 'new',

  utmSource        VARCHAR(100) NULL,
  utmMedium        VARCHAR(100) NULL,
  utmCampaign      VARCHAR(255) NULL,
  landingPage      VARCHAR(500) NULL,
  referrer         VARCHAR(500) NULL,
  sessionId        VARCHAR(64)  NULL,

  contactedAt      TIMESTAMP    NULL DEFAULT NULL,
  contactedBy      VARCHAR(255) NULL,
  notes            TEXT         NULL,

  createdAt        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_candidate_phone (phone),
  KEY idx_candidate_status (status),
  KEY idx_candidate_created (createdAt)
);

ALTER TABLE technician_referrals ADD COLUMN IF NOT EXISTS candidateId INT NULL;
