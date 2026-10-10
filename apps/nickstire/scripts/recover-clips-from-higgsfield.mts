/**
 * recover-clips-from-higgsfield.mts <jobId> <hfJobId1> <hfJobId2> ... [--execute]
 *
 * A reel job whose saved "clips" are not videos (2026-10-10, job 2070005: the
 * result parser took the uploaded start image instead of result_url) gets its
 * clipUrlsJson rebuilt from the Higgsfield generations that already completed
 * and were already paid for. One Higgsfield job id per beat, in beat order.
 * Each result_url is read through the app's allowlisted read-only CLI helper
 * (credential rotation persisted), must end in .mp4 and answer an HTTP HEAD,
 * then the job returns to assets_ready with attempts reset so assembly runs
 * on the next pipeline tick. Nothing is generated or paid for.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/recover-clips-from-higgsfield.mts 2070005 <id1> <id2> <id3> <id4> <id5> --execute
 */
const args = process.argv.slice(2).filter((a) => a !== "--execute");
const EXECUTE = process.argv.includes("--execute");
const jobId = Number(args[0]);
const hfIds = args.slice(1);
if (!Number.isInteger(jobId) || hfIds.length === 0) { console.error("usage: recover-clips-from-higgsfield.mts <jobId> <hfJobId...> [--execute]"); process.exit(2); }
const { runHiggsfieldCliReadOnly, parseResultUrl } = await import("../server/services/higgsfieldStudio");
const urls: string[] = [];
for (const [i, id] of hfIds.entries()) {
  const r = await runHiggsfieldCliReadOnly(["generate", "get", id, "--json"], 60_000);
  if (!r.ok) { console.error(`beat ${i + 1}: generate get ${id} failed: ${r.stderr.slice(0, 200)}`); process.exit(1); }
  const j = JSON.parse(r.stdout);
  if (j.status !== "completed") { console.error(`beat ${i + 1}: job ${id} is ${j.status}, not completed`); process.exit(1); }
  const url = parseResultUrl(r.stdout, "video");
  if (!/\.mp4([?#]|$)/i.test(url)) { console.error(`beat ${i + 1}: result is not an mp4: ${url}`); process.exit(1); }
  const head = await fetch(url, { method: "HEAD" });
  if (!head.ok) { console.error(`beat ${i + 1}: ${url} answered HTTP ${head.status}`); process.exit(1); }
  console.log(`beat ${i + 1}: ${url} (${head.headers.get("content-type")}, ${head.headers.get("content-length")} bytes)`);
  urls.push(url);
}
const { getDbTyped } = await import("../server/db");
const d = await getDbTyped(); if (!d) { console.error("database unavailable"); process.exit(1); }
const { reelJobs } = await import("../drizzle/schema");
const { and, eq } = await import("drizzle-orm");
const { queueStateForReelStatus } = await import("../shared/reelQueue");
const [job] = await d.select({ status: reelJobs.status, attempts: reelJobs.attempts, payload: reelJobs.payload, clips: reelJobs.clipUrlsJson }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
if (!job) { console.error(`job ${jobId} not found`); process.exit(1); }
const beats = (JSON.parse(job.payload ?? "{}").storyboardBeats ?? []).length;
console.log(`job ${jobId}: status=${job.status} attempts=${job.attempts} beats=${beats} saved clips before: ${JSON.parse(job.clips ?? "[]").length}`);
if (beats !== urls.length) { console.error(`brief has ${beats} beats but ${urls.length} clip urls were recovered — refusing`); process.exit(1); }
if (!["failed", "assets_ready", "needs_regen"].includes(String(job.status))) { console.error(`job is ${job.status} — only failed / assets_ready / needs_regen jobs are recovered`); process.exit(1); }
if (!EXECUTE) { console.log("DRY RUN — no write. Pass --execute to replace the clip list and return the job to assets_ready."); process.exit(0); }
const r = await d.update(reelJobs).set({
  clipUrlsJson: JSON.stringify(urls), status: "assets_ready", queueState: queueStateForReelStatus("assets_ready"), attempts: 0, updatedAt: new Date(),
  error: `clips recovered from Higgsfield result_url by operator ${new Date().toISOString()} (parser had saved the start image); assembly re-queued`,
}).where(and(eq(reelJobs.id, jobId), eq(reelJobs.status, job.status)));
const affected = Number((r as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0);
console.log(affected === 1 ? `job ${jobId} -> assets_ready with ${urls.length} video clips (assembly runs on the next pipeline tick)` : "row changed underneath — nothing written");
process.exit(affected === 1 ? 0 : 1);
