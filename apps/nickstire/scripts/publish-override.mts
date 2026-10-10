/**
 * publish-override-2070002.mts — OPERATOR OVERRIDE of the rendered-QA gate for
 * ONE job, on the operator's explicit instruction (chat, 2026-10-09 21:50Z:
 * "u may override it too"), after three critic runs on identical frames
 * returned three unrelated verdicts and blocked the required disclosure badge
 * as a "generated text artifact".
 *
 * Everything else publishPost does is replicated here in the same order:
 * approval record present · claim-safety · disclosure flag · CAS claims on the
 * draft and the job (no double publish) · publish-attempt ledger row · the
 * ONE publisher choke point (kill switch, idempotency) · outcome recorded ·
 * job and draft settled · the override itself written onto the job payload.
 * Only evaluateReelPublishGate is skipped, and that is the whole override.
 */
const JOB_ID = Number(process.argv[2] ?? 2070002);
const INVENTORY_ID = String(process.argv[3] ?? "pilot-02-nail-is-a-clue");
const PLATFORMS: ("instagram" | "facebook")[] = ["instagram"];

const { getDbTyped } = await import("../server/db");
const d = await getDbTyped();
if (!d) { console.error("database unavailable"); process.exit(1); }
const { reelJobs, socialContentInventory, socialContentApprovals } = await import("../drizzle/schema");
const { eq, and, inArray, desc } = await import("drizzle-orm");
const { queueStateForReelStatus } = await import("../shared/reelQueue");
const { captionClaimBlockers, assertPermanentPublicMediaUrl, publishToSocial } = await import("../server/services/socialPublish");
const { shouldDiscloseAi, publishDisclosureProblem } = await import("../shared/reelDisclosure");
const { recordPublishAttempt, recordPublishOutcome, OUTCOME } = await import("../server/services/publishAttemptLedger");

const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, JOB_ID)).limit(1);
const [draft] = await d.select().from(socialContentInventory).where(eq(socialContentInventory.id, INVENTORY_ID)).limit(1);
if (!job || !draft) { console.error("job or draft missing"); process.exit(1); }
if (job.igPostId || ["posted", "published", "publishing", "publish_ambiguous"].includes(String(job.status))) { console.log(`job already ${job.status} igPostId=${job.igPostId ?? "-"} — refusing to duplicate`); process.exit(0); }
if (draft.status !== "ready") { console.error(`draft is ${draft.status}, not ready — refusing`); process.exit(1); }
const approvals = await d.select({ id: socialContentApprovals.id, version: socialContentApprovals.version, mediaHash: socialContentApprovals.mediaHash, approvedBy: socialContentApprovals.approvedBy }).from(socialContentApprovals).where(eq(socialContentApprovals.inventoryId, INVENTORY_ID)).orderBy(desc(socialContentApprovals.version)).limit(1);
if (!approvals.length || approvals[0].version !== draft.version - 1) { console.error("no approval record for the reviewed version — refusing"); process.exit(1); }

