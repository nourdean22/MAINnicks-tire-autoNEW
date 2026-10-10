/**
 * fix-caption-ask-and-reassemble.mts <jobId> [--execute] — a job whose
 * assembly was refused by the ask-consistency gate ("the caption asks for X
 * while the declared end-card ask is Y") gets the caption's ask sentence
 * removed, so the end card carries the one ask, and goes back to
 * assets_ready with attempts reset so assembly gets its three tries again.
 * All five clips stay; nothing is re-rendered or paid for.
 *
 * Operator-authorised completion of job 2070005 (2026-10-10). Root cause to
 * fix upstream: generateReelBriefAI wrote a "send this to" caption against an
 * ask.kind of "profile", and enqueue preflight did not catch it.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/fix-caption-ask-and-reassemble.mts 2070005 --execute
 */
const args = process.argv.slice(2);
const jobId = Number(args.find((a) => /^\d+$/.test(a)));
const EXECUTE = args.includes("--execute");
if (!Number.isInteger(jobId)) { console.error("usage: fix-caption-ask-and-reassemble.mts <jobId> [--execute]"); process.exit(2); }
const { getDbTyped } = await import("../server/db");
const d = await getDbTyped(); if (!d) { console.error("database unavailable"); process.exit(1); }
const { reelJobs } = await import("../drizzle/schema");
const { and, eq } = await import("drizzle-orm");
const { queueStateForReelStatus } = await import("../shared/reelQueue");
const [job] = await d.select({ status: reelJobs.status, attempts: reelJobs.attempts, caption: reelJobs.caption, payload: reelJobs.payload, clips: reelJobs.clipUrlsJson }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
if (!job) { console.error(`job ${jobId} not found`); process.exit(1); }
const payload = JSON.parse(job.payload ?? "{}");
const clips: string[] = JSON.parse(job.clips ?? "[]");
const ASK_SENTENCE = /\s*(Send|Share|Tag|Forward) this (to|with)[^.!?]*[.!?]/gi;
const stripAsk = (s: string) => s.replace(ASK_SENTENCE, "").replace(/[ \t]{2,}/g, " ").trim();
const selectedBefore = String(payload.selectedCaption ?? "");
const captionBefore = String(job.caption ?? "");
const selectedAfter = stripAsk(selectedBefore);
const captionAfter = stripAsk(captionBefore);
console.log(`job ${jobId}: status=${job.status} attempts=${job.attempts} clips=${clips.filter(Boolean).length}/${clips.length} ask=${JSON.stringify(payload.ask)}`);
console.log(`selectedCaption before: ${selectedBefore}`);
console.log(`selectedCaption after:  ${selectedAfter}`);
if (selectedAfter === selectedBefore) { console.log("no ask sentence found in the caption — nothing to fix"); process.exit(1); }
if (job.status !== "failed" && job.status !== "assets_ready") { console.log(`job is ${job.status} — this script only touches failed/assets_ready jobs`); process.exit(1); }
if (!EXECUTE) { console.log("DRY RUN — no write. Pass --execute to fix the caption and return the job to assets_ready."); process.exit(0); }
payload.selectedCaption = selectedAfter;
payload.captionAskFix = { at: new Date().toISOString(), removed: selectedBefore.replace(selectedAfter, "").trim(), reason: "ask-consistency gate: end card carries the one ask" };
const r = await d.update(reelJobs).set({
  status: "assets_ready", queueState: queueStateForReelStatus("assets_ready"), attempts: 0,
  caption: captionAfter, payload: JSON.stringify(payload), updatedAt: new Date(),
  error: `caption ask sentence removed by operator ${new Date().toISOString()}; returned to assets_ready for assembly`,
}).where(and(eq(reelJobs.id, jobId), eq(reelJobs.status, job.status)));
const affected = Number((r as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0);
console.log(affected === 1 ? `job ${jobId} -> assets_ready with the fixed caption (assembly runs on the next pipeline tick)` : "row changed underneath — nothing written");
process.exit(affected === 1 ? 0 : 1);
