/**
 * prune-health-memories · remove the "System health:" rows the self-healing
 * bridge wrote into Nick's memory store (shop_settings, keys nick_memory_*).
 *
 * WHY. Until 2026-09-22 every 5-minute self-healing pass wrote each open issue
 * to Nick's durable memory. 173 such rows sit in the store (census 2026-09-22
 * 20:23Z: 136 "CRON WIRED TO NO TIER" from 2026-08-03..08-23, the rest CRON
 * STALE / DATABASE / MEMORY HIGH), in a store that is 721 rows over its 500
 * cap. They are operational history, not knowledge, and recall() can hand
 * them to the chat prompt. The bridge is gone; these rows only leave through
 * decayMemories (below 0.15 after 90 days untouched) or this script.
 *
 * DRY RUN BY DEFAULT. Without `--execute` the script only SELECTs: it prints
 * the count, the confidence spread, the ten oldest and the ten newest rows,
 * and returns before any DELETE is built.
 *
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-health-memories.mjs
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-health-memories.mjs --execute
 *
 * WHAT IT MATCHES. key LIKE 'nick_memory_%' AND value->'$.source' = 'self_healing'
 * AND value->'$.content' LIKE 'System health:%'. Both conditions: the source
 * alone would also match nothing else today, but the content prefix is what
 * the operator can read in the dry run, and a future self_healing writer that
 * stores real knowledge is not swept up by accident.
 *
 * SAFETY. --execute first copies the matched rows into
 * _bak_shop_settings_health_prune_<yyyymmdd> (CREATE TABLE … LIKE, then
 * INSERT … SELECT of the matched ids), verifies the backup count equals the
 * match count, and only then DELETEs by the same id list. Operator-run only:
 * a production DELETE is never an agent-initiative action.
 */
import mysql from "mysql2/promise";

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing or not mysql:// — run via: railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-health-memories.mjs");
  process.exit(1);
}
const c = await mysql.createConnection(url);
const WHERE =
  "`key` LIKE 'nick_memory_%' AND JSON_UNQUOTE(JSON_EXTRACT(value, '$.source')) = 'self_healing' AND JSON_UNQUOTE(JSON_EXTRACT(value, '$.content')) LIKE 'System health:%'";

const [[totals]] = await c.query(
  `SELECT COUNT(*) AS n, MIN(JSON_UNQUOTE(JSON_EXTRACT(value, '$.createdAt'))) AS oldest, MAX(JSON_UNQUOTE(JSON_EXTRACT(value, '$.createdAt'))) AS newest FROM shop_settings WHERE ${WHERE}`,
);
const [[store]] = await c.query("SELECT COUNT(*) AS n FROM shop_settings WHERE `key` LIKE 'nick_memory_%'");
console.log(`store: ${store.n} nick_memory rows · matched health rows: ${totals.n} (createdAt ${totals.oldest} .. ${totals.newest})`);

const [spread] = await c.query(
  `SELECT JSON_UNQUOTE(JSON_EXTRACT(value, '$.confidence')) AS confidence, COUNT(*) AS n FROM shop_settings WHERE ${WHERE} GROUP BY confidence ORDER BY confidence`,
);
console.log("confidence spread: " + spread.map((r) => `${r.confidence}×${r.n}`).join(" · "));

const [prefixes] = await c.query(
  `SELECT SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(value, '$.content')), ':', 2) AS prefix, COUNT(*) AS n FROM shop_settings WHERE ${WHERE} GROUP BY prefix ORDER BY n DESC LIMIT 12`,
);
console.log("by kind: " + prefixes.map((r) => `${r.prefix.trim()} ×${r.n}`).join(" · "));

const [sample] = await c.query(
  `SELECT id, LEFT(JSON_UNQUOTE(JSON_EXTRACT(value, '$.content')), 90) AS content, JSON_UNQUOTE(JSON_EXTRACT(value, '$.createdAt')) AS createdAt, JSON_UNQUOTE(JSON_EXTRACT(value, '$.uses')) AS uses FROM shop_settings WHERE ${WHERE} ORDER BY id DESC LIMIT 10`,
);
for (const r of sample) console.log(`  #${r.id} ${r.createdAt} uses=${r.uses} · ${r.content}`);

if (!EXECUTE) {
  console.log(`DRY RUN — nothing written. ${totals.n} rows would be backed up and deleted with --execute.`);
  await c.end();
  process.exit(0);
}

if (Number(totals.n) === 0) {
  console.log("nothing to prune");
  await c.end();
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const bak = `_bak_shop_settings_health_prune_${stamp}`;
await c.query(`CREATE TABLE IF NOT EXISTS \`${bak}\` LIKE shop_settings`);
const [ids] = await c.query(`SELECT id FROM shop_settings WHERE ${WHERE}`);
const idList = ids.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);
if (idList.length !== Number(totals.n)) {
  console.error(`id list (${idList.length}) does not match the count (${totals.n}) — aborting before any write`);
  await c.end();
  process.exit(1);
}
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
