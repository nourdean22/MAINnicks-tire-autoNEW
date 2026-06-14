/**
 * Schema coverage analyzer · v10.0.24 · Apr 30 (Horizon 5).
 *
 * Walks the live Prisma schema (via Prisma's introspection-equivalent
 * static metadata) + queries Postgres pg_stat_user_tables to give
 * the operator a single read of:
 *
 *   model X — N rows estimated — K indexes — hot? (yes/no)
 *
 * Combined with /system/slow-queries (in-memory tracker) the
 * operator can spot "this model has 3M rows + 1 index + slow
 * queries are hitting it" without grep-the-schema work.
 *
 * Composes with `getTopSlowQueries()`: the dashboard pulls both and
 * marks any model whose name appears in a slow-query shape with a
 * "⚡ in slow-queries" badge.
 */

import { prisma } from "@/lib/prisma";

export interface ModelCoverage {
  /** Model name as it appears in Prisma client (camelCase). */
  modelName: string;
  /** DB table name (snake_case via @@map). */
  tableName: string;
  /** Approximate row count from pg_stat_user_tables.n_live_tup. */
  estimatedRows: number;
  /** Number of @@index declarations + the implicit @@id index. */
  indexCount: number;
  /** True when the table appeared in a recent slow-query shape. */
  inRecentSlowQueries: boolean;
  /** Heuristic risk flag: many rows + few indexes. */
  flagged: boolean;
  flagReason: string | null;
}

interface PgStatRow {
  schemaname: string;
  relname: string;
  n_live_tup: bigint | number;
}

interface PgIndexRow {
  tablename: string;
  indexname: string;
}

/**
 * Pull n_live_tup (Postgres' fastest row-count estimator — accurate
 * within a few % thanks to autovacuum) for every user table in the
 * `public` schema.
 */
async function fetchEstimatedRowCounts(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<PgStatRow[]>`
    SELECT schemaname, relname, n_live_tup
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
  `;
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.relname, Number(r.n_live_tup));
  }
  return m;
}

/**
 * Pull index counts per table from pg_indexes. The table-level
 * @@id is one of the indexes counted here, which matches the
 * "K indexes" intuition — every PK is a real index in Postgres.
 */
async function fetchIndexCounts(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<PgIndexRow[]>`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
  `;
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.tablename, (m.get(r.tablename) ?? 0) + 1);
  }
  return m;
}

/**
 * Heuristic flag: a table is "under-indexed" when it has > 10k
 * rows AND fewer than 2 indexes (the PK alone). Large tables with
 * 1 index are forced to seq-scan on any filter that's not the PK.
 *
 * 10k threshold is intentionally low — it's the point where seq
 * scans start showing up in the slow-query tracker on Neon free
 * tier. Bump if false-positives become noisy.
 */
function flagModel(
  rows: number,
  indexes: number,
  inSlow: boolean,
): { flagged: boolean; reason: string | null } {
  if (rows >= 10_000 && indexes < 2) {
    return {
      flagged: true,
      reason: `${rows.toLocaleString()} rows · only ${indexes} index${indexes === 1 ? "" : "es"} (PK only) — non-PK filters seq-scan`,
    };
  }
  if (inSlow && indexes < 3) {
    return {
      flagged: true,
      reason: `appears in slow-queries window with ${indexes} index${indexes === 1 ? "" : "es"} — likely needs a covering index`,
    };
  }
  return { flagged: false, reason: null };
}

/**
 * Map of Prisma model name (camelCase from client) → DB table name
 * (snake_case from @@map). Hand-maintained for the most-queried
 * subset; missing entries fall back to the lowercased model name
 * which works for most tables.
 *
 * Auto-walking schema.prisma at runtime from Vercel would require
 * shipping the .prisma file — instead we read it via a dev-only
 * helper at build time when the dashboard renders. For v10.0.24
 * we use a hand list because the dashboard cares about the busy
 * tables and the long tail is fine.
 */
