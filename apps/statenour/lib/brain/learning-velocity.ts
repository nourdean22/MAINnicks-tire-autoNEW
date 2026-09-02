/**
 * Learning Velocity Dashboard
 *
 * Reads how the brain is changing. Every field names the window it was
 * computed over, because the previous shape did not and the labels lied:
 *
 *   - memoriesCreated    7d vs the prior 7d
 *   - memoryGrowth30d    30d vs the prior 30d. The ONLY change-over-30-days
 *                        number here, and the only one a "vs 30d" label may
 *                        cite.
 *   - wisdomCreated      wisdom ROWS CREATED (not promoted -- see the field)
 *   - predictionAccuracy all-time level + a coarse older/newer trend
 *   - causalChains       all-time total + a 30d slice, never one number
 *   - contradictions     all-time + 30d + a rate that is null when unrateable
 *   - connections        all-time total + a 30d slice
 *   - healthScore/Max    a LEVEL, out of a max that SHRINKS when a dimension
 *                        is unmeasured, so an unmeasured dimension cannot pay
 *
 * ---------------------------------------------------------------------------
 * 2026-09-02 - metrics-honesty pass. Three numbers were DELETED rather than
 * repaired, because no honest computation backed the words on screen.
 *
 * 1. `overallGrowth`. Rendered at memory-tab.tsx as "brain +N% vs 30d ago"
 *    and declared here as "percentage smarter vs 30 days ago". Of its five
 *    terms, three were all-time LEVELS (wisdom density, prediction accuracy,
 *    contradiction resolution) and one compared week 1 to week 2. Nothing in
 *    it looked back 30 days. Worked floor for a brain that learned nothing
 *    for a month: resolutionRate paid 15, predictionRate 0.5 paid 12.5, plus
 *    wisdom density -- about +28%.
 *
 *    It is not repaired because there is no 30-day baseline to repair it
 *    against. The `learning_velocity` snapshot rows written below store a
 *    prose sentence, not structured fields, and this repo has already been
 *    burned once mining prose for signal (the push-watchdog prose-parser
 *    blindness, PR #1743). Inventing a computation to justify the existing
 *    words is exactly the failure this pass exists to remove, so the
 *    composite is gone: `memoryGrowth30d` carries the 30d headline as a real
 *    30d-over-30d change, and the level is reported as a level in
 *    `healthScore`.
 *
 * 2. `confidenceDelta`, and the two full-table `brain_memories` aggregates
 *    that fed it. It subtracted the mean confidence of rows created BEFORE
 *    30d from the mean confidence of ALL live rows -- a superset minus its
 *    own subset, never two disjoint windows, so its sign was just a
 *    restatement of where the newer rows sat. `Math.max(0, delta * 50)` then
 *    clamped it, making falling confidence and flat confidence contribute
 *    an identical 0. A one-way ratchet over a cohort comparison is not a
 *    trend, and no label could have made it one.
 *
 * 3. The `resolutionRate = 1` fallback for an empty Contradiction table.
 *    "Never contradicted myself" scored identically to "found and resolved
 *    every contradiction", and collected 15 of 100 health points for it.
 *    The rate is now `null` when there is nothing to rate, and a null
 *    dimension leaves `healthScoreMax` instead of scoring free. The same
 *    shape in the prediction factor (5 points for zero predictions) is
 *    fixed the same way.
 *
 * Also corrected here: the Contradiction counts did not filter `deletedAt`,
 * so dismissed contradictions (soft-deleted since Wave F, 2026-05-23) still
 * inflated the resolution-rate denominator -- a dismissed row is not an
 * unresolved one, and counting it made self-correction look worse than it
 * was. Both counts now filter `deletedAt: null` like every other consumer.
 *
 * READS DO NOT WRITE. `measureLearningVelocity()` is pure-read. The daily
 * snapshot row lives in `snapshotLearningVelocity()` below -- see its header.
 */

import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/learning-velocity");

