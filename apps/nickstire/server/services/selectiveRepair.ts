/**
 * Selective repair — Long Haul milestone 9 (ledger: selective-repair).
 *
 * Consumes a rendered-QA verdict and regenerates EXACTLY the failing beat:
 *
 *   verdict finding (beatNumber + preserve/change)
 *   → policy boundary (enqueue_render, repair cap enforced from the job's
 *     own repair history) + ledger reservation (1 clip)
 *   → repair prompt = the beat's ORIGINAL prompt + a REPAIR block compiled
 *     from the finding (deterministic)
 *   → one provider clip
 *   → clipUrls[beatIndex] replaced — every accepted clip untouched
 *   → status flips to assets_ready so the EXISTING assembly worker
 *     re-assembles from accepted + repaired clips (no new assembly path)
 *   → repair recorded in the payload (attempt, code, previous clip, cost)
 *
 * Never regenerates the whole package because one component failed.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:selective-repair");

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

export interface RepairRecord {
  beatNumber: number;
  attempt: number;
  findingCode: string | null;
  previousClipUrl: string | null;
  newClipUrl: string;
  repairedAt: string;
}

export interface RepairResult {
  jobId: number;
  beatNumber: number;
  attempt: number;
  newClipUrl: string;
  status: "assets_ready";
}

/**
 * Repair one beat of an assembled/assets_ready job. Operator-initiated
 * (actor operator at the policy boundary). Throws with a clear reason on
 * cap/missing-state; the job is never left in a broken intermediate state —
 * clip replacement and status flip happen in one update after the provider
 * call succeeds.
 */
export async function repairReelBeat(input: {
  jobId: number;
  beatNumber: number;
  instruction?: RepairInstruction;
}): Promise<RepairResult> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("DB not available");
  const { reelJobs } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, input.jobId)).limit(1);
  if (!job) throw new Error(`job ${input.jobId} not found`);
  if (!["assembled", "assets_ready"].includes(job.status)) {
    throw new Error(`job ${input.jobId} is ${job.status} — repair needs assembled or assets_ready`);
  }
  const payload = JSON.parse(job.payload ?? "{}");
  const beats: Array<{ beatNumber: number }> = payload.storyboardBeats ?? [];
  const beatIndex = beats.findIndex((b) => b.beatNumber === input.beatNumber);
  if (beatIndex < 0) throw new Error(`beat ${input.beatNumber} not in job ${input.jobId}`);
  const clipUrls: string[] = job.clipUrlsJson ? JSON.parse(job.clipUrlsJson) : [];
  if (clipUrls.length !== beats.length) {
    throw new Error(`job ${input.jobId} has ${clipUrls.length} clips for ${beats.length} beats — repair needs a complete clip set`);
  }
  const pack: Array<{ beatNumber: number; prompt: string; negativePrompt?: string }> = payload.promptPack ?? payload.higgsfieldPromptPack ?? [];
  const beatPrompt = pack.find((p) => p.beatNumber === input.beatNumber);
  if (!beatPrompt) throw new Error(`no prompt for beat ${input.beatNumber} in job ${input.jobId}`);

  // Instruction: explicit > the QA verdict's finding for this beat > minimal.
  const verdictFinding = (payload.renderedQa?.findings ?? []).find(
    (f: { beatNumber: number | null }) => f.beatNumber === input.beatNumber,
  );
  const instruction: RepairInstruction = input.instruction ?? {
    code: verdictFinding?.code,
    description: verdictFinding?.description,
    preserve: verdictFinding?.preserve ?? [],
    change: verdictFinding?.change ?? [],
  };

  const priorRepairs: RepairRecord[] = payload.repairs ?? [];
  const attempt = priorRepairs.filter((r) => r.beatNumber === input.beatNumber).length + 1;

  // Policy boundary: repair spend is render spend, and the repair cap is
  // enforced from the JOB'S OWN history — the caller cannot undercount.
  const { enforceAtBoundary } = await import("./autonomyControl");
  const { COST_ESTIMATES_USD, reserve, settle, fail: failReservation } = await import("./generationLedger");
  await enforceAtBoundary(
    {
      type: "enqueue_render",
      format: "reel",
      estimatedCostUsd: COST_ESTIMATES_USD.seedance_clip,
      today: { repairAttemptsForAsset: priorRepairs.length },
    },
    { type: "operator", id: `repair_job_${input.jobId}` },
    payload.genomeId ?? null,
  );
  const actionId = `repair_${input.jobId}_beat${input.beatNumber}_a${attempt}`;
  const { getActivePolicy } = await import("./autonomyControl");
  const policy = await getActivePolicy();
  await reserve({
    actionId,
    campaignId: payload.genomeId ?? null,
    provider: "higgsfield",
    model: "seedance1_5",
    operation: "beat_repair",
    estimatedCostUsd: COST_ESTIMATES_USD.seedance_clip,
    dailyBudgetUsd: policy.limits.maxGenerationCostPerDayUsd,
  });

  let newClipUrl: string;
  try {
    const { generateReelClipVideo } = await import("./higgsfieldStudio");
    newClipUrl = await generateReelClipVideo({
      prompt: buildRepairPrompt(beatPrompt.prompt, instruction),
      negativePrompt: beatPrompt.negativePrompt,
    });
  } catch (err) {
    await failReservation(actionId);
    throw err;
  }
  await settle(actionId, COST_ESTIMATES_USD.seedance_clip);

  const previousClipUrl = clipUrls[beatIndex] ?? null;
  const nextClips = [...clipUrls];
  nextClips[beatIndex] = newClipUrl;
  const record: RepairRecord = {
    beatNumber: input.beatNumber,
    attempt,
    findingCode: instruction.code ?? null,
    previousClipUrl,
    newClipUrl,
    repairedAt: new Date().toISOString(),
  };
  payload.repairs = [...priorRepairs, record];
  // Stale QA verdict no longer describes the current clips — clear it so the
  // next QA pass judges the repaired render, not the rejected one.
  if (payload.renderedQa) payload.renderedQa = { ...payload.renderedQa, staleAfterRepair: true };

  await d
    .update(reelJobs)
    .set({
      clipUrlsJson: JSON.stringify(nextClips),
      payload: JSON.stringify(payload),
      status: "assets_ready", // existing assembly worker re-assembles
      attempts: 0,
      error: null,
    })
    .where(eq(reelJobs.id, input.jobId));

  log.info("beat repaired — job returned to assembly", {
    jobId: input.jobId,
    beat: input.beatNumber,
    attempt,
    code: instruction.code ?? "(manual)",
  });
  return { jobId: input.jobId, beatNumber: input.beatNumber, attempt, newClipUrl, status: "assets_ready" };
}
