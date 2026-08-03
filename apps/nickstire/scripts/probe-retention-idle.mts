const { db } = await import("../server/lib/db-helper");
const d = await db(); if (!d) { console.log("db unavailable"); process.exit(1); }
const { sql } = await import("drizzle-orm");
const r: any = await d.execute(sql`
  SELECT job_name,
         MAX(started_at) AS last_run,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_30d,
         COUNT(*) AS runs_30d,
         SUM(COALESCE(records_processed,0)) AS records_30d
  FROM cron_log
  WHERE started_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
  GROUP BY job_name
  HAVING records_30d = 0
  ORDER BY runs_30d DESC
  LIMIT 25
`);
console.log("\n=== crons that ran but processed ZERO records in 30d ===");
console.table((Array.isArray(r) ? r[0] : r?.rows ?? r));
process.exit(0);
