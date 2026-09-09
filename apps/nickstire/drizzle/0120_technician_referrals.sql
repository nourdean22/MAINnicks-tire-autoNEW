-- 0120 · technician_referrals — structured tracking for the $300-after-90-days
-- technician-referral bonus advertised on /careers. Before this migration the
-- referrer's name lived only inside a free-text note concatenated onto the
-- applicant's `leads.problem` field (client/src/pages/Careers.tsx
-- ApplicationForm) — there was no way to reliably know who referred whom,
-- verify the 90-day condition, or pay the bonus out without a dispute.
--
-- One row per referral claim, soft-linked to the referred applicant's own
-- `leads` row (source:"careers") via leadId — no SQL-level FOREIGN KEY
-- constraint, matching this repo's existing convention (e.g. vehicle_visits
-- .customerId is a plain nullable INT, not a declared FK); referential
-- integrity is app-enforced, not DB-enforced, here.
--
-- Status is VARCHAR, not ENUM, per .claude/skills/nickstire-tidb-ddl: TiDB
-- runs STRICT_TRANS_TABLES, so a write outside an ENUM's declared values is
-- REJECTED and the row is LOST, not defaulted — worst inside a status-update
-- handler that itself can't then record the failure. varchar(32) matches the
-- repo's own status-column convention.
--
-- Every lifecycle timestamp is TIMESTAMP NULL DEFAULT NULL, not DATETIME:
-- AGENTS.md records that driver-parsed TiDB DATETIME values come back
-- shifted on ET, which would silently corrupt the 90-day eligibility math.
--
-- CREATE TABLE IF NOT EXISTS: additive, idempotent, safe to re-run, drops
-- nothing.
--
-- Hand-applied — there is no auto-migrate in this repo. Do NOT run this
-- against production without explicit operator approval (AGENTS.md
-- "Protected operations — never on agent initiative": production database
-- writes require an explicit instruction for this specific action, every
-- time). This file was written but NOT applied by the authoring session.

CREATE TABLE IF NOT EXISTS technician_referrals (
  id INT AUTO_INCREMENT PRIMARY KEY,

  leadId               INT          NULL,
  referrerName         VARCHAR(255) NOT NULL,
  referrerPhone        VARCHAR(30)  NULL,
  referrerTechnicianId INT          NULL,
  positionTitle        VARCHAR(100) NULL,

  status               VARCHAR(32)  NOT NULL DEFAULT 'pending',
  bonusAmountCents     INT          NOT NULL DEFAULT 30000,

  hiredAt              TIMESTAMP    NULL DEFAULT NULL,
  eligibleAt           TIMESTAMP    NULL DEFAULT NULL,
  paidAt               TIMESTAMP    NULL DEFAULT NULL,
  disqualifiedReason   VARCHAR(500) NULL,
  notes                TEXT         NULL,

  createdAt            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_tech_referral_lead (leadId),
  KEY idx_tech_referral_status (status),
  KEY idx_tech_referral_created (createdAt)
);
