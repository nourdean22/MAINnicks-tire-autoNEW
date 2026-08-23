/**
 * Backfill the Discover columns added by
 * prisma/migrations/20260823000000_brain_memory_discovery_columns.
 *
 * TWO SEPARATE, SEPARATELY-REVERSIBLE OPERATIONS. They are deliberately not
 * one flag: the first is a pure derivation, the second edits a lifecycle field
 * and therefore snapshots first.
 *
 *   --columns        Derive discovery_verdict / discovery_rated_at /
 *                    discovery_provenance from `metadata`. `metadata` stays
 *                    the source of truth and is never written, so this is
 *                    idempotent (recomputes identical values) and reversible
 *                    by setting the three columns back to NULL.
 *
 *   --rescue-expiry  Clear `expires_at` on discovery rows the operator has
 *                    JUDGED. Snapshots (id, expires_at) into
 *                    _bak_brain_memories_expiry_20260822 BEFORE writing, so
 *                    the rollback is an exact restore, not a guess.
 *
 * WHY --rescue-expiry IS URGENT. Measured on prod 2026-08-22, the operator has
 * FIVE labels in total. One hidden_correlation row was already soft-deleted by
 * the consolidate merge on 08-20. The three blind_spot rows all carry
 * `expires_at = 2026-08-22T07:02`, already in the past: pruneNoise
 * (memory-consolidation.ts) soft-deletes on that field with no category
 * filter, and data-cleanup HARD-deletes the same set. Left alone, 4 of his 5
 * labels are destroyed and 60% of the only real training signal in the system
 * goes with them.
 *
 * IDEMPOTENCE, precisely. `--columns` re-runs write identical VALUES but the
 * UPDATE is unconditional, so it rewrites all 338 rows every time. Prisma's
 * `@updatedAt` is client-side and this uses $executeRawUnsafe, and there is no
 * trigger on brain_memories, so `updated_at` is NOT bumped and no consumer is
 * affected — the residue is 338 dead tuples per run. Idempotent in value and in
 * effect; not free in vacuum terms.
 *
 * SAFETY (prod-db-guard). DRY RUN unless `--apply`. Prints the DB host. Prints
 * a SAMPLE of the exact rows it would change, with before and after values,
 * and the row counts on both sides. There is no DELETE anywhere in this file.
 *
 * ROLLBACK
 *   --columns:
 *     UPDATE brain_memories
 *        SET discovery_verdict = NULL, discovery_rated_at = NULL,
 *            discovery_provenance = NULL
 *      WHERE discovery_verdict IS NOT NULL
 *         OR discovery_rated_at IS NOT NULL
 *         OR discovery_provenance IS NOT NULL;
 *
 *   --rescue-expiry:
 *     UPDATE brain_memories b
 *        SET expires_at = k.expires_at
 *       FROM _bak_brain_memories_expiry_20260822 k
 *      WHERE b.id = k.id;
 *
 *     TWO CAVEATS, stated rather than discovered later:
 *     (1) This restores `expires_at` only. If pruneNoise tombstoned a
 *         snapshotted row in the meantime, the restore re-arms the expiry on an
 *         already-soft-deleted row rather than returning it to its pre-script
 *         state; clear `deleted_at` too if that has happened.
 *     (2) `_bak_brain_memories_expiry_20260822` is created by raw SQL, is not
 *         in schema.prisma and is not in schema-sentinel. It is the ONLY copy
 *         of the pre-rescue values, so any schema-sync operation drops it
 *         without a word. Copy it out before running one.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-discovery-columns.ts --env <path>
 *   pnpm exec tsx scripts/backfill-discovery-columns.ts --env <path> --columns --apply
 *   pnpm exec tsx scripts/backfill-discovery-columns.ts --env <path> --rescue-expiry --apply
 */
