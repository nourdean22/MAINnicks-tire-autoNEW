/**
 * prune-superseded-memories — drop the snapshots a now-rolling writer left behind.
 *
 * WHAT (measured 2026-09-23). Ten writers gained an `identity` key in #2529, so each
 * now maintains exactly ONE rolling row: recomputing a summary refreshes that row
 * instead of inserting another. Every row those writers wrote BEFORE the keying is a
 * superseded snapshot — it will never be updated again, it is not what Nick reads for
 * that fact, and it occupies the 500-row cap forever (decay only removes a row after
 * it falls below 0.15, which takes years from 0.85).
 *
 * Measured against the live store: 528 rows, of which
 *   revenue_analytics      132 legacy + 1 rolling
 *   daily_score             75 legacy + 0 rolling (writer has not fired since keying)
 *   daily_digest            53 legacy + 1 rolling
 *   invoice_reconciliation  48 legacy + 1 rolling
 *   auto_analysis           37 legacy + 1 rolling
 *   vip_detection           17 legacy + 1 rolling
 *
 * THE SAFETY RULE THAT SHAPES THE SELECT. A source is only pruned when its rolling row
 * ALREADY EXISTS. `daily_score` is keyed in code but has not run since the deploy, so
 * it has no rolling row yet; deleting its 75 snapshots would leave Nick with nothing at
 * all for that fact until the writer next fires. It is listed and skipped, by design.
 * Rows carrying an `identity` are never matched — those are the rolling rows themselves.
 *
 * DRY RUN BY DEFAULT. Without `--execute` the script only SELECTs and returns before any
 * DELETE is built.
 *
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-superseded-memories.mjs
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-superseded-memories.mjs --execute
 *
 * SAFETY. --execute copies the matched rows into
 * _bak_shop_settings_superseded_<yyyymmdd> (CREATE TABLE … LIKE, then INSERT … SELECT of
 * the matched ids), verifies the backup count equals the match count, and only then
 * DELETEs by that same id list. Operator-run only: a production DELETE is never an
 * agent-initiative action.
 */
import mysql from "mysql2/promise";

const EXECUTE = process.argv.includes("--execute");
const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing — run via: railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-superseded-memories.mjs");
  process.exit(1);
}
const c = await mysql.createConnection(url);

const [[store]] = await c.query("SELECT COUNT(*) AS n FROM shop_settings WHERE `key` LIKE 'nick_memory_%'");

// Which sources currently have a rolling row? Only those are safe to prune behind.
const [rolling] = await c.query(
  "SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(value,'$.source')) AS src FROM shop_settings WHERE `key` LIKE 'nick_memory_%' AND JSON_EXTRACT(value,'$.identity') IS NOT NULL",
);
const safeSources = rolling.map((r) => r.src).filter(Boolean);
if (safeSources.length === 0) {
  console.log("no rolling rows exist yet — nothing is safe to prune");
  await c.end();
  process.exit(0);
}

const [legacy] = await c.query(
  "SELECT id, JSON_UNQUOTE(JSON_EXTRACT(value,'$.source')) AS src, JSON_UNQUOTE(JSON_EXTRACT(value,'$.createdAt')) AS createdAt FROM shop_settings WHERE `key` LIKE 'nick_memory_%' AND JSON_EXTRACT(value,'$.identity') IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(value,'$.source')) IN (?)",
  [safeSources],
);

// What is keyed in code but has no rolling row yet — listed, never deleted.
const [pending] = await c.query(
  "SELECT JSON_UNQUOTE(JSON_EXTRACT(value,'$.source')) AS src, COUNT(*) AS n FROM shop_settings WHERE `key` LIKE 'nick_memory_%' AND JSON_EXTRACT(value,'$.identity') IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(value,'$.source')) NOT IN (?) GROUP BY src HAVING n >= 10 ORDER BY n DESC",
  [safeSources],
);

const bySource = new Map();
for (const r of legacy) bySource.set(r.src, (bySource.get(r.src) ?? 0) + 1);

console.log(`store: ${store.n} nick_memory rows · rolling writers: ${safeSources.join(", ")}`);
console.log(`superseded snapshots behind a rolling row: ${legacy.length}`);
for (const [src, n] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`  ${String(src).padEnd(24)} ${String(n).padStart(4)}`);
if (pending.length) {
  console.log("NOT pruned — no rolling row exists yet for these, so their snapshots are all Nick has:");
  for (const p of pending) console.log(`  ${String(p.src).padEnd(24)} ${String(p.n).padStart(4)}`);
}
console.log(`store would go ${store.n} -> ${store.n - legacy.length} (cap is 500)`);

if (!EXECUTE) {
  console.log(`DRY RUN — nothing written. ${legacy.length} rows would be backed up and deleted with --execute.`);
  await c.end();
  process.exit(0);
}
if (legacy.length === 0) {
  console.log("nothing to prune");
  await c.end();
  process.exit(0);
}

const idList = legacy.map((r) => Number(r.id));
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const bak = `_bak_shop_settings_superseded_${stamp}`;
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
process.exit(0);
