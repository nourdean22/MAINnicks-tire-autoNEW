/**
 * probe-reel-publishable.mjs · READ-ONLY (2026-07-31)
 *
 * "Get them all posted" — this establishes what "them" actually IS before
 * anything touches the live Instagram account.
 *
 * Non-terminal reel jobs are only two rows: one `assembled` (a finished MP4
 * that never published) and one `publish_ambiguous` (publish outcome UNKNOWN —
 * it may ALREADY be live, so re-publishing risks a duplicate post on a real
 * business account). Everything else is terminal: 68 failed, 14 posted/
 * published.
 *
 * SAFETY: SELECT statements only.
 */
import mysql from "mysql2/promise";

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const q = async (sql) => (await conn.execute(sql))[0];

console.log("\n=== Non-terminal jobs — the only candidates for 'posting' ===");
for (const r of await q(
  `SELECT id, status, source, createdAt, attempts,
          CASE WHEN mp4Url IS NULL OR mp4Url='' THEN 'NO' ELSE 'yes' END AS has_mp4,
          COALESCE(igPostId,'-') AS ig_post_id,
          LEFT(COALESCE(caption,''), 70) AS caption
     FROM reel_jobs
    WHERE status NOT IN ('failed','posted','published')
    ORDER BY id DESC`,
)) {
  console.log(`\n  #${r.id} · ${r.status} · src=${r.source} · ${r.createdAt}`);
  console.log(`    mp4=${r.has_mp4}  attempts=${r.attempts}  igPostId=${r.ig_post_id}`);
  console.log(`    caption: ${r.caption || "(none)"}`);
}

console.log("\n=== Was the ambiguous one already published? (igPostId presence) ===");
for (const r of await q(
  `SELECT status, COUNT(*) AS n,
          SUM(CASE WHEN igPostId IS NOT NULL AND igPostId <> '' THEN 1 ELSE 0 END) AS with_ig_id
     FROM reel_jobs GROUP BY status ORDER BY n DESC`,
)) {
  console.log(`  ${String(r.status).padEnd(20)} n=${String(r.n).padStart(3)}  with igPostId: ${r.with_ig_id}`);
}

console.log("\n=== Publish cadence — what actually went live, last 30d ===");
for (const r of await q(
  `SELECT DATE(updatedAt) AS day, status, COUNT(*) AS n
     FROM reel_jobs
    WHERE status IN ('posted','published') AND updatedAt >= NOW() - INTERVAL 30 DAY
    GROUP BY day, status ORDER BY day DESC LIMIT 12`,
)) {
  console.log(`  ${r.day}  ${String(r.status).padEnd(10)} ${r.n}`);
}

await conn.end();
console.log("\ndone · read-only\n");
