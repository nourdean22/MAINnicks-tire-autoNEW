/**
 * Selective repair — async, durable, attempt-accounted (closes #820's three
 * unresolved review findings):
 *
 * P1 (repair blocked the request path): the endpoint now VALIDATES,
 * authorizes, invalidates stale outputs, and QUEUES a durable repair request
 * — provider generation happens in the pipeline worker on the next pulse,
 * reusing the existing claim/retry/stuck-recovery machinery.
 *
 * P2 (stale MP4 survived): queueing a repair immediately moves the current
 * mp4 into payload.mp4History and NULLs mp4Url — the stale render can no
 * longer be previewed, approved, or published; the QA verdict and contact
 * sheet are flagged stale.
 *
 * P2 (failed reservation reused): every PROVIDER ATTEMPT gets a fresh,
 * immutable reservation (`<logicalRepairId>_p<n>`); failed attempts stay on
 * the ledger as failed spend and are never settled or reused.
 *
 * State model (unambiguous):
 *   job.status: repair_queued -> repair_rendering -> assets_ready (existing
 *   assembly takes over) | repair_failed
 *   entry.state: queued -> rendering -> ready_for_assembly | failed
 */
import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger";

const log = createLogger("services:selective-repair");

const MAX_PROVIDER_ATTEMPTS = 2;

export interface RepairInstruction {
  code?: string;
  description?: string;
  preserve: string[];
  change: string[];
}

/** Deterministic: the original generation prompt stays the base truth; the
 *  repair block narrows what may differ. */
export function buildRepairPrompt(originalPrompt: string, instruction: RepairInstruction): string {
  const preserve = instruction.preserve.length ? instruction.preserve.join("; ") : "everything not named below";
  const change = instruction.change.length ? instruction.change.join("; ") : instruction.description ?? "fix the flagged defect";
  return [
    originalPrompt,
    ``,
    `REPAIR INSTRUCTION (this is a regeneration of a rejected take):`,
    `KEEP IDENTICAL: ${preserve}.`,
    `CHANGE ONLY: ${change}.`,
    `Everything else must match the original prompt exactly.`,
  ].join("\n");
}

export interface ProviderAttempt {
  providerAttemptId: string;
  reservationId: string;
  startedAt: string;
  outcome: "succeeded" | "failed";
  error?: string;
}

export interface RepairQueueEntry {
  logicalRepairId: string;
  beatNumber: number;
  instruction: RepairInstruction;
  state: "queued" | "rendering" | "ready_for_assembly" | "failed";
  requestedAt: string;
  attempts: ProviderAttempt[];
  previousClipUrl: string | null;
  newClipUrl?: string;
}

export interface RepairRequestResult {
  jobId: number;
  beatNumber: number;
  logicalRepairId: string;
  state: "queued";
}

/**
 * Operator-facing: validate + authorize + invalidate stale outputs + QUEUE.
 * Returns immediately — no provider call on the request path (P1).
 */
