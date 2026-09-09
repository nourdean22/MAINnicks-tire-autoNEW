/**
 * The generator has never seen how its own hooks performed.
 *
 * Meta measures the first three seconds for us. `reels_skip_rate` is "the
 * percentage of views from people who skipped during the first 3 seconds", and
 * "how likely you are to watch less than three seconds" is a NAMED prediction
 * in Meta's published Reels ranking documentation. This app has been collecting
 * it into `ig_metric_snapshots` since migration 0108.
 *
 * Measured against production 2026-09-09, one row per post, latest snapshot:
 *
 *   41 published posts carry a skip rate. Corpus mean 66.4%.
 *   Two thirds of viewers leave before the fourth second.
 *   Pearson r between skip rate and reach: -0.633 (n=41).
 *
 * That correlation is the reason this file exists. Reach is not something the
 * account earns by posting more; it is largely downstream of whether the first
 * three seconds hold. And the spread inside our own corpus is enormous - the
 * best hook measured 39.8%, the worst 92.9%.
 *
 * The generator was writing hook 105 with no knowledge of hooks 1 through 104.
 * This hands it its own scoreboard: the openings that actually held viewers on
 * THIS account, and the ones that lost them.
 *
 * WHY OUR OWN CORPUS AND NOT A BEST-PRACTICES LIST: every published benchmark
 * for "a good hook" is either unsourced marketing content or drawn from a
 * different audience. These numbers are first-party, measured on this account,
 * on this subject matter, by the platform doing the ranking.
 *
 * HONESTY CONTRACT: `available` is false when the read failed, and the prompt
 * fragment is then EMPTY. Telling the model "your best hooks were: (nothing)"
 * after a database blip would teach it from an outage. Absent evidence must
 * produce absent guidance, never confident guidance built on nothing.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:hook-performance");

export interface MeasuredHook {
  /** Beat 1's on-screen text - the words a scrolling viewer actually saw. */
  hook: string;
  /** Percentage of viewers who left inside three seconds. Lower is better. */
  skipPct: number;
  reach: number;
}

export interface MeasuredHookEvidence {
  /** False when the history could not be read. Distinct from "no history". */
  available: boolean;
  sampleSize: number;
  corpusMeanSkipPct: number | null;
  best: MeasuredHook[];
  worst: MeasuredHook[];
}

export const NO_HOOK_EVIDENCE: MeasuredHookEvidence = {
  available: false,
  sampleSize: 0,
  corpusMeanSkipPct: null,
  best: [],
  worst: [],
};

/** Below this, a mean is noise dressed as guidance and we say nothing. */
export const MIN_HOOK_SAMPLE = 6;

/**
 * Latest snapshot per published reel, joined back to the brief that wrote it.
 *
 * The join runs through `reel_jobs.igPostId`, not through the experiment
 * assignment table. That is deliberate: `content_experiment_assignments.media_id`
 * only covers episodes an experiment happened to assign, and its `episode_key`
 * holds a synthetic `reel_job_<id>` string rather than a briefId - a join on
 * episode_key against briefId silently returns zero rows and looks exactly like
 * "no data yet".
 */
export async function getMeasuredHookEvidence(limit = 5): Promise<MeasuredHookEvidence> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return NO_HOOK_EVIDENCE;
    const { sql } = await import("drizzle-orm");

    // Latest row per post, published only, and reach > 0 so an unviewed post
    // cannot masquerade as a perfect 0.00 skip rate. That exact row exists in
    // production and would otherwise rank first.
    const rows = (await d.execute(sql`
      SELECT j.payload AS payload, s.skip_rate AS skipRate, s.reach AS reach
        FROM reel_jobs j
        JOIN ig_metric_snapshots s ON s.postId = j.igPostId
        JOIN (SELECT postId, MAX(capturedAt) AS mx
                FROM ig_metric_snapshots WHERE skip_rate IS NOT NULL
               GROUP BY postId) l
          ON l.postId = s.postId AND l.mx = s.capturedAt
       WHERE j.igPostId IS NOT NULL AND s.skip_rate IS NOT NULL AND s.reach > 0
       ORDER BY s.skip_rate ASC
    `)) as unknown as Array<{ payload: string; skipRate: string | number; reach: number }>[];

    const list = (Array.isArray(rows[0]) ? rows[0] : rows) as unknown as Array<{
      payload: string; skipRate: string | number; reach: number;
    }>;
    if (!Array.isArray(list)) return NO_HOOK_EVIDENCE;

    const measured: MeasuredHook[] = [];
    for (const r of list) {
      const skipPct = Number(r.skipRate);
      if (!Number.isFinite(skipPct)) continue;
      let hook = "";
      try {
        const p = JSON.parse(r.payload) as { storyboardBeats?: Array<{ onScreenText?: string; visual?: string }> };
        const b1 = p.storyboardBeats?.[0];
        hook = String(b1?.onScreenText || b1?.visual || "").replace(/\s+/g, " ").trim();
      } catch {
        // One unreadable payload must not blank the whole scoreboard.
      }
      if (!hook) continue;
      measured.push({ hook: hook.slice(0, 120), skipPct, reach: Number(r.reach) || 0 });
    }

    if (measured.length < MIN_HOOK_SAMPLE) {
      log.info("not enough measured hooks to teach from yet", { n: measured.length, need: MIN_HOOK_SAMPLE });
      return { ...NO_HOOK_EVIDENCE, available: true, sampleSize: measured.length };
    }
    const corpusMean = measured.reduce((a, m) => a + m.skipPct, 0) / measured.length;
    return {
      available: true,
      sampleSize: measured.length,
      corpusMeanSkipPct: Math.round(corpusMean * 10) / 10,
      best: measured.slice(0, limit),
      worst: measured.slice(-limit).reverse(),
    };
  } catch (e) {
    log.warn("measured hook evidence unavailable - the generator will get no scoreboard", {
      e: e instanceof Error ? e.message : String(e),
    });
    return NO_HOOK_EVIDENCE;
  }
}

/**
 * Render the scoreboard for the generator. PURE, so the wording is testable
 * without a database.
 *
 * Returns "" whenever there is nothing honest to say - unavailable, or too few
 * samples to have a mean worth quoting. An empty string appends nothing, which
 * is the correct behaviour: no guidance beats invented guidance.
 */
export function buildHookEvidenceFragment(e: MeasuredHookEvidence): string {
  if (!e.available || e.corpusMeanSkipPct === null || e.sampleSize < MIN_HOOK_SAMPLE) return "";
  if (!e.best.length || !e.worst.length) return "";
  const line = (m: MeasuredHook) => `  ${m.skipPct.toFixed(1)}% skipped - "${m.hook}"`;
  return [
    "MEASURED HOOK PERFORMANCE - this account's own scoreboard, not general advice.",
    `Instagram reports how many viewers leave inside three seconds. Across ${e.sampleSize} published reels the average is ${e.corpusMeanSkipPct}%,`,
    "and lower skip goes with materially higher reach. The first line of beat 1 is the single highest-leverage thing in the brief.",
    "",
    "HELD VIEWERS (write openings like these):",
    ...e.best.map(line),
    "",
    "LOST VIEWERS (do not write openings like these):",
    ...e.worst.map(line),
    "",
    "Study what separates them rather than copying their wording - reusing a subject is repetition, and repetition is scored elsewhere.",
  ].join("\n");
}
