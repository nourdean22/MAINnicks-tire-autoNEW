/**
 * Vector-embedding SHADOW REPAIR · 2026-09-18
 *
 * `vector_embeddings` is a DERIVED index over many source tables, keyed by
 * ("sourceType","sourceId") with NO foreign key — one table indexes ~13
 * sources, so there is no referential action to lean on. When a source row
 * goes away, its embedding stays behind and stays searchable.
 *
 * This marks those rows instead of deleting them, and un-marks them if the
 * source comes back. `vector_embeddings.content` holds a TEXT copy of the
 * source and is frequently the LAST SURVIVING COPY of a hard-deleted row
 * (measured 2026-08-16: 100% of 4,867 brain_memory orphans had no surviving
 * brain_memories row with the same key). So the repair is applied to the
 * DERIVED INDEX in shadow; the evidence is never touched.
 *
 * ════════════════════════════════════════════════════════════════════════
 * WHY THIS IS AN ALLOWLIST AND NEVER A `NOT EXISTS` SWEEP
 * ════════════════════════════════════════════════════════════════════════
 * Measured 2026-09-18, `vector_embeddings` holds 17 distinct sourceTypes and
 * only 11 of them are "an id pointing at a row in a table". The other six are
 * two different kinds of not-that, and a blanket orphan sweep condemns ALL of
 * them because a missing row and a nonexistent concept look identical to
 * `NOT EXISTS`:
 *
 *   CODE-DEFINED — the source is a file, not a row. There is no table to
 *   join, so every row looks orphaned:
 *     skill (1,434) · tool_catalog (189) · greene_law (15) ·
 *     behavioral_persona (1)
 *   Condemning these would have broken skill recall AND tool selection.
 *
 *   COMPOSITE sourceId — the source IS a row, but sourceId is not its id:
 *     document      `${documentId}:chunk:${i}`        (document-ingest.ts)
 *     notebooklm    `${slug}:${sourceFile}:${text…}`  (adapters/notebooklm.ts)
 *     obsidian      `${prefix}${relativePath}`        (ingest-obsidian-…)
 *   These are the dangerous ones, because a table DOES exist and the join
 *   silently matches nothing. The first measurement of this repair reported
 *   `document: 1 row, 1 missing, 100% dead` and that reading was WRONG — the
 *   mapping was broken, not the data. It was survivable only because there is
 *   one document row today; the same code against a populated document index
 *   would have quarantined every chunk of every document.
 *
 * ⇒ A measurement can confirm its own error. The guard below (`allowFullSweep`)
 *   exists specifically so that "100% of this type is dead" must be asserted by
 *   a human once, rather than inferred by a query that cannot tell the
 *   difference between a dead silo and a broken join.
 */
import { prisma as defaultPrisma } from "@/lib/prisma";

type PrismaLike = typeof defaultPrisma;

export interface ShadowSource {
  /** vector_embeddings."sourceType" value. */
  sourceType: string;
  /** Physical table whose `id` column `sourceId` points at, verbatim casing. */
  table: string;
  /** Column that marks a row soft-deleted, if the table has one. */
  softDeleteColumn?: string;
  /**
   * Permit a sweep that would mark EVERY row of this type.
   *
   * Off by default: zero-live is the exact signature of a broken mapping, and
   * is indistinguishable from a genuinely dead silo without human judgement.
   * Set it only with a measurement in the comment.
   */
  allowFullSweep?: boolean;
}

/**
 * VERIFIED 2026-09-18 — each entry checked against the writer's `sourceId:`
 * expression (must be a bare row id) AND against information_schema.
 */
export const SHADOW_SOURCES: readonly ShadowSource[] = [
  { sourceType: "brain_memory", table: "brain_memories", softDeleteColumn: "deleted_at" },
  { sourceType: "chat_message", table: "chat_messages" },
  { sourceType: "brain_dump", table: "brain_dumps", softDeleteColumn: "deleted_at" },
  { sourceType: "reflection", table: "reflections", softDeleteColumn: "deleted_at" },
  // 205 embeddings, 0 source rows, and the table has NEVER held a row.
  // Cause is known and fixed in the same change: data-cleanup hard-deleted
  // situation_logs on a 90-day timer while its three sibling journal silos
  // (reflection · brain_dump · decision_replay) are never swept at all.
  { sourceType: "situation_log", table: "situation_logs", allowFullSweep: true },
  { sourceType: "strategic_law", table: "strategic_laws" },
  { sourceType: "chat_conversation", table: "chat_conversations", softDeleteColumn: "archived_at" },
  { sourceType: "mission", table: "Mission", softDeleteColumn: "deleted_at" },
  { sourceType: "decision_replay", table: "decision_replays" },
  { sourceType: "person_profile", table: "person_profiles", softDeleteColumn: "deleted_at" },
  { sourceType: "relationship_ledger", table: "relationship_ledger" },
];

