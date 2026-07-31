/**
 * probe-reel-pipeline-state.mjs · READ-ONLY diagnostic (2026-07-31)
 *
 * Answers one question: why do admin-enqueued reels never render?
 *
 * The gen/assembly stages are gated by `REEL_GENERATION_ENABLED === "true"`
 * (reelPipeline.ts:312/537/673) while the SCHEDULER only checks the var is
 * truthy (scheduler.ts:198). That mismatch yields two symptom-identical
 * branches, told apart by cron_log:
 *
 *   A · var UNSET      -> scheduler writes status='skipped' rows
 *   B · var set wrong  -> cron runs clean, stages silently no-op, NO skip rows
 *
 * SAFETY: every statement here is a SELECT. No INSERT/UPDATE/DELETE/DDL.
 * Run: node --env-file=<prod .env> scripts/probe-reel-pipeline-state.mjs
 */
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const q = async (sql, params = []) => (await conn.execute(sql, params))[0];

// Column names differ between camelCase and snake_case tables here — read
// the real ones rather than guessing (a wrong guess already cost one run).
const cols = (
  await q(
    `SELECT COLUMN_NAME AS c FROM information_schema.columns
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reel_jobs'`,
  )
).map((r) => r.c);
const pick = (...cands) => cands.find((c) => cols.includes(c)) ?? null;
const CREATED = pick("createdAt", "created_at");
const ERRCOL = pick("error", "errorMessage", "error_message");
console.log("\n=== 0 · reel_jobs columns ===\n  " + cols.join(", "));

console.log("\n=== 1 · reel_jobs status distribution ===");
for (const r of await q(
  `SELECT status, COUNT(*) AS n${CREATED ? `, MAX(\`${CREATED}\`) AS newest` : ""}
     FROM reel_jobs GROUP BY status ORDER BY n DESC`,
)) {
  console.log(`  ${String(r.status).padEnd(20)} ${String(r.n).padStart(5)}   newest ${r.newest ?? "-"}`);
}

console.log("\n=== 2 · newest 8 reel_jobs ===");
for (const r of await q(
  `SELECT id, status${ERRCOL ? `, LEFT(COALESCE(\`${ERRCOL}\`,''), 90) AS err` : ", '' AS err"}${CREATED ? `, \`${CREATED}\` AS created` : ", NULL AS created"}
     FROM reel_jobs ORDER BY id DESC LIMIT 8`,
)) {
  console.log(`  #${String(r.id).padEnd(8)} ${String(r.status).padEnd(16)} ${r.created ?? "-"}  ${r.err || ""}`);
}

console.log("\n=== 3 · cron_log 'reel-pipeline' · last 14d by status  <<< THE DISCRIMINATOR ===");
const cron = await q(
  `SELECT status, COUNT(*) AS n, MAX(started_at) AS newest
     FROM cron_log
    WHERE job_name = 'reel-pipeline' AND started_at >= NOW() - INTERVAL 14 DAY
    GROUP BY status ORDER BY n DESC`,
);
if (!cron.length) console.log("  (no reel-pipeline rows in 14d — cron never fired at all)");
for (const r of cron) console.log(`  ${String(r.status).padEnd(12)} ${String(r.n).padStart(5)}   newest ${r.newest}`);

console.log("\n=== 4 · newest 6 reel-pipeline cron rows (details) ===");
for (const r of await q(
  `SELECT status, records_processed, LEFT(COALESCE(details,''), 80) AS details,
          LEFT(COALESCE(error_message,''), 70) AS err, started_at
     FROM cron_log WHERE job_name = 'reel-pipeline'
    ORDER BY started_at DESC LIMIT 6`,
)) {
  console.log(`  ${r.started_at} ${String(r.status).padEnd(10)} rec=${r.records_processed ?? "-"} ${r.details || ""} ${r.err || ""}`);
}

console.log("\n=== 5 · sibling reel crons (14d) ===");
for (const r of await q(
  `SELECT job_name, status, COUNT(*) AS n, MAX(started_at) AS newest
     FROM cron_log
    WHERE job_name LIKE '%reel%' AND started_at >= NOW() - INTERVAL 14 DAY
    GROUP BY job_name, status ORDER BY job_name, n DESC`,
)) {
  console.log(`  ${String(r.job_name).padEnd(24)} ${String(r.status).padEnd(10)} ${String(r.n).padStart(4)}  newest ${r.newest}`);
}

await conn.end();
console.log("\ndone · read-only\n");
