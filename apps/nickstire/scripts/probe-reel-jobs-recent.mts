/**
 * probe-reel-jobs-recent.mts · READ-ONLY (2026-08-03)
 *
 * Recent reel_jobs with status + error, to answer "was the pipeline actually
 * producing, or just burning attempts?" Pure SELECT. No writes, no spend.
 *
 *   railway run --service MAINnicks-tire-auto -- pnpm exec tsx scripts/probe-reel-jobs-recent.mts
 */
const { db } = await import("../server/lib/db-helper");
const d = await db();
if (!d) {
  console.log("database unavailable");
  process.exit(1);
}

const { reelJobs } = await import("../drizzle/schema");
const { desc } = await import("drizzle-orm");

const rows = await d
  .select({
    id: reelJobs.id,
    status: reelJobs.status,
    attempts: reelJobs.attempts,
    error: reelJobs.error,
    createdAt: reelJobs.createdAt,
  })
  .from(reelJobs)
  .orderBy(desc(reelJobs.id))
  .limit(15);

console.log(`\n── reel_jobs · last ${rows.length} ──`);
for (const r of rows) {
  const when = r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt);
  console.log(
    `#${String(r.id).padEnd(9)} ${String(r.status).padEnd(13)} attempts=${r.attempts ?? 0}  ${when}  ${(r.error ?? "").slice(0, 70)}`,
  );
}
console.log("");

process.exit(0);
