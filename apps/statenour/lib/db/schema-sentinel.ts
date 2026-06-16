/**
 * Schema-drift sentinel · v8.1 Phase 2C · Apr 29.
 *
 * Compares the `expected schema fingerprint` (declared here in code)
 * against what the live Postgres actually has. Catches three classes
 * of bug we've actually hit:
 *
 *   1. Vercel `prisma db push --accept-data-loss` re-creates a
 *      regular UNIQUE on a table whose v7.9 migration converted it to
 *      a partial unique (the v7.9.1 IdentitySnapshot.date class).
 *   2. A migration file that's expected to have run never made it
 *      onto the live DB (rollback half-state).
 *   3. A column that should exist by name is missing, or has an
 *      unexpected type / nullability.
 *
 * Pure read-only: runs a handful of `information_schema` queries via
 * raw SQL, returns a structured drift report. Wraps in `try/catch` so
 * a misbehaving DB never bricks the route — a missing column is a
 * findable signal, not a crash.
 *
 * Hooked from:
 *   · GET /api/system/schema-drift  — admin/operator surface, on-demand check
 *   · /system/health                — pulls the count of drift findings
 *   · cron: weekly-review can call check() and emit a brain memory
 *     with category=schema_drift_check if anything's off.
 *
 * Adding a new expectation:
 *   Append to EXPECTATIONS below. Don't try to be exhaustive — focus
 *   on invariants that have ACTUALLY broken before, or that catch
 *   operator confusion when reading the live DB.
 */

import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────
// EXPECTATIONS
// ─────────────────────────────────────────────────────────────────

/**
 * One declarative expectation per row. Each maps to one or more
 * information_schema queries the sentinel runs against the live DB.
 *
 * Kinds:
 *   · column_exists       — table has this column with this nullability
 *   · index_exists        — there's an index with this name (any kind)
 *   · partial_unique      — there's a UNIQUE INDEX with the named
 *                           predicate (the v7.7/v7.9 flavor)
 *   · regular_unique_absent — DROP-and-replaced unique should NOT
 *                           come back. Catches `db push` resurrection.
 */
export type SchemaExpectation =
  | {
      kind: "column_exists";
      table: string;
      column: string;
      nullable?: boolean;
      reason: string;
    }
  | {
      kind: "index_exists";
      table: string;
      /** Either the exact pg_indexes name OR a substring to match
       *  against indexdef (use this when prisma may auto-name the index). */
      indexName: string;
      /** When true, indexName is matched against the indexdef SQL
       *  (case-insensitive substring) instead of as an exact name —
       *  use for Prisma auto-named indexes whose names depend on
       *  table/column casing the schema doesn't pin down. */
      matchByDefinition?: boolean;
      reason: string;
    }
  | {
      kind: "partial_unique";
      table: string;
      indexName: string;
      predicate: string; // e.g. "idempotency_key IS NOT NULL"
      reason: string;
    }
  | {
      kind: "regular_unique_absent";
      table: string;
      indexName: string;
      reason: string;
    };

