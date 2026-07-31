/**
 * probe-higgsfield-creds-source.mjs · READ-ONLY (2026-07-31)
 *
 * Why did `hf auth login` not fix prod?
 *
 * getHiggsfieldCredentialsJson() (higgsfieldStudio.ts:19-39) resolves in this
 * order:
 *      1. app_secret_kv row  k = 'higgsfield_credentials_json'   ← WINS
 *      2. process.env.HIGGSFIELD_CREDENTIALS_JSON                ← fallback
 *
 * So a stale DB row SHADOWS the Railway env var completely: updating the env
 * var alone changes nothing. And per the comment at :106, the CLI ROTATES
 * tokens — a static pair dies ~90 min after login because the rotated
 * successor is consumed and discarded.
 *
 * This reports WHICH source prod is using and HOW OLD it is. It never prints
 * token material — only presence, length, and timestamps.
 *
 * SAFETY: SELECT statements only. No secret values echoed.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const q = async (sql) => (await conn.execute(sql))[0];

const cols = (await q(
  `SELECT COLUMN_NAME AS c FROM information_schema.columns
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_secret_kv'`,
)).map((r) => r.c);
console.log(`\napp_secret_kv columns: ${cols.join(", ")}`);

const tsCol = ["updatedAt", "updated_at", "createdAt", "created_at"].find((c) => cols.includes(c));

console.log("\n=== the row that OVERRIDES the Railway env var ===");
const rows = await q(
  `SELECT k, LENGTH(v) AS v_len${tsCol ? `, \`${tsCol}\` AS ts` : ""}
     FROM app_secret_kv WHERE k = 'higgsfield_credentials_json'`,
);
if (!rows.length) {
  console.log("  ROW ABSENT → prod falls back to the Railway env var HIGGSFIELD_CREDENTIALS_JSON");
} else {
  for (const r of rows) {
    console.log(`  row PRESENT · value length ${r.v_len} chars${r.ts ? ` · last written ${r.ts}` : ""}`);
    console.log("  → this SHADOWS HIGGSFIELD_CREDENTIALS_JSON; updating the env var alone does nothing");
  }
}

console.log("\n=== all secret-kv keys (names + ages only) ===");
for (const r of await q(
  `SELECT k, LENGTH(v) AS v_len${tsCol ? `, \`${tsCol}\` AS ts` : ""} FROM app_secret_kv ORDER BY k`,
)) {
  console.log(`  ${String(r.k).padEnd(34)} len=${String(r.v_len).padStart(5)}${r.ts ? `  ${r.ts}` : ""}`);
}

await conn.end();
console.log("");
