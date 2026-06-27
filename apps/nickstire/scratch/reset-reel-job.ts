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
    console.log("Resetting job 180001 status back to 'assets_ready'...");
    const [result] = await conn.execute(
      "UPDATE reel_jobs SET status = 'assets_ready', attempts = 0, error = NULL WHERE id = 180001"
    );
    console.log("Result:", result);

  } finally {
    await conn.end();
  }
}

main().catch(console.error);
