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
}

export const DEFAULT_REPETITION_WINDOW_DAYS = 21;

const EMPTY: RecentReelSignals = {
  topics: [],
  keywords: [],
  archetypes: [],
  motionLenses: [],
  objectCharacters: [],
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
    const { gte } = await import("drizzle-orm");
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const rows = await d
      .select({ payload: reelJobs.payload })
      .from(reelJobs)
      .where(gte(reelJobs.createdAt, since));

    const signals: RecentReelSignals = { topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [] };
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
