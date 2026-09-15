-- Reality Ledger · Dream-to-Proof wave · 2026-09-15
--
-- The Evidence Substrate: an append-only, OCEL-style event log (one event may
-- belong to several objects) plus the claims made on top of it, each carrying
-- an evidence grade H0..H5 so a click is never reported as a dollar; and the
-- pairwise taste judgments the operator makes between candidates.
--
-- Additive only. Three new tables, three new enum types, one new value on the
-- existing WorkItemType enum. No data movement. Does not touch
-- vector_embeddings.embedding_vec* or the chat_messages tsvector column.
--
-- Hand-applied (this app has no auto-migrate). Verify with
-- `prisma migrate status` against prod before declaring it done.

CREATE TYPE "EvidenceGrade" AS ENUM ('H0', 'H1', 'H2', 'H3', 'H4', 'H5');
CREATE TYPE "ClaimDisposition" AS ENUM ('SUPPORTED', 'REFUTED', 'INCONCLUSIVE');
CREATE TYPE "LedgerAuthor" AS ENUM ('AGENT', 'CRON', 'OPERATOR');

-- Postgres cannot add an enum value inside the same transaction that uses it;
-- Prisma applies each migration in its own transaction and nothing below reads
-- the new value, so a plain ADD VALUE is safe here.
ALTER TYPE "WorkItemType" ADD VALUE IF NOT EXISTS 'DREAM_TO_PROOF_PROPOSAL';

CREATE TABLE "reality_events" (
  "id"            TEXT PRIMARY KEY,
  "event_type"    VARCHAR(80) NOT NULL,
  "observed_at"   TIMESTAMP(3) NOT NULL,
  "objects"       JSONB NOT NULL,
  "source_system" VARCHAR(64) NOT NULL,
  "source_uri"    VARCHAR(500),
  "experiment_id" VARCHAR(120),
  "variant_id"    VARCHAR(64),
  "contract_hash" VARCHAR(32),
  "quality"       VARCHAR(16) NOT NULL DEFAULT 'observed',
  "privacy"       VARCHAR(16) NOT NULL DEFAULT 'internal',
  "payload"       JSONB,
  "sender"        VARCHAR(64) NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "reality_events_event_type_observed_at_idx" ON "reality_events"("event_type", "observed_at");
CREATE INDEX "reality_events_experiment_id_idx" ON "reality_events"("experiment_id");
CREATE INDEX "reality_events_created_at_idx" ON "reality_events"("created_at");

CREATE TABLE "evidence_claims" (
  "id"                TEXT PRIMARY KEY,
  "claim_text"        TEXT NOT NULL,
  "grade"             "EvidenceGrade" NOT NULL,
  "disposition"       "ClaimDisposition" NOT NULL DEFAULT 'INCONCLUSIVE',
  "hypothesis_id"     VARCHAR(120),
  "goal_id"           VARCHAR(80),
  "contract_hash"     VARCHAR(32),
  "source_event_keys" JSONB,
  "confidence"        DOUBLE PRECISION,
  "created_by"        "LedgerAuthor" NOT NULL DEFAULT 'AGENT',
  "superseded_by_id"  TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "evidence_claims_grade_created_at_idx" ON "evidence_claims"("grade", "created_at");
CREATE INDEX "evidence_claims_hypothesis_id_idx" ON "evidence_claims"("hypothesis_id");
CREATE INDEX "evidence_claims_goal_id_idx" ON "evidence_claims"("goal_id");

CREATE TABLE "taste_judgments" (
  "id"           TEXT PRIMARY KEY,
  "surface"      VARCHAR(32) NOT NULL,
  "context"      TEXT NOT NULL,
  "candidate_a"  JSONB NOT NULL,
  "candidate_b"  JSONB NOT NULL,
  "winner"       VARCHAR(1) NOT NULL,
  "reason_codes" TEXT[] NOT NULL,
  "rationale"    TEXT,
  "goal_id"      VARCHAR(80),
  "decided_by"   VARCHAR(64) NOT NULL,
  "decided_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "taste_judgments_surface_decided_at_idx" ON "taste_judgments"("surface", "decided_at");
