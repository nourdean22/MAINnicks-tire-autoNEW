/**
 * Pattern Lab, finally connected to generation.
 *
 * `social_reel_patterns` stores short-form STRUCTURE: operator-captured
 * references plus clearly labeled Nick's house hypotheses when the lab has
 * never been populated. Nothing in this layer claims a hypothesis is a winner.
 * This is the read half: pick a pattern by rotation, hand it to brief
 * generation, and RECORD that it was used.
 *
 * The recording is the point as much as the picking. `timesUsed`/`lastUsedAt`
 * existed from the start and were never incremented, and there is no
 * pattern -> outcome link anywhere, so nothing could ever learn which captured
 * structure actually worked. Stamping the pattern id onto the brief — which
 * lands in `reel_jobs.payload` — creates the join that a later pass can run
 * against ig_metric_snapshots. Until then this rotates rather than pretending
 * to rank.
 *
 * Degrades to null, never throws: a missing structure hint must reduce the
 * brief to what it was yesterday, not fail the run.
 */
import { desc, inArray, isNotNull } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { db } from "../lib/db-helper";
import { igMetricSnapshots, reelJobs, socialReelPatterns } from "../../drizzle/schema";
import { type RotatablePattern } from "@shared/reelStructureRotation";
import { parseReelJobPayload } from "@shared/reelJobPayload";
import {
  rankPatternsByDistribution,
  selectLearnedPattern,
  type PatternPerformanceRow,
} from "@shared/reelStructureLearning";

const log = createLogger("reel-structure-prior");

export interface StructureHint {
  patternId: string;
  label: string;
  hookType: string;
  loopType: string;
  /** The full ReelPattern JSON as captured, for the generator to read. */
  pattern: unknown;
}

