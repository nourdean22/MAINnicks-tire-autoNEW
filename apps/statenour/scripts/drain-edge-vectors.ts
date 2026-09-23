/**
 * Drain the `semantic_edge` vectors out of vector_embeddings (2026-09-22).
 *
 * WHY. The semantic-link writer persists every graph edge as a BrainMemory row
 * (category `semantic_edge`, text "[cat] ↔ [cat] · score=0.82"), and the
 * embedding backfill embedded them like knowledge — about three vectors per
 * edge as their score churned. Measured read-only on prod: 58,945 of the
 * 92,181 brain_memory vectors belong to edges. Two-thirds of the HNSW index
 * the dense recall lane walks is graph plumbing. `semantic_edge` is now in
 * TELEMETRY_CATEGORIES (lib/brain/embedding-policy.ts), so no NEW edge vector
 * will be written; this removes the existing ones.
 *
 * WHAT IT DOES NOT TOUCH. Edge ROWS in brain_memories stay — the graph API
 * (app/api/brain/graph/route.ts) reads them by category. Vectors of every
 * other category stay, including the "dead" ones whose memory was deleted:
 * lib/db/embedding-cleanup.ts keeps those on purpose because their text column
 * is often the last copy of a hard-deleted memory. Edge text has no such
 * value, which is the only reason this drain is safe at all.
 *
 * SAFETY (prod-db-guard): DRY RUN unless `--apply` is passed. It prints the
 * database host before anything else, counts first, deletes in bounded
 * batches (`--batch`, default 5000) with a receipt per batch, and stops the
 * moment a batch matches zero rows. The DELETE statement is unreachable
 * without `--apply` (tests/scripts/drain-edge-vectors-dry-run.test.ts pins
 * that).
 *
 *   railway run -s statenour-web -- pnpm exec tsx scripts/drain-edge-vectors.ts            # count only
 *   railway run -s statenour-web -- pnpm exec tsx scripts/drain-edge-vectors.ts --apply    # operator-instructed write
 */
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const batchArg = process.argv.find((a) => a.startsWith("--batch="));
const BATCH = Math.max(100, Math.min(20_000, Number(batchArg?.slice("--batch=".length) ?? 5000) || 5000));
// 2026-09-23 · an --apply run backs up first. Every row the predicate would
// delete is copied into a backup table (house pattern: _bak_<table>_<op>_<yyyymmdd>)
// and the delete refuses to start unless the backup holds exactly the pre-count.
// The copy is the restore route: INSERT ... SELECT it back. Derived, regenerable
// data still gets one; "regenerable" has been wrong before.
const backupArg = process.argv.find((a) => a.startsWith("--backup-table="));
const BACKUP_TABLE = backupArg
  ? backupArg.slice("--backup-table=".length)
  : `_bak_vector_embeddings_edge_drain_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(BACKUP_TABLE)) {
  console.error(`refusing: backup table name must match ^[a-z_][a-z0-9_]{0,62}$ (got ${JSON.stringify(BACKUP_TABLE)})`);
  process.exit(1);
}

const EDGE_VECTOR_MATCH = `FROM vector_embeddings ve
   JOIN brain_memories bm ON bm.id = ve."sourceId"
  WHERE ve."sourceType" = 'brain_memory'
    AND bm.category = 'semantic_edge'`;

function hostOf(url: string | undefined): string {
  if (!url) return "(DATABASE_URL unset)";
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main(): Promise<void> {
  console.log(`database host: ${hostOf(process.env.DATABASE_URL)}`);
  console.log(`mode: ${APPLY ? "APPLY — rows will be deleted" : "DRY RUN — counting only (pass --apply to delete)"}`);

  const prisma = new PrismaClient();
  try {
    const [before] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n ${EDGE_VECTOR_MATCH}`);
    const [total] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM vector_embeddings WHERE "sourceType" = 'brain_memory'`,
    );
    const edgeVectors = Number(before?.n ?? 0);
    const brainVectors = Number(total?.n ?? 0);
    console.log(`semantic_edge vectors: ${edgeVectors} of ${brainVectors} brain_memory vectors (${brainVectors ? ((edgeVectors / brainVectors) * 100).toFixed(1) : "0"}%)`);

    if (!APPLY) {
      console.log(`dry run: would delete ${edgeVectors} vector rows in batches of ${BATCH}. Edge ROWS in brain_memories are never touched.`);
      return;
    }

    // ── APPLY · only reachable with --apply ────────────────────────────────
    // Backup before the first delete; abort on any count mismatch.
    const [existing] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`,
      BACKUP_TABLE,
    );
    if (Number(existing?.n ?? 0) > 0) {
      console.error(`refusing: backup table ${BACKUP_TABLE} already exists - pick another --backup-table= or drop the old one first (operator)`);
      process.exitCode = 1;
      return;
    }
    await prisma.$executeRawUnsafe(`CREATE TABLE ${BACKUP_TABLE} AS SELECT ve.* ${EDGE_VECTOR_MATCH}`);
    const [backed] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM ${BACKUP_TABLE}`);
    const backedUp = Number(backed?.n ?? 0);
    console.log(`backup: ${BACKUP_TABLE} holds ${backedUp} rows (pre-count ${edgeVectors})`);
    if (backedUp !== edgeVectors) {
      console.error(`refusing to delete: backup count ${backedUp} != pre-count ${edgeVectors} (rows moved under us; re-run)`);
      process.exitCode = 1;
      return;
    }
    console.log(`restore route: INSERT INTO vector_embeddings SELECT * FROM ${BACKUP_TABLE}; then DROP TABLE ${BACKUP_TABLE} once the change is confirmed good (operator)`);

    let deleted = 0;
    for (let batch = 1; ; batch++) {
      const n = await prisma.$executeRawUnsafe(
        `DELETE FROM vector_embeddings
          WHERE id IN (
            SELECT ve.id ${EDGE_VECTOR_MATCH}
            LIMIT ${BATCH}
          )`,
      );
      deleted += n;
      console.log(`batch ${batch}: deleted ${n} (running total ${deleted})`);
      if (n === 0) break;
    }
    const [after] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n ${EDGE_VECTOR_MATCH}`);
    console.log(`done: deleted ${deleted}; semantic_edge vectors remaining ${Number(after?.n ?? 0)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("drain failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
