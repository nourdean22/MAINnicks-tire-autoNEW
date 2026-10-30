/**
 * READ-ONLY · the brain backfill proof reads (job 2026-10-30-brain-backfill). One command re-runs the census
 * the phase-1 report was built on, so every wave's "proof read" and "kill read" is the same query, not a retelling.
 *
 *   railway run -s statenour-web -- pnpm exec tsx scripts/probe-brain-backfill-census.ts
 *
 * BEGIN READ ONLY + statement guard (SELECT/WITH only) + ROLLBACK. Prints counts, dates and category names only,
 * never row text. Each statement runs under a savepoint, so one failed read prints ERROR and never reads as zero.
 */
import pg from "pg";
import { RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";

/** Recall-visible: what the Prisma recall pool can return. */
const RV = `bm.deleted_at IS NULL AND bm.confidence >= 0.3 AND NOT (bm.category = ANY($1))
  AND (bm.expires_at IS NULL OR bm.expires_at > now()) AND bm.valid_until IS NULL AND bm.superseded_by_id IS NULL`;
const NO_DISTILL = `NOT EXISTS (SELECT 1 FROM brain_memories bm WHERE bm.deleted_at IS NULL
  AND ((bm.category = 'chat_summary' AND bm.key = c.id) OR (bm.category = 'conversation_summary' AND bm.key = 'conv_' || c.id)))`;

export const READS: ReadonlyArray<[wave: string, name: string, sql: string]> = [
  ["W1", "chats >=4 msgs with no distill of either kind", `SELECT COUNT(*)::int n, MIN(c.updated_at)::date lo, MAX(c.updated_at)::date hi FROM chat_conversations c
     WHERE (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) >= 4 AND ${NO_DISTILL}`],
  ["W1", "chat_summary rows from session_distiller, live", `SELECT COUNT(*)::int n, MAX(created_at)::date hi FROM brain_memories WHERE category = 'chat_summary' AND deleted_at IS NULL`],
  ["W2", "pack rows with a pgvector embedding, by pack", `SELECT b.source k, COUNT(v.id)::int n, COUNT(*)::int of_rows FROM brain_memories b
     LEFT JOIN vector_embeddings v ON v."sourceType" = 'brain_memory' AND v."sourceId" = b.id AND v.embedding_vec IS NOT NULL
     WHERE b.deleted_at IS NULL AND b.source LIKE 'pack:%' GROUP BY 1 ORDER BY 1`],
  ["W2", "recall-visible rows with no usable vector", `SELECT COUNT(*)::int n FROM (SELECT id FROM brain_memories bm WHERE ${RV}
     EXCEPT SELECT "sourceId" FROM vector_embeddings WHERE "sourceType" = 'brain_memory' AND embedding_vec IS NOT NULL) x`],
  ["W3", "live rows with NULL trust_tier", `SELECT COUNT(*)::int n FROM brain_memories WHERE deleted_at IS NULL AND trust_tier IS NULL`],
  ["W3", "recall-visible trust tiers", `SELECT COALESCE(trust_tier, '(null)') k, COUNT(*)::int n FROM brain_memories bm WHERE ${RV} GROUP BY 1 ORDER BY 2 DESC`],
  ["W4", "recall-visible exact duplicates (extra rows)", `SELECT COALESCE(SUM(c - 1), 0)::int n FROM (SELECT md5(content), COUNT(*) c FROM brain_memories bm WHERE ${RV} GROUP BY 1 HAVING COUNT(*) > 1) x`],
  ["W4", "live rows with superseded_by_id set", `SELECT COUNT(*)::int n FROM brain_memories WHERE deleted_at IS NULL AND superseded_by_id IS NOT NULL`],
  ["W5", "mastery decisions with a decision replay", `SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM decision_replays r WHERE r."decisionId" = d.id))::int n, COUNT(*)::int of_rows
     FROM mastery_decisions d WHERE d.deleted_at IS NULL`],
  ["W6", "ledger notes >=20 chars with no pgvector embedding", `SELECT COUNT(*)::int n FROM (SELECT id FROM relationship_ledger WHERE length(COALESCE(note, '')) >= 20
     EXCEPT SELECT "sourceId" FROM vector_embeddings WHERE "sourceType" = 'relationship_ledger' AND embedding_vec IS NOT NULL) x`],
  ["all", "live categories / recall-visible rows", `SELECT COUNT(DISTINCT category)::int n, COUNT(*) FILTER (WHERE ${RV})::int rv FROM brain_memories bm WHERE bm.deleted_at IS NULL`],
  ["all", "live rows with metadata.lastRecalledAt (the recall instrument)", `SELECT COUNT(*)::int n FROM brain_memories WHERE deleted_at IS NULL AND metadata ? 'lastRecalledAt'`],
];

export function guard(sql: string): string {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error("non-SELECT refused");
  return sql;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL unset");
  console.log(`host ${new URL(url).hostname} at ${new Date().toISOString()}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '120s'");
    const ro = await client.query<{ ro: string }>("SELECT current_setting('transaction_read_only') AS ro");
    if (ro.rows[0]?.ro !== "on") throw new Error("transaction is not read-only; abort");
    console.log("transaction_read_only on");
    for (const [wave, name, sql] of READS) {
      await client.query("SAVEPOINT s");
      try {
        const r = await client.query(guard(sql), sql.includes("$1") ? [[...RECALL_EXCLUDE_CATEGORIES]] : []);
        console.log(`${wave}\t${name}\t${r.rows.map((row) => Object.values(row).join("|")).join("  ;  ")}`);
        await client.query("RELEASE SAVEPOINT s");
      } catch (e) {
        console.log(`${wave}\t${name}\tERROR ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

if (process.argv[1]?.endsWith("probe-brain-backfill-census.ts")) {
  main().catch((e) => {
    console.error(`FAILED: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`);
    process.exit(1);
  });
}
