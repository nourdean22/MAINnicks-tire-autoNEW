/**
 * requeue-needs-regen.mts <jobId> [--execute] — put ONE needs_regen job back in
 * the generation queue WITH its saved clips, so only the missing beats render.
 * Operator-authorised per job (2026-10-10, job 2070005: beat 5 hit the 6-minute
 * clip timeout twice on Seedance 2.5 after a deploy restart killed the first
 * attempt; the timeout is now 13 minutes). regenerateReelFromBrief is the wrong
 * door for this: it makes a fresh paid job and re-renders every beat.
 *
 * Compare-and-set on status = needs_regen; attempts are kept (MAX_ATTEMPTS
 * still applies), the error column records the requeue. Dry run by default.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/requeue-needs-regen.mts 2070005 --execute
 */
const args = process.argv.slice(2);
const jobId = Number(args.find((a) => /^\d+$/.test(a)));
const EXECUTE = args.includes("--execute");
if (!Number.isInteger(jobId)) { console.error("usage: requeue-needs-regen.mts <jobId> [--execute]"); process.exit(2); }
const { getDbTyped } = await import("../server/db");
const d = await getDbTyped(); if (!d) { console.error("database unavailable"); process.exit(1); }
const { reelJobs } = await import("../drizzle/schema");
const { and, eq } = await import("drizzle-orm");
const { queueStateForReelStatus } = await import("../shared/reelQueue");
const [job] = await d.select({ status: reelJobs.status, attempts: reelJobs.attempts, error: reelJobs.error, clips: reelJobs.clipUrlsJson }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
if (!job) { console.error(`job ${jobId} not found`); process.exit(1); }
const clips: string[] = JSON.parse(job.clips ?? "[]");
console.log(`job ${jobId}: status=${job.status} attempts=${job.attempts} clips saved=${clips.filter(Boolean).length}/${clips.length}`);
console.log(`error: ${(job.error ?? "").slice(0, 200)}`);
if (job.status !== "needs_regen") { console.log("not needs_regen — nothing to do"); process.exit(0); }
if (!EXECUTE) { console.log("DRY RUN — no write. Pass --execute to requeue (only the missing beats render)."); process.exit(0); }
const note = `requeued by operator ${new Date().toISOString()} (clips kept) after: ${(job.error ?? "").slice(0, 300)}`;
const r = await d.update(reelJobs).set({ status: "queued", queueState: queueStateForReelStatus("queued"), error: note, updatedAt: new Date() }).where(and(eq(reelJobs.id, jobId), eq(reelJobs.status, "needs_regen")));
const affected = Number((r as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0);
console.log(affected === 1 ? `job ${jobId} -> queued (clips kept; the reel-pipeline cron resumes it within 15 min)` : "row changed underneath — nothing written");
process.exit(affected === 1 ? 0 : 1);