export interface LearningVelocity {
  /**
   * The 7-day window that `memoriesCreated.thisWeek` covers. Every other
   * field carries its own window in its NAME -- this string describes the
   * weekly pair only, and must not be read as the digest's window.
   */
  period: string;
  memoriesCreated: { thisWeek: number; lastWeek: number; delta: number };
  /**
   * Memories created in the last 30 days vs the 30 days before that. The
   * only genuine change-over-30-days measure in this digest.
   */
  memoryGrowth30d: {
    last30d: number;
    prior30d: number;
    /**
     * Rounded percent change vs the prior 30-day window. `null` when
     * `prior30d === 0`: a ratio against zero is undefined, and this repo
     * prefers an explicit unknown over a fabricated number. Consumers MUST
     * render the null state as unknown, never as 0.
     */
    pctChange: number | null;
  };
  /**
   * Wisdom rows CREATED in the window -- a plain count over the `wisdom`
   * category. This is NOT the promotion path: real promotions stamp
   * `metadata.promotedFromCandidate` in
   * `lib/services/brain-wisdom.ts` (promote branch). A distiller cron run or
   * a batch of chat scrapes lands here too, so the field is named for what
   * it counts. Was `wisdomPromotions` while the header claimed "Wisdom
   * promotions (knowledge maturity)" -- it never measured maturity.
   */
  wisdomCreated: { total: number; last30d: number };
  predictionAccuracy: {
    confirmed: number;
    disproven: number;
    /** confirmed / resolved, all-time. `null` when nothing has resolved. */
    rate: number | null;
    trend: string;
  };
  causalChains: { total: number; last30d: number };
  contradictions: {
    /** Lifetime resolved count. Only goes up -- never label this a velocity. */
    resolvedAllTime: number;
    /**
     * Resolved within the last 30 days, keyed on `updatedAt`. Contradiction
     * has no `resolvedAt` column; `updatedAt` is written when `resolved`
     * flips, so it is the closest available proxy. A resolved row edited
     * again later re-enters the window -- documented imprecision, not a
     * lifetime total pretending to be a 30d one.
     */
    resolvedLast30d: number;
    unresolved: number;
    /**
     * resolvedAllTime / (resolvedAllTime + unresolved), excluding dismissed
     * rows. `null` when the table is empty for this operator: there is no
     * self-correction rate when there has been nothing to correct.
     */
    resolutionRate: number | null;
  };
  connections: { total: number; last30d: number };
  /**
   * 0-`healthScoreMax` LEVEL. Not a change, not a growth rate, and not
   * comparable across runs where `healthScoreMax` differs.
   */
  healthScore: number;
  /**
   * The maximum `healthScore` could have reached THIS run. Below 100 when a
   * dimension was unmeasurable (no predictions yet, no contradictions yet).
   * Render it: "78/85" is honest where "78/100" silently charges the brain
   * for data it was never given.
   */
  healthScoreMax: number;
}

/**
 * Measure learning velocity. Pure read -- no writes, no upserts.
 */