export const EXPECTATIONS: SchemaExpectation[] = [
  // ── Phase 1 hardening (v7.6-v7.9) ───────────────────────────────
  {
    kind: "column_exists",
    table: "chat_messages",
    column: "parts",
    nullable: true,
    reason: "v7.6 ChatMessage Batch A — UIMessage tree storage",
  },
  {
    kind: "column_exists",
    table: "chat_messages",
    column: "client_message_id",
    nullable: true,
    reason: "v7.6 idempotency key for duplicate-send dedup",
  },
  {
    kind: "column_exists",
    table: "chat_messages",
    column: "searchable_tsv",
    reason: "v7.6 generated tsvector for FTS — required by /api/ai/chat/search",
  },
  {
    kind: "partial_unique",
    table: "autonomous_actions",
    indexName: "autonomous_actions_idempotency_key_uniq",
    predicate: "idempotency_key IS NOT NULL",
    reason: "v7.7 idempotency — without partial, legacy NULLs collide",
  },
  // Note: Mission and Task have NO @@map in prisma/schema.prisma so
  // Prisma's default lowercases-the-model-name rule applies — the
  // actual Postgres table names are "Mission" and "Task" (PascalCase).
  // The migrations folder uses "missions"/"tasks" purely as docs;
  // `prisma db push` is what actually creates the schema and uses
  // the model name. Sentinel checks must use the Prisma-resolved
  // names or it will false-positive on every run.
  {
    kind: "column_exists",
    table: "Mission",
    column: "created_by",
    nullable: true,
    reason: "v7.8 universal audit-actor",
  },
  {
    kind: "column_exists",
    table: "Task",
    column: "deleted_at",
    nullable: true,
    reason: "v7.9 universal soft-delete",
  },
  {
    kind: "column_exists",
    table: "life_goals",
    column: "deleted_at",
    nullable: true,
    reason: "v7.9 universal soft-delete",
  },
  {
    kind: "index_exists",
    table: "Task",
    // Prisma auto-names this; match by definition substring instead
    // of exact name so casing variations don't false-positive.
    indexName: "deleted_at",
    matchByDefinition: true,
    reason: "v7.9 soft-delete index — without it, alive-row queries scan",
  },
  // The v7.9.1 hotfix — IdentitySnapshot.date used to be UNIQUE; we
  // dropped it because soft-delete needs to support "redo today". If
  // `prisma db push` ever recreates this, the next cron will P2002.
  {
    kind: "regular_unique_absent",
    table: "identity_snapshots",
    indexName: "identity_snapshots_date_key",
    reason: "v7.9.1 — hard unique blocks soft-delete + re-emit. Must stay dropped.",
  },
  // ── Phase 2A entity-audit ──────────────────────────────────────
  {
    kind: "column_exists",
    table: "entity_audits",
    column: "entity_type",
    reason: "v8.0 Phase 2A entity-audit table",
  },
  {
    kind: "partial_unique",
    table: "entity_audits",
    indexName: "entity_audits_idempotency_key_uniq",
    predicate: "idempotency_key IS NOT NULL",
    reason: "v8.0 entity-audit idempotency — race-safe insert",
  },
  {
    kind: "index_exists",
    table: "entity_audits",
    // The migration creates this exact name. Match by name first;
    // if Prisma db push later renames it to its auto-pattern, the
    // substring fallback would still work.
    indexName: "entity_type",
    matchByDefinition: true,
    reason: "v8.0 entity-audit per-entity history query path (composite type+id+at)",
  },
  // ── v8.5 pgvector ──────────────────────────────────────────────
  {
    kind: "column_exists",
    table: "vector_embeddings",
    column: "embedding_vec",
    nullable: true,
    reason: "v8.5 pgvector native column — native KNN search",
  },
  {
    kind: "index_exists",
    table: "vector_embeddings",
    indexName: "embedding_vec",
    matchByDefinition: true,
    reason: "v8.5 HNSW index — without it, KNN queries scan",
  },
  // ── Cockpit Observability Models (Phase 1) ──────────────────────
  {
    kind: "column_exists",
    table: "prompt_versions",
    column: "version",
    reason: "Cockpit Observability — prompt system prompt versioning",
  },
  {
    kind: "column_exists",
    table: "agent_runs",
    column: "traceId",
    reason: "Cockpit Observability — agent turn statistics and billing costs",
  },
  {
    kind: "column_exists",
    table: "agent_memory_hits",
    column: "similarity",
    reason: "Cockpit Observability — memory hit relevance ratios",
  },
  {
    kind: "column_exists",
    table: "agent_feedbacks",
    column: "score",
    reason: "Cockpit Observability — feedback evaluation score",
  },
];

// ─────────────────────────────────────────────────────────────────
// FINDING TYPES
// ─────────────────────────────────────────────────────────────────

export interface DriftFinding {
  severity: "high" | "medium" | "low";
  expectation: SchemaExpectation;
  problem: string;
}

export interface DriftReport {
  ok: boolean;
  checkedAt: string;
  findings: DriftFinding[];
  expectationCount: number;
  /** Did the live DB even respond? false → connectivity problem */
  reachable: boolean;
}

// ─────────────────────────────────────────────────────────────────
// CHECKERS
// ─────────────────────────────────────────────────────────────────

interface ColumnRow {
  column_name: string;
  is_nullable: "YES" | "NO";
  data_type: string;
}

async function checkColumnExists(
  e: Extract<SchemaExpectation, { kind: "column_exists" }>,
): Promise<DriftFinding | null> {
  // 2026-05-01 — explicit ::text casts. information_schema.columns
  // returns `name`-typed columns (column_name, is_nullable, data_type
  // are pg-internal `name` / `yes_or_no` / `character_data` types).
  // Prisma's $queryRaw can't deserialize those — pre-fix, every
  // column_exists check threw "Failed to deserialize column of type
  // 'name'", returning 14 false-positive findings every nightly run.
  const rows = await prisma.$queryRaw<ColumnRow[]>`
    SELECT column_name::text AS column_name,
           is_nullable::text AS is_nullable,
           data_type::text AS data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${e.table}
      AND column_name = ${e.column}
    LIMIT 1
  `;
  if (rows.length === 0) {
    return {
      severity: "high",
      expectation: e,
      problem: `column "${e.table}"."${e.column}" is missing — migration likely didn't apply`,
    };
  }
  if (typeof e.nullable === "boolean") {
    const isNullable = rows[0].is_nullable === "YES";
    if (isNullable !== e.nullable) {
      return {
        severity: "medium",
        expectation: e,
        problem: `column "${e.table}"."${e.column}" nullability mismatch — expected ${e.nullable ? "nullable" : "NOT NULL"}, got ${rows[0].is_nullable}`,
      };
    }
  }
  return null;
}

