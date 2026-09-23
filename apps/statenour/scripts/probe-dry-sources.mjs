#!/usr/bin/env node
/**
 * probe-dry-sources.mjs · READ-ONLY · 2026-09-18
 *
 * Which memory sources have stopped producing, and who is still reading them?
 *
 * ★★★ THIS REFUTES THE QUESTION IT WAS ASKED. The 2026-09-17 audit listed
 * `reflection`, `situationLog` and `decisionReplay` under "retire redundancies
 * only after verifying importers/consumers". Verified 2026-09-18, they are NOT
 * redundancies — they have substantial live consumers:
 *
 *     prisma.reflection      5 writers · 37 readers
 *     prisma.situationLog    5 writers ·  9 readers
 *     prisma.decisionReplay  7 writers · 12 readers
 *
 * A table with 37 readers is not a retirement candidate. What is actually wrong
 * is the opposite of redundancy: the READ paths are alive and the WRITERS have
 * stopped, so dozens of call sites are rendering stale or empty data as fact.
 * That is the empty-vs-error class, one layer down.
 *
 * ⚠⚠ THE SHARPEST CASE IS `situation_log`: ZERO rows, ever — and 205 vector
 * embeddings pointing at row ids that do not exist. Something wrote 205
 * embeddings for records that were never created or were hard-deleted. Those
 * embeddings are live, searchable content backed by nothing; if recall surfaces
 * one, it is a memory with no source.
 *
 * ⚠ DELETES NOTHING. The audit's own boundary is "repair derived indexes in
 * shadow, never by deleting original evidence" — and retiring any of these
 * means touching 14-42 call sites, which is a decision about whether the
 * FEATURE exists, not about a table. That is the operator's call, and this
 * script exists so it is made on measurements rather than memory.
 *
 * Usage:
 *   railway run -s statenour-web -- node scripts/probe-dry-sources.mjs
 */
import pg from "pg";

const SOURCES = [
  { table: "reflections", sourceType: "reflection", model: "prisma.reflection" },
  { table: "situation_logs", sourceType: "situation_log", model: "prisma.situationLog" },
  { table: "decision_replays", sourceType: "decision_replay", model: "prisma.decisionReplay" },
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const L = (s = "") => console.log(s);

await client.connect();
try {
  L("source                rows    newest        embeddings  orphaned");
  L("-".repeat(66));
  for (const s of SOURCES) {
    const cols = (
      await client.query(
        `SELECT column_name::text c FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [s.table],
      )
    ).rows.map((r) => r.c);
    if (cols.length === 0) {
      L(`${s.table.padEnd(20)} (table does not exist)`);
      continue;
    }
    // Timestamp column name is not uniform across these tables — derive it
    // rather than assuming `created_at`, which is how an earlier probe of this
    // very question failed with "column does not exist" and reported nothing.
    const tcol = cols.find((c) => /^createdAt$|^created_at$|At$|_at$/.test(c)) ?? null;

    const rows = (await client.query(`SELECT COUNT(*)::int n FROM "${s.table}"`)).rows[0].n;
    let newest = "n/a";
    if (tcol) {
      const m = (await client.query(`SELECT MAX("${tcol}") m FROM "${s.table}"`)).rows[0].m;
      newest = m ? new Date(m).toISOString().slice(0, 10) : "never";
    }
    const emb = (
      await client.query(`SELECT COUNT(*)::int n FROM vector_embeddings WHERE "sourceType"=$1`, [
        s.sourceType,
      ])
    ).rows[0].n;
    const orphaned = (
      await client.query(
        `SELECT COUNT(*)::int n FROM vector_embeddings v
         WHERE v."sourceType"=$1
           AND NOT EXISTS (SELECT 1 FROM "${s.table}" t WHERE t.id = v."sourceId")`,
        [s.sourceType],
      )
    ).rows[0].n;

    const flag = rows === 0 && emb > 0 ? "  <- embeddings with NO source rows at all" : "";
    L(
      `${s.table.padEnd(20)} ${String(rows).padEnd(7)} ${String(newest).padEnd(13)} ${String(emb).padEnd(11)} ${orphaned}${flag}`,
    );
  }
  L();
  L("A row count that stopped growing is not the same as a table nobody reads.");
  L("Check the consumer counts in this file's header before proposing a retirement:");
  L("  git grep -c 'prisma\\.reflection\\.' -- lib app scripts");
} catch (e) {
  console.error("PROBE FAILED:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await client.end();
}