async function measuredPatternOutcomes(): Promise<PatternPerformanceRow[]> {
  try {
    const database = await db();
    if (!database) return [];

    const jobs = await database
      .select({ payload: reelJobs.payload, postId: reelJobs.igPostId })
      .from(reelJobs)
      .where(andPublished())
      .orderBy(desc(reelJobs.updatedAt))
      .limit(500);

    const lineage: Array<{ patternId: string; postId: string }> = [];
    for (const job of jobs as Array<{ payload: string | null; postId: string | null }>) {
      const patternId = parseReelJobPayload(job.payload).structurePatternId;
      if (patternId && job.postId) lineage.push({ patternId, postId: job.postId });
    }
    if (!lineage.length) return [];

    const postIds: string[] = Array.from(new Set(lineage.map((x) => x.postId))).slice(0, 500);
    const snaps = await database
      .select({
        postId: igMetricSnapshots.postId,
        reach: igMetricSnapshots.reach,
        saved: igMetricSnapshots.saved,
        shares: igMetricSnapshots.shares,
        views: igMetricSnapshots.views,
        avgWatchTimeMs: igMetricSnapshots.avgWatchTimeMs,
        skipRate: igMetricSnapshots.skipRate,
        capturedAt: igMetricSnapshots.capturedAt,
      })
      .from(igMetricSnapshots)
      .where(inArray(igMetricSnapshots.postId, postIds))
      .orderBy(desc(igMetricSnapshots.capturedAt))
      .limit(2500);

    const newest = new Map<string, typeof snaps[number]>();
    for (const snap of snaps) if (!newest.has(snap.postId)) newest.set(snap.postId, snap);

    const measured: PatternPerformanceRow[] = [];
    for (const { patternId, postId } of lineage) {
      const m = newest.get(postId);
      if (!m) continue;
      measured.push({
        patternId,
        themes: [],
        reach: m.reach,
        saved: m.saved,
        shares: m.shares,
        views: m.views,
        avgWatchTimeMs: m.avgWatchTimeMs,
        skipRate: m.skipRate == null ? null : Number(m.skipRate),
      });
    }
    return measured;
  } catch (err) {
    log.warn("pattern outcome evidence unavailable; rotation remains active", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Keep the TiDB predicate in one helper so a future status vocabulary change
 * does not silently make the learning query disagree with the publisher. */
function andPublished() {
  return isNotNull(reelJobs.igPostId);
}

/**
 * Choose the next structure. `excludeHookTypes` lets a caller avoid repeating
 * the hook shape of the immediately previous reel.
 */
export async function pickStructureHint(
  opts: { excludeHookTypes?: string[] } = {},
): Promise<StructureHint | null> {
  try {
    const database = await db();
    if (!database) return null;

    // Explicit row type: db-helper's client is loosely typed here, so an
    // untyped mapper would let a renamed column through as undefined.
    type PatternRow = {
      id: string; label: string; hookType: string; loopType: string;
      patternJson: string; timesUsed: number | null; lastUsedAt: Date | null;
    };
    let rows = (await database
      .select()
      .from(socialReelPatterns)
      .orderBy(desc(socialReelPatterns.createdAt))
      .limit(100)) as PatternRow[];

    if (rows.length === 0) {
      // Production can honestly be empty because Pattern Lab capture is manual.
      // Seed only that empty state with original, explicitly UNMEASURED house
      // hypotheses so the rotation/outcome loop can begin collecting evidence.
      const { ensureHouseReelPatterns } = await import("./reelPatternBootstrap");
      const bootstrap = await ensureHouseReelPatterns();
      if (bootstrap.seeded) {
        log.info("empty Pattern Lab bootstrapped before structure selection", {
          inserted: bootstrap.inserted,
        });
      }
      rows = (await database
        .select()
        .from(socialReelPatterns)
        .orderBy(desc(socialReelPatterns.createdAt))
        .limit(100)) as PatternRow[];
    }
    if (rows.length === 0) return null;

    const rotatable: RotatablePattern[] = rows.map((r) => ({
      id: r.id,
      label: r.label,
      hookType: r.hookType,
      loopType: r.loopType,
      timesUsed: r.timesUsed ?? 0,
      lastUsedAt: r.lastUsedAt ?? null,
    }));

    const scored = rankPatternsByDistribution(await measuredPatternOutcomes());
    const decision = selectLearnedPattern(rotatable, scored, opts);
    const chosen = decision.pattern;
    if (!chosen) return null;
    log.info("pattern selected", {
      patternId: chosen.id,
      mode: decision.mode,
      measuredPatterns: scored.length,
      measuredPosts: scored.reduce((sum, row) => sum + row.posts, 0),
    });

    const row = rows.find((r) => r.id === chosen.id);
    let pattern: unknown = null;
    try {
      pattern = JSON.parse(row?.patternJson ?? "null");
    } catch {
      // A pattern whose JSON does not parse is still usable as a structural
      // label — hookType and loopType are typed columns, not part of the blob.
      log.warn("pattern JSON unparseable, using typed columns only", { patternId: chosen.id });
    }

    return {
      patternId: chosen.id,
      label: chosen.label,
      hookType: chosen.hookType,
      loopType: chosen.loopType,
      pattern,
    };
  } catch (err) {
    log.warn("structure hint unavailable", { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Record that a pattern was used. Called only AFTER a brief survives preflight
 * — counting rejected attempts would rotate the lab on work that never shipped
 * and starve the genuinely unused patterns.
 */
export async function recordStructureUse(patternId: string): Promise<void> {
  try {
    const database = await db();
    if (!database) return;
    const { eq, sql } = await import("drizzle-orm");
    await database
      .update(socialReelPatterns)
      .set({
        timesUsed: sql`${socialReelPatterns.timesUsed} + 1`,
        lastUsedAt: new Date(),
      })
      .where(eq(socialReelPatterns.id, patternId));
  } catch (err) {
    // Never fatal: the brief is already good. A missed increment costs rotation
    // fairness, not correctness.
    log.warn("could not record structure use", {
      patternId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
