/**
 * publish-reel-job.mts <jobId> [--execute] [--facebook] — walk ONE assembled
 * pipeline reel through the normal door: reconcileAssembledReel -> approveDraft
 * (hash-checked) -> publishPost (quality gate, claim gate, disclosure, attempt
 * ledger). Nothing here bypasses a gate; it only presses the buttons an operator
 * would press in Instagram > Queue, acting as users.id=1 (owner).
 *
 * Dry run (default) prints the job, its rendered-QA / audio-QA verdicts, the
 * gate decision and the caption, and opens no write. --execute publishes.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/publish-reel-job.mts 2070005 --execute
 */
const args = process.argv.slice(2);
const jobId = Number(args.find((a) => /^\d+$/.test(a)));
const EXECUTE = args.includes("--execute");
const PLATFORMS: ("instagram" | "facebook")[] = args.includes("--facebook") ? ["instagram", "facebook"] : ["instagram"];
if (!Number.isInteger(jobId)) { console.error("usage: publish-reel-job.mts <jobId> [--execute] [--facebook]"); process.exit(2); }

const { getDbTyped } = await import("../server/db");
const d = await getDbTyped();
if (!d) { console.error("database unavailable"); process.exit(1); }
const { reelJobs, socialContentInventory, users } = await import("../drizzle/schema");
const { eq } = await import("drizzle-orm");
const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
if (!job) { console.error(`job ${jobId} not found`); process.exit(1); }
const payload = JSON.parse(job.payload ?? "{}");
console.log(`job ${job.id} briefId=${job.briefId} status=${job.status} igPostId=${job.igPostId ?? "-"}`);
console.log(`mp4Url=${job.mp4Url ?? "-"}`);
const rq = payload.renderedQa;
if (rq) {
  console.log(`renderedQa: decision=${rq.decision} qaState=${rq.qaState} critic=${rq.critic} craft=${rq.craftScore?.total ?? "-"} voting=${rq.voting ? JSON.stringify(rq.voting).slice(0, 160) : "-"}`);
  for (const f of rq.findings ?? []) console.log(`  [${f.severity}] beat ${f.beatNumber} ${f.code}: ${String(f.description).slice(0, 200)}`);
} else console.log("renderedQa: none");
console.log("audioQa:", payload.audioQa ? JSON.stringify({ decision: payload.audioQa.decision, lufs: payload.audioQa.integratedLufs, tp: payload.audioQa.truePeakDb, findings: payload.audioQa.findings }) : "none");
const { evaluateReelPublishGate } = await import("../server/services/qualityGate");
const gate = await evaluateReelPublishGate(jobId, { runIfMissing: false });
console.log(`publish gate (read-only): allowed=${gate.allowed} gate=${gate.gate} reason=${String(gate.reason).slice(0, 200)}`);
// Caption finish (quiet-caption standard, 2026-10-10): the pipeline caption ends its first
// line with the hashtags AND repeats them on the last line; keep one hashtag line, and close
// the body with the one-clause disclosure the operator chose. is_ai_generated stays true.
const rawCaption = String(job.caption ?? "");
const tags = [...new Set(rawCaption.match(/#[A-Za-z0-9_]+/g) ?? [])];
const body = rawCaption.replace(/#[A-Za-z0-9_]+/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
const CAPTION = `${body}\n\nIllustrated, not filmed.${tags.length ? `\n\n${tags.join(" ")}` : ""}`;
console.log(`caption (${CAPTION.length} chars):\n${CAPTION}\n`);
if (job.status !== "assembled") { console.log(`job is ${job.status}, not assembled — nothing to publish yet`); process.exit(EXECUTE ? 1 : 0); }
if (!EXECUTE) { console.log("DRY RUN — nothing approved or published. Pass --execute to publish."); process.exit(0); }
if (["posted", "published", "publishing", "publish_ambiguous"].includes(String(job.status))) { console.log("already published or in flight — refusing to duplicate"); process.exit(0); }

const [owner] = await d.select({ id: users.id, openId: users.openId, role: users.role, email: users.email, name: users.name }).from(users).where(eq(users.id, 1)).limit(1);
if (!owner || owner.role !== "admin") { console.error("owner user (id 1) is not an admin row — refusing"); process.exit(1); }
const { appRouter } = await import("../server/routers");
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: { id: owner.id, openId: owner.openId, role: owner.role, email: owner.email, name: owner.name ?? "Nour", isGuest: false } as never } as never);
const inventoryId = String(job.briefId);
const readDraft = async () => (await d.select({ status: socialContentInventory.status, version: socialContentInventory.version }).from(socialContentInventory).where(eq(socialContentInventory.id, inventoryId)).limit(1))[0];
let draft = await readDraft();
if (!draft) { console.log("reconcileAssembledReel:", JSON.stringify(await caller.contentAdmin.reconcileAssembledReel({ jobId }))); draft = await readDraft(); }
if (!draft) { console.error("no draft after reconcile — refusing"); process.exit(1); }
console.log(`draft ${inventoryId}: status=${draft.status} v${draft.version}`);
if (draft.status === "review_ready") console.log("approveDraft:", JSON.stringify(await caller.instagramAdmin.approveDraft({ id: inventoryId, expectedVersion: draft.version })));
else if (["published", "published_partial", "publishing"].includes(draft.status)) { console.log(`draft is ${draft.status} — refusing to duplicate`); process.exit(0); }
const result = await caller.instagramAdmin.publishPost({ inventoryId, platforms: PLATFORMS, caption: CAPTION, videoUrl: String(job.mp4Url), isAiGenerated: true });
console.log("publishPost:", JSON.stringify(result, null, 2));
const [after] = await d.select({ id: reelJobs.id, status: reelJobs.status, igPostId: reelJobs.igPostId }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
console.log("reel_jobs after:", JSON.stringify(after));
process.exit(0);
