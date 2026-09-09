/**
 * Every door to the live Instagram account, and what it must ask first.
 *
 * THE SHAPE OF THIS DEFECT. Migration 0112 gave the autonomous cron an approval
 * gate. Two other routes publish to the SAME account and never got one:
 *
 *   · POST /api/admin/reel-canary action=publish — no approval check at all,
 *     and `force=true` additionally overrode the quality gate AND the stock
 *     guard nested inside it.
 *   · contentAdmin.generateAndPublishLiveTestReel — no approval, no claim
 *     audit, no originality check, and it passed no `isAiGenerated`, so
 *     metaSocial omitted `is_ai_generated` and posted AI video UNDISCLOSED.
 *
 * A gate applied to one door is a gate applied to nothing. These are source
 * assertions because the alternative is publishing to a live audience to find
 * out — the reel pipeline's verifier skill is explicit that
 * `generateAndPublishLiveTestReel` must never be used as a verification handle.
 *
 * THE FORCE DISTINCTION IS THE POINT. `force` may override a QUALITY OPINION
 * about the operator's own reel; that is their call. It may not override the
 * record of WHO CONSENTED to these exact caption bytes and this exact asset,
 * because the approval binds to content precisely so an edit cannot ride an old
 * yes. A flag that skipped consent would make the ledger decorative.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const adminRoutes = read("server/routes/adminRoutes.ts");
const content = read("server/routers/content.ts");
const dailyReel = read("server/cron/jobs/dailyReelPost.ts");
const pipeline = read("server/services/reelPipeline.ts");

/** The canary publish handler, isolated so assertions cannot match other routes. */
const canaryPublish = adminRoutes.slice(
  adminRoutes.indexOf('if (action === "publish")'),
  adminRoutes.indexOf("const { publishToSocial }", adminRoutes.indexOf('if (action === "publish")')),
);

