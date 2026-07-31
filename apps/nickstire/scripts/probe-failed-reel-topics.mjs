/**
 * probe-failed-reel-topics.mjs · READ-ONLY (2026-07-31)
 *
 * Picks regeneration candidates out of the 68 failed reel jobs.
 *
 * Best candidates are the ones that died ONLY at the Higgsfield step: they
 * already cleared the M10 preflight, the spend boundary and the content
 * governor, so their briefs are proven-good — the render is the only thing
 * that failed. Operator-discarded and superseded jobs are excluded by
 * definition (the operator already rejected those).
 *
 * Also dedupes by topic: the recent session-expired failures are mostly the
 * SAME nail-in-tire subject, so regenerating all of them would publish
 * near-duplicates.
 *
 * SAFETY: SELECT statements only.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const q = async (sql) => (await conn.execute(sql))[0];

console.log("\n=== A · render-only failures (brief already passed every gate) ===");
for (const r of await q(
  `SELECT id, briefId, DATE_FORMAT(CONVERT_TZ(createdAt,'+00:00','-04:00'),'%Y-%m-%d %H:%i') AS et,
          source, attempts, LEFT(COALESCE(caption,''),95) AS cap
     FROM reel_jobs
    WHERE status='failed' AND error LIKE '%Session expired%'
    ORDER BY id DESC`,
)) {
  console.log(`  #${r.id} brief=${r.briefId} ${r.et} ET src=${r.source} attempts=${r.attempts}`);
  console.log(`     ${r.cap || "(no caption)"}`);
}

console.log("\n=== B · reserved topics for those jobs (governor view) ===");
for (const r of await q(
  `SELECT LEFT(topic,80) AS topic, cta, status,
          DATE_FORMAT(CONVERT_TZ(created_at,'+00:00','-04:00'),'%Y-%m-%d %H:%i') AS et
     FROM content_reservations
    WHERE format='reel' ORDER BY created_at DESC LIMIT 8`,
)) {
  console.log(`  ${r.et} ET  [${r.status}] cta=${r.cta}  ${r.topic}`);
}

console.log("\n=== C · what already went live recently (avoid repeating a subject) ===");
for (const r of await q(
  `SELECT DATE_FORMAT(CONVERT_TZ(updatedAt,'+00:00','-04:00'),'%m-%d') AS et,
          status, LEFT(COALESCE(caption,''),70) AS cap
     FROM reel_jobs WHERE status IN ('posted','published')
    ORDER BY updatedAt DESC LIMIT 8`,
)) {
  console.log(`  ${r.et} ${String(r.status).padEnd(10)} ${r.cap}`);
}

await conn.end();
console.log("");
