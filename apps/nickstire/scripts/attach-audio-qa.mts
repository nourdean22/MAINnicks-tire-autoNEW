/**
 * attach-audio-qa.mts <jobId> [localMp4] — run the repo's audio QA
 * (services/audioQa.runAudioQa, the same measurement reelAssembly and mp4Ingest
 * persist) on the job's CURRENT MASTER and write the verdict to
 * reel_jobs.payload.audioQa. An external master never went through assembly,
 * so this is the only way the publish gate can read audio evidence for it.
 *
 * Binding (review of #2952): the bytes measured are the bytes at job.mp4Url,
 * fetched here and hashed; a local file may be passed only as a cache and is
 * used solely when its sha256 equals the master's. Lineage hashes are per-clip
 * and are not consulted. The write is a compare-and-set on the exact payload
 * string that was read, retried three times, so a concurrent writer (rendered
 * QA, a publish-gate retry) is never overwritten with a stale snapshot.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/attach-audio-qa.mts 2070002 [cached.mp4]
 */
const path = await import("path");
const fs = await import("fs");
const os = await import("os");
const { createHash } = await import("crypto");
const dir = "C:/Users/nourd/NattyNour/nicks-tire/node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@4.0.486/node_modules/@remotion/compositor-win32-x64-msvc";
if (fs.existsSync(path.join(dir, "ffprobe.exe"))) {
  process.env.FFMPEG_PATH ||= path.join(dir, "ffmpeg.exe");
  process.env.FFPROBE_PATH ||= path.join(dir, "ffprobe.exe");
}
const jobId = Number(process.argv[2]);
const cached = process.argv[3];
if (!Number.isInteger(jobId)) { console.error("usage: attach-audio-qa.mts <jobId> [cached.mp4]"); process.exit(2); }

const { getDbTyped } = await import("../server/db");
const d = await getDbTyped();
if (!d) { console.error("database unavailable"); process.exit(1); }
const { reelJobs } = await import("../drizzle/schema");
const { eq, and } = await import("drizzle-orm");

const readJob = async () => (await d.select({ id: reelJobs.id, status: reelJobs.status, mp4Url: reelJobs.mp4Url, payload: reelJobs.payload }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1))[0];
const job = await readJob();
if (!job) { console.error(`job ${jobId} not found`); process.exit(1); }
if (!job.mp4Url || !/^https?:\/\//.test(job.mp4Url)) { console.error(`job ${jobId} has no http master (mp4Url) — nothing to measure`); process.exit(1); }
if (JSON.parse(job.payload ?? "{}").audioQa?.decision) { console.log(`job ${jobId} already has audioQa: ${JSON.stringify(JSON.parse(job.payload ?? "{}").audioQa)}`); process.exit(0); }

// The master, by its own bytes.
const res = await fetch(job.mp4Url);
if (!res.ok) { console.error(`master fetch failed: HTTP ${res.status}`); process.exit(1); }
const master = Buffer.from(await res.arrayBuffer());
const masterSha = createHash("sha256").update(master).digest("hex");
let file = cached && fs.existsSync(cached) ? cached : null;
if (file && createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== masterSha) {
  console.error(`cached file does not match the master at mp4Url (${masterSha.slice(0, 12)}) — ignoring the cache`);
  file = null;
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `audioqa-${jobId}-`));
if (!file) { file = path.join(workDir, "master.mp4"); fs.writeFileSync(file, master); }

const { runAudioQa } = await import("../server/services/audioQa");
const result = await runAudioQa(file);
const audioQa = { ...result, qaState: "completed", evaluatedAt: new Date().toISOString(), masterSha256: masterSha, measuredOn: "operator machine, bundled remotion ffmpeg 7.1, the exact bytes at mp4Url" };

// Compare-and-set on the payload string read: only audioQa changes, and only
// if nobody else wrote the row in between.
let written = false;
for (let attempt = 0; attempt < 3 && !written; attempt++) {
  const fresh = await readJob();
  if (!fresh) break;
  if (fresh.mp4Url !== job.mp4Url) { console.error("master URL changed while measuring — refusing to attach a verdict for other bytes"); process.exit(1); }
  const payload = JSON.parse(fresh.payload ?? "{}");
  payload.audioQa = audioQa;
  const r = await d.update(reelJobs).set({ payload: JSON.stringify(payload), updatedAt: new Date() }).where(and(eq(reelJobs.id, jobId), eq(reelJobs.payload, fresh.payload ?? "")));
  written = Number((r as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 1;
  if (!written) console.log(`payload changed under us (attempt ${attempt + 1}) — re-reading`);
}
fs.rmSync(workDir, { recursive: true, force: true });
if (!written) { console.error("could not write audioQa after 3 attempts"); process.exit(1); }
console.log(`job ${jobId} audioQa written (master ${masterSha.slice(0, 12)}):`, JSON.stringify(audioQa));
process.exit(0);
