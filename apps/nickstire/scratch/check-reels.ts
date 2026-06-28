import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not configured.");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    console.log("=== Reel Settings (Shop Settings) ===");
    const [settings] = await conn.execute(
      "SELECT `key`, `value` FROM `shop_settings` WHERE `key` LIKE 'reel_%'"
    );
    for (const s of settings as any[]) {
      console.log(`  ${s.key}: "${s.value}"`);
    }

    console.log("\n=== Reel Jobs (Status Summary) ===");
    const [jobsSummary] = await conn.execute(
      "SELECT status, COUNT(*) as count FROM reel_jobs GROUP BY status"
    );
    for (const j of jobsSummary as any[]) {
      console.log(`  Status: ${j.status} | Count: ${j.count}`);
    }

    console.log("\n=== Recent Reel Jobs (Last 5) ===");
    const [recentJobs] = await conn.execute(
      "SELECT id, status, briefId, igPostId, mp4Url, attempts, error, createdAt FROM reel_jobs ORDER BY createdAt DESC LIMIT 5"
    );
    for (const j of recentJobs as any[]) {
      console.log(`  ID: ${j.id} | Status: ${j.status} | BriefId: ${j.briefId} | igPostId: ${j.igPostId || 'None'} | mp4Url: ${j.mp4Url || 'None'} | Attempts: ${j.attempts} | Error: ${j.error || 'None'} | Created: ${j.createdAt.toISOString()}`);
    }

  } finally {
    await conn.end();
  }
}

main().catch(console.error);
