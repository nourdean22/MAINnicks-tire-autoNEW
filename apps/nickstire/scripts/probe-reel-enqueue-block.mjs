/**
 * probe-reel-enqueue-block.mjs · READ-ONLY (2026-07-31)
 *
 * Follow-up to probe-reel-pipeline-state: the cron is healthy (794 completed
 * runs / 14d) and every recent job died on "Higgsfield · Session expired".
 * Open question: the operator reports "enqueued" today, but the newest
 * reel_jobs row is from Jul 30 — so is a live content-governor reservation
 * blocking new enqueues (the documented job-660001 incident, where an
 * orphaned reservation blocked every enqueue for its 24h RESERVATION_SPACING
 * window)?
 *
 * SAFETY: SELECT statements only. No mutations.
 */
import mysql from "mysql2/promise";

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const q = async (sql) => (await conn.execute(sql))[0];
const colsOf = async (t) =>
  (await q(
    `SELECT COLUMN_NAME AS c FROM information_schema.columns
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}'`,
  )).map((r) => r.c);

console.log("\n=== reel_jobs created in the last 4 days ===");
const recent = await q(
  `SELECT id, status, source, createdAt, LEFT(COALESCE(error,''),70) AS err
     FROM reel_jobs WHERE createdAt >= NOW() - INTERVAL 4 DAY ORDER BY id DESC`,
);
if (!recent.length) console.log("  (NONE — no reel job row created in 4 days)");
for (const r of recent) {
  console.log(`  #${r.id} ${String(r.status).padEnd(12)} src=${String(r.source ?? "-").padEnd(8)} ${r.createdAt}  ${r.err || ""}`);
}

for (const t of ["content_reservations", "generation_reservations"]) {
  const cols = await colsOf(t);
  if (!cols.length) { console.log(`\n=== ${t} · TABLE ABSENT ===`); continue; }
  console.log(`\n=== ${t} · columns ===\n  ${cols.join(", ")}`);
  const created = ["createdAt", "created_at", "reservedAt", "reserved_at"].find((c) => cols.includes(c));
  const rows = await q(
    `SELECT * FROM \`${t}\`${created ? ` ORDER BY \`${created}\` DESC` : ""} LIMIT 8`,
  );
  console.log(`  newest ${rows.length} row(s):`);
  for (const r of rows) {
    const brief = Object.fromEntries(
      Object.entries(r).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v).slice(0, 40)]),
    );
    console.log("   ", JSON.stringify(brief));
  }
}

await conn.end();
console.log("\ndone · read-only\n");
