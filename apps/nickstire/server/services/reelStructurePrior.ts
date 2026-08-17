/**
 * Pattern Lab, finally connected to generation.
 *
 * `social_reel_patterns` has captured operator-judged short-form STRUCTURE
 * since migration 0107 and nothing ever read it outside the admin CRUD screen.
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
import { desc } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { db } from "../lib/db-helper";
import { socialReelPatterns } from "../../drizzle/schema";
import { selectRotationPattern, type RotatablePattern } from "@shared/reelStructureRotation";

const log = createLogger("reel-structure-prior");

export interface StructureHint {
  patternId: string;
  label: string;
  hookType: string;
  loopType: string;
  /** The full ReelPattern JSON as captured, for the generator to read. */
  pattern: unknown;
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
    const rows = (await database
      .select()
      .from(socialReelPatterns)
      .orderBy(desc(socialReelPatterns.createdAt))
      .limit(100)) as PatternRow[];
    if (rows.length === 0) return null;

    const rotatable: RotatablePattern[] = rows.map((r) => ({
      id: r.id,
      label: r.label,
      hookType: r.hookType,
      loopType: r.loopType,
      timesUsed: r.timesUsed ?? 0,
      lastUsedAt: r.lastUsedAt ?? null,
    }));

    const chosen = selectRotationPattern(rotatable, opts);
    if (!chosen) return null;

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
