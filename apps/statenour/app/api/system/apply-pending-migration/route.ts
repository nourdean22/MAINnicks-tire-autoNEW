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
 *    guards) so re-running is a no-op. The migration is recorded in
 *    _prisma_migrations so `migrate deploy` never re-runs it (no drift).
 *
 * To add a future migration: add `<name>: [statements]` to MIGRATIONS, deploy,
 * then POST { name }.
 */
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

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

  // Record as applied so `migrate deploy` never re-runs it (drift-safe).
  // If this tracking insert fails the DDL is still applied (it already ran
  // above) but Prisma has no record of it — surface that via a logged warning
  // + a `migrationRecorded` flag in the response rather than swallowing it,
  // so the operator can tell an un-tracked apply from a clean one.
  const migrationRecorded = await prisma
    .$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, $1, NOW(), $2, NULL, NULL, NOW(), 1)
       ON CONFLICT DO NOTHING`,
      `manual-endpoint-${name}`,
      name,
    )
    .then(() => true)
    .catch((err) => {
      logger.warn("apply_migration_tracking_insert_failed", {
        name,
        error: err instanceof Error ? err.message.slice(0, 120) : String(err),
      });
      return false;
    });

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

  return Response.json({ applied: true, name, results, verify, migrationRecorded });
}
