/**
 * One-shot recovery · clear AttemptedAt claims for rows that failed to
 * actually send. Only resets rows where AttemptedAt is recent (within
 * the failure window) AND the sent flag is still 0 — so we never
 * un-stamp a row that genuinely went out.
 */
import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  // Before
  const [before] = await conn.query(`
    SELECT
      SUM(CASE WHEN follow_up_7d_attempted_at IS NOT NULL AND follow_up_7d_sent = 0 THEN 1 ELSE 0 END) AS stale_7d,
      SUM(CASE WHEN follow_up_30d_attempted_at IS NOT NULL AND follow_up_30d_sent = 0 THEN 1 ELSE 0 END) AS stale_30d
    FROM alg_estimates
    WHERE follow_up_7d_attempted_at > NOW() - INTERVAL 30 MINUTE
       OR follow_up_30d_attempted_at > NOW() - INTERVAL 30 MINUTE
  `);
  console.log("Before reset:");
  console.log(JSON.stringify((before as Array<Record<string, unknown>>)[0], null, 2));

  // Reset 7d claims
  const [r7d] = await conn.query(`
    UPDATE alg_estimates
    SET follow_up_7d_attempted_at = NULL
    WHERE follow_up_7d_attempted_at > NOW() - INTERVAL 30 MINUTE
      AND follow_up_7d_sent = 0
  `);
  // Reset 30d claims
  const [r30d] = await conn.query(`
    UPDATE alg_estimates
    SET follow_up_30d_attempted_at = NULL
    WHERE follow_up_30d_attempted_at > NOW() - INTERVAL 30 MINUTE
      AND follow_up_30d_sent = 0
  `);

  const cleared7d = (r7d as { affectedRows?: number }).affectedRows ?? 0;
  const cleared30d = (r30d as { affectedRows?: number }).affectedRows ?? 0;
  console.log(`\nReset: 7d cleared=${cleared7d} · 30d cleared=${cleared30d}`);

  // After
  const [after] = await conn.query(`
    SELECT
      SUM(CASE WHEN follow_up_7d_attempted_at IS NOT NULL AND follow_up_7d_sent = 0 THEN 1 ELSE 0 END) AS stale_7d,
      SUM(CASE WHEN follow_up_30d_attempted_at IS NOT NULL AND follow_up_30d_sent = 0 THEN 1 ELSE 0 END) AS stale_30d
    FROM alg_estimates
    WHERE follow_up_7d_attempted_at > NOW() - INTERVAL 30 MINUTE
       OR follow_up_30d_attempted_at > NOW() - INTERVAL 30 MINUTE
  `);
  console.log("\nAfter reset:");
  console.log(JSON.stringify((after as Array<Record<string, unknown>>)[0], null, 2));
} finally {
  await conn.end();
}
