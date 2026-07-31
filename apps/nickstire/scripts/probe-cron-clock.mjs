/**
 * probe-cron-clock.mjs · READ-ONLY (2026-07-31)
 *
 * The reel probes print timestamps labelled "Eastern Daylight Time" that are
 * AHEAD of the local wall clock — impossible if they were truly Eastern. This
 * pins down what the stored values actually are, so "the daily reel cron runs
 * ~17:00-18:30" (an earlier claim of mine) can be stated in real local time
 * instead of a mislabelled one.
 *
 * SAFETY: SELECT only.
 */
import mysql from "mysql2/promise";

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const q = async (sql) => (await conn.execute(sql))[0];

const localNow = new Date();
const [t] = await q(
  `SELECT NOW() AS db_now, UTC_TIMESTAMP() AS db_utc, @@session.time_zone AS tz, @@global.time_zone AS gtz`,
);
console.log("\n=== clocks ===");
console.log(`  local wall clock : ${localNow.toString()}`);
console.log(`  local UTC        : ${localNow.toISOString()}`);
console.log(`  DB NOW()         : ${t.db_now}`);
console.log(`  DB UTC_TIMESTAMP : ${t.db_utc}`);
console.log(`  session tz=${t.tz}  global tz=${t.gtz}`);

const drift = (new Date(t.db_now).getTime() - localNow.getTime()) / 3600000;
console.log(`  DB NOW() minus local: ${drift.toFixed(2)} h  ← ~0 means stored values are UTC read as local`);

console.log("\n=== when does reel generation actually fire? (raw vs corrected) ===");
for (const r of await q(
  `SELECT id, createdAt,
          DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i') AS raw_stored,
          DATE_FORMAT(CONVERT_TZ(createdAt, '+00:00', '-04:00'), '%Y-%m-%d %H:%i') AS as_eastern
     FROM reel_jobs WHERE source='cron' ORDER BY id DESC LIMIT 6`,
)) {
  console.log(`  #${r.id}  stored=${r.raw_stored}  → Eastern=${r.as_eastern ?? "(CONVERT_TZ unavailable)"}`);
}

console.log("\n=== reel-pipeline pulse cadence (last 5, stored + Eastern) ===");
for (const r of await q(
  // NB: `stored` is a RESERVED WORD in TiDB — alias must be quoted or renamed.
  `SELECT DATE_FORMAT(started_at,'%H:%i:%s') AS t_utc,
          DATE_FORMAT(CONVERT_TZ(started_at,'+00:00','-04:00'),'%H:%i:%s') AS eastern, status
     FROM cron_log WHERE job_name='reel-pipeline' ORDER BY started_at DESC LIMIT 5`,
)) {
  console.log(`  UTC ${r.t_utc}  → Eastern ${r.eastern ?? "?"}  ${r.status}`);
}

await conn.end();
console.log("");