export async function measureLearningVelocity(): Promise<LearningVelocity> {
  const sevenDaysAgo = daysAgo(7);
  const fourteenDaysAgo = daysAgo(14);
  const thirtyDaysAgo = daysAgo(30);
  const sixtyDaysAgo = daysAgo(60);

  const [
    memoriesThisWeek,
    memoriesLastWeek,
    memoriesLast30d,
    memoriesPrior30d,
    totalWisdom,
    wisdomLast30d,
    confirmedPredictions,
    disprovenPredictions,
    olderConfirmed,
    olderDisproven,
    totalChains,
    chainsLast30d,
    contradictionsResolvedAllTime,
    contradictionsResolvedLast30d,
    contradictionsUnresolved,
    totalEdges,
    edgesLast30d,
    totalMemories,
  ] = await Promise.all([
    prisma.brainMemory.count({ where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } } }),
    prisma.brainMemory.count({
      where: { deletedAt: null, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
    }),
    prisma.brainMemory.count({ where: { deletedAt: null, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.brainMemory.count({
      where: { deletedAt: null, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
    }),
    prisma.brainMemory.count({ where: { deletedAt: null, category: BRAIN_CATEGORIES.WISDOM } }),
    prisma.brainMemory.count({
      where: { deletedAt: null, category: BRAIN_CATEGORIES.WISDOM, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.prediction.count({ where: { status: "confirmed" } }),
    prisma.prediction.count({ where: { status: "disproven" } }),
    prisma.prediction.count({
      where: { status: "confirmed", createdAt: { lt: thirtyDaysAgo } },
    }),
    prisma.prediction.count({
      where: { status: "disproven", createdAt: { lt: thirtyDaysAgo } },
    }),
    prisma.causalChain.count(),
    prisma.causalChain.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    // Both contradiction counts filter deletedAt: a DISMISSED contradiction
    // is neither resolved nor outstanding, and leaving it in the denominator
    // understated self-correction.
    prisma.contradiction.count({ where: { deletedAt: null, resolved: true } }),
    prisma.contradiction.count({
      where: { deletedAt: null, resolved: true, updatedAt: { gte: thirtyDaysAgo } },
    }),
    prisma.contradiction.count({ where: { deletedAt: null, resolved: false } }),
    prisma.memoryEdge.count(),
    prisma.memoryEdge.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.brainMemory.count({ where: { deletedAt: null } }),
  ]);

  // Memory growth -- a real 30d-over-30d change. Undefined against an empty
  // prior window, and undefined is reported as null rather than smoothed to 0.
  const memoryPctChange30d =
    memoriesPrior30d === 0
      ? null
      : Math.round(((memoriesLast30d - memoriesPrior30d) / memoriesPrior30d) * 100);

  // Prediction accuracy -- an all-time LEVEL, not a window.
  const totalPredictions = confirmedPredictions + disprovenPredictions;
  const predictionRate = totalPredictions > 0 ? confirmedPredictions / totalPredictions : null;

  const olderTotal = olderConfirmed + olderDisproven;
  const olderRate = olderTotal > 0 ? olderConfirmed / olderTotal : 0;
  const predictionTrend =
    totalPredictions < 3 || predictionRate === null
      ? "insufficient data"
      : predictionRate > olderRate + 0.05
        ? "improving"
        : predictionRate < olderRate - 0.05
          ? "declining"
          : "stable";

  // Contradiction resolution. null, NOT 1, when there is nothing to rate.
  const totalContradictions = contradictionsResolvedAllTime + contradictionsUnresolved;
  const resolutionRate =
    totalContradictions > 0 ? contradictionsResolvedAllTime / totalContradictions : null;

  // Health score. `points: null` marks a dimension we could not measure --
  // it forfeits its points AND its share of the max, so an absent dimension
  // neither pays out nor counts against the brain.
  const healthFactors: Array<{ name: string; points: number | null; max: number }> = [
    { name: "memory_volume", points: Math.min(totalMemories, 20), max: 20 },
    { name: "wisdom_exists", points: totalWisdom > 0 ? 15 : 0, max: 15 },
    {
      name: "prediction_accuracy",
      points:
        predictionRate === null ? null : predictionRate > 0.5 ? 15 : predictionRate > 0.3 ? 10 : 5,
      max: 15,
    },
    {
      name: "self_correction",
      points: resolutionRate === null ? null : resolutionRate > 0.5 ? 15 : 5,
      max: 15,
    },
    { name: "connected_knowledge", points: Math.min(totalEdges, 15), max: 15 },
    { name: "actively_growing", points: memoriesThisWeek > 0 ? 10 : 0, max: 10 },
    { name: "wisdom_recent", points: wisdomLast30d > 0 ? 10 : 0, max: 10 },
  ];
  const healthScoreMax = healthFactors.reduce((s, f) => s + (f.points === null ? 0 : f.max), 0);
  const healthScore = Math.min(
    healthScoreMax,
    healthFactors.reduce((s, f) => s + (f.points ?? 0), 0),
  );

  return {
    period: `${sevenDaysAgo.toISOString().slice(0, 10)} to ${new Date().toISOString().slice(0, 10)}`,
    memoriesCreated: {
      thisWeek: memoriesThisWeek,
      lastWeek: memoriesLastWeek,
      delta: memoriesThisWeek - memoriesLastWeek,
    },
    memoryGrowth30d: {
      last30d: memoriesLast30d,
      prior30d: memoriesPrior30d,
      pctChange: memoryPctChange30d,
    },
    wisdomCreated: { total: totalWisdom, last30d: wisdomLast30d },
    predictionAccuracy: {
      confirmed: confirmedPredictions,
      disproven: disprovenPredictions,
      rate: predictionRate,
      trend: predictionTrend,
    },
    causalChains: { total: totalChains, last30d: chainsLast30d },
    contradictions: {
      resolvedAllTime: contradictionsResolvedAllTime,
      resolvedLast30d: contradictionsResolvedLast30d,
      unresolved: contradictionsUnresolved,
      resolutionRate,
    },
    connections: { total: totalEdges, last30d: edgesLast30d },
    healthScore,
    healthScoreMax,
  };
}

/**
 * Measure AND persist the daily snapshot row.
 *
 * The upsert used to live at the bottom of `measureLearningVelocity()`, which
 * made every /brain Memory-tab render write to the database: the tRPC
 * `journal.learningVelocity` QUERY called it, so viewing a dashboard mutated
 * state. It was also wrapped in `.catch(() => {})`, so the write's failure was
 * invisible -- under the Neon read-only lock this repo hit on 2026-08-19 (PG
 * 25006, every write silently no-oped) the snapshot would have stopped for
 * days with nothing to show for it.
 *
 * A read must not write, so the write moved here, and this is called from the
 * nightly `/api/cron/intelligence` fan-out -- a cron is where a once-a-day
 * snapshot belongs, and it already records per-engine outcomes. The failure is
 * logged at ERROR and reported in the return value; the measurement still
 * comes back, because losing today's reading on top of losing today's write
 * helps nobody.
 */
export async function snapshotLearningVelocity(): Promise<{
  velocity: LearningVelocity;
  snapshotWritten: boolean;
}> {
  const velocity = await measureLearningVelocity();

  const key = `velocity_${new Date().toISOString().slice(0, 10)}`;
  const pct = velocity.memoryGrowth30d.pctChange;
  const rate = velocity.predictionAccuracy.rate;
  const arrow =
    velocity.memoriesCreated.delta > 0 ? "↑" : velocity.memoriesCreated.delta < 0 ? "↓" : "→";
  const content =
    `Brain health: ${velocity.healthScore}/${velocity.healthScoreMax} | ` +
    `Memories 30d: ${velocity.memoryGrowth30d.last30d} vs ${velocity.memoryGrowth30d.prior30d} prior ` +
    `(${pct === null ? "no prior window" : `${pct > 0 ? "+" : ""}${pct}%`}) | ` +
    `Memories: ${velocity.memoriesCreated.thisWeek}/wk (${arrow}) | ` +
    `Wisdom rows: ${velocity.wisdomCreated.total} | ` +
    `Predictions: ${rate === null ? "none resolved" : `${(rate * 100).toFixed(0)}% accurate`} ` +
    `(${velocity.predictionAccuracy.trend}) | Chains: ${velocity.causalChains.total}`;

  try {
    await prisma.brainMemory.upsert({
      where: {
        category_key: { category: BRAIN_CATEGORIES.LEARNING_VELOCITY, key },
      },
      create: {
        category: BRAIN_CATEGORIES.LEARNING_VELOCITY,
        key,
        content,
        confidence: 0.9,
        source: "learning_velocity",
      },
      update: { content, confidence: 0.9 },
    });
    return { velocity, snapshotWritten: true };
  } catch (err) {
    log.error("velocity_snapshot_write_failed", {
      key,
      err: err instanceof Error ? err.message : String(err),
    });
    return { velocity, snapshotWritten: false };
  }
}
