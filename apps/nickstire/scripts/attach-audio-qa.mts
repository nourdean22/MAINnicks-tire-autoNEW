/**
 * attach-audio-qa.mts <jobId> <localMp4> — run the repo's audio QA (services/audioQa.runAudioQa,
 * the same measurement reelAssembly and mp4Ingest persist) on a downloaded master whose sha256
 * must match the job's lineage, and write the verdict to reel_jobs.payload.audioQa. An external
 * master never went through assembly, so this is the only way the publish gate can read audio
 * evidence for it. One job, one field, nothing else changes; refuses on a sha mismatch.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/attach-audio-qa.mts 2070002 <path>
 */
const path = await import("path");
const fs = await import("fs");
const { createHash } = await import("crypto");
const dir = "C:/Users/nourd/NattyNour/nicks-tire/node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@4.0.486/node_modules/@remotion/compositor-win32-x64-msvc";
process.env.FFMPEG_PATH ||= path.join(dir, "ffmpeg.exe");
process.env.FFPROBE_PATH ||= path.join(dir, "ffprobe.exe");
const jobId = Number(process.argv[2]);
const file = process.argv[3];
if (!Number.isInteger(jobId) || !file) { console.error("usage: attach-audio-qa.mts <jobId> <mp4>"); process.exit(2); }

const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const { getDbTyped } = await import("../server/db");
const d = await getDbTyped();
if (!d) { console.error("database unavailable"); process.exit(1); }
const { reelJobs } = await import("../drizzle/schema");
const { eq } = await import("drizzle-orm");
const [job] = await d.select({ id: reelJobs.id, status: reelJobs.status, payload: reelJobs.payload }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
if (!job) { console.error(`job ${jobId} not found`); process.exit(1); }
const payload = JSON.parse(job.payload ?? "{}");
const bound = (payload.shotLineage ?? []).map((r: { sha256?: string }) => r.sha256).filter(Boolean);
if (!bound.length || !bound.every((s: string) => s === sha)) { console.error(`sha mismatch: file ${sha.slice(0, 12)} vs lineage ${bound.map((s: string) => s.slice(0, 12)).join(",")} — refusing`); process.exit(1); }
if (payload.audioQa?.decision) { console.log(`job ${jobId} already has audioQa: ${JSON.stringify(payload.audioQa)}`); process.exit(0); }

const { runAudioQa } = await import("../server/services/audioQa");
const result = await runAudioQa(file);
const audioQa = { ...result, qaState: "completed", evaluatedAt: new Date().toISOString(), measuredOn: "operator machine, bundled remotion ffmpeg 7.1, same bytes as the lineage sha256" };
payload.audioQa = audioQa;
await d.update(reelJobs).set({ payload: JSON.stringify(payload), updatedAt: new Date() }).where(eq(reelJobs.id, jobId));
console.log(`job ${jobId} audioQa written:`, JSON.stringify(audioQa));
process.exit(0);
