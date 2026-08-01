/**
 * Persistence for the content experiment registry (tables from 0108).
 *
 * The evaluator in shared/contentExperiments.ts is pure and already decides
 * correctly. This is the half that makes it REMEMBER: assignment, media
 * attachment, observation gathering, and a persisted verdict.
 *
 * Two properties this layer must not lose:
 *
 *  · ASSIGNMENT IS IDEMPOTENT. The arm is derived deterministically from the
 *    episode key, and the insert is ON DUPLICATE KEY UPDATE against
 *    UNIQUE(experiment_id, episode_key). A retry re-derives the same arm and
 *    writes nothing new. Without both halves a re-run could move an episode
 *    between arms mid-experiment and silently invalidate the result.
 *
 *  · REFUSALS ARE PERSISTED. `insufficient_data`, `no_signal` and
 *    `invalid_design` are written to verdict_status exactly like a winner. A
 *    refusal is a result — discard it and the next evaluation re-decides a
 *    question that was already answered "not yet", which is how a system talks
 *    itself into a conclusion over enough runs.
 */
import { createLogger } from "../lib/logger";
import {
  assignArm,
  evaluateExperiment,
  horizonForSnapshot,
  type ArmObservation,
  type ExperimentDefinition,
  type ExperimentVerdict,
} from "../../shared/contentExperiments";

const log = createLogger("services:content-experiments");

export async function startExperiment(def: ExperimentDefinition): Promise<boolean> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return false;
  const { contentExperiments } = await import("../../drizzle/schema");
  await d.insert(contentExperiments).values({
    experimentId: def.experimentId,
    primaryVariable: def.primaryVariable,
    objective: def.objective,
    primaryMetric: def.primaryMetric,
    armsJson: def.arms,
    status: "running",
  }).onDuplicateKeyUpdate({ set: { armsJson: def.arms } });
  log.info("experiment started", { experimentId: def.experimentId, variable: def.primaryVariable, arms: def.arms.length });
  return true;
}

/**
 * Place an episode in an arm. Safe to call repeatedly — the arm is re-derived,
 * not re-rolled, and the unique key absorbs the duplicate.
 */
export async function assignEpisode(
  def: ExperimentDefinition,
  episodeKey: string,
  context: {
    reelJobId?: number;
    franchiseId?: string;
    contentOrigin?: string;
    postingSlot?: string;
    provider?: string;
    model?: string;
    promptVersion?: string;
  } = {},
): Promise<{ armId: string; variantValue: string } | null> {
  const arm = assignArm(def, episodeKey);
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return null;
  const { contentExperimentAssignments } = await import("../../drizzle/schema");
  await d.insert(contentExperimentAssignments).values({
    experimentId: def.experimentId,
    armId: arm.armId,
    episodeKey,
    reelJobId: context.reelJobId ?? null,
    franchiseId: context.franchiseId ?? arm.franchiseId ?? null,
    ctaType: arm.ctaType ?? null,
    contentOrigin: context.contentOrigin ?? arm.contentOrigin ?? null,
    postingSlot: context.postingSlot ?? arm.postingSlot ?? null,
    provider: context.provider ?? arm.provider ?? null,
    model: context.model ?? arm.model ?? null,
    promptVersion: context.promptVersion ?? arm.promptVersion ?? null,
    // Re-assert the SAME arm on conflict. This is a no-op by construction and
    // exists so a retry cannot rewrite the arm to a different value.
  }).onDuplicateKeyUpdate({ set: { armId: arm.armId } });
  return { armId: arm.armId, variantValue: arm.variantValue };
}

/**
 * Assign a reel job to whichever experiment is currently RUNNING, if any.
 *
 * This is the pipeline's entry point, and it is deliberately a NO-OP when no
 * experiment is running — which is the default state. Wiring it in therefore
 * changes nothing until an operator starts an experiment, and a failure here
 * must never take down a reel: an unassigned episode is a measurement gap, a
 * thrown error is a lost reel. Logged, swallowed, returns null.
 *
 * Picks the OLDEST running experiment so two overlapping ones cannot silently
 * fight over the same episode.
 */
