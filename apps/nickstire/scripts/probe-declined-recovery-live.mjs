/**
 * READ-ONLY · has declined-work recovery actually been SENDING?
 *
 * Prod shows FEATURE_DECLINED_RECOVERY=1 and the guard is `=== "1"`, i.e. sends
 * are enabled — contradicting docs/ISSUE-REGISTRY.md (ROS-093), which records
 * the operator setting it to 0 on 2026-08-08 "read-back verified". One of those
 * is wrong and the difference is customer SMS.
 *
 * Structurally read-only: q() refuses anything that is not SELECT/SHOW/DESCRIBE.
 */
import mysql from "mysql2/promise";
import fs from "fs";

const envText = fs.readFileSync(process.argv[2], "utf8");
const url = (envText.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
if (!url) throw new Error("no DATABASE_URL");
const base = url.replace(/\?ssl=.*$/, "");
console.log("host:", new URL(base).hostname);

const conn = await mysql.createConnection(`${base}?ssl={"rejectUnauthorized":true}`);
async function q(sql, p = []) {
  if (!/^\s*(select|show|describe)\b/i.test(sql)) throw new Error("REFUSED: " + sql.slice(0, 40));
  const [rows] = await conn.execute(sql, p);
  return rows;
}

console.log("\n=== cron runs, last 30d ===");
console.table(
  await q(`
    SELECT job_name, COUNT(*) runs,
           SUM(status='success') ok, SUM(status='skipped') skipped, SUM(status='error') err,
           MAX(started_at) last_run
    FROM cron_log
    WHERE job_name LIKE '%declined%' AND started_at >= NOW() - INTERVAL 30 DAY
    GROUP BY job_name
  `),
);

console.log("\n=== what those runs reported (most recent 8) ===");
console.table(
  await q(`
    SELECT started_at, status, LEFT(COALESCE(details,''), 160) AS details
    FROM cron_log
    WHERE job_name LIKE '%declined%'
    ORDER BY started_at DESC LIMIT 8
  `),
);

console.log("\n=== follow-up touches actually STAMPED on estimates ===");
console.table(
  await q(`
    SELECT
      SUM(follow_up_3d_attempted_at  IS NOT NULL) AS touched_3d,
      SUM(follow_up_7d_attempted_at IS NOT NULL) AS touched_7d,
      SUM(follow_up_3d_attempted_at  >= NOW() - INTERVAL 30 DAY) AS touched_3d_last30,
      SUM(follow_up_7d_attempted_at >= NOW() - INTERVAL 30 DAY) AS touched_7d_last30,
      MAX(GREATEST(COALESCE(follow_up_3d_attempted_at,'1970-01-01'),
                   COALESCE(follow_up_7d_attempted_at,'1970-01-01'))) AS most_recent_touch
    FROM alg_estimates
  `),
);

console.log("\n=== the eligible set the cron targets right now ===");
console.table(
  await q(`
    SELECT COUNT(*) AS eligible_unmatched_60d,
           SUM(estimate_date < NOW() - INTERVAL 30 DAY) AS in_the_31_60d_blind_band
    FROM alg_estimates
    WHERE matched_invoice_id IS NULL
      AND estimate_date >= NOW() - INTERVAL 60 DAY
  `),
);

await conn.end();
