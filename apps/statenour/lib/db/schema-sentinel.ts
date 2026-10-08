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
      /** When set, information_schema.columns.data_type must equal it (e.g. "tsvector"). */
      dataType?: string;
      /** When set, the column must be GENERATED ALWAYS with exactly this generation_expression (Postgres's
       *  canonical spelling, e.g. "to_tsvector('english'::regconfig, content)"). A generated column is the
       *  ONLY guarantee that nothing has to maintain the value; an ordinary column with the same name reads
       *  as healthy to a name check while its readers trust a value nothing updates (review on #2553). */
      generationExpression?: string;
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
  {
    // 2026-10-07 · camera audit. Parked as
    // prisma/migrations-pending/20261007120000_device_events_identity_indexes until the
    // operator applies it, so this reads "missing" until then -- and that reading is TRUE,
    // not a false positive. An expression index Prisma cannot model: a `db push` drops it
    // silently and this is the only thing that would say so. The arrival ingest
    // (lib/services/vehicle-detection.ts) dedupes retried edge events on data->>'eventId'
    // and catches the P2002 this index raises; without the index two retries of one arrival
    // are two rows and two pages.
    kind: "partial_unique",
    table: "device_events",
    indexName: "device_events_device_id_event_id_uniq",
    predicate: "(data ->> 'eventId'::text) IS NOT NULL",
    reason: "camera audit 2026-10-07 — one edge eventId per device, or a retried arrival pages twice",
  },
  {
    // 2026-07-11 · hand-applied 20260711000000_assistant_reply_uniq
    // (railway run + apply-pending-migration.ts, verified in pg_indexes
    // + migrate status). Closes the cmou6xugm double-reply race — one
    // assistant reply per (conversation, parent user msg, branch).
    // Partial expression index — Prisma cannot model it, so a silent
    // drop on db push would go unnoticed without this expectation
    // (the exact gap the brain-FTS index had).
    kind: "index_exists",
    table: "chat_messages",
    indexName: "chat_messages_assistant_reply_uniq",
    reason: "duplicate-assistant race guard — DB-level backstop for the persist dedup check",
  },
  {
    // 2026-08-22 · 20260823000000_brain_memory_discovery_columns, narrowed
    // 2026-08-23 by migrations-pending/20260823010000+010001. The original
    // predicate was `deleted_at IS NULL` alone, so it indexed all 92,228 live
    // rows to serve 246 — measured 5144 kB. Rebuilt scoped to the four
    // discovery categories: 32 kB, and the plan improved from 508 buffers /
    // 0.572 ms to 118 / 0.485 ms on the same 239 rows.
    //
    // NOTE for a FRESH database: `migrate deploy` replays
    // 20260823000000, which creates the BROAD index; the narrowing lives in
    // migrations-pending because CREATE/DROP INDEX CONCURRENTLY cannot run
    // inside Prisma's transaction wrap. This expectation is what catches that —
    // a fresh env will fail it until both pending steps are applied.
    //
    // Partial index backing the Discover feed's
    // EXACT unrated/restoredHidden counts. Prisma cannot model a partial
    // index, so it is absent from schema.prisma and a `db push` would drop it
    // silently — same gap this file was written for. Without it the two
    // count() query per feed load (ONE raw statement with two FILTER aggregates,
    // not two calls) degrades to a bitmap scan over ~93k live rows,
    // which is slow rather than wrong, so this is a performance guard, not a
    // correctness one. Stated that way on purpose.
    kind: "index_exists",
    table: "brain_memories",
    indexName: "brain_memories_discovery_scoped_idx",
    reason: "Discover exact-count index — partial, unmodellable in Prisma, silent-drop risk",
  },
  {
    // THE PREDICATE, asserted separately — and this is the entry that matters.
    // The one above checks only that an index of that NAME exists, which is the
    // wrong fact: the whole point of this wave is the predicate (32 kB scoped
    // vs 5144 kB broad). Recreate it under the same name with
    // `WHERE deleted_at IS NULL` alone and the name check still passes while
    // the 99.7% write amplification is back.
    //
    // Same correction the hnsw entry below already carries: it was upgraded
    // from a name match to matchByDefinition because "every HNSW index could be
    // dropped and this expectation still passed". Identical reasoning, applied
    // here rather than re-learned.
    //
    // matchByDefinition makes `indexName` a case-insensitive SUBSTRING match
    // against indexdef, so this asserts the category list is in the WHERE
    // clause of SOME index on brain_memories — the fact, not the label.
    kind: "index_exists",
    table: "brain_memories",
    indexName: "counter_intuitive",
    matchByDefinition: true,
    reason: "Discover index must stay category-scoped — a broad rebuild silently restores 5 MB of write amplification",
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
  // The schema.prisma pgvector warning (three near-misses in 10 days)
  // says the sentinel watches these columns for existence. It watched
  // exactly one of the three. `embedding_vec_1536` is the column the HNSW
  // index sits on and the one every live recall path queries
  // (brain/search-hybrid, people/search); `embedding_vec` is only the
  // fallback knnSearch. A `db push --accept-data-loss` that dropped the
  // 1536 column was an unguarded repeat of the incident being memorialized.
  {
    kind: "column_exists",
    table: "vector_embeddings",
    column: "embedding_vec_1536",
    nullable: true,
    reason: "pgvector fixed-dim column — the HNSW index and every live recall path use it",
  },
  {
    kind: "column_exists",
    table: "vector_embeddings",
    column: "embedding_dim",
    nullable: true,
    reason: "pgvector dim tracking — backfill + padding correctness depend on it",
  },
  {
    kind: "index_exists",
    table: "vector_embeddings",
    // Was `embedding_vec` + matchByDefinition, i.e. indexdef ILIKE
    // '%embedding_vec%'. The SAME migration that creates the HNSW index
    // also creates a plain btree —
    // `vector_embeddings_source_type_vec_present_idx ... WHERE
    // "embedding_vec" IS NOT NULL` — whose definition contains that
    // substring. Every HNSW index could be dropped and this expectation
    // still passed, while KNN silently degraded to a sequential scan.
    // Matching "USING hnsw" asserts the index KIND, which a btree cannot
    // satisfy.
    indexName: "USING hnsw",
    matchByDefinition: true,
    reason: "HNSW vector index (vector_embeddings_hnsw_1536) — without it, KNN queries sequential-scan",
  },
  // ── 2026-09-18 · embedding source-shadow (#2430) ────────────────
  // Added because the sentinel was BLIND to the columns that landed with it:
  // `/api/system/schema-drift` would have reported green with
  // `sourceUnavailableAt` missing, while knnSearch errored on every call. An
  // instrument consulted about schema drift that cannot see the newest schema
  // is worse than no instrument, because it answers.
  //
  // The failure is invisible rather than loud, which is why it needs a guard:
  // knnSearch catches, returns null, and semanticSearch falls through to the
  // legacy in-memory cosine scan — correct results, but that scan under
  // getContextualMemories' 3s withTimeout (fallback `""`) means the brain
  // block silently drops out of the prompt instead of surfacing an error.
  {
    kind: "column_exists",
    table: "vector_embeddings",
    column: "sourceUnavailableAt",
    nullable: true,
    reason: "knnSearch filters `AND \"sourceUnavailableAt\" IS NULL` unconditionally (pgvector.ts) — dropping it errors every KNN query, which degrades SILENTLY to the in-memory scan",
  },
  {
    kind: "column_exists",
    table: "vector_embeddings",
    column: "sourceUnavailableReason",
    nullable: true,
    reason: "written by the shadow sweeper (lib/db/embedding-shadow.ts) — dropping it breaks the sweep write, so the marks stop being maintained and the filter above silently goes stale",
  },
  {
    kind: "index_exists",
    table: "vector_embeddings",
    // Matched by DEFINITION, not name, for the same reason as the HNSW entry
    // above: this is a PARTIAL index (`WHERE "sourceUnavailableAt" IS NOT
    // NULL`), and a plain btree on the same columns would satisfy a
    // name-or-column check while losing the property that makes it useful.
    indexName: "WHERE (\"sourceUnavailableAt\" IS NOT NULL)",
    matchByDefinition: true,
    reason: "partial index vector_embeddings_source_unavailable_idx — the sweeper's lookups sequential-scan a ~97k-row table without it, and nothing in lib/ references it by name so its loss is otherwise undetectable",
  },
  {
    kind: "column_exists",
    table: "prompt_versions",
    column: "version",
    reason: "Cockpit Observability — prompt system prompt versioning",
  },
  // ── 2026-08-19 coverage audit ─────────────────────────────────
  // The universal-idempotency migration created SEVEN partial uniques;
  // only autonomous_actions (and entity_audits, separately) had
  // expectations. The other five shared the identical `db push`
  // resurrection failure mode and were unguarded.
  ...(["scheduled_actions", "task_events", "goal_events", "reflections", "decision_replays"] as const).map(
    (table) => ({
      kind: "partial_unique" as const,
      table,
      indexName: `${table}_idempotency_key_uniq`,
      predicate: "idempotency_key IS NOT NULL",
      reason: "v7.7 universal idempotency — without partial, legacy NULLs collide",
    }),
  ),
  // The 2026-05-27 audit dropped two regular uniques and replaced them
  // with alive-rows-only partials. Expectation #10 guards that the OLD
  // identity_snapshots unique stays dead — but nothing guarded that its
  // REPLACEMENT still exists. Drop the replacement and soft-delete dedup
  // is silently gone while the sentinel stays green.
  {
    kind: "partial_unique",
    table: "identity_snapshots",
    indexName: "identity_snapshots_date_alive_idx",
    predicate: "deleted_at IS NULL",
    reason: "soft-delete-aware date dedup — the replacement for the dropped regular unique",
  },
  {
    kind: "partial_unique",
    table: "reflections",
    indexName: "reflections_date_scope_category_alive_idx",
    predicate: "deleted_at IS NULL",
    reason: "soft-delete-aware (date,scope,category) dedup — replacement for the dropped regular unique",
  },
  // The searchable_tsv COLUMN was guarded (expectation #3) but the GIN
  // index serving it was not — schema.prisma's own recovery note says
  // both must exist, and a tsv column without its GIN degrades chat
  // search to a sequential scan.
  {
    kind: "index_exists",
    table: "chat_messages",
    indexName: "USING gin",
    matchByDefinition: true,
    reason: "GIN index over searchable_tsv — without it, chat FTS sequential-scans",
  },
  // 2026-09-22 · brain_memories.content_tsv: GENERATED STORED tsvector + GIN (migration
  // 20260923000000_brain_content_tsv). The brain FTS readers filter AND rank on it. Same
  // db-push exposure as chat_messages.searchable_tsv (Prisma cannot model the generator);
  // without the column every brain FTS query errors and the lexical lane degrades to [].
  {
    kind: "column_exists",
    table: "brain_memories",
    column: "content_tsv",
    nullable: true,
    dataType: "tsvector",
    // Postgres's canonical spelling of the migration's expression, read back from production 2026-09-23 00:24Z.
    generationExpression: "to_tsvector('english'::regconfig, content)",
    reason: "stored GENERATED tsvector for the brain FTS lane - the readers trust it instead of parsing content (1.9 s per query); an ordinary or differently generated column would serve them a value nothing maintains",
  },
  {
    // Matched by DEFINITION, not by name (review on #2553): an index that merely carries the
    // name - the old expression index renamed under it, or a btree - would pass a name check
    // while the readers scan. The ILIKE runs server-side, so a wrong definition returns no row
    // and reads as missing. Production indexdef, verified 2026-09-23 00:24Z:
    // CREATE INDEX brain_memories_content_tsv_idx ON public.brain_memories USING gin (content_tsv)
    kind: "index_exists",
    table: "brain_memories",
    indexName: "USING gin (content_tsv)",
    matchByDefinition: true,
    reason: "GIN over the STORED content_tsv - a name-only match would accept the wrong index and the brain FTS lane would scan 57k rows",
  },
  // 2026-09-29 · the RealityEvent envelope (#2784, migration
  // 20260929123500_reality_event_envelope). The code shipped before the migration was
  // applied, and every prisma.realityEvent read and write failed with `column "event_version"
  // does not exist` from 15:33Z, while this sentinel reported no drift. Prisma selects every
  // model column, so any one of these missing fails them all.
  {
    kind: "column_exists",
    table: "reality_events",
    column: "event_version",
    nullable: false,
    reason: "RealityEvent envelope - without it every realityEvent read and write fails",
  },
  {
    kind: "column_exists",
    table: "reality_events",
    column: "occurred_at",
    nullable: false,
    reason: "RealityEvent envelope - without it every realityEvent read and write fails",
  },
  {
    kind: "column_exists",
    table: "reality_events",
    column: "correlation_id",
    nullable: true,
    reason: "RealityEvent envelope - without it every realityEvent read and write fails",
  },
  {
    kind: "column_exists",
    table: "reality_events",
    column: "causation_id",
    nullable: true,
    reason: "RealityEvent envelope - without it every realityEvent read and write fails",
  },
  {
    kind: "column_exists",
    table: "reality_events",
    column: "retention_class",
    nullable: false,
    reason: "RealityEvent envelope - without it every realityEvent read and write fails",
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
  /** information_schema.columns.is_generated: "ALWAYS" | "NEVER" (Postgres 12+). */
  is_generated?: string | null;
  generation_expression?: string | null;
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
           data_type::text AS data_type,
           is_generated::text AS is_generated,
           generation_expression::text AS generation_expression
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
  // Type and generation are HIGH: the readers do not derive this value, they trust it. A wrong type
  // breaks their SQL; an ordinary or differently generated column serves a value nothing maintains.
  if (e.dataType && rows[0].data_type !== e.dataType) {
    return {
      severity: "high",
      expectation: e,
      problem: `column "${e.table}"."${e.column}" type mismatch — expected ${e.dataType}, got ${rows[0].data_type}`,
    };
  }
  if (e.generationExpression) {
    if (rows[0].is_generated !== "ALWAYS") {
      return {
        severity: "high",
        expectation: e,
        problem: `column "${e.table}"."${e.column}" is not a generated column (is_generated=${rows[0].is_generated ?? "unknown"}) — nothing maintains its value, readers trust it`,
      };
    }
    if ((rows[0].generation_expression ?? "") !== e.generationExpression) {
      return {
        severity: "high",
        expectation: e,
        problem: `column "${e.table}"."${e.column}" generation expression drift — expected ${e.generationExpression}, got ${rows[0].generation_expression ?? "null"}`,
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
