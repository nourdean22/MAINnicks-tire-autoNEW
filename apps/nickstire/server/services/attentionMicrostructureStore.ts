/**
 * DB-backed swipe-file assembly — joins reel_jobs (hook + beat structure,
 * design text that exists for every reel ever generated) to the LATEST
 * ig_metric_snapshots row per post (real outcome data) and reduces it to
 * `SwipeFileSample[]` for shared/attentionMicrostructure.ts to correlate.
 *
 * Same join `scripts/analyze-hook-vs-skip.mjs` already runs by hand against
 * skip_rate — this is that logic made a real, tested, callable function
 * (ScanFinish NT-012: "not a standalone script nobody calls") instead of a
 * script the operator has to remember exists, generalized to also carry
 * saves/shares so BOTH metric families are queryable, not just skip rate.
 */
import { createLogger } from "../lib/logger";
import { extractHookSignals } from "../../shared/hookSignals";
import { extractBeatStructureSignals } from "../../shared/beatStructureSignals";
import type { SwipeFileSample } from "../../shared/attentionMicrostructure";
import type { CtaType } from "../../shared/instagramStudio";

const log = createLogger("services:attention-microstructure-store");

const LOWER_CTA_TYPES = new Set<string>(["send", "save", "comment", "visit", "none"]);

/**
 * Self-review (2026-08-13): the first version read `brief.ctaType` — a field
 * that does not exist on ReelBrief at all (dailyReelPost.ts's own comment
 * says so: "ReelBrief has no ctaType yet"). The real value lives at
 * `episodeContract.script.ctaType`, in a DIFFERENT, uppercase domain
 * ("SEND"|"SAVE"|"COMMENT"|"VISIT"|"FOLLOW"|"NONE") than CtaType
 * ("send"|"save"|"comment"|"visit"|"none") — so a naive lowercase of every
 * value is not safe either: "FOLLOW" has no lowercase member. Unrecognized
 * values (including "follow") degrade to undefined -> extractBeatStructure-
 * Signals' own "none" default, never a silent miscast.
 */
function normalizeCtaType(raw: string | undefined): CtaType | undefined {
  const lower = raw?.toLowerCase();
  return lower && LOWER_CTA_TYPES.has(lower) ? (lower as CtaType) : undefined;
}

interface RawRow {
  jobId: number;
  payload: string;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  skipRate: string | null; // decimal column comes back as a string
}

/** DB-down or an unreadable row degrades to an empty sample set — a swipe
 *  file that cannot read history must report "nothing to show", never throw
 *  and never silently compare against a partial, misleading set. */
export async function getSwipeFileSamples(): Promise<SwipeFileSample[]> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return [];
    const { sql } = await import("drizzle-orm");

    // Newest snapshot per post that reported EITHER skip_rate or saved/shares
    // — a post measured for one family but not the other must still appear,
    // so each metric's own row is excluded independently rather than the
    // whole post being dropped when only one field is unreported.
    //
    // Raw execute, not the select builder — same reason smsControl.ts gives:
    // it is the one surface every db mock in the serial test suite provides,
    // and a builder-chain read would misreport a mocked DB as unreadable.
    const [rows] = await d.execute(sql`
      SELECT j.id AS jobId, j.payload AS payload,
             s.reach AS reach, s.saved AS saved, s.shares AS shares, s.skip_rate AS skipRate
        FROM reel_jobs j
        JOIN ig_metric_snapshots s ON s.postId = j.igPostId
       WHERE j.igPostId IS NOT NULL AND j.igPostId <> ''
         AND s.id = (
           SELECT MAX(s2.id) FROM ig_metric_snapshots s2
            WHERE s2.postId = j.igPostId
              AND (s2.skip_rate IS NOT NULL OR s2.saved IS NOT NULL OR s2.shares IS NOT NULL)
         )
    `);
    const list: RawRow[] = Array.isArray(rows) ? (rows as unknown as RawRow[]) : [];

    const samples: SwipeFileSample[] = [];
    for (const r of list) {
      let brief: {
        storyboardBeats?: Array<{ visual?: string; motion?: string; onScreenText?: string; endSecond?: number; beatNumber: number }>;
        episodeContract?: { script?: { ctaType?: string } };
      } = {};
      try {
        brief = JSON.parse(r.payload || "{}");
      } catch {
        continue; // one unparsable payload must not blank out the rest
      }
      const beat1 = brief.storyboardBeats?.[0];
      if (!beat1) continue;
      const reach = r.reach && r.reach > 0 ? r.reach : null;
      samples.push({
        jobId: r.jobId,
        hook: extractHookSignals({
          visual: beat1.visual ?? "",
          motion: beat1.motion ?? "",
          onScreenText: beat1.onScreenText ?? "",
        }),
        beatStructure: extractBeatStructureSignals({
          storyboardBeats: brief.storyboardBeats,
          ctaType: normalizeCtaType(brief.episodeContract?.script?.ctaType),
        }),
        metrics: {
          skipRate: r.skipRate === null ? null : Number(r.skipRate),
          savesPerReach: r.saved === null || !reach ? null : r.saved / reach,
          sharesPerReach: r.shares === null || !reach ? null : r.shares / reach,
        },
      });
    }
    return samples;
  } catch (e) {
    log.warn("swipe file samples unavailable — reporting empty rather than throwing", {
      e: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}
