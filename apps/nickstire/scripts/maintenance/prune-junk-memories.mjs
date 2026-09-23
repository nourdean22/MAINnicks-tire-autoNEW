/**
 * prune-junk-memories — delete the writer-noise rows that fill Nick's prompt.
 *
 * WHAT (2026-09-22, scripts/diagnostics/memory-counterfactual.mjs): nine of
 * the ten rows getWarmupContext() injects into every Nick turn were noise a
 * writer re-emitted until `uses` reached the thousands. The writers are now
 * guarded (server/services/memoryWriterGuards.ts) so no NEW row of these
 * shapes is written; the rows already in the store decay 0.05 per 30 days from
 * 1.0 and would keep their seats for over a year. This script removes them.
 *
 * MATCHES — content shapes only, each one a row that says nothing:
 *   1. "Bay utilization at H:00: 0% (0/0 bays, …"      a reading with no bays configured
 *   2. 'Alert "…" was unknown. Outcome unknown.'        an outcome that was never known
 *   3. "[statenour] Nick AI has N learned memories"     Nick describing its own store
 *   4. "[statenour-commitment]  — deadline: …"          a commitment with no text
 * Rows with an `identity` are never matched (they are the rolling rows the
 * keyed writers refresh; the guard keeps them clean going forward).
 *
 * DRY RUN BY DEFAULT. Without `--execute` the script only SELECTs and returns
 * before any DELETE is built.
 *
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-junk-memories.mjs
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-junk-memories.mjs --execute
 *
 * SAFETY. --execute first copies the matched rows into
 * _bak_shop_settings_junk_prune_<yyyymmdd> (CREATE TABLE … LIKE, then INSERT …
 * SELECT of the matched ids), verifies the backup count equals the match
 * count, and only then DELETEs by the same id list. Operator-run only: a
 * production DELETE is never an agent-initiative action.
 */
import mysql from "mysql2/promise";

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing — run via: railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-junk-memories.mjs");
  process.exit(1);
}
const c = await mysql.createConnection(url);
const [[store]] = await c.query("SELECT COUNT(*) AS n FROM shop_settings WHERE `key` LIKE 'nick_memory_%'");
const [rows] = await c.query(
  `SELECT id, JSON_UNQUOTE(JSON_EXTRACT(value, '$.content')) AS content, JSON_EXTRACT(value, '$.uses') AS uses, JSON_EXTRACT(value, '$.confidence') AS confidence, JSON_UNQUOTE(JSON_EXTRACT(value, '$.source')) AS source
   FROM shop_settings
   WHERE \`key\` LIKE 'nick_memory_%'
     AND JSON_EXTRACT(value, '$.identity') IS NULL
     AND (
       JSON_UNQUOTE(JSON_EXTRACT(value, '$.content')) LIKE 'Bay utilization at %(0/0 bays%'
       OR JSON_UNQUOTE(JSON_EXTRACT(value, '$.content')) LIKE 'Alert "%" was unknown.%'
       OR JSON_UNQUOTE(JSON_EXTRACT(value, '$.content')) REGEXP '^\\\\[statenour\\\\] Nick AI has [0-9]+ learned memor'
       OR JSON_UNQUOTE(JSON_EXTRACT(value, '$.content')) LIKE '[statenour-commitment]  — deadline:%'
     )`,
);
const kinds = new Map();
for (const r of rows) {
  const k = r.content.startsWith("Bay utilization") ? "0/0 bays" : r.content.startsWith("Alert ") ? "outcome unknown" : r.content.startsWith("[statenour-commitment]") ? "empty commitment" : "memory-count meta";
  kinds.set(k, (kinds.get(k) ?? 0) + 1);
}
console.log(`store: ${store.n} nick_memory rows · matched junk rows: ${rows.length}`);
console.log(`by kind: ${[...kinds].map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
for (const r of rows.slice(0, 20)) console.log(`  #${r.id} uses=${r.uses} conf=${r.confidence} · ${String(r.content).replace(/\s+/g, " ").slice(0, 100)}`);
if (rows.length > 20) console.log(`  … ${rows.length - 20} more`);

if (!EXECUTE) {
  console.log(`DRY RUN — nothing written. ${rows.length} rows would be backed up and deleted with --execute.`);
  await c.end();
  process.exit(0);
}
if (rows.length === 0) {
  console.log("nothing to prune");
  await c.end();
  process.exit(0);
}
const idList = rows.map((r) => Number(r.id));
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const bak = `_bak_shop_settings_junk_prune_${stamp}`;
await c.query(`CREATE TABLE IF NOT EXISTS \`${bak}\` LIKE shop_settings`);
await c.query(`INSERT IGNORE INTO \`${bak}\` SELECT * FROM shop_settings WHERE id IN (?)`, [idList]);
const [[bakCount]] = await c.query(`SELECT COUNT(*) AS n FROM \`${bak}\` WHERE id IN (?)`, [idList]);
if (Number(bakCount.n) !== idList.length) {
  console.error(`backup holds ${bakCount.n} of ${idList.length} rows — aborting before the DELETE`);
  await c.end();
  process.exit(1);
}
console.log(`backup ${bak}: ${bakCount.n} rows verified`);
const [del] = await c.query("DELETE FROM shop_settings WHERE id IN (?)", [idList]);
const [[after]] = await c.query("SELECT COUNT(*) AS n FROM shop_settings WHERE `key` LIKE 'nick_memory_%'");
console.log(`deleted ${del.affectedRows} rows · store now ${after.n} nick_memory rows · backup kept in ${bak}`);
await c.end();
