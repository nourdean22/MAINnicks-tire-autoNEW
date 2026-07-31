/**
 * probe-higgsfield-keepalive.mjs · READ-ONLY (2026-07-31)
 *
 * The `higgsfield-session-keepalive` cron (scheduler.ts:461) spawns
 * `hf account status`, which forces the CLI to refresh+rotate the token and
 * writes the rotated pair back to app_secret_kv. Its cron_log `details` is the
 * cheapest authoritative answer to "does PROD have working credentials?":
 *
 *   "session refreshed, N credits"      → creds VALID
 *   "keepalive FAILED — re-login required" → refresh token revoked
 *   "no higgsfield creds — skip"        → nothing configured
 *
 * Timestamps are UTC in this DB (see probe-cron-clock.mjs) — shown as Eastern.
 *
 * SAFETY: SELECT only.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const q = async (sql) => (await conn.execute(sql))[0];

console.log("\n=== higgsfield-session-keepalive · last 8 runs (Eastern) ===");
const rows = await q(
  `SELECT DATE_FORMAT(CONVERT_TZ(started_at,'+00:00','-04:00'),'%m-%d %H:%i:%s') AS et,
          status, records_processed AS rec, LEFT(COALESCE(details,''),80) AS details,
          LEFT(COALESCE(error_message,''),80) AS err
     FROM cron_log WHERE job_name = 'higgsfield-session-keepalive'
    ORDER BY started_at DESC LIMIT 8`,
);
if (!rows.length) console.log("  (no runs recorded)");
for (const r of rows) console.log(`  ${r.et} ${String(r.status).padEnd(10)} rec=${r.rec ?? "-"}  ${r.details || r.err || ""}`);

console.log("\n=== creds row freshness (rotation writes here) ===");
for (const r of await q(
  `SELECT LENGTH(v) AS len,
          DATE_FORMAT(CONVERT_TZ(updated_at,'+00:00','-04:00'),'%m-%d %H:%i:%s') AS et
     FROM app_secret_kv WHERE k='higgsfield_credentials_json'`,
)) {
  console.log(`  len=${r.len}  updated ${r.et} ET`);
}

console.log("\n=== newest reel jobs ===");
for (const r of await q(
  `SELECT id, status, DATE_FORMAT(CONVERT_TZ(createdAt,'+00:00','-04:00'),'%m-%d %H:%i') AS et,
          LEFT(COALESCE(error,''),60) AS err
     FROM reel_jobs ORDER BY id DESC LIMIT 4`,
)) {
  console.log(`  #${r.id} ${String(r.status).padEnd(10)} ${r.et} ET  ${r.err}`);
}

await conn.end();
console.log("");