export async function requestBeatRepair(input: {
  jobId: number;
  beatNumber: number;
  instruction?: RepairInstruction;
}): Promise<RepairRequestResult> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("DB not available");
  const { reelJobs } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, input.jobId)).limit(1);
  if (!job) throw new Error(`job ${input.jobId} not found`);
  if (!["assembled", "assets_ready", "repair_failed"].includes(job.status)) {
    throw new Error(`job ${input.jobId} is ${job.status} — repair needs assembled, assets_ready, or repair_failed`);
  }
  const payload = JSON.parse(job.payload ?? "{}");
  const beats: Array<{ beatNumber: number }> = payload.storyboardBeats ?? [];
  const beatIndex = beats.findIndex((b) => b.beatNumber === input.beatNumber);
  if (beatIndex < 0) throw new Error(`beat ${input.beatNumber} not in job ${input.jobId}`);
  const clipUrls: string[] = job.clipUrlsJson ? JSON.parse(job.clipUrlsJson) : [];
  if (clipUrls.length !== beats.length) {
    throw new Error(`job ${input.jobId} has ${clipUrls.length} clips for ${beats.length} beats — repair needs a complete clip set`);
  }
  const pack: Array<{ beatNumber: number; prompt: string }> = payload.promptPack ?? payload.higgsfieldPromptPack ?? [];
  if (!pack.find((p) => p.beatNumber === input.beatNumber)) {
    throw new Error(`no prompt for beat ${input.beatNumber} in job ${input.jobId}`);
  }
  const queue: RepairQueueEntry[] = payload.repairQueue ?? [];
  if (queue.some((e) => e.state === "queued" || e.state === "rendering")) {
    throw new Error(`job ${input.jobId} already has a repair in flight — one at a time`);
  }

  const verdictFinding = (payload.renderedQa?.findings ?? []).find(
    (f: { beatNumber: number | null }) => f.beatNumber === input.beatNumber,
  );
  const instruction: RepairInstruction = input.instruction ?? {
    code: verdictFinding?.code,
    description: verdictFinding?.description,
    preserve: verdictFinding?.preserve ?? [],
    change: verdictFinding?.change ?? [],
  };

  // Repair cap counts LOGICAL repairs on this job — provider retries within
  // a repair do not consume the cap, failed repair requests do.
  const { enforceAtBoundary } = await import("./autonomyControl");
  const { COST_ESTIMATES_USD, dailySpendUsd } = await import("./generationLedger");
  const spend = await dailySpendUsd();
  await enforceAtBoundary(
    {
      type: "enqueue_render",
      format: "reel",
      estimatedCostUsd: COST_ESTIMATES_USD.seedance_clip,
      today: {
        repairAttemptsForAsset: queue.length,
        ...(spend !== null ? { generationCostUsd: spend } : {}),
      },
    },
    { type: "operator", id: `repair_request_job_${input.jobId}` },
    payload.genomeId ?? null,
  );

  const logicalRepairId = `rep_${randomUUID().slice(0, 12)}`;
  const entry: RepairQueueEntry = {
    logicalRepairId,
    beatNumber: input.beatNumber,
    instruction,
    state: "queued",
    requestedAt: new Date().toISOString(),
    attempts: [],
    previousClipUrl: clipUrls[beatIndex] ?? null,
  };
  payload.repairQueue = [...queue, entry];

  // P2: the current render is stale the moment a repair is accepted —
  // preserve it as history, remove it from every consumable surface.
  if (job.mp4Url) {
    payload.mp4History = [
      ...(payload.mp4History ?? []),
      { mp4Url: job.mp4Url, replacedAt: new Date().toISOString(), reason: `repair beat ${input.beatNumber} (${logicalRepairId})` },
    ];
  }
  if (payload.renderedQa) payload.renderedQa = { ...payload.renderedQa, staleAfterRepair: true };

  await d
    .update(reelJobs)
    .set({
      payload: JSON.stringify(payload),
      mp4Url: null,
      status: "repair_queued",
      attempts: 0,
      error: null,
    })
    .where(eq(reelJobs.id, input.jobId));

  log.info("beat repair QUEUED (no provider call on request path)", {
    jobId: input.jobId,
    beat: input.beatNumber,
    logicalRepairId,
  });
  return { jobId: input.jobId, beatNumber: input.beatNumber, logicalRepairId, state: "queued" };
}

/**
 * Pipeline worker stage: claim one repair_queued job, run ONE provider
 * attempt with a FRESH per-attempt reservation, and either hand the job to
 * the existing assembly stage or park it as repair_failed at the attempt cap.
 * Kill switches are re-checked FRESH here — an operator's emergency stop
 * between request and execution wins.
 */