/** Why each remaining sourceType is deliberately absent. Documentation that a
 *  test asserts against, so adding a writer without deciding is noticed. */
export const UNMAPPED_SOURCE_TYPES: Readonly<Record<string, string>> = {
  skill: "code-defined · no source table",
  tool_catalog: "code-defined · no source table",
  greene_law: "code-defined · no source table",
  behavioral_persona: "code-defined · no source table",
  photo: "sourceId is a bare id but no photos table exists · source unknown",
  document: "composite sourceId `${documentId}:chunk:${i}` · not a row id",
  notebooklm: "composite sourceId `${slug}:${sourceFile}:${text}` · not a row id",
  obsidian: "composite sourceId `${prefix}${relativePath}` · a file path",
};

export const REASON_ROW_ABSENT = "row_absent";
export const REASON_SOFT_DELETED = "soft_deleted";

/**
 * Refuse a run that would newly mark more than this, unless forced.
 *
 * Same shape as the brain-GC guard in data-cleanup: count first, refuse over
 * the cap. The FIRST real run exceeds it on purpose (17,721 rows were dead on
 * 2026-09-18) so the initial quarantine is a deliberate `force: true` with a
 * number in front of the operator, not a silent background event. Steady-state
 * runs mark a handful and never trip it.
 */
export const MAX_NEW_MARKS_PER_RUN = 2000;

export interface ShadowSourceResult {
  sourceType: string;
  /** Rows newly held out of recall this run. */
  marked: number;
  /** Rows returned to recall because their source came back. */
  cleared: number;
  /** Set when the source was not swept; `marked`/`cleared` are then 0. */
  skipped?: string;
}

export interface ShadowSweepReport {
  sources: ShadowSourceResult[];
  totalMarked: number;
  totalCleared: number;
  /** True when the cap refused the marking pass. Clears still ran. */
  refused: boolean;
  refusedReason?: string;
  dryRun: boolean;
}

export interface ShadowSweepOptions {
  prisma?: PrismaLike;
  /** Count only; write nothing. */
  dryRun?: boolean;
  /** Bypass MAX_NEW_MARKS_PER_RUN. Operator-initiated only. */
  force?: boolean;
  /**
   * Override the source list. Production never passes this — it exists so the
   * guards below can be EXERCISED rather than merely read. A guard with no test
   * that trips it is a comment.
   */
  sources?: readonly ShadowSource[];
}

/**
 * Table names are interpolated, not bound — Postgres cannot parameterise an
 * identifier. They come from the const above rather than from input, but this
 * validates anyway: it is the difference between "not exploitable today" and
 * "cannot become exploitable". Mirrors assertSafeVectorLiteral in pgvector.ts.
 *
 * (lib/db/embedding-cleanup.ts is the counter-example. Its non-dry-run path
 * passes the table name through `$executeRaw`, a TAGGED TEMPLATE that turns
 * every `${}` into a bind parameter — so the identifier becomes a parameter in
 * a FROM clause, which Postgres cannot accept. Its dry-run path is correct
 * because it uses `$queryRawUnsafe`.)
 */
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertSafeIdent(name: string, what: string): void {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(`embedding-shadow: unsafe ${what} identifier ${JSON.stringify(name)}`);
  }
}

/** `t."col" IS NULL` when the table has a soft-delete column, else always-true. */
function liveExpr(src: ShadowSource): string {
  if (!src.softDeleteColumn) return "TRUE";
  return `t."${src.softDeleteColumn}" IS NULL`;
}

async function tableExists(prisma: PrismaLike, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    table,
  );
  return (rows[0]?.n ?? 0) > 0;
}

async function columnExists(
  prisma: PrismaLike,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return (rows[0]?.n ?? 0) > 0;
}

async function scalar(
  prisma: PrismaLike,
  sql: string,
  ...params: unknown[]
): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(sql, ...params);
  return rows[0]?.n ?? 0;
}

/** Embeddings of this type whose source row exists AND is not soft-deleted. */
function liveCountSql(src: ShadowSource): string {
  return `SELECT COUNT(*)::int AS n
            FROM vector_embeddings v
            JOIN "${src.table}" t ON t.id = v."sourceId"
           WHERE v."sourceType" = $1 AND ${liveExpr(src)}`;
}

/** Not-yet-marked embeddings whose source row is gone entirely. */
function absentCountSql(src: ShadowSource): string {
  return `SELECT COUNT(*)::int AS n
            FROM vector_embeddings v
           WHERE v."sourceType" = $1
             AND v."sourceUnavailableAt" IS NULL
             AND NOT EXISTS (SELECT 1 FROM "${src.table}" t WHERE t.id = v."sourceId")`;
}

