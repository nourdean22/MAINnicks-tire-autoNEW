/**
 * backfill-experiment-media (2026-08-06) — attach historical publish evidence
 * to experiment assignments made BEFORE the #1384 publish-attach existed.
 *
 * The live hook-style-2026-08 experiment (seeded 08-01) has assignments whose
 * media_id/published_at are NULL because nothing attached at publish time
 * until 2026-08-06. The evidence exists: assignments carry reel_job_id and
 * reel_jobs carries igPostId. published_at uses reel_jobs.updatedAt WHERE
 * status='posted' — posted is a terminal status, so the last update IS the
 * posting transition; the evaluator's horizons are 24/72/168h buckets, so
 * hour-level error is immaterial. The attach is guarded media_id IS NULL —
 * re-running is a no-op, and rows attached going forward are never touched.
 *
 * DRY RUN by default. --apply to execute. Read the rows before trusting them.
 */
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const url = (readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")) ?? "")
  .slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
const c = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

const [eligible] = await c.execute(`
  SELECT a.id, a.experiment_id, a.episode_key, r.igPostId, r.status, r.updatedAt
  FROM content_experiment_assignments a
  JOIN reel_jobs r ON r.id = a.reel_job_id
  WHERE a.media_id IS NULL AND r.igPostId IS NOT NULL AND r.status = 'posted'
`);
console.log(`eligible assignments (media NULL, job posted with igPostId): ${eligible.length}`);
for (const r of eligible) console.log(`  ${r.episode_key} → media ${r.igPostId} · posted≈${r.updatedAt?.toISOString?.()}`);

if (!APPLY) {
  console.log("\nDRY RUN — re-run with --apply to attach.");
} else {
  const [res] = await c.execute(`
    UPDATE content_experiment_assignments a
    JOIN reel_jobs r ON r.id = a.reel_job_id
    SET a.media_id = r.igPostId, a.published_at = r.updatedAt
    WHERE a.media_id IS NULL AND r.igPostId IS NOT NULL AND r.status = 'posted'
  `);
  console.log(`\nattached: ${res.affectedRows} row(s)`);
  const [check] = await c.execute(
    `SELECT COUNT(*) n FROM content_experiment_assignments WHERE media_id IS NOT NULL`,
  );
  console.log(`verification read-back: assignments with media attached = ${check[0].n}`);
}
await c.end();
