#!/usr/bin/env node
/**
 * probe-embedding-identity.mjs · READ-ONLY · 2026-09-18
 *
 * Can we tell which embedding space a stored vector belongs to?
 *
 * ★★★ THE ANSWER TODAY IS NO, AND NOT FOR THE REASON THE AUDIT ASSUMED.
 * The 2026-09-17 audit recorded "72,726 embeddings lacking model metadata" and
 * framed it as a BACKFILL gap. Measured, the coverage number is real (94% NULL)
 * but the deeper problem is that `vector_embeddings."model"` is an OVERLOADED
 * COLUMN — it is not a reliable identity even on the rows that HAVE a value:
 *
 *   cohere-embed-v4.0 / embed-v4.0 / venice-bge-m3  -> a real model identity
 *   "default"                                        -> a placeholder that
 *                                                       identifies nothing
 *                                                       (scripts/embed-skills.ts)
 *   16-hex-char strings                              -> a CONTENT FINGERPRINT
 *                                                       for cache invalidation
 *                                                       (lib/ai/tool-embeddings.ts
 *                                                       writes `model: fingerprint`)
 *
 * So backfilling the NULLs would produce a column that is 94% trustworthy and
 * 6% quietly lying, which is worse than one that is honestly empty: a reader
 * would finally believe it. The same defect class as `cron_job_log.status`
 * carrying both "invoked" and "finished, some children failed" — one token,
 * two meanings, and every consumer silently wrong.
 *
 * ⚠ THIS SCRIPT DELETES NOTHING and is safe to run against production. The
 * audit packet is explicit: "repair derived indexes in shadow, never by
 * deleting original evidence", and 8k orphaned rows are evidence of something,
 * not garbage to sweep. Measure first; decide with the operator.
 *
 * Usage (needs the prod DATABASE_URL, which the deployed service has):
 *   railway run -s statenour-web -- node scripts/probe-embedding-identity.mjs
 */
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const L = (s = "") => console.log(s);
const q = async (sql) => (await client.query(sql)).rows;

/** A value that looks like a hex hash rather than a model name. */
const looksLikeFingerprint = (s) => typeof s === "string" && /^[0-9a-f]{12,}$/i.test(s);
/** A value that names nothing in particular. */
const PLACEHOLDERS = new Set(["default", "unknown", "none", ""]);

await client.connect();
try {
  const [tot] = await q(`SELECT COUNT(*)::int n FROM vector_embeddings`);
  L(`vector_embeddings: ${tot.n} rows`);
  L();

  const [cov] = await q(`
    SELECT COUNT(*) FILTER (WHERE "model" IS NULL)::int           AS model_null,
           COUNT(*) FILTER (WHERE embedding_dim IS NULL)::int     AS dim_null
    FROM vector_embeddings`);
  const pct = (n) => `${((n / Math.max(1, tot.n)) * 100).toFixed(1)}%`;
  L(`IDENTITY COVERAGE`);
  L(`  model NULL         ${cov.model_null} (${pct(cov.model_null)})`);
  L(`  embedding_dim NULL ${cov.dim_null} (${pct(cov.dim_null)})`);
  L();

  const models = await q(
    `SELECT "model", COUNT(*)::int n FROM vector_embeddings WHERE "model" IS NOT NULL GROUP BY 1 ORDER BY n DESC`,
  );
  let real = 0, placeholder = 0, fingerprint = 0;
  L(`WHAT THE POPULATED VALUES ACTUALLY ARE`);
  for (const r of models) {
    const kind = looksLikeFingerprint(r.model)
      ? (fingerprint += r.n, "FINGERPRINT (not a model)")
      : PLACEHOLDERS.has(String(r.model).toLowerCase())
        ? (placeholder += r.n, "PLACEHOLDER (identifies nothing)")
        : (real += r.n, "model identity");
    L(`  ${String(r.model).padEnd(26)} ${String(r.n).padStart(6)}  ${kind}`);
  }
  L();
  L(`  usable identity : ${real}`);
  L(`  placeholder     : ${placeholder}`);
  L(`  fingerprint     : ${fingerprint}   <- lib/ai/tool-embeddings.ts writes model: fingerprint`);
  L(`  ⇒ rows where the embedding SPACE is actually knowable: ${real} of ${tot.n} (${pct(real)})`);
  L();

  // Does the recorded dim agree with the column that actually holds the vector?
  const [dim] = await q(`
    SELECT COUNT(*) FILTER (WHERE embedding_dim = 1024 AND embedding_vec_1536 IS NOT NULL)::int AS says1024_has1536,
           COUNT(*) FILTER (WHERE embedding_vec_1536 IS NOT NULL)::int AS has1536,
           COUNT(*) FILTER (WHERE embedding_vec IS NOT NULL)::int      AS hasvec
    FROM vector_embeddings`);
  L(`DIM METADATA vs STORED VECTOR`);
  L(`  embedding_vec_1536 populated : ${dim.has1536}`);
  L(`  embedding_vec populated      : ${dim.hasvec}`);
  L(`  rows claiming dim=1024 while the 1536 column is populated: ${dim.says1024_has1536}`);
  L(`  ⇒ the dim column is not a safe proxy for the space either.`);
  L();

  // Derived-index health. REPORTED, never repaired here.
  const [orph] = await q(`
    SELECT COUNT(*)::int n FROM vector_embeddings v
    WHERE v."sourceType" = 'brain_memory'
      AND NOT EXISTS (SELECT 1 FROM brain_memories m WHERE m.id = v."sourceId")`);
  const [soft] = await q(`
    SELECT COUNT(*)::int n FROM vector_embeddings v
    JOIN brain_memories m ON m.id = v."sourceId"
    WHERE v."sourceType" = 'brain_memory' AND m.deleted_at IS NOT NULL`);
  L(`DERIVED-INDEX HEALTH (brain_memory lane) — reported, NOT repaired`);
  L(`  orphaned (target row gone)      : ${orph.n}`);
  L(`  pointing at SOFT-DELETED target : ${soft.n}`);
  L(`  ⚠ Do not mass-delete these. The dense read paths already filter`);
  L(`    deletedAt + RECALL_EXCLUDE_CATEGORIES, so they are not reachable;`);
  L(`    they are stale storage, and they are also the only surviving record`);
  L(`    of what was embedded. Shadow-repair, with the operator.`);
} catch (e) {
  console.error("PROBE FAILED:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await client.end();
}
