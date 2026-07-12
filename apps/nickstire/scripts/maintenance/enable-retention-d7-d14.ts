/**
 * wave-181.81 · operator-authorized · flip retention_7day +
 * retention_14day DB feature flags from value=0 to value=1.
 *
 * Authorization · operator directive "go ahead set them up u do it
 * all" 2026-05-19. The DB flag flip is reversible (re-run with
 * value=0 to disable). The retention SMS sends that result use the
 * same safety stack as every other revenue cron · audit-verified
 * across waves 181.58 → 181.80.
 *
 * Idempotent · re-running is a no-op if the flags are already 1.
 *
 * NOT IN SCOPE · the third gate `FEATURE_DECLINED_RECOVERY` is a
 * Railway env var · I cannot set Railway env from this environment.
 * Operator still needs to flip that one manually (Railway dashboard
 * → nickstire service → Variables → add → Deploy).
 *
 * Run: pnpm exec tsx scripts/enable-retention-d7-d14.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  console.log("\n═══ Wave-181.81 · Enable retention_7day + retention_14day ═══\n");

  // BEFORE state
  const [before] = await conn.query(`
    SELECT \`key\`, value, description, updated_at
    FROM feature_flags
    WHERE \`key\` IN ('retention_7day', 'retention_14day')
    ORDER BY \`key\`
  `);
  console.log("BEFORE:");
  console.log(JSON.stringify(before, null, 2));

  // Idempotency · skip if already 1
  const rows = before as Array<{ key: string; value: number }>;
  const alreadyOn = rows.every((r) => Number(r.value) === 1);
  if (alreadyOn) {
    console.log("\n  · both flags already at value=1 · no-op");
  } else {
    // FLIP
    const [result] = await conn.query(`
      UPDATE feature_flags
      SET value = 1, updated_at = NOW()
      WHERE \`key\` IN ('retention_7day', 'retention_14day')
        AND value = 0
    `);
    const updated = (result as { affectedRows?: number })?.affectedRows ?? 0;
    console.log(`\nUPDATED ${updated} flag(s).`);

    // AFTER state
    const [after] = await conn.query(`
      SELECT \`key\`, value, description, updated_at
      FROM feature_flags
      WHERE \`key\` IN ('retention_7day', 'retention_14day')
      ORDER BY \`key\`
    `);
    console.log("\nAFTER:");
    console.log(JSON.stringify(after, null, 2));

    // Sanity check · both should be 1
    const finalRows = after as Array<{ key: string; value: number }>;
    const allOn = finalRows.every((r) => Number(r.value) === 1);
    if (!allOn) {
      throw new Error("POST-CHECK FAILED: at least one flag is still off after UPDATE");
    }
    console.log("\n═══ DONE · D7 + D14 retention sends activated ═══");
    console.log("\nNext cron tick (retention-all · daily) will start firing D7 + D14 sends.");
    console.log("REMINDER: FEATURE_DECLINED_RECOVERY env var on Railway is the third gate. Operator-only.");
  }
} finally {
  await conn.end();
}
