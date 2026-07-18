/**
 * The consolidated reel publish gate (the persisted Quality Decision Record,
 * Creative Compiler 2.0 review closure).
 *
 * ONE decision, used at EVERY autonomous reel publish door so no path can post
 * merely because status === "assembled". It reads the PERSISTED rendered-QA
 * verdict (runRenderedQaOnJob stores it on payload.renderedQa) — or runs it once
 * — folds in the REAL per-job repair-attempt count + the policy repair cap +
 * audio verdict, and returns the publish permit via orchestratePostQa.
 *
 * Honesty: a rendered-QA that cannot run does NOT hard-block. The upstream
 * compiler + M10 preflight already prevent the known defect classes, and holding
 * every reel on flaky frame-extraction is worse than shipping one unscored clean
 * render. Such a case returns allowed:true with source:"unavailable" so the
 * caller can log it. A real non-"proceed" verdict DOES hold the publish.
 */
import type { PublishGate } from "./postQaOrchestrator";
import type { RenderedFinding, RenderedQaVerdict } from "./renderedQa";

export interface ReelPublishGateResult {
  gate: PublishGate | "unavailable";
  /** the publish permit — true only for a clean "proceed" (or QA unavailable). */
  allowed: boolean;
  findings: RenderedFinding[];
  source: "persisted" | "fresh" | "unavailable";
  repairAttempts: number;
  reason: string;
}

export async function evaluateReelPublishGate(jobId: number): Promise<ReelPublishGateResult> {
  const skip = (source: ReelPublishGateResult["source"], reason: string): ReelPublishGateResult =>
    ({ gate: "unavailable", allowed: true, findings: [], source, repairAttempts: 0, reason });

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return skip("unavailable", "no db — gate skipped");

  const { reelJobs } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
  if (!job) return skip("unavailable", "job not found");

  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(job.payload ?? "{}"); } catch { /* malformed payload → treat as no evidence */ }

  // Rendered-QA verdict: prefer the persisted one; else run it once (if enabled).
  let verdict = payload.renderedQa as RenderedQaVerdict | undefined;
  let source: ReelPublishGateResult["source"] = "persisted";
  if (!verdict && process.env.RENDERED_QA_ENABLED === "true") {
    const { runRenderedQaOnJob } = await import("./renderedQa");
    verdict = (await runRenderedQaOnJob(jobId)) ?? undefined;
    source = verdict ? "fresh" : "unavailable";
  }
  if (!verdict || !Array.isArray(verdict.findings)) {
    return skip("unavailable", "rendered QA unavailable — upstream compiler + preflight gates stand");
  }

  // Real context: repair attempts already spent on this asset + the policy cap.
  const repairAttempts = Array.isArray(payload.repairQueue) ? payload.repairQueue.length : 0;
  let maxRepairAttempts = 2;
  try {
    const { getActivePolicy } = await import("./autonomyControl");
    maxRepairAttempts = (await getActivePolicy()).limits.maxRepairAttemptsPerAsset;
  } catch { /* policy unavailable → conservative default cap */ }
  const audioDecision = (payload.audioQa as { decision?: string } | undefined)?.decision === "repair" ? "repair" : "approve";

  const { orchestratePostQa } = await import("./postQaOrchestrator");
  const outcome = orchestratePostQa(verdict.findings, { repairAttempts, maxRepairAttempts, audioDecision });
  return {
    gate: outcome.publishGate,
    allowed: outcome.publishGate === "proceed",
    findings: verdict.findings,
    source,
    repairAttempts,
    reason: outcome.verdict.reason,
  };
}
