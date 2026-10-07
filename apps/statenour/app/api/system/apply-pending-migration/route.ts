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
import {
  classifyStatementError,
  indexNamesCreatedBy,
} from "@/lib/db/migration-apply-safety";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Inlined, idempotent migration statements (operator-controlled · deploy-gated). */
const MIGRATIONS: Record<string, string[]> = {
  // Restore six indexes the live DB is missing · 2026-09-02 · reported by the
  // schema sentinel on /system/health (5 HIGH + 1 MEDIUM). Additive and
  // idempotent; nothing is dropped or deleted. Full reasoning, the built-in
  // control that proves the sentinel is not false-positiving, and the
  // read-only duplicate preflight to run if a unique create fails, are in
  // prisma/migrations-pending/20260902000000_restore_idempotency_partials/migration.sql
  //
  // Short version: 20260429190000_universal_idempotency created all six
  // partial uniques in one file; five are gone from pg_indexes while
  // autonomous_actions and entity_audits — same expectation shape, same
  // checker — still pass. Prisma cannot express a partial unique, so none of
  // these are known to it, and an index Prisma does not know about is one
  // `db push` will drop. That is failure mode #1 in the sentinel's own header.
  //
  // A CREATE UNIQUE INDEX here CAN fail on pre-existing duplicate keys. No
  // rows are touched, the route stops and returns it, and the post-apply
  // pg_indexes check refuses to answer applied:true while any of these six is
  // still missing. That check exists because this comment used to claim the
  // stop happened when it did not: the executor skipped anything matching
  // /duplicate/i, which the Postgres message contains. See
  // lib/db/migration-apply-safety.ts. Deduplicating is a DELETE against real
  // operator data and is deliberately not automated here.
  "20260902000000_restore_idempotency_partials": [
    `CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_actions_idempotency_key_uniq" ON "scheduled_actions"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "task_events_idempotency_key_uniq" ON "task_events"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "goal_events_idempotency_key_uniq" ON "goal_events"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "reflections_idempotency_key_uniq" ON "reflections"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "decision_replays_idempotency_key_uniq" ON "decision_replays"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS "chat_messages_searchable_tsv_idx" ON "chat_messages" USING GIN ("searchable_tsv")`,
  ],
  // Drop 42 duplicate indexes across 24 tables (~18.7 MB) · 2026-08-06 ·
  // indexes only, zero data touched, fully reversible. Matches
  // prisma/migrations-pending/20260806120000_drop_duplicate_indexes/migration.sql
  // — read that file's header for the full why, the safety argument, and the
  // post-apply verification query.
  //
  // Short version: scripts/emit-index-migration.ts built index NAMES from
  // Prisma field names while building index BODIES from @map'd column names,
  // so its `IF NOT EXISTS` guard never matched the snake_case twins created by
  // the earlier hand-written migrations and it created byte-identical copies
  // instead. Every one of these has a surviving twin with the same table, the
  // same column list and no predicate. High scan counts on some of the dropped
  // names are not evidence they are needed — with two identical indexes the
  // planner splits scans arbitrarily, and after the drop they land on the twin.
  // The generator bug is fixed in the same PR, so these cannot come back.
  "20260806120000_drop_duplicate_indexes": [
    `DROP INDEX IF EXISTS "brain_memories_category_updatedAt_idx"`,
    `DROP INDEX IF EXISTS "brain_memories_category_createdAt_idx"`,
    `DROP INDEX IF EXISTS "brain_memories_category_deletedAt_idx"`,
    `DROP INDEX IF EXISTS "brain_memories_lastSeen_idx"`,
    `DROP INDEX IF EXISTS "brain_memories_expiresAt_idx"`,
    `DROP INDEX IF EXISTS "api_request_logs_statusCode_createdAt_idx"`,
    `DROP INDEX IF EXISTS "agent_traces_errorClass_createdAt_idx"`,
    `DROP INDEX IF EXISTS "agent_traces_source_createdAt_idx"`,
    `DROP INDEX IF EXISTS "agent_traces_provider_createdAt_idx"`,
    `DROP INDEX IF EXISTS "automation_policy_fires_firedAt_idx"`,
    `DROP INDEX IF EXISTS "system_metrics_source_createdAt_idx"`,
    `DROP INDEX IF EXISTS "system_metrics_createdAt_idx"`,
    `DROP INDEX IF EXISTS "chat_messages_parentMessageId_idx"`,
    `DROP INDEX IF EXISTS "chat_messages_conversationId_branchId_idx"`,
    `DROP INDEX IF EXISTS "chat_messages_streamingState_createdAt_idx"`,
    `DROP INDEX IF EXISTS "chat_messages_provider_createdAt_idx"`,
    `DROP INDEX IF EXISTS "chat_messages_feedbackScore_idx"`,
    `DROP INDEX IF EXISTS "ai_generations_model_createdAt_idx"`,
    `DROP INDEX IF EXISTS "ai_generations_status_createdAt_idx"`,
    `DROP INDEX IF EXISTS "entity_audits_actor_createdAt_idx"`,
    `DROP INDEX IF EXISTS "entity_audits_action_createdAt_idx"`,
    `DROP INDEX IF EXISTS "entity_audits_createdAt_idx"`,
    `DROP INDEX IF EXISTS "brain_bus_events_topic_createdAt_idx"`,
    `DROP INDEX IF EXISTS "memory_edges_targetType_targetId_idx"`,
    `DROP INDEX IF EXISTS "brain_dumps_date_actionsTaken_idx"`,
    `DROP INDEX IF EXISTS "brain_dumps_deletedAt_idx"`,
    `DROP INDEX IF EXISTS "task_events_kind_createdAt_idx"`,
    `DROP INDEX IF EXISTS "Task_deletedAt_idx"`,
    `DROP INDEX IF EXISTS "Mission_deletedAt_idx"`,
    `DROP INDEX IF EXISTS "commitments_deletedAt_idx"`,
    `DROP INDEX IF EXISTS "goal_events_kind_createdAt_idx"`,
    `DROP INDEX IF EXISTS "identity_snapshots_deletedAt_idx"`,
    `DROP INDEX IF EXISTS "life_goals_deletedAt_idx"`,
    `DROP INDEX IF EXISTS "mastery_decisions_deletedAt_idx"`,
    `DROP INDEX IF EXISTS "mastery_decisions_reviewDate_idx"`,
    `DROP INDEX IF EXISTS "chat_conversations_starredAt_idx"`,
    `DROP INDEX IF EXISTS "chat_conversations_missionId_idx"`,
    `DROP INDEX IF EXISTS "person_profiles_trustScore_idx"`,
    `DROP INDEX IF EXISTS "reflections_deletedAt_idx"`,
    `DROP INDEX IF EXISTS "device_commands_status_createdAt_idx"`,
    `DROP INDEX IF EXISTS "schema_change_ledger_environment_appliedAt_idx"`,
    `DROP INDEX IF EXISTS "scheduled_actions_entityType_entityId_idx"`,
  ],

  // Render lease for social_publish_queue · 2026-08-03 · additive, zero data
  // loss. Matches prisma/migrations-pending/20260803120000_render_lease/
  // migration.sql. A reel claimed by /api/sync/queue/render was stuck in
  // status='rendering' forever if the worker died mid-render; these columns let
  // an expired lease be reclaimed. They are ALSO the discriminator that keeps
  // reclaim safe — 'rendering' is overloaded with the publish path, whose rows
  // never carry a lease and so can never be stolen.
  "20260803120000_render_lease": [
    `ALTER TABLE "social_publish_queue" ADD COLUMN IF NOT EXISTS "render_claimed_at" TIMESTAMP(3)`,
    `ALTER TABLE "social_publish_queue" ADD COLUMN IF NOT EXISTS "render_lease_expires_at" TIMESTAMP(3)`,
    `ALTER TABLE "social_publish_queue" ADD COLUMN IF NOT EXISTS "render_attempts" INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE "social_publish_queue" ADD COLUMN IF NOT EXISTS "last_render_error" TEXT`,
    `CREATE INDEX IF NOT EXISTS "social_publish_queue_render_lease_expires_at_idx" ON "social_publish_queue"("render_lease_expires_at")`,
  ],

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

  // 0007_brain_fts (the expression GIN brain_memories_content_fts_idx, 2026-06-02) was REMOVED from this registry on
  // 2026-09-23: the index was dropped in production by 20260923013000_drop_brain_fts_expression_index once every
  // brain_memories FTS reader moved to the stored column content_tsv (20260923000000_brain_content_tsv). A registry
  // entry left here would have re-created it through IF NOT EXISTS on the next apply - the resurrection shape #1233
  // documented. Never re-add it.

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

  // "20260618000000_consolidated_models" was REMOVED from this registry
  // 2026-07-30: its IF NOT EXISTS statements would RESURRECT content_nodes /
  // financial_transactions / investment_holdings — tables deliberately dropped
  // when their models were purged (2026-06-21 · finance.ts refuses loudly ·
  // probe-unused-models sweep). The 7 surviving tables it also created are
  // live and need no re-apply path. Never re-add a registry entry whose
  // tables were retired on purpose.

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

  // ADR-0019 phase 0b · the receiver's dedupe table for keyed nickstire writes.
  // One new table + one index, nothing else touched. Full reasoning and the
  // promote/resolve steps: prisma/migrations-pending/20260929090000_bridge_receipts/migration.sql
  "20260929090000_bridge_receipts": [
    `CREATE TABLE IF NOT EXISTS "bridge_receipts" (
      "idempotency_key" VARCHAR(190) NOT NULL,
      "route" VARCHAR(64) NOT NULL,
      "result_ref" VARCHAR(120),
      "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "seen_count" INTEGER NOT NULL DEFAULT 1,
      CONSTRAINT "bridge_receipts_pkey" PRIMARY KEY ("idempotency_key")
    );`,
    `CREATE INDEX IF NOT EXISTS "bridge_receipts_first_seen_at_idx" ON "bridge_receipts"("first_seen_at");`
  ],

  // Camera audit 2026-10-07 · vehicle lane hardening. Two expression indexes on
  // device_events, nothing else: one edge eventId per device (the service's
  // findFirst-then-create dedupe had no database behind it, so two retries of
  // one arrival became two rows and two pages), and a visitId index so the
  // visit window can span a weekend. Prisma cannot model either. Mirrors,
  // statement for statement,
  // prisma/migrations-pending/20261007120000_device_events_identity_indexes/migration.sql,
  // whose header carries the read-only duplicate preflight to run if the
  // unique create fails. Deduplicating is a DELETE and is not automated here.
  "20261007120000_device_events_identity_indexes": [
    `CREATE UNIQUE INDEX IF NOT EXISTS "device_events_device_id_event_id_uniq"
  ON "device_events" ("device_id", ("data"->>'eventId'))
  WHERE "data"->>'eventId' IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS "device_events_device_id_visit_id_idx"
  ON "device_events" ("device_id", ("data"->>'visitId'))
  WHERE "data"->>'visitId' IS NOT NULL`,
  ],

  // Q-31 · BrainMemory transaction-time validity. Additive nullable columns
  // only; no historical backfill and no destructive DDL. Runtime code probes
  // these columns before use, so this remains deploy-safe before the operator
  // applies it. Mirrors the reviewed pending migration statement-for-statement.
  "20260929150500_brain_memory_transaction_time": [
    `ALTER TABLE "brain_memories"
  ADD COLUMN IF NOT EXISTS "transaction_from_at" TIMESTAMP(3)`,
    `ALTER TABLE "brain_memories"
  ADD COLUMN IF NOT EXISTS "transaction_expired_at" TIMESTAMP(3)`,
    `CREATE INDEX IF NOT EXISTS "brain_memories_transaction_from_at_idx"
  ON "brain_memories"("transaction_from_at")`,
    `CREATE INDEX IF NOT EXISTS "brain_memories_transaction_expired_at_idx"
  ON "brain_memories"("transaction_expired_at")`
  ],

  // Q-25 · RealityEvent envelope columns (#2784). The Prisma model already
  // names these five columns, so until this runs every realityEvent read and
  // write fails with "column event_version does not exist" (seen in
  // production 2026-09-29 15:50Z). Additive: five columns, two backfills
  // from existing data, three indexes. Mirrors, statement for statement,
  // prisma/migrations-pending/20260929123500_reality_event_envelope/migration.sql,
  // which also holds the rollback; tests/api/apply-pending-migration.test.ts
  // fails if the two drift.
  "20260929123500_reality_event_envelope": [
    `ALTER TABLE "reality_events"
  ADD COLUMN IF NOT EXISTS "event_version" INTEGER NOT NULL DEFAULT 1;`,
    `ALTER TABLE "reality_events"
  ADD COLUMN IF NOT EXISTS "occurred_at" TIMESTAMP(3);`,
    `UPDATE "reality_events"
SET "occurred_at" = "observed_at"
WHERE "occurred_at" IS NULL;`,
    `ALTER TABLE "reality_events"
  ALTER COLUMN "occurred_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "occurred_at" SET NOT NULL;`,
    `ALTER TABLE "reality_events"
  ADD COLUMN IF NOT EXISTS "correlation_id" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "causation_id" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "retention_class" VARCHAR(32) NOT NULL DEFAULT 'operational';`,
    `UPDATE "reality_events"
SET "retention_class" = CASE
  WHEN "event_type" = 'experiment.verdict' OR "event_type" LIKE 'proof.%' THEN 'evidence'
  WHEN "event_type" LIKE 'episode.%' THEN 'learning'
  WHEN "event_type" LIKE 'darwin.%' THEN 'audit'
  ELSE 'operational'
END;`,
    `CREATE INDEX IF NOT EXISTS "reality_events_event_type_occurred_at_idx"
  ON "reality_events" ("event_type", "occurred_at");`,
    `CREATE INDEX IF NOT EXISTS "reality_events_correlation_id_idx"
  ON "reality_events" ("correlation_id");`,
    `CREATE INDEX IF NOT EXISTS "reality_events_causation_id_idx"
  ON "reality_events" ("causation_id");`
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
      // classifyStatementError checks the data-conflict pattern FIRST; see
      // lib/db/migration-apply-safety.ts for why that order is the fix.
      if (classifyStatementError(msg) === "fail") {
        results.push({ stmt: label, status: "fail", error: msg.slice(0, 200) });
        return Response.json({ applied: false, name, results }, { status: 500 });
      }
      results.push({ stmt: label, status: "skip" });
    }
  }

  // Every index the statements claim to create must actually be in pg_indexes.
  // Without this the response's `applied: true` rests on "no statement threw
  // an error we decided to care about", which is not the same claim.
  const expectedIndexes = indexNamesCreatedBy(statements);
  const missingIndexes: string[] = [];
  if (expectedIndexes.length > 0) {
    // Positional placeholders rather than `= ANY($1::text[])`: array binding
    // through $queryRawUnsafe is one more assumption than this needs, and it
    // is not one that can be checked without a database.
    const placeholders = expectedIndexes.map((_, i) => `$${i + 1}`).join(", ");
    const present = await prisma
      .$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (${placeholders})`,
        ...expectedIndexes,
      )
      .catch(() => null);
    if (present === null) {
      // A failed verification is not a passed one. Say so rather than
      // returning applied:true on the strength of a query that never ran.
      return Response.json(
        {
          applied: false,
          name,
          results,
          error: "post-apply index verification could not run — state unconfirmed",
        },
        { status: 500 },
      );
    }
    const found = new Set(present.map((r) => r.indexname));
    missingIndexes.push(...expectedIndexes.filter((n) => !found.has(n)));
    if (missingIndexes.length > 0) {
      return Response.json(
        {
          applied: false,
          name,
          results,
          missingIndexes,
          error:
            `${missingIndexes.length} of ${expectedIndexes.length} indexes are still absent after apply. ` +
            `For a unique index this usually means the table holds duplicate non-null keys — run the ` +
            `read-only preflight in the migration file before doing anything else.`,
        },
        { status: 500 },
      );
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
