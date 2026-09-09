/**
 * Real history supplier for `buildRepetitionChecks`
 * (client/src/lib/facelessReelStudio.ts) — that function has been pure and
 * tested since it shipped, but nothing on the server ever called it: every
 * caller of `generateReelBriefAI` (the autonomous daily cron, the draft
 * manufacturing lane, the reel director) generated with no memory of what
 * ran before it. `avoidTopics` existed on the input type but nothing ever
 * populated it from real history (ScanFinish NT-010, 2026-08-13).
 *
 * Reads `reel_jobs` rather than only published posts on purpose: a brief
 * that was generated and later failed/rejected still consumed that topic —
 * regenerating the same idea the next day is a repeat even if the first
 * attempt never posted.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:reel-repetition-history");

export interface RecentReelSignals {
  topics: string[];
  keywords: string[];
  archetypes: string[];
  motionLenses: string[];
  objectCharacters: string[];
  /**
   * Did the read succeed? Everything above is empty in BOTH the good case
   * (nothing published in the window) and the bad one (no DB, query threw),
   * and downstream those mean opposite things: an empty window is a brief
   * with nothing to repeat and scores full distinctiveness marks, while an
   * unreadable one is a brief nobody checked and must not.
   *
   * Without this the degrade-to-no-memory below silently converts an outage
   * into a perfect originality score - the "absent evidence is not a pass"
   * shape this repo has now hit more than once.
   */
  available: boolean;
}

export const DEFAULT_REPETITION_WINDOW_DAYS = 21;

/** Hard cap on rows read, independent of the day window. `reel_jobs.payload`
 *  is MEDIUMTEXT and real briefs run ~70KB (drizzle/schema.ts's own comment
 *  on that column) — self-review (2026-08-13) found the first version had no
 *  LIMIT at all on a query that runs on every brief generation across every
 *  lane (daily cron, drafts, admin, director). Ordered by recency so a busy
 *  window still returns the MOST RECENT history, which is what repetition-
 *  avoidance actually cares about. */
const MAX_ROWS = 100;

/** The no-answer value. available:false is the whole point - see the field. */
const EMPTY: RecentReelSignals = {
  topics: [],
  keywords: [],
  archetypes: [],
  motionLenses: [],
  objectCharacters: [],
  available: false,
};

/** Last `daysBack` days of reel_jobs, any status, reduced to the fields
 *  `buildRepetitionChecks` compares against. DB-down or an unreadable row
 *  degrades to "no memory" rather than throwing — a missing repetition check
 *  must never block the pipeline the way a DB outage already can elsewhere. */
export async function getRecentReelSignals(daysBack = DEFAULT_REPETITION_WINDOW_DAYS): Promise<RecentReelSignals> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return EMPTY;
    const { reelJobs } = await import("../../drizzle/schema");
    const { gte, desc } = await import("drizzle-orm");
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const rows = await d
      .select({ payload: reelJobs.payload })
      .from(reelJobs)
      .where(gte(reelJobs.createdAt, since))
      .orderBy(desc(reelJobs.createdAt))
      .limit(MAX_ROWS);

    // available:true from here on - the query returned, so an empty window is a
    // real finding ("nothing recent to repeat"), not a failure to look.
    const signals: RecentReelSignals = { topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [], available: true };
    for (const row of rows) {
      try {
        const brief = JSON.parse(row.payload) as Partial<{
          topic: string;
          campaignKeyword: string;
          archetype: string;
          motionLens: string;
          objectCharacter: string;
        }>;
        if (brief.topic) signals.topics.push(brief.topic);
        if (brief.campaignKeyword) signals.keywords.push(brief.campaignKeyword);
        if (brief.archetype) signals.archetypes.push(brief.archetype);
        if (brief.motionLens) signals.motionLenses.push(brief.motionLens);
        if (brief.objectCharacter) signals.objectCharacters.push(brief.objectCharacter);
      } catch {
        // one unparsable payload must not blank out the whole window's history
      }
    }
    return signals;
  } catch (e) {
    log.warn("recent reel signals unavailable — proceeding with no memory", {
      e: e instanceof Error ? e.message : String(e),
    });
    return EMPTY;
  }
}