export async function processNextRepairJob(): Promise<{ processed: boolean; jobId?: number; status?: string; error?: string }> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return { processed: false };
  const { reelJobs } = await import("../../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  const [job] = await d.select().from(reelJobs).where(eq(reelJobs.status, "repair_queued")).limit(1);
  if (!job) return { processed: false };

  // Claim (same conditional-update pattern as the other stages — a racing
  // worker's update matches zero rows and it moves on).
  await d.update(reelJobs).set({ status: "repair_rendering", updatedAt: new Date() }).where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "repair_queued")));
  const [claimed] = await d.select().from(reelJobs).where(eq(reelJobs.id, job.id)).limit(1);
  if (!claimed || claimed.status !== "repair_rendering") return { processed: false };

  const payload = JSON.parse(claimed.payload ?? "{}");
  const queue: RepairQueueEntry[] = payload.repairQueue ?? [];
  const entry = queue.find((e) => e.state === "queued" || e.state === "rendering");
  if (!entry) {
    await d.update(reelJobs).set({ status: "repair_failed", error: "repair_queued with no queue entry" }).where(eq(reelJobs.id, job.id));
    return { processed: true, jobId: job.id, status: "repair_failed", error: "no queue entry" };
  }
  entry.state = "rendering";

  // Fresh emergency check — leave the job queued (not failed) under a switch.
  const { getEmergencyControlsFresh } = await import("./autonomyControl");
  const emergency = await getEmergencyControlsFresh();
  if (emergency.controls.globalKillSwitch || emergency.controls.generationKillSwitch) {
    entry.state = "queued";
    await d.update(reelJobs).set({ status: "repair_queued", payload: JSON.stringify(payload) }).where(eq(reelJobs.id, job.id));
    log.warn("repair deferred — kill switch armed", { jobId: job.id });
    return { processed: true, jobId: job.id, status: "repair_queued", error: "kill switch armed" };
  }

  const attemptNumber = entry.attempts.length + 1;
  if (attemptNumber > MAX_PROVIDER_ATTEMPTS) {
    entry.state = "failed";
    await d.update(reelJobs).set({ status: "repair_failed", payload: JSON.stringify(payload), error: `repair ${entry.logicalRepairId} exhausted ${MAX_PROVIDER_ATTEMPTS} provider attempts` }).where(eq(reelJobs.id, job.id));
    return { processed: true, jobId: job.id, status: "repair_failed" };
  }

  // P2: fresh, immutable, per-attempt reservation — failed attempts remain
  // failed spend on the ledger and are never reused.
  const { reserve, settle, fail: failReservation, COST_ESTIMATES_USD } = await import("./generationLedger");
  const { getActivePolicy } = await import("./autonomyControl");
  const policy = await getActivePolicy();
  const reservationId = `${entry.logicalRepairId}_p${attemptNumber}`;
  try {
    await reserve({
      actionId: reservationId,
      campaignId: payload.genomeId ?? null,
      provider: "higgsfield",
      model: "seedance1_5",
      operation: "beat_repair",
      estimatedCostUsd: COST_ESTIMATES_USD.seedance_clip,
      dailyBudgetUsd: policy.limits.maxGenerationCostPerDayUsd,
    });
  } catch (err) {
    // Budget breach at attempt time: leave queued for tomorrow's window.
    entry.state = "queued";
    await d.update(reelJobs).set({ status: "repair_queued", payload: JSON.stringify(payload) }).where(eq(reelJobs.id, job.id));
    return { processed: true, jobId: job.id, status: "repair_queued", error: err instanceof Error ? err.message : "reservation failed" };
  }

  const pack: Array<{ beatNumber: number; prompt: string; negativePrompt?: string }> = payload.promptPack ?? payload.higgsfieldPromptPack ?? [];
  const beatPrompt = pack.find((p) => p.beatNumber === entry.beatNumber)!;
  const attempt: ProviderAttempt = {
    providerAttemptId: `${entry.logicalRepairId}_a${attemptNumber}`,
    reservationId,
    startedAt: new Date().toISOString(),
    outcome: "failed",
  };

  try {
    const { generateReelClipVideo } = await import("./higgsfieldStudio");
    const newClipUrl = await generateReelClipVideo({
      prompt: buildRepairPrompt(beatPrompt.prompt, entry.instruction),
      negativePrompt: beatPrompt.negativePrompt,
    });
    await settle(reservationId, COST_ESTIMATES_USD.seedance_clip);
    attempt.outcome = "succeeded";
    entry.attempts.push(attempt);

    const beats: Array<{ beatNumber: number }> = payload.storyboardBeats ?? [];
    const beatIndex = beats.findIndex((b) => b.beatNumber === entry.beatNumber);
    const clipUrls: string[] = claimed.clipUrlsJson ? JSON.parse(claimed.clipUrlsJson) : [];
    clipUrls[beatIndex] = newClipUrl;
    entry.newClipUrl = newClipUrl;
    entry.state = "ready_for_assembly";
    payload.repairs = [
      ...(payload.repairs ?? []),
      { beatNumber: entry.beatNumber, attempt: attemptNumber, findingCode: entry.instruction.code ?? null, previousClipUrl: entry.previousClipUrl, newClipUrl, repairedAt: new Date().toISOString(), logicalRepairId: entry.logicalRepairId },
    ];

    await d
      .update(reelJobs)
      .set({ clipUrlsJson: JSON.stringify(clipUrls), payload: JSON.stringify(payload), status: "assets_ready", attempts: 0, error: null })
      .where(eq(reelJobs.id, job.id));
    log.info("beat repair rendered — job handed to assembly", { jobId: job.id, beat: entry.beatNumber, attempt: attemptNumber });
    return { processed: true, jobId: job.id, status: "assets_ready" };
  } catch (err) {
    await failReservation(reservationId);
    attempt.error = err instanceof Error ? err.message.slice(0, 300) : String(err);
    entry.attempts.push(attempt);
    const exhausted = attemptNumber >= MAX_PROVIDER_ATTEMPTS;
    entry.state = exhausted ? "failed" : "queued";
    await d
      .update(reelJobs)
      .set({ status: exhausted ? "repair_failed" : "repair_queued", payload: JSON.stringify(payload), error: attempt.error })
      .where(eq(reelJobs.id, job.id));
    log.warn("repair provider attempt failed", { jobId: job.id, attempt: attemptNumber, exhausted });
    return { processed: true, jobId: job.id, status: exhausted ? "repair_failed" : "repair_queued", error: attempt.error };
  }
}
