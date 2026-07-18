/**
 * The consolidated reel publish gate (the Quality Decision authority).
 *
 * ONE decision, used at EVERY autonomous reel publish door so no path can post
 * merely because status === "assembled". It reads the PERSISTED rendered-QA
 * verdict (runRenderedQaOnJob stores it on payload.renderedQa) — or runs it once
 * — folds in the REAL per-job repair-attempt count + the policy repair cap +
 * audio verdict, and returns the publish permit via orchestratePostQa.
 *
 * CORE RULE (audit: "failure and missing evidence were read as permission"):
 * only a COMPLETED, CURRENT, COMPLETE evaluation can authorize a publish.
 *   - critic outage / timeout / parse failure  -> qaState "unavailable" -> HOLD
 *   - verdict stale after a repair re-render   -> HOLD
 *   - critic said "repair" but findings are empty, or unknown defect codes were
 *     dropped (incomplete evidence)            -> HOLD for review
 *   - RENDERED_QA_ENABLED explicitly off       -> "disabled" -> allowed (an
 *     operator POLICY choice, logged — not a silent failure)
 * Absence of evidence is never evidence of quality.
 */
import type { PublishGate } from "./postQaOrchestrator";
import type { RenderedFinding, RenderedQaVerdict } from "./renderedQa";

/** Gate outcomes that are NOT an orchestrator decision — evidence problems. */
export type EvidenceGate = "unavailable" | "stale" | "needs_review" | "disabled";

export interface ReelPublishGateResult {
  gate: PublishGate | EvidenceGate;
  /** the publish permit — only a clean, current, complete evaluation (or an
   *  explicit operator disable) may be true. */
  allowed: boolean;
  findings: RenderedFinding[];
  source: "persisted" | "fresh" | "unavailable" | "disabled";
  repairAttempts: number;
  reason: string;
}

export async function evaluateReelPublishGate(jobId: number): Promise<ReelPublishGateResult> {
  const result = (
    gate: ReelPublishGateResult["gate"],
    allowed: boolean,
    source: ReelPublishGateResult["source"],
    reason: string,
    findings: RenderedFinding[] = [],
    repairAttempts = 0,
  ): ReelPublishGateResult => ({ gate, allowed, findings, source, repairAttempts, reason });

  // An explicit operator disable is a POLICY choice, not a failed evaluation.
  if (process.env.RENDERED_QA_ENABLED !== "true") {
    return result("disabled", true, "disabled", "RENDERED_QA_ENABLED is off — publishing on upstream compiler + preflight gates by operator policy");
  }

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return result("unavailable", false, "unavailable", "no database — cannot read a quality decision; refusing to publish unscored");

  const { reelJobs } = await import("../../drizzle/schema");
  const { eq, and, gte } = await import("drizzle-orm");
  const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
  if (!job) return result("unavailable", false, "unavailable", `reel job ${jobId} not found — no quality evidence`);

  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(job.payload ?? "{}"); } catch {
    return result("unavailable", false, "unavailable", "job payload unparseable — no quality evidence");
  }

  // Prefer the persisted verdict; else run it once.
  let verdict = payload.renderedQa as RenderedQaVerdict | undefined;
  let source: ReelPublishGateResult["source"] = "persisted";
  if (!verdict) {
    const { runRenderedQaOnJob } = await import("./renderedQa");
    verdict = (await runRenderedQaOnJob(jobId)) ?? undefined;
    source = verdict ? "fresh" : "unavailable";
  }
  if (!verdict || !Array.isArray(verdict.findings)) {
    return result("unavailable", false, "unavailable", "rendered QA produced no verdict — refusing to publish unscored");
  }

  // A NON-evaluation must never satisfy the gate. `qaState` is authoritative;
  // `critic === "skipped"` is checked too so verdicts persisted before qaState
  // existed are still caught.
  if (verdict.qaState !== "completed" || verdict.critic === "skipped") {
    return result("unavailable", false, source, "vision critic did not evaluate (outage/timeout/parse failure) — an approve-shaped non-evaluation is not an approval", verdict.findings);
  }

  // The media changed after this verdict was written (selectiveRepair re-render).
  if (verdict.staleAfterRepair) {
    return result("stale", false, source, "verdict predates a repair re-render — re-run rendered QA against the current mp4", verdict.findings);
  }

  // Incomplete evidence: the critic flagged a problem we could not classify, or
  // asked for repair while its recognized findings came back empty.
  if ((verdict.droppedUnknownCodes ?? 0) > 0) {
    return result("needs_review", false, source, `${verdict.droppedUnknownCodes} unrecognized defect code(s) were dropped — evidence incomplete, operator review required`, verdict.findings);
  }
  if (verdict.decision === "repair" && verdict.findings.length === 0) {
    return result("needs_review", false, source, "critic returned decision=repair with no classifiable findings — operator review required", verdict.findings);
  }

  // Real context: repair attempts already spent on this asset + the policy cap.
  const repairAttempts = Array.isArray(payload.repairQueue) ? payload.repairQueue.length : 0;
  let maxRepairAttempts = 2;
  try {
    const { getActivePolicy } = await import("./autonomyControl");
    maxRepairAttempts = (await getActivePolicy()).limits.maxRepairAttemptsPerAsset;
  } catch { /* policy unavailable → conservative default cap */ }
  const audioDecision = (payload.audioQa as { decision?: string } | undefined)?.decision === "repair" ? "repair" : "approve";

  // decideAutomation has always had PAUSE_MISSING_EVIDENCE and PAUSE_PROVIDER_DOWN
  // branches, but NO caller ever passed either input — they defaulted to
  // "evidence present, provider healthy", so both safety nets were unreachable
  // code. They are armed here from signals the gate can actually observe.

  // A verdict that judged ZERO frames is shaped like evidence and contains none.
  // (A skipped critic is already held above; this catches a completed run that
  //  had nothing to look at — e.g. frame extraction produced no stills.)
  const missingEvidence = !Number.isFinite(Number(verdict.framesEvaluated)) || Number(verdict.framesEvaluated) <= 0;

  // Only consulted when the outcome would SPEND money on a paid re-render. If the
  // generation provider has been failing, queueing another paid repair burns
  // budget on a call that will fail too — pause for an operator instead.
  let providerHealthy = true;
  try {
    const { sql } = await import("drizzle-orm");
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const [row] = await d
      .select({ n: sql<number>`count(*)` })
      .from(reelJobs)
      .where(and(eq(reelJobs.status, "failed"), gte(reelJobs.updatedAt, since)));
    // Three failed jobs inside an hour is a provider problem, not bad luck — the
    // pipeline posts at most twice a day, so this is never normal volume.
    providerHealthy = Number(row?.n ?? 0) < 3;
  } catch {
    // Unknown health must not manufacture a pause on its own; the repair-cap and
    // the findings gate still apply.
  }

  const { orchestratePostQa } = await import("./postQaOrchestrator");
  const outcome = orchestratePostQa(verdict.findings, { repairAttempts, maxRepairAttempts, audioDecision, missingEvidence, providerHealthy });
  return result(
    outcome.publishGate,
    outcome.publishGate === "proceed",
    source,
    outcome.verdict.reason,
    verdict.findings,
    repairAttempts,
  );
}
