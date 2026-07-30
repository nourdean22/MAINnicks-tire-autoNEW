/**
 * POST /api/system/apply-pending-migration  ·  body: { name: string }
 *
 * Guarded admin tool to apply a PRE-REGISTERED pending migration from inside
 * the deployed app — where the prod DATABASE_URL lives. Solves the recurring
 * blocker: the dev/agent environment has no prod creds, so `prisma migrate`
 * can't reach Neon (see prisma/migrations-pending/README.md). Mirrors the
 * nickstire `runMigrations` admin pattern.
 *
 * SECURITY:
 *  · requireSession — operator-only (same auth as every other surface).
 *  · NO arbitrary SQL — only migrations in the inlined MIGRATIONS registry
 *    below (operator-controlled, changes only via a deploy).
 *  · Every statement is idempotent (IF NOT EXISTS / constraint-existence
 *    guards) so re-running is a no-op.
 *  · This endpoint NEVER writes _prisma_migrations. It used to insert a
 *    `manual-endpoint-<name>` row "so migrate deploy never re-runs it" — but
 *    nothing in this repo runs `migrate deploy`, and rows for names with no
 *    prisma/migrations/<name>/ dir are exactly what turned `prisma migrate
 *    status` red (2026-07-29 ledger reconciliation, 9 orphan rows deleted —
 *    docs/STATENOUR-OBSERVABILITY-TRUTH-ARC.2026-07-29.cgd.md). Recording is
 *    the canonical flow's job: promote the SQL to prisma/migrations/<name>/
 *    and run `prisma migrate resolve --applied <name>`.
 *
 * To add a future migration: add `<name>: [statements]` to MIGRATIONS, deploy,
 * then POST { name }.
 */
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Inlined, idempotent migration statements (operator-controlled · deploy-gated). */
const MIGRATIONS: Record<string, string[]> = {
  // Ambition Engine P1 · /stats goals redesign · additive · zero data loss.
  // Matches prisma/migrations-pending/0003_ambition_engine/migration.sql.
  "0003_ambition_engine": [
    `ALTER TABLE "life_goals" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'metric'`,
    `ALTER TABLE "life_goals" ADD COLUMN IF NOT EXISTS "parentGoalId" TEXT`,
    `ALTER TABLE "life_goals" ADD COLUMN IF NOT EXISTS "conviction" INTEGER`,
    `ALTER TABLE "life_goals" ADD COLUMN IF NOT EXISTS "ambition" TEXT`,
    `ALTER TABLE "life_goals" ADD COLUMN IF NOT EXISTS "lastChallengedAt" TIMESTAMP(3)`,
    `ALTER TABLE "life_goals" ADD COLUMN IF NOT EXISTS "killCriteria" TEXT`,
    `ALTER TABLE "life_goals" ADD COLUMN IF NOT EXISTS "killBy" TIMESTAMP(3)`,
    `ALTER TABLE "life_goals" ADD COLUMN IF NOT EXISTS "identityLine" TEXT`,
    `CREATE INDEX IF NOT EXISTS "life_goals_parentGoalId_idx" ON "life_goals"("parentGoalId")`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'life_goals_parentGoalId_fkey') THEN ALTER TABLE "life_goals" ADD CONSTRAINT "life_goals_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "life_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
    `CREATE TABLE IF NOT EXISTS "goal_stats" ("id" TEXT NOT NULL, "goalId" TEXT NOT NULL, "statKey" TEXT NOT NULL, "weight" DOUBLE PRECISION NOT NULL DEFAULT 1, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "goal_stats_pkey" PRIMARY KEY ("id"))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "goal_stats_goalId_statKey_key" ON "goal_stats"("goalId", "statKey")`,
    `CREATE INDEX IF NOT EXISTS "goal_stats_statKey_idx" ON "goal_stats"("statKey")`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goal_stats_goalId_fkey') THEN ALTER TABLE "goal_stats" ADD CONSTRAINT "goal_stats_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "life_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$`,
  ],

  // Task classification + scoring · 2026-06-01 · additive · zero data loss.
  // statHints holds the classifier-assigned mastery stat keys a task feeds
  // (so goal-less tasks still credit a real stat on completion). TEXT[] with
  // an empty-array default — existing rows backfill to [] automatically.
  "0004_task_stat_hints": [
    `ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "statHints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
  ],

  // Journal Brain · Phase 0 · 2026-06-01 · additive · zero data loss.
  // Grounding/scoring columns on the 4 journal silos + single-row
  // JournalSettings. Matches prisma/migrations-pending/20260601_journal_brain_foundation.
  "20260601_journal_brain_foundation": [
    `ALTER TABLE "brain_dumps" ADD COLUMN IF NOT EXISTS "entry_type" TEXT, ADD COLUMN IF NOT EXISTS "goal_id" TEXT, ADD COLUMN IF NOT EXISTS "mission_id" TEXT, ADD COLUMN IF NOT EXISTS "link_confidence" DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS "link_status" TEXT, ADD COLUMN IF NOT EXISTS "enriched_at" TIMESTAMP(3)`,
    `ALTER TABLE "reflections" ADD COLUMN IF NOT EXISTS "goal_id" TEXT, ADD COLUMN IF NOT EXISTS "mission_id" TEXT, ADD COLUMN IF NOT EXISTS "link_confidence" DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS "link_status" TEXT, ADD COLUMN IF NOT EXISTS "enriched_at" TIMESTAMP(3)`,
    `ALTER TABLE "situation_logs" ADD COLUMN IF NOT EXISTS "goal_id" TEXT, ADD COLUMN IF NOT EXISTS "mission_id" TEXT, ADD COLUMN IF NOT EXISTS "link_confidence" DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS "link_status" TEXT, ADD COLUMN IF NOT EXISTS "enriched_at" TIMESTAMP(3)`,
    `ALTER TABLE "decision_replays" ADD COLUMN IF NOT EXISTS "goal_id" TEXT, ADD COLUMN IF NOT EXISTS "mission_id" TEXT, ADD COLUMN IF NOT EXISTS "link_confidence" DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS "link_status" TEXT, ADD COLUMN IF NOT EXISTS "enriched_at" TIMESTAMP(3)`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brain_dumps_goal_id_fkey') THEN ALTER TABLE "brain_dumps" ADD CONSTRAINT "brain_dumps_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "life_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brain_dumps_mission_id_fkey') THEN ALTER TABLE "brain_dumps" ADD CONSTRAINT "brain_dumps_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reflections_goal_id_fkey') THEN ALTER TABLE "reflections" ADD CONSTRAINT "reflections_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "life_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reflections_mission_id_fkey') THEN ALTER TABLE "reflections" ADD CONSTRAINT "reflections_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'situation_logs_goal_id_fkey') THEN ALTER TABLE "situation_logs" ADD CONSTRAINT "situation_logs_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "life_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'situation_logs_mission_id_fkey') THEN ALTER TABLE "situation_logs" ADD CONSTRAINT "situation_logs_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decision_replays_goal_id_fkey') THEN ALTER TABLE "decision_replays" ADD CONSTRAINT "decision_replays_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "life_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decision_replays_mission_id_fkey') THEN ALTER TABLE "decision_replays" ADD CONSTRAINT "decision_replays_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
    `CREATE INDEX IF NOT EXISTS "brain_dumps_entry_type_idx" ON "brain_dumps"("entry_type")`,
    `CREATE INDEX IF NOT EXISTS "brain_dumps_goal_id_idx" ON "brain_dumps"("goal_id")`,
    `CREATE INDEX IF NOT EXISTS "brain_dumps_enriched_at_idx" ON "brain_dumps"("enriched_at")`,
    `CREATE INDEX IF NOT EXISTS "reflections_goal_id_idx" ON "reflections"("goal_id")`,
    `CREATE INDEX IF NOT EXISTS "reflections_enriched_at_idx" ON "reflections"("enriched_at")`,
    `CREATE INDEX IF NOT EXISTS "situation_logs_goal_id_idx" ON "situation_logs"("goal_id")`,
    `CREATE INDEX IF NOT EXISTS "situation_logs_enriched_at_idx" ON "situation_logs"("enriched_at")`,
    `CREATE INDEX IF NOT EXISTS "decision_replays_goal_id_idx" ON "decision_replays"("goal_id")`,
    `CREATE INDEX IF NOT EXISTS "decision_replays_enriched_at_idx" ON "decision_replays"("enriched_at")`,
    `CREATE TABLE IF NOT EXISTS "journal_settings" ("id" TEXT NOT NULL, "baseline_xp" DOUBLE PRECISION NOT NULL DEFAULT 0.8, "baseline_enabled" BOOLEAN NOT NULL DEFAULT true, "quality_floor_chars" INTEGER NOT NULL DEFAULT 40, "grounded_xp_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5, "auto_confirm_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8, "challenge_cadence" TEXT NOT NULL DEFAULT 'daily', "creative_intensity" TEXT NOT NULL DEFAULT 'bold', "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "journal_settings_pkey" PRIMARY KEY ("id"))`,
  ],

  // Task confirm-chip · 2026-06-01 · additive · zero data loss. Parks a
  // LOW-confidence mission/goal suggestion for operator approval (mirrors
  // PersonProfile.pending_classification). Nullable JSONB; existing rows = NULL.
  "0006_task_pending_classification": [
    `ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "pending_classification" JSONB`,
  ],

  // Brain hybrid-retrieval FTS lane · 2026-06-02 · additive · zero data loss.
  // Expression GIN index for full-text search on brain_memories.content,
  // powering the real lexical lane in lib/brain/contextual-recall.ts (it
  // replaces the naive substring keywordScore lane). On a SEPARATE table from
  // vector_embeddings, so pgvector is untouched. ~7K rows -> sub-second build.
  // No new column -> no Prisma drift. The recall query degrades to a seq-scan
  // pre-apply (still correct, just slower), so the code is safe to deploy
  // ahead of applying this.
  "0007_brain_fts": [
    `CREATE INDEX IF NOT EXISTS "brain_memories_content_fts_idx" ON "brain_memories" USING GIN (to_tsvector('english', "content"))`,
  ],

  // Custom weekday recurrence · 2026-06-06 · additive · zero data loss.
  // Adds the WEEKLY loop kind + recurring_days int[] (0=Sun..6=Sat) so a task
  // can recur on chosen weekdays (e.g. every Thursday). On completion checkTask
  // snoozes a WEEKLY task to its next listed weekday; the task-resurface cron
  // resurfaces it (WAITING -> READY) then. COLUMN-FIRST: apply BEFORE the
  // schema/code that reads recurring_days is relied upon.
  "0008_task_weekly_recurrence": [
    `ALTER TYPE "LoopKind" ADD VALUE IF NOT EXISTS 'WEEKLY'`,
    `ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "recurring_days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[]`,
  ],

  // PersonProfile origin + contact · 2026-06-06 · additive · zero data loss.
  // source (operator|agent|digest) makes shop-vs-personal structural; phone +
  // email are stored contact identity (displayed; NOT a match key). All nullable.
  // Matches prisma/migrations-pending/0009_person_source_contact/migration.sql.
  "0009_person_source_contact": [
    `ALTER TABLE "person_profiles" ADD COLUMN IF NOT EXISTS "source" TEXT`,
    `ALTER TABLE "person_profiles" ADD COLUMN IF NOT EXISTS "phone" TEXT`,
    `ALTER TABLE "person_profiles" ADD COLUMN IF NOT EXISTS "email" TEXT`,
  ],

  // Domain-anchored missions + classifier learning · 2026-06-09 · additive ·
  // zero data loss · NO enum changes (pgvector-safe). system_kind="GENERAL"
  // marks the 6 per-domain anchor missions; canonical_domain is the routing
  // key (the legacy MissionDomain enum is kept + mapped in code). The
  // corrections table is the classifier's few-shot learning signal.
  // Matches prisma/migrations-pending/0010_domain_missions/migration.sql.
  "0010_domain_missions": [
    `ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "system_kind" VARCHAR(16)`,
    `ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "canonical_domain" VARCHAR(24)`,
    `CREATE TABLE IF NOT EXISTS "task_classification_corrections" ("id" TEXT NOT NULL, "task_title" TEXT NOT NULL, "chosen_mission_id" TEXT, "domain" VARCHAR(24), "created_by" VARCHAR(64) DEFAULT 'user', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "task_classification_corrections_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "task_classification_corrections_created_at_idx" ON "task_classification_corrections" ("created_at" DESC)`,
  ],

  // change-detection-lite sensor · NEW table only · additive · zero data loss.
  // Matches prisma/migrations-pending/20260722000000_page_snapshots/migration.sql.
  "20260722000000_page_snapshots": [
    `CREATE TABLE IF NOT EXISTS "page_snapshots" ("id" TEXT NOT NULL, "url" TEXT NOT NULL, "label" TEXT, "content_hash" TEXT NOT NULL, "content" TEXT NOT NULL, "changed" BOOLEAN NOT NULL DEFAULT false, "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "page_snapshots_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "page_snapshots_url_checked_at_idx" ON "page_snapshots" ("url", "checked_at")`,
    `CREATE INDEX IF NOT EXISTS "page_snapshots_changed_checked_at_idx" ON "page_snapshots" ("changed", "checked_at")`,
  ],

  // Closed-loop Experiment factory · NEW table + nullable columns · additive · zero data loss.
  // Matches prisma/migrations-pending/20260722120000_experiment_factory/migration.sql.
  // COLUMN-FIRST: the two ADD COLUMN statements touch hot tables — apply BEFORE the
  // schema deploy (see the .sql header). This registry entry is the idempotent re-apply /
  // record-of-truth path once the code is live.
  "20260722120000_experiment_factory": [
    `CREATE TABLE IF NOT EXISTS "experiments" ("id" TEXT NOT NULL, "opportunity_id" TEXT NOT NULL, "source_id" TEXT, "hypothesis" TEXT NOT NULL, "metric" TEXT, "baseline" DOUBLE PRECISION, "expected_effect" DOUBLE PRECISION, "status" TEXT NOT NULL DEFAULT 'running', "actual_result" TEXT, "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "due_at" TIMESTAMP(3) NOT NULL, "measured_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "experiments_pkey" PRIMARY KEY ("id"))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "experiments_opportunity_id_key" ON "experiments" ("opportunity_id")`,
    `CREATE INDEX IF NOT EXISTS "experiments_status_due_at_idx" ON "experiments" ("status", "due_at")`,
    `CREATE INDEX IF NOT EXISTS "experiments_source_id_idx" ON "experiments" ("source_id")`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiments_opportunity_id_fkey') THEN ALTER TABLE "experiments" ADD CONSTRAINT "experiments_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiments_source_id_fkey') THEN ALTER TABLE "experiments" ADD CONSTRAINT "experiments_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
    `ALTER TABLE "opportunity_logs" ADD COLUMN IF NOT EXISTS "source_id" TEXT`,
    `CREATE INDEX IF NOT EXISTS "opportunity_logs_source_id_idx" ON "opportunity_logs" ("source_id")`,
    `ALTER TABLE "intelligence_sources" ADD COLUMN IF NOT EXISTS "auth_score_updated_at" TIMESTAMP(3)`,
    `ALTER TABLE "intelligence_sources" ADD COLUMN IF NOT EXISTS "auth_score_samples" INTEGER NOT NULL DEFAULT 0`,
  ],

  "0011_approval_queue_and_memory_inbox": [
    `CREATE TABLE IF NOT EXISTS "approval_requests" (
      "id" TEXT NOT NULL,
      "action_type" TEXT NOT NULL,
      "tool_id" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending_approval',
      "risk_class" TEXT NOT NULL,
      "payload" JSONB NOT NULL,
      "result_payload" JSONB,
      "requested_by" TEXT NOT NULL,
      "reason" TEXT NOT NULL,
      "expires_at" TIMESTAMP(3) NOT NULL,
      "approved_at" TIMESTAMP(3),
      "approved_by" TEXT,
      "executed_at" TIMESTAMP(3),
      "screenshot_url" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "approval_requests_status_idx" ON "approval_requests"("status")`,
    `CREATE INDEX IF NOT EXISTS "approval_requests_created_at_idx" ON "approval_requests"("created_at")`,
    `CREATE TABLE IF NOT EXISTS "memory_inbox_items" (
      "id" TEXT NOT NULL,
      "source_url" TEXT,
      "source_type" TEXT NOT NULL,
      "raw_text_fenced" TEXT NOT NULL,
      "extracted_claims" JSONB NOT NULL,
      "contradiction_logs" JSONB,
      "privacy_class" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'quarantined',
      "reviewed_by" TEXT,
      "reviewed_at" TIMESTAMP(3),
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "memory_inbox_items_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "memory_inbox_items_status_idx" ON "memory_inbox_items"("status")`,
    `CREATE INDEX IF NOT EXISTS "memory_inbox_items_created_at_idx" ON "memory_inbox_items"("created_at")`,
  ],

  "20260618000000_consolidated_models": [
    `CREATE TABLE IF NOT EXISTS "content_nodes" (
      "id" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "published" BOOLEAN NOT NULL DEFAULT false,
      "category" VARCHAR(64) NOT NULL,
      "metadata" JSONB,
      "publishedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "content_nodes_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "contacts" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "email" TEXT,
      "phone" TEXT,
      "role" VARCHAR(32) NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'active',
      "notes" TEXT,
      "psychProfile" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "bookings" (
      "id" TEXT NOT NULL,
      "contact_id" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "start_time" TIMESTAMP(3) NOT NULL,
      "end_time" TIMESTAMP(3) NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'scheduled',
      "cal_event_id" TEXT,
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "agreements" (
      "id" TEXT NOT NULL,
      "contact_id" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "document_url" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "signed_at" TIMESTAMP(3),
      "signature_metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "products" (
      "id" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "price_cents" INTEGER NOT NULL,
      "stripe_price_id" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "products_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "orders" (
      "id" TEXT NOT NULL,
      "contact_id" TEXT NOT NULL,
      "product_id" TEXT NOT NULL,
      "stripe_session_id" TEXT,
      "amount_cents" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "financial_transactions" (
      "id" TEXT NOT NULL,
      "date" DATE NOT NULL,
      "amount_cents" INTEGER NOT NULL,
      "payee" TEXT NOT NULL,
      "category" VARCHAR(64) NOT NULL,
      "pending" BOOLEAN NOT NULL DEFAULT false,
      "plaid_transaction_id" TEXT,
      "manual_override_category" TEXT,
      "notes" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "investment_holdings" (
      "id" TEXT NOT NULL,
      "symbol" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "shares" DECIMAL(12,4) NOT NULL,
      "cost_basis_cents" INTEGER NOT NULL,
      "current_price_cents" INTEGER NOT NULL,
      "last_updated_at" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "investment_holdings_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "short_links" (
      "id" TEXT NOT NULL,
      "url" TEXT NOT NULL,
      "campaign" VARCHAR(64),
      "medium" VARCHAR(64),
      "source" VARCHAR(64),
      "click_count" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "link_clicks" (
      "id" TEXT NOT NULL,
      "short_link_id" TEXT NOT NULL,
      "ip_hash" VARCHAR(64) NOT NULL,
      "user_agent" TEXT,
      "referrer" TEXT,
      "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "link_clicks_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "content_nodes_slug_key" ON "content_nodes"("slug")`,
    `CREATE INDEX IF NOT EXISTS "content_nodes_category_published_idx" ON "content_nodes"("category", "published")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "contacts_email_key" ON "contacts"("email")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "contacts_phone_key" ON "contacts"("phone")`,
    `CREATE INDEX IF NOT EXISTS "contacts_role_status_idx" ON "contacts"("role", "status")`,
    `CREATE INDEX IF NOT EXISTS "bookings_contact_id_idx" ON "bookings"("contact_id")`,
    `CREATE INDEX IF NOT EXISTS "bookings_start_time_idx" ON "bookings"("start_time")`,
    `CREATE INDEX IF NOT EXISTS "agreements_contact_id_idx" ON "agreements"("contact_id")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "products_slug_key" ON "products"("slug")`,
    `CREATE INDEX IF NOT EXISTS "orders_contact_id_idx" ON "orders"("contact_id")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_plaid_transaction_id_key" ON "financial_transactions"("plaid_transaction_id")`,
    `CREATE INDEX IF NOT EXISTS "financial_transactions_date_category_idx" ON "financial_transactions"("date", "category")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "investment_holdings_symbol_key" ON "investment_holdings"("symbol")`,
    `CREATE INDEX IF NOT EXISTS "link_clicks_short_link_id_clicked_at_idx" ON "link_clicks"("short_link_id", "clicked_at")`,
    `ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_contact_id_fkey"`,
    `ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS "agreements_contact_id_fkey"`,
    `ALTER TABLE "agreements" ADD CONSTRAINT "agreements_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_contact_id_fkey"`,
    `ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_product_id_fkey"`,
    `ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "link_clicks" DROP CONSTRAINT IF EXISTS "link_clicks_short_link_id_fkey"`,
    `ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_short_link_id_fkey" FOREIGN KEY ("short_link_id") REFERENCES "short_links"("id") ON DELETE CASCADE ON UPDATE CASCADE`
  ],

  "20260625000000_action_receipts_and_completion_criteria": [
    `DO $$ BEGIN
      CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;`,
    `CREATE TABLE IF NOT EXISTS "action_receipts" (
      "id" TEXT NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
      "action" VARCHAR(255) NOT NULL,
      "context" TEXT,
      "missionId" TEXT,
      "source_system" TEXT,
      "verification_payload" JSONB,
      "executed_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "action_receipts_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE INDEX IF NOT EXISTS "action_receipts_status_created_at_idx" ON "action_receipts"("status", "created_at" DESC);`,
    `CREATE INDEX IF NOT EXISTS "action_receipts_missionId_idx" ON "action_receipts"("missionId");`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_receipts_missionId_fkey') THEN
        ALTER TABLE "action_receipts" ADD CONSTRAINT "action_receipts_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;`,
    `ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "completionCriteria" JSONB;`
  ],

  "20260628000000_task_outcome_rating_and_lessons": [
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OutcomeRating') THEN
        CREATE TYPE "OutcomeRating" AS ENUM ('OUTSTANDING', 'SATISFACTORY', 'SUBSTANDARD', 'FAILED');
      END IF;
    END $$;`,
    `ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "outcome_rating" "OutcomeRating";`,
    `ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "outcome_lesson" TEXT;`
  ],
};

export async function POST(req: Request) {
  await requireSession(req);

  let name = "";
  try {
    const body = (await req.json()) as { name?: string };
    name = String(body?.name ?? "");
  } catch {
    return Response.json({ error: "body must be { name }" }, { status: 400 });
  }

  const statements = MIGRATIONS[name];
  if (!statements) {
    return Response.json(
      { error: `unknown migration "${name}"`, available: Object.keys(MIGRATIONS) },
      { status: 400 },
    );
  }

  const results: Array<{ stmt: string; status: "ok" | "skip" | "fail"; error?: string }> = [];
  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, " ").slice(0, 80);
    try {
      await prisma.$executeRawUnsafe(stmt);
      results.push({ stmt: label, status: "ok" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already exists|duplicate/i.test(msg)) {
        results.push({ stmt: label, status: "skip" });
      } else {
        results.push({ stmt: label, status: "fail", error: msg.slice(0, 200) });
        return Response.json({ applied: false, name, results }, { status: 500 });
      }
    }
  }

  // Deliberately NOT recorded in _prisma_migrations — see the header note.
  // The response carries the follow-up step so it can't get lost.

  // Verify (only meaningful for the ambition migration, harmless otherwise).
  let verify: Record<string, unknown> = {};
  try {
    const cols = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::int AS count FROM information_schema.columns
       WHERE table_name = 'life_goals' AND column_name IN
       ('kind','parentGoalId','conviction','ambition','lastChallengedAt','killCriteria','killBy','identityLine')`,
    );
    const tbl = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_name = 'goal_stats'`,
    );
    verify = { lifeGoalNewColumns: Number(cols[0]?.count ?? 0), goalStatsTable: Number(tbl[0]?.count ?? 0) };
  } catch {
    /* verify is best-effort */
  }

  return Response.json({
    applied: true,
    name,
    results,
    verify,
    ledger:
      "not recorded — promote the SQL to prisma/migrations/<name>/ and run `prisma migrate resolve --applied <name>` so `prisma migrate status` stays green",
  });
}