/** Not-yet-marked embeddings whose source row is present but soft-deleted. */
function softCountSql(src: ShadowSource): string {
  return `SELECT COUNT(*)::int AS n
            FROM vector_embeddings v
            JOIN "${src.table}" t ON t.id = v."sourceId"
           WHERE v."sourceType" = $1
             AND v."sourceUnavailableAt" IS NULL
             AND NOT (${liveExpr(src)})`;
}

/** Marked embeddings whose source is live again — the self-heal direction. */
function clearCountSql(src: ShadowSource): string {
  return `SELECT COUNT(*)::int AS n
            FROM vector_embeddings v
            JOIN "${src.table}" t ON t.id = v."sourceId"
           WHERE v."sourceType" = $1
             AND v."sourceUnavailableAt" IS NOT NULL
             AND ${liveExpr(src)}`;
}

/**
 * Rows touched per statement.
 *
 * ⚠ NOT A TUNING KNOB — A CORRECTNESS ONE. The first version issued one
 * unbounded UPDATE per source type. Against prod it died with `Query read
 * timeout` on brain_memory's 17,325 rows, and the whole sweep rolled back
 * (verified afterwards: 0 rows marked, nothing partial). Raising the timeout
 * would have "fixed" it while leaving a nightly cron holding an unbounded write
 * — the shape whose blast radius was the whole story of the 54,107-row deletion
 * on 2026-08-28. Bounding the statement is the fix; the retry is free because
 * every batch is idempotent.
 */
const BATCH_SIZE = 2000;

/** Refuse to loop forever if a predicate somehow never converges. */
const MAX_BATCHES_PER_STATEMENT = 200;

/**
 * Run one bounded UPDATE repeatedly until it stops matching rows.
 *
 * `sql` must contain `__LIMIT__` inside an `id IN (SELECT ... LIMIT __LIMIT__)`
 * so each pass is bounded. Every pass narrows the remaining set (the predicate
 * always includes the column the UPDATE writes), so this terminates.
 */
async function updateInBatches(
  prisma: PrismaLike,
  sql: string,
  params: unknown[],
): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_STATEMENT; i++) {
    const n = Number(
      await prisma.$executeRawUnsafe(sql.replace("__LIMIT__", String(BATCH_SIZE)), ...params),
    );
    total += n;
    if (n < BATCH_SIZE) return total;
  }
  return total;
}

/**
 * Mark / un-mark one source type.
 *
 * Two UPDATEs rather than one, so `sourceUnavailableReason` is exact per row.
 * A single statement with a CASE would have to re-evaluate the liveness join
 * twice anyway, and a wrong reason is worse than a second statement: it is what
 * sends an operator looking for a recoverable row that was hard-deleted.
 */
async function applyForSource(
  prisma: PrismaLike,
  src: ShadowSource,
): Promise<{ marked: number; cleared: number }> {
  const absent = await updateInBatches(
    prisma,
    `UPDATE vector_embeddings
        SET "sourceUnavailableAt" = NOW(), "sourceUnavailableReason" = $2
      WHERE id IN (
            SELECT v.id FROM vector_embeddings v
             WHERE v."sourceType" = $1
               AND v."sourceUnavailableAt" IS NULL
               AND NOT EXISTS (SELECT 1 FROM "${src.table}" t WHERE t.id = v."sourceId")
             LIMIT __LIMIT__)`,
    [src.sourceType, REASON_ROW_ABSENT],
  );

  let soft = 0;
  if (src.softDeleteColumn) {
    soft = await updateInBatches(
      prisma,
      `UPDATE vector_embeddings
          SET "sourceUnavailableAt" = NOW(), "sourceUnavailableReason" = $2
        WHERE id IN (
              SELECT v.id FROM vector_embeddings v
               JOIN "${src.table}" t ON t.id = v."sourceId"
               WHERE v."sourceType" = $1
                 AND v."sourceUnavailableAt" IS NULL
                 AND t."${src.softDeleteColumn}" IS NOT NULL
               LIMIT __LIMIT__)`,
      [src.sourceType, REASON_SOFT_DELETED],
    );
  }

  // Self-heal. Always allowed, never capped: restoring visibility is the safe
  // direction, and a marked row whose source is back is simply stale state.
  const cleared = await clearOnly(prisma, src);

  return { marked: absent + soft, cleared };
}

/**
 * Sweep every allowlisted source type.
 *
 * Order is deliberate: PLAN the whole run (counts only), apply the cap to the
 * total, and only then write. Capping per-source would let eleven small
 * over-limit sweeps through while refusing one honest big one.
 */
