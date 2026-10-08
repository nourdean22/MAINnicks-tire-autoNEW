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
  isDurationLaneId,
  isUnwiredExperimentId,
  type ArmObservation,
  type DurationLaneId,
  type ExperimentArm,
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
 * The key an episode's arm is derived from. MUST be the same key generation
 * resolves on (dailyReelPost → hookArmForEpisode(briefId); reelBriefGen →
 * durationLaneForEpisode(episodeKey)). Until 2026-10-01 enqueue recorded the
 * arm under `reel_job_<id>` while generation derived it from the brief id —
 * assignArm hashes the key, so the RECORDED arm disagreed with the GENERATED
 * arm on roughly half the episodes and the hook experiment measured noise.
 * The brief id wins when the caller has it; the job id is the fallback for
 * callers that never had a brief (none today, kept so nothing is unassigned).
 */
export function experimentEpisodeKey(reelJobId: number, briefId?: string | null): string {
  return briefId && briefId.trim() ? briefId.trim() : `reel_job_${reelJobId}`;
}

/**
 * Record a reel job in every experiment that will actually shape it.
 *
 * This is the pipeline's entry point, and it is deliberately a NO-OP when no
 * experiment is running, which is the default state. A failure here must never
 * take down a reel: an unassigned episode is a measurement gap, a thrown error
 * is a lost reel. Logged, swallowed, returns [].
 *
 * WHICH experiments: the oldest running one PER primary variable, which is
 * exactly the one generation applies (runningArmForEpisode). Until 2026-10-08
 * this recorded only the single oldest running experiment of any variable, so
 * with a hook test and a duration test both running, the newer one had its arm
 * applied to every Reel and recorded on none, and it could never conclude.
 * UNIQUE(experiment_id, episode_key) lets one episode sit in several.
 * Exposed presets are skipped: no generator applies their arm.
 */
