/**
 * approve-reel-job.mts <jobId> [--execute] — reconcile an assembled pipeline
 * reel into the inventory and record the hash-checked approval, acting as
 * users.id=1 (owner). No publish. Dry run prints the draft state.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/approve-reel-job.mts 2070005 --execute
 */
// validateFinalMedia spawns ffprobe by name; on this machine it lives in the bundled remotion compositor.
const _path = await import("path"); const _fs = await import("fs");
const _dir = "C:/Users/nourd/NattyNour/nicks-tire/node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@4.0.486/node_modules/@remotion/compositor-win32-x64-msvc";
if (_fs.existsSync(_path.join(_dir, "ffprobe.exe"))) { process.env.FFPROBE_PATH ||= _path.join(_dir, "ffprobe.exe"); process.env.FFMPEG_PATH ||= _path.join(_dir, "ffmpeg.exe"); process.env.PATH = _dir + ";" + process.env.PATH; }
const args = process.argv.slice(2);
const jobId = Number(args.find((a) => /^\d+$/.test(a)));
const EXECUTE = args.includes("--execute");
if (!Number.isInteger(jobId)) { console.error("usage: approve-reel-job.mts <jobId> [--execute]"); process.exit(2); }
const { getDbTyped } = await import("../server/db");
const d = await getDbTyped(); if (!d) { console.error("database unavailable"); process.exit(1); }
const { reelJobs, socialContentInventory, users } = await import("../drizzle/schema");
const { eq } = await import("drizzle-orm");
const [job] = await d.select({ id: reelJobs.id, briefId: reelJobs.briefId, status: reelJobs.status, mp4Url: reelJobs.mp4Url }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
if (!job) { console.error(`job ${jobId} not found`); process.exit(1); }
const inventoryId = String(job.briefId);
const readDraft = async () => (await d.select({ status: socialContentInventory.status, version: socialContentInventory.version }).from(socialContentInventory).where(eq(socialContentInventory.id, inventoryId)).limit(1))[0];
let draft = await readDraft();
console.log(`job ${job.id} status=${job.status} mp4=${job.mp4Url ? "yes" : "no"} draft ${inventoryId}: ${draft ? `${draft.status} v${draft.version}` : "none"}`);
if (job.status !== "assembled") { console.log("job is not assembled — nothing to approve"); process.exit(1); }
if (!EXECUTE) { console.log("DRY RUN — no write. Pass --execute to reconcile and approve."); process.exit(0); }
const [owner] = await d.select({ id: users.id, openId: users.openId, role: users.role, email: users.email, name: users.name }).from(users).where(eq(users.id, 1)).limit(1);
if (!owner || owner.role !== "admin") { console.error("owner user (id 1) is not an admin row — refusing"); process.exit(1); }
const { appRouter } = await import("../server/routers");
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: { id: owner.id, openId: owner.openId, role: owner.role, email: owner.email, name: owner.name ?? "Nour", isGuest: false } as never } as never);
if (!draft) { console.log("reconcileAssembledReel:", JSON.stringify(await caller.contentAdmin.reconcileAssembledReel({ jobId }))); draft = await readDraft(); }
if (!draft) { console.error("no draft after reconcile — refusing"); process.exit(1); }
if (draft.status === "review_ready") {
  console.log("approveDraft:", JSON.stringify(await caller.instagramAdmin.approveDraft({ id: inventoryId, expectedVersion: draft.version })));
} else {
  console.log(`draft is ${draft.status} — not approving again`);
}
draft = await readDraft();
console.log(`draft ${inventoryId} now: ${draft?.status} v${draft?.version}`);
process.exit(0);
