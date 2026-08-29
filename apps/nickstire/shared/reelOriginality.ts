/**
 * Has this content already gone out? The gate nobody had.
 *
 * ── THE INCIDENT ────────────────────────────────────────────────────────────
 * Reel job 1770003 was published 2026-08-29 after an audit that checked claims
 * against primary sources, AI disclosure, aspect ratio, burned-in text and
 * destination. It never asked whether the content had run before. It had: job
 * 1620001 published the SAME reel on 2026-08-17 - measured similarity 1.00 on
 * the on-screen text AND 1.00 on the caption. Twelve days apart, and nothing in
 * the pipeline or the review noticed.
 *
 * A repost is not neutral. Instagram weights original content in
 * recommendations, so a duplicate is demoted rather than merely redundant.
 *
 * ── WHAT IS COMPARED, AND WHY ───────────────────────────────────────────────
 * Identical `videoUrl` is checked because it is free, but it is the trivial
 * case and would have caught nothing here: 1620001 and 1770003 are DIFFERENT
 * renders of the same script, with different clip files.
 *
 * The load-bearing surface is the **on-screen text** - the words burned into
 * the frame, in beat order. That is what a viewer actually reads, and it is the
 * one thing that survives a re-render with new clips, a new voiceover, new
 * music and a new end card. The **caption** is compared as a second surface
 * because a re-post sometimes keeps the copy while the beats get reworded. The
 * verdict takes the WORSE (higher) of the two: either surface repeating is
 * enough to make the post a repeat.
 *
 * Similarity is Jaccard over normalised word sets. Deliberately not an
 * embedding: this must run at a publish door with no model call, no network and
 * no budget, and the measured separation (below) is wide enough that a bag of
 * words settles it.
 *
 * ── THE THRESHOLD IS MEASURED, NOT CHOSEN BY FEEL ───────────────────────────
 * Across all 465 pairs of the account's 31 recorded reels:
 *
 *     0.9-1.0   1     <- the real duplicate
 *     0.7-0.9   0
 *     0.5-0.7   0
 *     0.35-0.5  0
 *     0.25-0.35 5     <- same subject, genuinely different scripts
 *     <0.25     459
 *
 * The band from 0.35 to 0.9 is EMPTY, so any threshold inside it gives
 * identical results on real data. 0.5 sits in the middle of that gap: well
 * above the highest observed non-duplicate (0.35) and well below a lightly
 * reworded repost.
 *
 * ── WHAT THIS CATCHES, AND WHAT IT STILL MISSES ─────────────────────────────
 * CATCHES: the same script re-rendered (the 1770003 case), a reused caption, a
 * literally reused video file, and a repost of anything the account published
 * that reached either corpus.
 *
 * MISSES, stated plainly rather than discovered later:
 *  1. SAME TOPIC, FRESHLY WRITTEN. Three such pairs exist in the history
 *     (pothole damage, wiper smearing, oil sludge). These are deliberately NOT
 *     blocked - re-covering a subject with a new script is legitimate, and
 *     Instagram's duplicate weighting targets near-identical media, not
 *     subjects. `topicOverlap()` reports them as advisory instead.
 *  2. A DELIBERATE PARAPHRASE below the threshold. Someone rewording a script
 *     to evade this would succeed; it is a hygiene gate, not an adversary.
 *  3. THE SAME VIDEO WITH A NEW SCRIPT. Nothing here hashes pixels or audio, so
 *     re-using footage under fresh words is invisible to it.
 *  4. ANYTHING THE CORPUS CANNOT SEE. `reel_jobs` accounts for 29 distinct
 *     published post ids while the account's analytics cache holds 39 REELS -
 *     so roughly a dozen published reels came from somewhere else (the Studio /
 *     inventory lane, or the phone). That is why the corpus includes analytics
 *     captions and not only this pipeline's own rows, but any post absent from
 *     BOTH remains invisible.
 */

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeForComparison(text: string | null | undefined): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaccard similarity over word sets. 0 when either side is empty. */
export function jaccardSimilarity(a: string, b: string): number {
  const A = new Set(normalizeForComparison(a).split(" ").filter(Boolean));
  const B = new Set(normalizeForComparison(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

/** One thing the account has already published. */
export interface PublishedRecord {
  /** Human-facing identifier for the refusal message (job id or IG post id). */
  label: string;
  onScreenText?: string | null;
  caption?: string | null;
  videoUrl?: string | null;
  topic?: string | null;
}

/** The reel about to go out. */
export interface OriginalityCandidate {
  onScreenText?: string | null;
  caption?: string | null;
  videoUrl?: string | null;
  topic?: string | null;
}

/**
 * Measured from the account's own history: highest similarity between two
 * genuinely different reels was 0.35, and the one real duplicate scored 1.00.
 */
export const ORIGINALITY_BLOCK_THRESHOLD = 0.5;

export interface OriginalityMatch {
  label: string;
  score: number;
  surface: "video_url" | "on_screen_text" | "caption";
  reason: string;
}

/**
 * Why this reel must not publish as original, or null when it is new.
 *
 * Returns the STRONGEST match so the refusal names the most convincing
 * evidence rather than the first row that happened to trip.
 */
export function originalityProblem(
  candidate: OriginalityCandidate,
  corpus: PublishedRecord[],
  threshold: number = ORIGINALITY_BLOCK_THRESHOLD,
): OriginalityMatch | null {
  let worst: OriginalityMatch | null = null;

  for (const prior of corpus) {
    // Trivial but free. A byte-identical asset is a repost regardless of copy.
    if (candidate.videoUrl && prior.videoUrl && candidate.videoUrl === prior.videoUrl) {
      const m: OriginalityMatch = {
        label: prior.label,
        score: 1,
        surface: "video_url",
        reason: `this exact video file was already published as ${prior.label}`,
      };
      return m;
    }

    const ostScore = jaccardSimilarity(candidate.onScreenText ?? "", prior.onScreenText ?? "");
    const capScore = jaccardSimilarity(candidate.caption ?? "", prior.caption ?? "");
    const surface: OriginalityMatch["surface"] = ostScore >= capScore ? "on_screen_text" : "caption";
    const score = Math.max(ostScore, capScore);

    if (score >= threshold && (!worst || score > worst.score)) {
      worst = {
        label: prior.label,
        score,
        surface,
        reason:
          `this content has already been published as ${prior.label} ` +
          `(${surface.replace(/_/g, " ")} similarity ${score.toFixed(2)}, threshold ${threshold}). ` +
          "A repost is demoted by Instagram's originality weighting, not merely redundant.",
      };
    }
  }

  return worst;
}

/**
 * Prior reels covering the same SUBJECT. Advisory only - never a block.
 *
 * Re-covering a topic with a genuinely new script is legitimate content
 * strategy, and three such pairs already exist in the account's history. This
 * exists so a human can see the overlap and decide, not so a gate can refuse it.
 */
export function topicOverlap(
  candidate: OriginalityCandidate,
  corpus: PublishedRecord[],
  threshold = 0.5,
): Array<{ label: string; score: number }> {
  if (!candidate.topic) return [];
  return corpus
    .filter((p) => p.topic)
    .map((p) => ({ label: p.label, score: jaccardSimilarity(candidate.topic!, p.topic!) }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score);
}
