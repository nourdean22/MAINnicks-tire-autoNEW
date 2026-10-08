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
 *
 * Wave B (2026-10-01): three more dimensions — hook grammar, Pattern Lab
 * structure id, CTA family — plus per-topic ages and declared-duration
 * buckets. The five original arrays are what buildRepetitionChecks scores.
 * Hook grammars also reach the distinctiveness scorer and the generator as
 * HOOK FATIGUE (shared/reelHookGrammar.ts, 2026-10-08); CTA family and
 * structure are read by the Creative Assistant's fatigue card only, and that
 * file says why they are not penalised.
 */
import { createLogger } from "../lib/logger";
import { parseReelJobPayload } from "../../shared/reelJobPayload";
import { classifyHookGrammar, type HookGrammar } from "../../shared/reelHookGrammar";

const log = createLogger("services:reel-repetition-history");

export type CtaFamily = "profile" | "dm" | "save" | "visit" | "send" | "call" | "book" | "none";

export interface RecentReelSignals {
  topics: string[];
  keywords: string[];
  archetypes: string[];
  motionLenses: string[];
  objectCharacters: string[];
  /** Beat 1's on-screen text, classified by classifyHookGrammar. One entry per job. */
  hookGrammars: HookGrammar[];
  /** Pattern Lab ids stamped on the brief (structurePatternId). Only jobs that carried one. */
  structurePatternIds: string[];
  /** The ask family the viewer actually reads — caption CTA first, declared ask as fallback. */
  ctaFamilies: CtaFamily[];
  /** Declared storyboard length, bucketed to 5 s ("20s"). Only jobs with beats. */
  durationBuckets: string[];
  /** Topic + whole days since the job was created, newest first. Same topics as `topics`. */
  topicAges: Array<{ topic: string; daysAgo: number }>;
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

function emptySignals(available: boolean): RecentReelSignals {
  return {
    topics: [],
    keywords: [],
    archetypes: [],
    motionLenses: [],
    objectCharacters: [],
    hookGrammars: [],
    structurePatternIds: [],
    ctaFamilies: [],
    durationBuckets: [],
    topicAges: [],
    available,
  };
}

/**
 * The ask family a viewer reads. The caption CTA is checked FIRST because the
 * declared `ask` defaults to `profile` on every generated brief (reelAsk.ts),
 * so reading it first would report one family for the whole corpus and hide
 * what the captions actually asked for.
 */
export function classifyCtaFamily(
  caption: string | null | undefined,
  declaredAskKind?: string | null,
): CtaFamily {
  const c = String(caption ?? "").toLowerCase();
  if (/\b(send this|share this|forward this|send it to)\b/.test(c)) return "send";
  if (/\bdm\b|\bmessage us\b/.test(c)) return "dm";
  if (/\b(call us|give us a call|call \(?\d)/.test(c)) return "call";
  if (/\b(book|schedule|appointment)\b/.test(c)) return "book";
  if (/\b(stop by|stop in|come in|come by|swing by|visit us)\b/.test(c)) return "visit";
  if (/\b(link in bio|in our bio|in the bio|profile)\b/.test(c)) return "profile";
  if (/\bsave this\b|\bsave for later\b/.test(c)) return "save";
  const k = String(declaredAskKind ?? "").toLowerCase();
  if (k === "profile" || k === "dm" || k === "save" || k === "visit") return k;
  return "none";
}

/** Declared storyboard length, bucketed to the nearest 5 s. Null without beats. */
export function durationBucket(beats: Array<{ endSecond?: number }> | undefined): string | null {
  if (!beats?.length) return null;
  const end = Math.max(...beats.map((b) => Number(b.endSecond) || 0));
  if (!(end > 0)) return null;
  return `${Math.round(end / 5) * 5}s`;
}

/** Last `daysBack` days of reel_jobs, any status, reduced to the fields
 *  `buildRepetitionChecks` compares against. DB-down or an unreadable row
 *  degrades to "no memory" rather than throwing — a missing repetition check
 *  must never block the pipeline the way a DB outage already can elsewhere. */
export async function getRecentReelSignals(daysBack = DEFAULT_REPETITION_WINDOW_DAYS): Promise<RecentReelSignals> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return emptySignals(false);
    const { reelJobs } = await import("../../drizzle/schema");
    const { gte, desc } = await import("drizzle-orm");
    const now = Date.now();
    const since = new Date(now - daysBack * 24 * 60 * 60 * 1000);
    const rows = await d
      .select({ payload: reelJobs.payload, createdAt: reelJobs.createdAt })
      .from(reelJobs)
      .where(gte(reelJobs.createdAt, since))
      .orderBy(desc(reelJobs.createdAt))
      .limit(MAX_ROWS);

    // available:true from here on - the query returned, so an empty window is a
    // real finding ("nothing recent to repeat"), not a failure to look.
    const signals = emptySignals(true);
    for (const row of rows as Array<{ payload: string; createdAt?: Date | string | null }>) {
      // parseReelJobPayload never throws: one unparsable payload yields {} and
      // must not blank out the whole window's history.
      const brief = parseReelJobPayload(row.payload) as ReturnType<typeof parseReelJobPayload> & {
        ask?: { kind?: string };
        selectedCaption?: string;
      };
      if (brief.topic) {
        signals.topics.push(brief.topic);
        const created = row.createdAt ? new Date(row.createdAt).getTime() : NaN;
        const daysAgo = Number.isFinite(created) ? Math.max(0, Math.floor((now - created) / 86_400_000)) : Number.NaN;
        signals.topicAges.push({ topic: brief.topic, daysAgo });
      }
      if (brief.campaignKeyword) signals.keywords.push(brief.campaignKeyword);
      if (brief.archetype) signals.archetypes.push(brief.archetype);
      if (brief.motionLens) signals.motionLenses.push(brief.motionLens);
      if (brief.objectCharacter) signals.objectCharacters.push(brief.objectCharacter);
      if (brief.structurePatternId) signals.structurePatternIds.push(String(brief.structurePatternId));
      const beats = brief.storyboardBeats;
      if (beats?.length) {
        signals.hookGrammars.push(classifyHookGrammar(beats[0]?.onScreenText));
        const bucket = durationBucket(beats);
        if (bucket) signals.durationBuckets.push(bucket);
      }
      if (brief.selectedCaption || brief.ask?.kind) {
        signals.ctaFamilies.push(classifyCtaFamily(brief.selectedCaption, brief.ask?.kind));
      }
    }
    return signals;
  } catch (e) {
    log.warn("recent reel signals unavailable — proceeding with no memory", {
      e: e instanceof Error ? e.message : String(e),
    });
    return emptySignals(false);
  }
}
