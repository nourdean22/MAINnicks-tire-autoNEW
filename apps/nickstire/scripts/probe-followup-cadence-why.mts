const { db } = await import("../server/lib/db-helper");
const d = await db(); if (!d) { console.log("db unavailable"); process.exit(1); }
const { sql } = await import("drizzle-orm");
const q = async (x: any) => { const r: any = await d.execute(x); return (Array.isArray(r) ? r[0] : r?.rows ?? r) as any[]; };

console.log("\n=== followup-cadence: WHICH guard is stopping it? ===");
console.table(await q(sql`
  SELECT details, COUNT(*) AS runs, MAX(started_at) AS latest
  FROM cron_log WHERE job_name='followup-cadence' AND started_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
  GROUP BY details ORDER BY runs DESC LIMIT 10
`));

console.log("=== siblings on the same VAPI outbound rail ===");
console.table(await q(sql`
  SELECT job_name, details, COUNT(*) AS runs
  FROM cron_log
  WHERE job_name IN ('confirmation-calls','voice-recovery','alg-declined-work-recovery')
    AND started_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
  GROUP BY job_name, details ORDER BY job_name, runs DESC LIMIT 12
`));
process.exit(0);
