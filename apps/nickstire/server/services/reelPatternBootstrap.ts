import { sql } from "drizzle-orm";
import { HOUSE_REEL_PATTERN_SEEDS } from "@shared/reelPatternSeeds";
import { socialReelPatterns } from "../../drizzle/schema";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

const log = createLogger("reel-pattern-bootstrap");

export interface HousePatternBootstrapResult {
  seeded: boolean;
  inserted: number;
  reason: "seeded_empty_lab" | "lab_not_empty" | "database_unavailable";
}

/**
 * Seed a completely empty Pattern Lab with original Nick's HOUSE HYPOTHESES.
 *
 * Safety / truth properties:
 * - NEVER runs when any pattern already exists. Operator capture wins.
 * - Stable IDs + a no-op duplicate-key update make concurrent first calls safe.
 * - Existing rows are never overwritten.
 * - Seeds say "house hypothesis · unmeasured" in their sourceLabel; they are
 *   candidates for the outcome learner, never represented as observed winners.
 */
export async function ensureHouseReelPatterns(
  databaseOverride?: Awaited<ReturnType<typeof db>>,
): Promise<HousePatternBootstrapResult> {
  const database = databaseOverride ?? await db();
  if (!database) return { seeded: false, inserted: 0, reason: "database_unavailable" };

  const existing = await database
    .select({ id: socialReelPatterns.id })
    .from(socialReelPatterns)
    .limit(1);
  if (existing.length > 0) {
    return { seeded: false, inserted: 0, reason: "lab_not_empty" };
  }

  const rows = HOUSE_REEL_PATTERN_SEEDS.map((pattern) => ({
    id: pattern.id,
    label: pattern.label,
    hookType: pattern.hookType,
    loopType: pattern.loopType,
    patternJson: JSON.stringify(pattern),
  }));

  await database
    .insert(socialReelPatterns)
    .values(rows)
    // Race-safe and NON-overwriting. If two empty-lab callers arrive together,
    // the loser changes no pattern content.
    .onDuplicateKeyUpdate({ set: { id: sql`${socialReelPatterns.id}` } });

  log.info("seeded empty Pattern Lab with house hypotheses", {
    inserted: rows.length,
    patternIds: rows.map((r) => r.id),
  });
  return { seeded: true, inserted: rows.length, reason: "seeded_empty_lab" };
}
