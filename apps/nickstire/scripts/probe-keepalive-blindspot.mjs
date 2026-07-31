/**
 * probe-keepalive-blindspot.mjs · READ-ONLY (2026-07-31)
 *
 * Quantifies why reel production died for days with no alert.
 *
 * higgsfield-session-keepalive RETURNS a failure message but does not THROW,
 * so cronHandler records status='completed'. cron/observer.ts:109 counts a run
 * as failing only when `r.status === "failed"` — so every keepalive failure
 * was invisible to the alerting that exists precisely to catch this.
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

console.log("\n=== keepalive: how long was it failing, and under what status? ===");
for (const r of await q(
  `SELECT status,
          CASE WHEN details LIKE '%FAILED%' THEN 'FAILED (in details)'
               WHEN details LIKE '%refreshed%' THEN 'refreshed OK'
               ELSE COALESCE(LEFT(details,30),'(none)') END AS outcome,
          COUNT(*) AS runs,
          DATE_FORMAT(CONVERT_TZ(MIN(started_at),'+00:00','-04:00'),'%m-%d %H:%i') AS first_et,
          DATE_FORMAT(CONVERT_TZ(MAX(started_at),'+00:00','-04:00'),'%m-%d %H:%i') AS last_et
     FROM cron_log WHERE job_name='higgsfield-session-keepalive'
    GROUP BY status, outcome ORDER BY runs DESC`,
)) {
  console.log(`  status=${String(r.status).padEnd(10)} ${String(r.outcome).padEnd(22)} runs=${String(r.runs).padStart(4)}  ${r.first_et} → ${r.last_et}`);
}

console.log("\n=== the blind spot: rows the observer counts as failures ===");
for (const r of await q(
  `SELECT COUNT(*) AS n FROM cron_log
    WHERE job_name='higgsfield-session-keepalive' AND status='failed'`,
)) {
  console.log(`  cron_log rows with status='failed': ${r.n}   ← observer.ts:109 only counts these`);
}
for (const r of await q(
  `SELECT COUNT(*) AS n FROM cron_log
    WHERE job_name='higgsfield-session-keepalive' AND details LIKE '%FAILED%'`,
)) {
  console.log(`  rows actually reporting FAILURE:     ${r.n}   ← invisible to the alerting`);
}

await conn.end();
console.log("");
