/**
 * attach-audio-qa.mts <jobId> — run audio QA on a job's CURRENT master and
 * write the verdict to reel_jobs.payload.audioQa. Since 2026-10-10 the publish
 * gate does this itself on first contact (audioQa.measureJobAudioQa); this
 * script is the manual door for a job the gate has not touched yet.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/attach-audio-qa.mts 2070002
 */
const path = await import("path");
const fs = await import("fs");
const dir = "C:/Users/nourd/NattyNour/nicks-tire/node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@4.0.486/node_modules/@remotion/compositor-win32-x64-msvc";
if (fs.existsSync(path.join(dir, "ffprobe.exe"))) {
  process.env.FFMPEG_PATH ||= path.join(dir, "ffmpeg.exe");
  process.env.FFPROBE_PATH ||= path.join(dir, "ffprobe.exe");
}
const jobId = Number(process.argv[2]);
if (!Number.isInteger(jobId)) { console.error("usage: attach-audio-qa.mts <jobId>"); process.exit(2); }
const { getDbTyped } = await import("../server/db");
const d = await getDbTyped();
if (!d) { console.error("database unavailable"); process.exit(1); }
const { reelJobs } = await import("../drizzle/schema");
const { eq } = await import("drizzle-orm");
const [job] = await d.select({ payload: reelJobs.payload }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
if (!job) { console.error(`job ${jobId} not found`); process.exit(1); }
const existing = JSON.parse(job.payload ?? "{}").audioQa;
if (existing?.decision) { console.log(`job ${jobId} already has audioQa: ${JSON.stringify(existing)}`); process.exit(0); }
const { measureJobAudioQa } = await import("../server/services/audioQa");
const verdict = await measureJobAudioQa(d, jobId);
if (!verdict) { console.error("audio QA could not be measured or attached — see the warn line above"); process.exit(1); }
console.log(`job ${jobId} audioQa attached: ${JSON.stringify(verdict)}`);
process.exit(0);
