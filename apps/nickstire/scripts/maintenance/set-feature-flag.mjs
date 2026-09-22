/**
 * set-feature-flag · flip ONE feature_flags row, on operator instruction, with a dry run.
 *
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/set-feature-flag.mjs --key photo_assess_enabled --value 1
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/set-feature-flag.mjs --key photo_assess_enabled --value 1 --execute
 *
 * DRY RUN BY DEFAULT: prints the row as it is and returns before any write.
 * --execute updates the row (or inserts it if the definition exists in code but
 * the row does not — the silent-no-op trap setFlag() fixed on 2026-07-20) and
 * prints the row after. Reversible: re-run with the other value. The running
 * service re-reads flags within 60 s (CACHE_TTL_MS), no deploy needed.
 *
 * A flag flip is the operator's decision, every time: this script exists so
 * the flip is a dry-run-then-execute with a printed before/after, not a hand
 * UPDATE in a console.
 */
import mysql from "mysql2/promise";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const KEY = opt("key");
const VALUE = opt("value");
const EXECUTE = argv.includes("--execute");
if (!KEY || !/^[a-z0-9_]+$/.test(KEY) || !["0", "1"].includes(VALUE ?? "")) {
  console.error("usage: --key <flag_key> --value 0|1 [--execute]");
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing — run via: railway run -s MAINnicks-tire-auto -- node scripts/maintenance/set-feature-flag.mjs …");
  process.exit(1);
}
const c = await mysql.createConnection(url);
const [before] = await c.query("SELECT `key`, value, LEFT(COALESCE(description,''),100) AS description, updated_at FROM feature_flags WHERE `key` = ?", [KEY]);
console.log("before:", before.length ? JSON.stringify(before[0]) : `(no row for ${KEY})`);
if (!EXECUTE) {
  console.log(`DRY RUN — nothing written. Would set ${KEY} = ${VALUE}. Re-run with --execute.`);
  await c.end();
  process.exit(0);
}
let res;
if (before.length) {
  [res] = await c.query("UPDATE feature_flags SET value = ?, updated_at = NOW() WHERE `key` = ?", [Number(VALUE), KEY]);
} else {
  [res] = await c.query("INSERT INTO feature_flags (`key`, value, created_at, updated_at) VALUES (?, ?, NOW(), NOW())", [KEY, Number(VALUE)]);
}
const [after] = await c.query("SELECT `key`, value, updated_at FROM feature_flags WHERE `key` = ?", [KEY]);
console.log(`written (affectedRows ${res.affectedRows}) · after:`, JSON.stringify(after[0]));
await c.end();