interface IndexRow {
  indexname: string;
  indexdef: string;
}

async function checkIndexExists(
  e: Extract<SchemaExpectation, { kind: "index_exists" }>,
): Promise<DriftFinding | null> {
  if (e.matchByDefinition) {
    // Substring match against indexdef — robust when Prisma may
    // auto-name the index with casing we can't predict. Same ::text
    // cast as columns query — pg_indexes.indexname is `name`-typed.
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname::text AS indexname,
             indexdef::text AS indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = ${e.table}
        AND indexdef ILIKE ${`%${e.indexName}%`}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return {
        severity: "medium",
        expectation: e,
        problem: `no index on "${e.table}" matching "${e.indexName}" — query path may scan instead`,
      };
    }
    return null;
  }
  const rows = await prisma.$queryRaw<IndexRow[]>`
    SELECT indexname::text AS indexname,
           indexdef::text AS indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = ${e.table}
      AND indexname = ${e.indexName}
    LIMIT 1
  `;
  if (rows.length === 0) {
    return {
      severity: "medium",
      expectation: e,
      problem: `index "${e.indexName}" on "${e.table}" is missing — query path may scan instead`,
    };
  }
  return null;
}

async function checkPartialUnique(
  e: Extract<SchemaExpectation, { kind: "partial_unique" }>,
): Promise<DriftFinding | null> {
  const rows = await prisma.$queryRaw<IndexRow[]>`
    SELECT indexname::text AS indexname,
           indexdef::text AS indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = ${e.table}
      AND indexname = ${e.indexName}
    LIMIT 1
  `;
  if (rows.length === 0) {
    return {
      severity: "high",
      expectation: e,
      problem: `partial unique index "${e.indexName}" missing — re-runs will collide instead of dedup`,
    };
  }
  const def = rows[0].indexdef.toLowerCase();
  if (!def.includes("unique")) {
    return {
      severity: "high",
      expectation: e,
      problem: `index "${e.indexName}" exists but is NOT unique — uniqueness guarantee gone`,
    };
  }
  if (!def.includes("where") || !def.toLowerCase().includes(e.predicate.toLowerCase())) {
    return {
      severity: "high",
      expectation: e,
      problem: `partial unique "${e.indexName}" predicate drift — got: ${rows[0].indexdef}`,
    };
  }
  return null;
}

async function checkRegularUniqueAbsent(
  e: Extract<SchemaExpectation, { kind: "regular_unique_absent" }>,
): Promise<DriftFinding | null> {
  const rows = await prisma.$queryRaw<IndexRow[]>`
    SELECT indexname::text AS indexname,
           indexdef::text AS indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = ${e.table}
      AND indexname = ${e.indexName}
    LIMIT 1
  `;
  if (rows.length === 0) return null; // Good — index is gone as expected
  // Index resurrected. This is the "prisma db push reverted my migration" case.
  return {
    severity: "high",
    expectation: e,
    problem: `index "${e.indexName}" RESURRECTED — prisma db push likely re-created it from @@unique. Re-run the drop migration.`,
  };
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────

/**
 * Run all expectations against the live DB. Returns a structured
 * report. Never throws; on connectivity failure returns
 * `{reachable: false}`.
 */
export async function runSchemaDriftCheck(): Promise<DriftReport> {
  const checkedAt = new Date().toISOString();
  const findings: DriftFinding[] = [];

  // Cheap connectivity probe so we can distinguish "DB down" from "no
  // findings". If this fails, every other query will too.
  try {
    await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
  } catch (err) {
    return {
      ok: false,
      checkedAt,
      findings: [
        {
          severity: "high",
          expectation: { kind: "column_exists" } as SchemaExpectation,
          problem: `DB connectivity check failed: ${err instanceof Error ? err.message : "unknown"}`,
        },
      ],
      expectationCount: EXPECTATIONS.length,
      reachable: false,
    };
  }

  for (const e of EXPECTATIONS) {
    try {
      let finding: DriftFinding | null = null;
      if (e.kind === "column_exists") finding = await checkColumnExists(e);
      else if (e.kind === "index_exists") finding = await checkIndexExists(e);
      else if (e.kind === "partial_unique") finding = await checkPartialUnique(e);
      else if (e.kind === "regular_unique_absent") finding = await checkRegularUniqueAbsent(e);
      if (finding) findings.push(finding);
    } catch (err) {
      findings.push({
        severity: "low",
        expectation: e,
        problem: `Check errored: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  return {
    ok: findings.length === 0,
    checkedAt,
    findings,
    expectationCount: EXPECTATIONS.length,
    reachable: true,
  };
}
