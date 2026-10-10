/**
 * enqueue-quality-test-reel.mts — the one paid test the operator approved on
 * 2026-10-10 ("yes" to a Seedance 2.5 reel, about 130 credits): generate one
 * brief the normal way (generateReelBriefAI), attach the autonomous visual
 * world, and enqueue it as an admin job. The reel-pipeline cron renders it on
 * production with whatever REEL_CLIP_MODEL the service carries, so set
 * REEL_CLIP_MODEL=seedance_2_5 on Railway BEFORE --execute or the test renders
 * on the old model.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/enqueue-quality-test-reel.mts [--topic "..."] [--execute]
 *
 * Dry run (default) prints the brief and the price it would reserve, opens no
 * database, enqueues nothing. The job lands in the normal queue: rendered QA,
 * audio QA and the approval door all still apply; nothing is published by this.
 */
const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const t = args.indexOf("--topic");
const topic = t >= 0 ? args[t + 1] : "What a tire shop sees in a worn tread that a driver walks past every morning";

const model = (process.env.REEL_CLIP_MODEL ?? "").trim() || "seedance1_5 (default — REEL_CLIP_MODEL unset)";
console.log(`clip model on this environment: ${model}`);
if (EXECUTE && !/^seedance_2_5$/.test(process.env.REEL_CLIP_MODEL ?? "")) {
  console.error("REFUSING: this test is for seedance_2_5; set REEL_CLIP_MODEL=seedance_2_5 on the service first (railway variables --set ...) and rerun.");
  process.exit(2);
}

const { generateReelBriefAI } = await import("../server/services/reelBriefGen");
const { brief } = await generateReelBriefAI({ topic });
const { reelClipCostUsd } = await import("../server/services/generationLedger");
const beats = brief.storyboardBeats?.length ?? 0;
console.log(`brief ${brief.id}: "${brief.topic}" — ${beats} beats, lens ${brief.motionLens}, archetype ${brief.archetype}`);
for (const b of brief.storyboardBeats ?? []) console.log(`  ${b.beatNumber}. ${b.visual.slice(0, 110)}`);
console.log(`reservation: ${beats} x $${reelClipCostUsd("higgsfield").toFixed(2)} = $${(beats * reelClipCostUsd("higgsfield")).toFixed(2)} (estimate; 26 credits per clip on seedance_2_5)`);
if (!EXECUTE) { console.log("DRY RUN — nothing enqueued. Pass --execute to enqueue."); process.exit(0); }

const { attachAutonomousVisualWorld } = await import("../server/services/visualWorld");
await attachAutonomousVisualWorld(brief);
const { enqueueReelJob } = await import("../server/services/reelPipeline");
const { jobId } = await enqueueReelJob(brief, "admin", { objective: "DISCOVERY", disclosureMode: "visibly_animated", ctaType: "VISIT" });
console.log(`enqueued reel_jobs #${jobId} — the reel-pipeline cron renders it within 15 min; watch the logs for "Generating Reel clip video via Higgsfield CLI" with model seedance_2_5, then "rendered QA verdict voted".`);
process.exit(0);