describe("reel-canary publish asks for consent, and force cannot skip it", () => {
  it("checks the approval gate", () => {
    expect(canaryPublish).toMatch(/reelApprovalProblem\(\{ jobId, caption: captionForApproval, videoUrl: job\.mp4Url \}\)/);
  });

  it("checks approval BEFORE the quality gate, so a blocked job fails on consent first", () => {
    const approvalAt = canaryPublish.indexOf("reelApprovalProblem");
    const qualityAt = canaryPublish.indexOf("evaluateReelPublishGate");
    expect(approvalAt).toBeGreaterThan(-1);
    expect(qualityAt).toBeGreaterThan(-1);
    expect(approvalAt).toBeLessThan(qualityAt);
  });

  it("the approval refusal is NOT guarded by !force", () => {
    // The regression that matters. `if (approvalProblem && !force)` would
    // restore the bypass while still passing the "checks the gate" test above.
    const refusal = canaryPublish.slice(canaryPublish.indexOf("const approvalProblem"));
    expect(refusal).toMatch(/if \(approvalProblem\) \{/);
    expect(refusal).not.toMatch(/if \(approvalProblem && !force\)/);
    expect(refusal).not.toMatch(/if \(!force && approvalProblem\)/);
  });

  it("says plainly that force does not override consent", () => {
    expect(canaryPublish).toMatch(/force=true does NOT override consent/);
  });

  it("refuses a job with no caption rather than approving an empty string", () => {
    // captionFingerprint("") would otherwise be a stable, approvable value.
    expect(canaryPublish).toMatch(/nothing to approve or publish/);
  });
});

describe("generateAndPublishLiveTestReel is a live post, not a test", () => {
  const liveTest = content.slice(content.indexOf("if (!input?.dryRun) {"));

  it("checks the approval gate before publishing", () => {
    expect(liveTest).toMatch(/reelApprovalProblem\(\{/);
    expect(liveTest).toMatch(/PRECONDITION_FAILED/);
  });

  it("passes isAiGenerated, derived from the stored clips", () => {
    // It passed nothing, so metaSocial omitted `is_ai_generated` entirely and
    // AI video reached a live audience undisclosed. Derivation is from clip
    // storage paths — provider-independent, and not a caller-supplied flag.
    expect(liveTest).toMatch(/shouldDiscloseAi\(finalJob\.clipUrlsJson/);
    expect(liveTest).toMatch(/isAiGenerated,/);
  });
});

describe("the drain advances past ineligible jobs without publishing them", () => {
  it("runs BEFORE today's job is considered", () => {
    // It used to be `if (!job)` against a lookup for autopost-<today>, so once
    // the enqueue branch created today's row the drain was skipped for the rest
    // of the ET day and an approved master waited until tomorrow.
    const todaysLookup = dailyReel.indexOf("const todaysJob = jobs[0]");
    const drainStart = dailyReel.indexOf("DRAIN THE BACKLOG FIRST");
    // Anchor updated 2026-09-09: today's job gained the same parked-QA
    // pre-filter the drain has, so the assignment is now guarded. The ordering
    // invariant - drain first, today's job only as a fallback - is unchanged.
    const fallback = dailyReel.indexOf("if (!job && todaysJob)");
    expect(todaysLookup).toBeGreaterThan(-1);
    expect(drainStart).toBeGreaterThan(todaysLookup);
    expect(fallback).toBeGreaterThan(drainStart);
  });

  it("scans a bounded window rather than peeking at one row", () => {
    // `.limit(1)` handed the oldest approved job to the per-job gate, which
    // returns WITHOUT advancing — so an EXPIRED approval (72h TTL) or an edited
    // caption at the head of the queue blocked every valid reel behind it.
    expect(dailyReel).toMatch(/const DRAIN_SCAN_LIMIT = 25;/);
    expect(dailyReel).toMatch(/\.limit\(DRAIN_SCAN_LIMIT\)/);
  });

  it("selects the first candidate that ACTUALLY passes the approval gate", () => {
    const loop = dailyReel.slice(dailyReel.indexOf("for (const candidate of candidates)"));
    expect(loop).toMatch(/reelApprovalProblem\(\{ jobId: candidate\.id/);
    expect(loop).toMatch(/if \(problem\) \{[\s\S]{0,120}continue;/);
    expect(loop).toMatch(/job = candidate;/);
  });

  it("treats an unreadable approval as NOT an approval and keeps scanning", () => {
    const loop = dailyReel.slice(dailyReel.indexOf("for (const candidate of candidates)"));
    expect(loop).toMatch(/approval_read_failed/);
  });

  it("never publishes a skipped candidate — it is only ever skipped", () => {
    const loop = dailyReel.slice(
      dailyReel.indexOf("for (const candidate of candidates)"),
      dailyReel.indexOf("if (skipped.length)"),
    );
    expect(loop).not.toMatch(/publishToSocial/);
    expect(loop).not.toMatch(/force/);
  });

  it("logs what it skipped, because a queue that silently skips is how the last one hid", () => {
    expect(dailyReel).toMatch(/skipped ineligible approved jobs while draining/);
  });
});

describe("assembly refuses to render onto disposable storage", () => {
  it("asserts durable storage before ffmpeg runs", () => {
    const assembly = pipeline.slice(pipeline.indexOf("export async function processNextAssemblyJob"));
    const assertAt = assembly.indexOf("assertDurableStorageForGeneration");
    const assembleAt = assembly.indexOf("await assembleReel(");
    expect(assertAt).toBeGreaterThan(-1);
    expect(assembleAt).toBeGreaterThan(-1);
    // Before the render, so the work is not spent to produce a doomed artifact.
    expect(assertAt).toBeLessThan(assembleAt);
  });

  it("names the job, so the failure says which reel it refused", () => {
    expect(pipeline).toMatch(/assertDurableStorageForGeneration\(`reel job \$\{job\.id\} assembly`\)/);
  });
});