export async function sweepEmbeddingShadow(
  options: ShadowSweepOptions = {},
): Promise<ShadowSweepReport> {
  const prisma = options.prisma ?? defaultPrisma;
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const sources = options.sources ?? SHADOW_SOURCES;

  const planned: Array<{ src: ShadowSource; marked: number; cleared: number }> = [];
  const results: ShadowSourceResult[] = [];

  for (const src of sources) {
    assertSafeIdent(src.table, "table");
    if (src.softDeleteColumn) assertSafeIdent(src.softDeleteColumn, "column");

    if (!(await tableExists(prisma, src.table))) {
      results.push({
        sourceType: src.sourceType,
        marked: 0,
        cleared: 0,
        skipped: `table "${src.table}" does not exist`,
      });
      continue;
    }
    if (
      src.softDeleteColumn &&
      !(await columnExists(prisma, src.table, src.softDeleteColumn))
    ) {
      // A renamed soft-delete column would make every live row read as
      // deleted. Skip rather than guess.
      results.push({
        sourceType: src.sourceType,
        marked: 0,
        cleared: 0,
        skipped: `column "${src.softDeleteColumn}" missing on "${src.table}"`,
      });
      continue;
    }

    const [live, absent, soft, clearable] = await Promise.all([
      scalar(prisma, liveCountSql(src), src.sourceType),
      scalar(prisma, absentCountSql(src), src.sourceType),
      src.softDeleteColumn ? scalar(prisma, softCountSql(src), src.sourceType) : Promise.resolve(0),
      scalar(prisma, clearCountSql(src), src.sourceType),
    ]);

    const toMark = absent + soft;

    // THE MAPPING GUARD. Zero live rows while rows exist to mark is exactly
    // what a broken join looks like — and exactly what `document` would have
    // produced. Refuse unless a human asserted it.
    if (live === 0 && toMark > 0 && !src.allowFullSweep) {
      results.push({
        sourceType: src.sourceType,
        marked: 0,
        cleared: 0,
        skipped: `would mark 100% (${toMark}) — no live row resolves, which is also what a broken sourceId mapping looks like. Set allowFullSweep with a measurement to confirm.`,
      });
      continue;
    }

    planned.push({ src, marked: toMark, cleared: clearable });
  }

  const plannedMarks = planned.reduce((s, p) => s + p.marked, 0);
  const plannedClears = planned.reduce((s, p) => s + p.cleared, 0);
  const overCap = plannedMarks > MAX_NEW_MARKS_PER_RUN && !force;

  if (dryRun) {
    for (const p of planned) {
      results.push({
        sourceType: p.src.sourceType,
        marked: p.marked,
        cleared: p.cleared,
      });
    }
    return {
      sources: results,
      totalMarked: plannedMarks,
      totalCleared: plannedClears,
      refused: overCap,
      refusedReason: overCap
        ? `${plannedMarks} rows exceeds MAX_NEW_MARKS_PER_RUN=${MAX_NEW_MARKS_PER_RUN}; re-run with force`
        : undefined,
      dryRun: true,
    };
  }

  let totalMarked = 0;
  let totalCleared = 0;
  for (const p of planned) {
    if (overCap) {
      // Clears still run — returning rows to recall can never be the unsafe
      // direction, and withholding them would punish the operator for the
      // size of an unrelated marking pass.
      const cleared = await clearOnly(prisma, p.src);
      totalCleared += cleared;
      results.push({
        sourceType: p.src.sourceType,
        marked: 0,
        cleared,
        skipped: "marking refused by cap",
      });
      continue;
    }
    const applied = await applyForSource(prisma, p.src);
    totalMarked += applied.marked;
    totalCleared += applied.cleared;
    results.push({
      sourceType: p.src.sourceType,
      marked: applied.marked,
      cleared: applied.cleared,
    });
  }

  return {
    sources: results,
    totalMarked,
    totalCleared,
    refused: overCap,
    refusedReason: overCap
      ? `${plannedMarks} rows exceeds MAX_NEW_MARKS_PER_RUN=${MAX_NEW_MARKS_PER_RUN}; re-run with force`
      : undefined,
    dryRun: false,
  };
}

async function clearOnly(prisma: PrismaLike, src: ShadowSource): Promise<number> {
  return updateInBatches(
    prisma,
    `UPDATE vector_embeddings
        SET "sourceUnavailableAt" = NULL, "sourceUnavailableReason" = NULL
      WHERE id IN (
            SELECT v.id FROM vector_embeddings v
             JOIN "${src.table}" t ON t.id = v."sourceId"
             WHERE v."sourceType" = $1
               AND v."sourceUnavailableAt" IS NOT NULL
               AND ${liveExpr(src)}
             LIMIT __LIMIT__)`,
    [src.sourceType],
  );
}