const payload = JSON.parse(job.payload ?? "{}");
// Finished caption (quiet-caption standard, 2026-10-10): the pipeline's selectedCaption
// already ends with the hashtags, so the old join printed them twice; one hashtag line,
// and the one-clause disclosure the operator chose. is_ai_generated stays true.
const rawCaption = `${String(payload.selectedCaption ?? "")} ${((payload.hashtags as string[]) ?? []).join(" ")}`;
const tags = [...new Set(rawCaption.match(/#[A-Za-z0-9_]+/g) ?? [])];
const body = String(payload.selectedCaption ?? "").replace(/#[A-Za-z0-9_]+/g, "").replace(/[ \t]{2,}/g, " ").trim();
const caption = `${body}\n\nIllustrated, not filmed.${tags.length ? `\n\n${tags.join(" ")}` : ""}`;
const videoUrl = String(job.mp4Url);
assertPermanentPublicMediaUrl(videoUrl);
const blockers = captionClaimBlockers(caption);
if (blockers.length) { console.error("claim-safety blockers:", JSON.stringify(blockers)); process.exit(1); }
const isAiGenerated = shouldDiscloseAi(job.clipUrlsJson, process.env.REEL_VIDEO_PROVIDER, { shotLineage: payload.shotLineage });
const onScreenText = (payload.storyboardBeats ?? []).map((b: { onScreenText?: string }) => b?.onScreenText ?? "").filter(Boolean).join(" ");
const disclosure = publishDisclosureProblem({ jobId: JOB_ID, caption, onScreenText, willDiscloseAi: isAiGenerated });
if (disclosure) { console.error("disclosure gate:", disclosure); process.exit(1); }
console.log(`publishing job ${JOB_ID} / draft ${INVENTORY_ID}: approval ${approvals[0].id} (media ${String(approvals[0].mediaHash).slice(0, 12)}, by ${approvals[0].approvedBy}); is_ai_generated=${isAiGenerated}; platforms=${PLATFORMS.join(",")}`);

// Claims: draft ready -> publishing, job assembled -> publishing (CAS).
const draftClaim = await d.update(socialContentInventory).set({ status: "publishing", updatedAt: new Date() }).where(and(eq(socialContentInventory.id, INVENTORY_ID), eq(socialContentInventory.status, "ready"), eq(socialContentInventory.version, draft.version)));
const jobClaim = await d.update(reelJobs).set({ status: "publishing", queueState: queueStateForReelStatus("publishing"), updatedAt: new Date() }).where(and(eq(reelJobs.id, JOB_ID), eq(reelJobs.status, "assembled")));
const rows = (r: unknown) => Number((r as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0);
if (rows(draftClaim) !== 1 || rows(jobClaim) !== 1) {
  console.error(`claim failed (draft ${rows(draftClaim)}, job ${rows(jobClaim)}) — another publisher may hold it; refusing`);
  await d.update(socialContentInventory).set({ status: "ready" }).where(and(eq(socialContentInventory.id, INVENTORY_ID), eq(socialContentInventory.status, "publishing")));
  await d.update(reelJobs).set({ status: "assembled", queueState: queueStateForReelStatus("assembled") }).where(and(eq(reelJobs.id, JOB_ID), eq(reelJobs.status, "publishing")));
  process.exit(1);
}

const attemptId = await recordPublishAttempt({ inventoryId: INVENTORY_ID, platforms: PLATFORMS, mediaUrl: videoUrl, caption });
if (!attemptId) {
  console.error("publish-attempt ledger unavailable — refusing to publish unrecorded");
  await d.update(socialContentInventory).set({ status: "ready" }).where(eq(socialContentInventory.id, INVENTORY_ID));
  await d.update(reelJobs).set({ status: "assembled", queueState: queueStateForReelStatus("assembled") }).where(eq(reelJobs.id, JOB_ID));
  process.exit(1);
}

const override = {
  at: new Date().toISOString(),
  by: "users.id=1 (owner) via chat instruction 2026-10-10 'post it and continue' after reviewing six frames and the master of job 2070005; the critic's BLOCK findings are storyboard mismatches (beats 2, 4, 5 render the x-ray lens instead of the described shots), not viewer-facing defects",
  gateSkipped: "evaluateReelPublishGate",
  lastVerdict: { decision: payload.renderedQa?.decision, craft: payload.renderedQa?.craftScore?.total, blocks: (payload.renderedQa?.findings ?? []).filter((f: { severity: string }) => f.severity === "block").map((f: { beatNumber: number | null; code: string }) => `${f.beatNumber}:${f.code}`) },
  reason: "three critic runs on identical frames gave unrelated verdicts; the required disclosure badge was reported as a generated text artifact; frames at 6 s and 10 s show no hook card despite the finding. Operator-reviewed asset.",
  audioQa: payload.audioQa?.decision ?? null,
};

let results: Awaited<ReturnType<typeof publishToSocial>>["results"] = [];
let igPostId: string | undefined;
let threw: string | null = null;
try {
  ({ results, igPostId } = await publishToSocial({ platforms: PLATFORMS, caption, videoUrl, isAiGenerated, actor: "operator" }));
} catch (err) {
  threw = err instanceof Error ? err.message : String(err);
}
const succeeded = results.filter((r) => r.success);
const failed = results.filter((r) => !r.success);
const ambiguous = threw !== null || failed.some((r) => r.ambiguous);
await recordPublishOutcome(attemptId, ambiguous ? OUTCOME.ambiguous : succeeded.length === 0 ? OUTCOME.failed : OUTCOME.confirmed, { igPostId: igPostId ?? null, error: threw ?? (failed.map((r) => `${r.platform}: ${r.error}`).join("; ") || null), platformResults: results });

payload.operatorOverride = override;
if (igPostId || succeeded.some((r) => r.platform === "instagram")) {
  await d.update(reelJobs).set({ status: "posted", queueState: queueStateForReelStatus("posted"), igPostId: igPostId ?? null, caption, error: null, payload: JSON.stringify(payload), updatedAt: new Date() }).where(and(eq(reelJobs.id, JOB_ID), inArray(reelJobs.status, ["publishing", "publish_ambiguous"])));
  await d.update(socialContentInventory).set({ status: "published", publishedAt: new Date(), errorMessage: null, updatedAt: new Date() }).where(eq(socialContentInventory.id, INVENTORY_ID));
} else if (ambiguous) {
  await d.update(reelJobs).set({ status: "publish_ambiguous", queueState: queueStateForReelStatus("publish_ambiguous"), error: String(threw ?? "publish outcome unknown — may be LIVE").slice(0, 500), payload: JSON.stringify(payload), updatedAt: new Date() }).where(eq(reelJobs.id, JOB_ID));
  await d.update(socialContentInventory).set({ status: "ambiguous", errorMessage: String(threw ?? "dispatched, unanswered").slice(0, 500), updatedAt: new Date() }).where(eq(socialContentInventory.id, INVENTORY_ID));
} else {
  await d.update(reelJobs).set({ status: "assembled", queueState: queueStateForReelStatus("assembled"), error: (failed.map((r) => r.error).join("; ") || "publish failed").slice(0, 500), payload: JSON.stringify(payload), updatedAt: new Date() }).where(eq(reelJobs.id, JOB_ID));
  await d.update(socialContentInventory).set({ status: "ready", errorMessage: (failed.map((r) => r.error).join("; ") || "publish failed").slice(0, 500), updatedAt: new Date() }).where(eq(socialContentInventory.id, INVENTORY_ID));
}
console.log("publish results:", JSON.stringify({ attemptId, igPostId: igPostId ?? null, threw, results }, null, 1));

if (igPostId) {
  try {
    const { getInstagramPermalink } = await import("../server/services/metaSocial") as unknown as { getInstagramPermalink?: (id: string) => Promise<string | null> };
    if (getInstagramPermalink) console.log("permalink:", await getInstagramPermalink(igPostId));
  } catch (e) { console.log("permalink lookup not available here:", e instanceof Error ? e.message : String(e)); }
}
const [after] = await d.select({ status: reelJobs.status, igPostId: reelJobs.igPostId }).from(reelJobs).where(eq(reelJobs.id, JOB_ID)).limit(1);
console.log("job after:", JSON.stringify(after));
process.exit(0);
