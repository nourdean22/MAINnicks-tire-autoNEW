/**
 * probe-reel-failure-span.mjs · READ-ONLY (2026-07-31)
 *
 * Clarity-gate follow-up. The diagnosis claimed "every reel job since Jul 28
 * fails on Higgsfield Session expired" — but that rested on the newest 8 rows
 * and a 4-day window, not on all 68 failed rows. This scopes it exactly:
 * how many failures carry that error, and what the true first/last are.
 *
 * Also answers: was ANY reel job created today (the operator says they clicked
 * "generate" — if no row exists for today, enqueue itself is the problem and
 * the diagnosis is incomplete).
 *
 * SAFETY: SELECT statements only.
 */
import mysql from "mysql2/promise";

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const q = async (sql) => (await conn.execute(sql))[0];

console.log("\n=== A · failures carrying 'Session expired' (all time) ===");
for (const r of await q(
  `SELECT COUNT(*) AS n, MIN(createdAt) AS first_seen, MAX(createdAt) AS last_seen
     FROM reel_jobs
    WHERE status='failed' AND error LIKE '%Session expired%'`,
)) {
  console.log(`  n=${r.n}  first=${r.first_seen}  last=${r.last_seen}`);
}

console.log("\n=== B · all 'failed' jobs bucketed by error signature ===");
for (const r of await q(
  `SELECT CASE
            WHEN error LIKE '%Session expired%'      THEN 'higgsfield: session expired'
            WHEN error LIKE '%discarded by operator%' THEN 'operator: discarded'
            WHEN error LIKE '%superseded%'            THEN 'operator: superseded'
            WHEN error IS NULL OR error=''            THEN '(no error text)'
            ELSE 'other'
          END AS signature,
          COUNT(*) AS n, MAX(createdAt) AS newest
     FROM reel_jobs WHERE status='failed'
    GROUP BY signature ORDER BY n DESC`,
)) {
  console.log(`  ${String(r.signature).padEnd(30)} ${String(r.n).padStart(4)}   newest ${r.newest}`);
}

console.log("\n=== C · any reel job created TODAY? (enqueue still works?) ===");
const today = await q(
  `SELECT id, status, source, createdAt FROM reel_jobs
    WHERE createdAt >= CURDATE() ORDER BY id DESC`,
);
console.log(today.length ? `  ${today.length} row(s) today` : "  NONE created today");
for (const r of today) console.log(`   #${r.id} ${r.status} src=${r.source} ${r.createdAt}`);

console.log("\n=== D · newest admin-sourced job (the operator's own clicks) ===");
for (const r of await q(
  `SELECT id, status, createdAt, LEFT(COALESCE(error,''),60) AS err
     FROM reel_jobs WHERE source='admin' ORDER BY id DESC LIMIT 5`,
)) {
  console.log(`  #${r.id} ${String(r.status).padEnd(10)} ${r.createdAt}  ${r.err}`);
}

console.log("\n=== E · does anything alert on FAILED reel jobs? (alert rows) ===");
for (const r of await q(
  `SELECT job_name, status, COUNT(*) AS n, MAX(started_at) AS newest
     FROM cron_log
    WHERE (job_name LIKE '%watch%' OR job_name LIKE '%alert%' OR job_name LIKE '%health%')
      AND started_at >= NOW() - INTERVAL 7 DAY
    GROUP BY job_name, status ORDER BY job_name`,
)) {
  console.log(`  ${String(r.job_name).padEnd(28)} ${String(r.status).padEnd(10)} ${String(r.n).padStart(4)}  newest ${r.newest}`);
}

await conn.end();
console.log("\ndone · read-only\n");