export async function assignEpisodeToActiveExperiment(
  reelJobId: number,
  context: { franchiseId?: string; contentOrigin?: string; postingSlot?: string; provider?: string; model?: string; briefId?: string } = {},
): Promise<Array<{ experimentId: string; armId: string; variantValue: string }>> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return [];
    const { contentExperiments } = await import("../../drizzle/schema");
    const { eq, asc } = await import("drizzle-orm");
    const rows = (await d
      .select()
      .from(contentExperiments)
      .where(eq(contentExperiments.status, "running"))
      .orderBy(asc(contentExperiments.startedAt))) as unknown as Array<{
      experimentId: string; primaryVariable: string; objective: string; primaryMetric: string;
      armsJson: unknown; startedAt: Date;
    }>;

    const seenVariables = new Set<string>();
    const defs: ExperimentDefinition[] = [];
    for (const row of rows) {
      if (seenVariables.has(row.primaryVariable)) continue; // generation applies only the oldest per variable
      seenVariables.add(row.primaryVariable);
      if (isUnwiredExperimentId(row.experimentId)) continue;
      const arms = (Array.isArray(row.armsJson) ? row.armsJson : []) as ExperimentDefinition["arms"];
      if (arms.length < 2) continue;
      defs.push({
        experimentId: row.experimentId,
        primaryVariable: row.primaryVariable as ExperimentDefinition["primaryVariable"],
        objective: row.objective as ExperimentDefinition["objective"],
        primaryMetric: row.primaryMetric,
        arms,
        startedAt: new Date(row.startedAt).toISOString(),
      });
    }

    // The episode key must be STABLE for this job — assignment is derived from
    // it, so a changing key would re-roll the arm on every retry.
    const { briefId, ...rest } = context;
    const episodeKey = experimentEpisodeKey(reelJobId, briefId);
    const out: Array<{ experimentId: string; armId: string; variantValue: string }> = [];
    for (const def of defs) {
      const assigned = await assignEpisode(def, episodeKey, { reelJobId, ...rest });
      if (!assigned) continue;
      log.info("episode assigned to experiment", { reelJobId, experimentId: def.experimentId, arm: assigned.armId });
      out.push({ experimentId: def.experimentId, ...assigned });
    }
    return out;
  } catch (err) {
    // An unassigned episode is a measurement gap. A thrown error is a lost reel.
    log.warn("experiment assignment skipped (reel continues)", { reelJobId, err: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/**
 * Which opening-line arm this episode belongs to, resolved BEFORE generation.
 *
 * Returns "direct" for the treatment arm and undefined for control (or when no
 * hook experiment is running, which is the default). Deterministic on
 * episodeKey, so a regeneration or retry re-derives the SAME arm instead of
 * re-rolling — a re-roll would silently reassign an episode mid-experiment and
 * contaminate the comparison.
 *
 * Separate from assignEpisodeToActiveExperiment on purpose: that one runs at
 * enqueue and RECORDS an arm, which is all an observational study needs. Testing
 * a hook style is interventional — the arm has to reach the prompt, and by
 * enqueue the brief already exists.
 */
export async function hookArmForEpisode(episodeKey: string): Promise<"direct" | undefined> {
  const arm = await runningArmForEpisode("hook_style", episodeKey);
  return arm?.variantValue === "direct" ? "direct" : undefined;
}

/**
 * The arm this episode lands in for the oldest RUNNING experiment on one
 * primary variable — undefined when none is running (the default) or the
 * read fails (logged; the episode runs as control). Shared by the hook-style
 * reader above and the duration-lane reader below so the two interventional
 * lookups cannot derive an arm two different ways.
 */
async function runningArmForEpisode(
  primaryVariable: ExperimentDefinition["primaryVariable"],
  episodeKey: string,
): Promise<ExperimentArm | undefined> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return undefined;
    const { contentExperiments } = await import("../../drizzle/schema");
    const { and, eq, asc } = await import("drizzle-orm");
    const rows = await d
      .select()
      .from(contentExperiments)
      .where(and(eq(contentExperiments.status, "running"), eq(contentExperiments.primaryVariable, primaryVariable)))
      .orderBy(asc(contentExperiments.startedAt))
      .limit(1);
    if (!rows.length) return undefined;

    const row = rows[0] as unknown as { experimentId: string; primaryVariable: string; objective: string; primaryMetric: string; armsJson: unknown; startedAt: Date };
    const def: ExperimentDefinition = {
      experimentId: row.experimentId,
      primaryVariable,
      objective: row.objective as ExperimentDefinition["objective"],
      primaryMetric: row.primaryMetric,
      arms: (Array.isArray(row.armsJson) ? row.armsJson : []) as ExperimentDefinition["arms"],
      startedAt: new Date(row.startedAt).toISOString(),
    };
    if (def.arms.length < 2) return undefined;
    return assignArm(def, episodeKey);
  } catch (err) {
    log.warn("experiment arm lookup failed — treating as control", { primaryVariable, episodeKey, err: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

/**
 * Which DURATION lane this episode belongs to (duration_v1 preset), resolved
 * BEFORE generation the same way the hook arm is. Returns undefined when no
 * length_band experiment is running — the generator then keeps its default
 * target — or when the arm's lane id is not one DURATION_LANES declares, which
 * is logged rather than guessed at.
 */
export async function durationLaneForEpisode(episodeKey: string): Promise<DurationLaneId | undefined> {
  const arm = await runningArmForEpisode("length_band", episodeKey);
  if (!arm) return undefined;
  const lane = arm.lengthBand ?? arm.variantValue;
  if (isDurationLaneId(lane)) return lane;
  log.warn("length_band arm names no declared duration lane — generating at the default target", { episodeKey, armId: arm.armId, lane });
  return undefined;
}

/**
 * Every running experiment as a typed definition. Loader for the daily
 * resolver + the operator status surface — the row→def mapping the two
 * assignment readers inline for their single-experiment case.
 */
export async function loadRunningExperiments(): Promise<ExperimentDefinition[]> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return [];
  const { contentExperiments } = await import("../../drizzle/schema");
  const { eq, asc } = await import("drizzle-orm");
  const rows = await d
    .select()
    .from(contentExperiments)
    .where(eq(contentExperiments.status, "running"))
    .orderBy(asc(contentExperiments.startedAt));
  return (rows as unknown as Array<{
    experimentId: string; primaryVariable: string; objective: string; primaryMetric: string;
    armsJson: unknown; startedAt: Date;
  }>).map((row) => ({
    experimentId: row.experimentId,
    primaryVariable: row.primaryVariable as ExperimentDefinition["primaryVariable"],
    objective: row.objective as ExperimentDefinition["objective"],
    primaryMetric: row.primaryMetric,
    arms: (Array.isArray(row.armsJson) ? row.armsJson : []) as ExperimentDefinition["arms"],
    startedAt: new Date(row.startedAt).toISOString(),
  }));
}

/**
 * Publish-time attach for the reel lane, keyed by the reel job id the publish
 * site actually has in hand. `media_id IS NULL` makes it idempotent — a
 * republish or retry can never rewrite which media an episode was measured on.
 * Returns rows updated (0 = the job was never assigned to an experiment, the
 * default no-experiment state).
 */
export async function attachPublishedMediaForReelJob(
  reelJobId: number,
  mediaId: string,
  publishedAt: Date,
): Promise<number> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return 0;
  const { contentExperimentAssignments } = await import("../../drizzle/schema");
  const { and, eq, isNull } = await import("drizzle-orm");
  const [result] = await d.update(contentExperimentAssignments)
    .set({ mediaId, publishedAt })
    .where(and(
      eq(contentExperimentAssignments.reelJobId, reelJobId),
      isNull(contentExperimentAssignments.mediaId),
    ));
  const affected = (result as { affectedRows?: number })?.affectedRows ?? 0;
  if (affected > 0) log.info("published media attached to experiment", { reelJobId, mediaId, rows: affected });
  return affected;
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
  metric: "shares" | "saved" | "views" | "reach" | "avgWatchTimeMs" | "skipRate",
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
      // skip_rate is a DECIMAL column, which mysql2 returns as a STRING
      // ("83.6000"). Reading only numbers made every skip rate "not reported",
      // so no hook experiment could ever be judged on the metric hooks move.
      // A numeric string is a number; anything else stays null, never 0.
      const value = typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
      out.push({
        armId: a.armId,
        mediaId: a.mediaId,
        horizonHours,
        reach: typeof s.reach === "number" ? s.reach : null,
        metricValue: value,
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
  metric: "shares" | "saved" | "views" | "reach" | "avgWatchTimeMs" | "skipRate",
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