import fs from "node:fs";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
{
  const i = process.argv.indexOf("--env");
  if (i >= 0 && process.argv[i + 1]) {
    for (const line of fs.readFileSync(process.argv[i + 1], "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

type Prisma = (typeof import("@/lib/prisma"))["prisma"];

const APPLY = process.argv.includes("--apply");
const DO_COLUMNS = process.argv.includes("--columns");
const DO_RESCUE = process.argv.includes("--rescue-expiry");
const BAK = "_bak_brain_memories_expiry_20260822";

const DISCOVERY = ["counter_intuitive", "hidden_correlation", "blind_spot", "teaching_moment"];

async function main() {
  const { prisma }: { prisma: Prisma } = await import("@/lib/prisma");
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`database host : ${host || "(unset)"}`);
  console.log(`mode          : ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(
    `operations    : ${[DO_COLUMNS && "columns", DO_RESCUE && "rescue-expiry"]
      .filter(Boolean)
      .join(" + ") || "(none selected - pass --columns and/or --rescue-expiry)"}\n`,
  );

  // ---- BEFORE counts, always printed, both modes -------------------------
  const before = await prisma.$queryRawUnsafe<
    Array<{ total: bigint; verdict_col: bigint; prov_col: bigint; judged_meta: bigint; judged_expiring: bigint }>
  >(`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE discovery_verdict IS NOT NULL) AS verdict_col,
           count(*) FILTER (WHERE discovery_provenance IS NOT NULL) AS prov_col,
           count(*) FILTER (WHERE metadata->>'discoveryVerdict' IS NOT NULL) AS judged_meta,
           count(*) FILTER (WHERE metadata->>'discoveryVerdict' IS NOT NULL
                              AND expires_at IS NOT NULL) AS judged_expiring
      FROM brain_memories
     WHERE category = ANY($1::text[])
  `, DISCOVERY);
  console.log("BEFORE:", JSON.stringify(before[0], (_k, v) => (typeof v === "bigint" ? Number(v) : v)));

  if (DO_COLUMNS) {
    // SAMPLE FIRST. Proving the mapping on real rows before running wide is
    // the whole point -- a derivation that reads the wrong key would silently
    // stamp every row with NULL and look like a clean run.
    const sample = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT key,
             metadata->>'discoveryVerdict'  AS meta_verdict,
             discovery_verdict              AS col_verdict_now,
             metadata->>'origin'            AS meta_origin,
             CASE WHEN coalesce(metadata->>'origin','') LIKE 'orphan-restore%'
                  THEN 'restored' ELSE 'engine' END AS col_prov_next
        FROM brain_memories
       WHERE category = ANY($1::text[])
         AND (metadata->>'discoveryVerdict' IS NOT NULL
              OR coalesce(metadata->>'origin','') LIKE 'orphan-restore%')
       ORDER BY metadata->>'discoveryVerdict' NULLS LAST
       LIMIT 8
    `, DISCOVERY);
    console.log("\nSAMPLE (metadata -> column):");
    console.table(sample);

    if (APPLY) {
      const n = await prisma.$executeRawUnsafe(`
        UPDATE brain_memories
           SET discovery_verdict  = CASE
                 WHEN metadata->>'discoveryVerdict' IN ('investigate','known','noise')
                 THEN metadata->>'discoveryVerdict' ELSE NULL END,
               discovery_rated_at = CASE
                 WHEN metadata->>'discoveryRatedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'
                 THEN (metadata->>'discoveryRatedAt')::timestamp ELSE NULL END,
               discovery_provenance = CASE
                 WHEN coalesce(metadata->>'origin','') LIKE 'orphan-restore%'
                 THEN 'restored' ELSE 'engine' END
         WHERE category = ANY($1::text[])
      `, DISCOVERY);
      console.log(`\n--columns: ${n} rows updated`);
    } else {
      console.log("\n(dry run - no write. Re-run with --apply)");
    }
  }

  if (DO_RESCUE) {
    const targets = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT id, key, metadata->>'discoveryVerdict' AS verdict, expires_at, deleted_at
        FROM brain_memories
       WHERE category = ANY($1::text[])
         AND metadata->>'discoveryVerdict' IS NOT NULL
         AND expires_at IS NOT NULL
       ORDER BY expires_at
    `, DISCOVERY);
    console.log(`\nRESCUE TARGETS (judged rows still carrying an expiry): ${targets.length}`);
    console.table(targets);

    if (APPLY) {
      // Snapshot BEFORE the write. CREATE TABLE IF NOT EXISTS + insert-only-
      // if-absent keeps a second run from overwriting the original values with
      // the already-nulled ones, which would destroy the rollback.
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS ${BAK} (id text PRIMARY KEY, expires_at timestamp, saved_at timestamptz DEFAULT now())`,
      );
      const saved = await prisma.$executeRawUnsafe(`
        INSERT INTO ${BAK} (id, expires_at)
        SELECT id, expires_at FROM brain_memories
         WHERE category = ANY($1::text[])
           AND metadata->>'discoveryVerdict' IS NOT NULL
           AND expires_at IS NOT NULL
        ON CONFLICT (id) DO NOTHING
      `, DISCOVERY);
      console.log(`snapshot rows written to ${BAK}: ${saved}`);

      const n = await prisma.$executeRawUnsafe(`
        UPDATE brain_memories
           SET expires_at = NULL
         WHERE category = ANY($1::text[])
           AND metadata->>'discoveryVerdict' IS NOT NULL
           AND expires_at IS NOT NULL
      `, DISCOVERY);
      console.log(`--rescue-expiry: ${n} rows updated`);
    } else {
      console.log("(dry run - no write. Re-run with --apply)");
    }
  }

  // ---- AFTER counts ------------------------------------------------------
  const after = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE discovery_verdict IS NOT NULL) AS verdict_col,
           count(*) FILTER (WHERE discovery_provenance IS NOT NULL) AS prov_col,
           count(*) FILTER (WHERE metadata->>'discoveryVerdict' IS NOT NULL) AS judged_meta,
           count(*) FILTER (WHERE metadata->>'discoveryVerdict' IS NOT NULL
                              AND expires_at IS NOT NULL) AS judged_expiring
      FROM brain_memories
     WHERE category = ANY($1::text[])
  `, DISCOVERY);
  console.log("\nAFTER :", JSON.stringify(after[0], (_k, v) => (typeof v === "bigint" ? Number(v) : v)));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