export async function assignEpisodeToActiveExperiment(
  reelJobId: number,
  context: { franchiseId?: string; contentOrigin?: string; postingSlot?: string; provider?: string; model?: string } = {},
): Promise<{ experimentId: string; armId: string; variantValue: string } | null> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return null;
    const { contentExperiments } = await import("../../drizzle/schema");
    const { eq, asc } = await import("drizzle-orm");
    const rows = await d
      .select()
      .from(contentExperiments)
      .where(eq(contentExperiments.status, "running"))
      .orderBy(asc(contentExperiments.startedAt))
      .limit(1);
    if (!rows.length) return null;

    const row = rows[0] as unknown as {
      experimentId: string; primaryVariable: string; objective: string; primaryMetric: string;
      armsJson: unknown; startedAt: Date;
    };
    const def: ExperimentDefinition = {
      experimentId: row.experimentId,
      primaryVariable: row.primaryVariable as ExperimentDefinition["primaryVariable"],
      objective: row.objective as ExperimentDefinition["objective"],
      primaryMetric: row.primaryMetric,
      arms: (Array.isArray(row.armsJson) ? row.armsJson : []) as ExperimentDefinition["arms"],
      startedAt: new Date(row.startedAt).toISOString(),
    };
    if (def.arms.length < 2) return null;

    // The episode key must be STABLE for this job — assignment is derived from
    // it, so a changing key would re-roll the arm on every retry.
    const assigned = await assignEpisode(def, `reel_job_${reelJobId}`, { reelJobId, ...context });
    if (!assigned) return null;
    log.info("episode assigned to experiment", { reelJobId, experimentId: def.experimentId, arm: assigned.armId });
    return { experimentId: def.experimentId, ...assigned };
  } catch (err) {
    // An unassigned episode is a measurement gap. A thrown error is a lost reel.
    log.warn("experiment assignment skipped (reel continues)", { reelJobId, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Attach the published media id + time, which is what makes the episode
 *  measurable — a horizon cannot be derived without a publish timestamp. */
export async function attachPublishedMedia(
  experimentId: string,
  episodeKey: string,
  mediaId: string,
  publishedAt: Date,
): Promise<void> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return;
  const { contentExperimentAssignments } = await import("../../drizzle/schema");
  const { and, eq } = await import("drizzle-orm");
  await d.update(contentExperimentAssignments)
    .set({ mediaId, publishedAt })
    .where(and(
      eq(contentExperimentAssignments.experimentId, experimentId),
      eq(contentExperimentAssignments.episodeKey, episodeKey),
    ));
}

/**
 * Turn append-only snapshots into arm observations at one horizon.
 *
 * The metric is read by NAME so the same gatherer serves every objective. A
 * metric the snapshot does not carry yields `null`, which the evaluator treats
 * as NOT REPORTED and excludes — it is never coerced to zero.
 */
export async function gatherObservations(
  experimentId: string,
  metric: "shares" | "saved" | "views" | "reach" | "avgWatchTimeMs",
  horizonHours: 24 | 72 | 168,
): Promise<ArmObservation[]> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return [];
  const { contentExperimentAssignments, igMetricSnapshots } = await import("../../drizzle/schema");
  const { eq, isNotNull, and } = await import("drizzle-orm");

  const assignments = await d
    .select({
      armId: contentExperimentAssignments.armId,
      mediaId: contentExperimentAssignments.mediaId,
      publishedAt: contentExperimentAssignments.publishedAt,
    })
    .from(contentExperimentAssignments)
    .where(and(
      eq(contentExperimentAssignments.experimentId, experimentId),
      isNotNull(contentExperimentAssignments.mediaId),
    ));

  const out: ArmObservation[] = [];
  for (const a of assignments as Array<{ armId: string; mediaId: string | null; publishedAt: Date | null }>) {
    if (!a.mediaId || !a.publishedAt) continue;
    const snaps = await d
      .select()
      .from(igMetricSnapshots)
      .where(eq(igMetricSnapshots.postId, a.mediaId));
    // Pick the snapshot whose DERIVED horizon matches. Snapshots outside every
    // window are skipped rather than snapped to the nearest one, which would
    // compare a 5-hour reading against a 24-hour one.
    for (const s of snaps as Array<Record<string, unknown>>) {
      const capturedAt = s.capturedAt as Date | null;
      if (!capturedAt) continue;
      if (horizonForSnapshot(a.publishedAt, capturedAt) !== horizonHours) continue;
      const raw = s[metric];
      out.push({
        armId: a.armId,
        mediaId: a.mediaId,
        horizonHours,
        reach: typeof s.reach === "number" ? s.reach : null,
        metricValue: typeof raw === "number" ? raw : null,
      });
      break;
    }
  }
  return out;
}

/**
 * Evaluate and PERSIST — including the refusals. `concludeExperiment` only
 * flips status to "concluded" on a decisive verdict; a refusal is recorded but
 * leaves the experiment running, because "not yet" is not "done".
 */
export async function recordVerdict(
  def: ExperimentDefinition,
  metric: "shares" | "saved" | "views" | "reach" | "avgWatchTimeMs",
  horizonHours: 24 | 72 | 168 = 72,
): Promise<ExperimentVerdict | null> {
  const observations = await gatherObservations(def.experimentId, metric, horizonHours);
  const verdict = evaluateExperiment(def, observations, horizonHours);

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return verdict;
  const { contentExperiments } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const decisive = verdict.status === "winner" || verdict.status === "tie";
  await d.update(contentExperiments)
    .set({
      verdictStatus: verdict.status,
      verdictNote: "note" in verdict ? verdict.note : null,
      ...(decisive ? { status: "concluded", concludedAt: new Date() } : {}),
    })
    .where(eq(contentExperiments.experimentId, def.experimentId));

  log.info("experiment verdict recorded", {
    experimentId: def.experimentId,
    status: verdict.status,
    decisive,
    observations: observations.length,
  });
  return verdict;
}