const KNOWN_TABLES: Array<{ model: string; table: string }> = [
  { model: "BrainMemory", table: "BrainMemory" },
  { model: "ChatMessage", table: "ChatMessage" },
  { model: "ChatConversation", table: "ChatConversation" },
  { model: "AiGeneration", table: "AiGeneration" },
  { model: "AgentTrace", table: "agent_traces" },
  { model: "Task", table: "Task" },
  { model: "Mission", table: "Mission" },
  { model: "LifeGoal", table: "LifeGoal" },
  { model: "ErrorLog", table: "ErrorLog" },
  { model: "CronJobLog", table: "CronJobLog" },
  { model: "VectorEmbedding", table: "vector_embeddings" },
  { model: "MemoryEdge", table: "MemoryEdge" },
  { model: "EntityAudit", table: "entity_audits" },
  { model: "BrainBusEvent", table: "brain_bus_events" },
  { model: "SchemaChangeLedger", table: "schema_change_ledger" },
  { model: "Reflection", table: "Reflection" },
  { model: "Commitment", table: "Commitment" },
  { model: "Prediction", table: "Prediction" },
  { model: "PatternDetection", table: "PatternDetection" },
  { model: "BrainDump", table: "BrainDump" },
  { model: "Pin", table: "Pin" },
  { model: "Decision", table: "Decision" },
  { model: "DeviceCommand", table: "DeviceCommand" },
  { model: "AutonomousAction", table: "AutonomousAction" },
  { model: "AuditEvent", table: "AuditEvent" },
];

export interface SchemaCoverageReport {
  generatedAt: string;
  totalModels: number;
  flaggedCount: number;
  totalRowsEstimate: number;
  /**
   * v10.0.26 — true when both pg_stat_user_tables AND pg_indexes
   * came back empty (typically because the Neon pooled role lacks
   * pg_monitor / pg_read_all_stats grants). Without this flag the
   * dashboard would silently show 0 rows + 0 indexes for every
   * model and look reassuringly green.
   */
  permissionDenied: boolean;
  models: ModelCoverage[];
}

export async function buildSchemaCoverageReport(opts: {
  slowQueryShapes?: string[];
} = {}): Promise<SchemaCoverageReport> {
  // v10.0.26 — track whether the catalog reads actually succeeded so
  // the dashboard can render a permission-denied banner instead of
  // silently showing zeros.
  let rowCountsOk = true;
  let indexCountsOk = true;
  const [rowCounts, indexCounts] = await Promise.all([
    fetchEstimatedRowCounts().catch(() => {
      rowCountsOk = false;
      return new Map<string, number>();
    }),
    fetchIndexCounts().catch(() => {
      indexCountsOk = false;
      return new Map<string, number>();
    }),
  ]);
  // v10.0.27 · partial-denial coverage. Pre-v10.0.27 required BOTH
  // reads to fail before flagging permissionDenied. But Neon could
  // grant pg_stat_user_tables while denying pg_indexes (or vice
  // versa) — partial denial would silently show 0 indexes on every
  // model and look healthy. OR the failures so EITHER blind side
  // surfaces the warning banner.
  const permissionDenied = !rowCountsOk || !indexCountsOk;

  const slowShapes = (opts.slowQueryShapes ?? []).map((s) => s.toLowerCase());

  const models: ModelCoverage[] = KNOWN_TABLES.map(({ model, table }) => {
    const estimatedRows = rowCounts.get(table) ?? 0;
    const indexCount = indexCounts.get(table) ?? 0;
    const tableLower = table.toLowerCase();
    const inRecentSlowQueries = slowShapes.some((s) =>
      s.includes(tableLower),
    );
    const { flagged, reason } = flagModel(
      estimatedRows,
      indexCount,
      inRecentSlowQueries,
    );
    return {
      modelName: model,
      tableName: table,
      estimatedRows,
      indexCount,
      inRecentSlowQueries,
      flagged,
      flagReason: reason,
    };
  });

  // Sort: flagged first, then by row count descending.
  models.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    return b.estimatedRows - a.estimatedRows;
  });

  return {
    generatedAt: new Date().toISOString(),
    totalModels: models.length,
    flaggedCount: models.filter((m) => m.flagged).length,
    totalRowsEstimate: models.reduce((s, m) => s + m.estimatedRows, 0),
    permissionDenied,
    models,
  };
}
