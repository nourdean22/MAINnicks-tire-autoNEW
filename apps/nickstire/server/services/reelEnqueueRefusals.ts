/**
 * What enqueueReelJob would refuse in a brief, judged from the brief alone
 * (2026-10-08). Each of these refusals is a typed ReelPreflightBlockedError at
 * enqueue: the deterministic preflight, the condemned-script check (truth
 * packets included), a beat the generator must not render, the caption and
 * hashtag limits, and a caption whose ask is not the end card's (2026-10-10).
 * The episode contract's claim checks need the day's claim packet, so they
 * are not here.
 *
 * Two callers need the verdict BEFORE enqueue: the miner's brief loop
 * (reelDraftPrep.prepareCleanReelBrief), which regenerates instead of losing
 * the day, and a pack variant's eligibility (approvedReelPackRotation.
 * approvedVariantSnapshot), which must hold for every arm or none.
 */
import { runReelPreflight, type ReelBrief } from "../../client/src/lib/facelessReelStudio";
import { CAPTION_LIMIT, HASHTAG_CAP } from "../../shared/episodeContract";
import { condemnedContentProblem } from "../../shared/reelClaimAudit";
import { beatsTheGeneratorMustNotRender } from "../../shared/shotRouter";
import { captionAskMismatch, resolveReelAsk } from "../../shared/reelAsk";
import { RETIRED_MOTION_LENSES } from "../../shared/contentExperiments";

/** A quoted run of text with a letter or digit, opened after a space or the start. */
const QUOTED_TEXT = /(?:^|[\s(])['"“‘][^'"”’]*[A-Za-z0-9][^'"”’]*['"”’](?=$|[\s.,;:!?)])/;

/**
 * What a single 4-second clip cannot show (2026-10-12, text and icons 2026-10-13).
 * Each rule names one visual the generator produced and the viewer could not
 * check in the time a clip holds. A visual matching a rule is refused before
 * spend. Kept short on purpose: add a rule only with a real miss behind it.
 */
const CLIP_DETAIL_RULES: ReadonlyArray<{ id: string; test: (visual: string) => boolean; why: string }> = [
  // An internal cut of a part needs a held look the clip does not give.
  { id: "cross-section", test: (v) => /\bcross[- ]section\b/i.test(v), why: "an internal cut needs a held look a 4 s clip does not give" },
  // A cutaway is only readable when its tread or belt layers can be followed for a beat.
  { id: "cutaway-with-tread-or-belt", test: (v) => /\bcut[- ]?away\b/i.test(v) && /\b(tread|belt)s?\b/i.test(v), why: "tread and belt layers cannot be followed through a cutaway in 4 s" },
  // A missing weight is a before-and-after comparison, which one clip cannot prove.
  { id: "weight-missing", test: (v) => /\b(weight missing|missing weight)\b/i.test(v), why: "a missing weight needs a before and after one clip cannot hold" },
  // A bend has to be seen from two angles to read as a bend.
  { id: "bent-rim", test: (v) => /\bbent rim\b/i.test(v), why: "a bend has to be seen from two angles to read" },
  // Depth differences are too small to read in 4 s.
  { id: "uneven-tread-depth", test: (v) => /\buneven tread depth\b/i.test(v), why: "depth differences are too small to read in 4 s" },
  // A gauge reading and a weight in one frame are two measurements a viewer cannot check.
  { id: "tread-depth-with-wheel-weight", test: (v) => /\btread depth\b/i.test(v) && /\bwheel weights?\b/i.test(v), why: "a gauge and a weight in one frame are two measurements a viewer cannot check" },
  // Words and numbers the generator cannot render legibly. Quoted text must open after a space or the start, so "driver's" is not a quote.
  { id: "legible-text", test: (v) => QUOTED_TEXT.test(v) || /\b(on[- ]screen text|text overlay|legible|readable)\b/i.test(v), why: "a generator cannot render legible words or numbers in 4 s; words belong in onScreenText" },
  // An icon that morphs or goes abstract does not read as one object in a clip.
  { id: "icon-morph", test: (v) => /\bicons?\b/i.test(v) && /\b(morph\w*|abstract)\b/i.test(v), why: "a morphing or abstract icon sequence does not read in 4 s" },
];

/** Beats whose visual names mechanical detail a 4-second clip cannot show. */
export function clipCannotShowRefusals(beats: ReadonlyArray<{ beatNumber?: number; visual?: string | null } | null | undefined>): string[] {
  const out: string[] = [];
  for (const beat of beats) {
    const visual = beat?.visual ?? "";
    const rule = CLIP_DETAIL_RULES.find((r) => r.test(visual));
    if (rule) out.push(`REEL_CLIP_CANNOT_SHOW: beat ${beat?.beatNumber ?? "?"} (${rule.id}): ${rule.why}`);
  }
  return out;
}

export function briefEnqueueRefusals(brief: ReelBrief): string[] {
  const beats = Array.isArray(brief.storyboardBeats) ? brief.storyboardBeats : [];
  const out: string[] = [];
  out.push(...clipCannotShowRefusals(beats));
  const pre = runReelPreflight(brief);
  if (pre.status === "block") out.push(...pre.blocking.map((f) => f.message));
  const condemned = condemnedContentProblem({
    voiceover: brief.voiceoverScript ?? "",
    onScreenText: beats.map((b) => b?.onScreenText ?? "").filter(Boolean).join(" "),
  });
  if (condemned) out.push(`condemned script: ${condemned}`);
  const held = beatsTheGeneratorMustNotRender(beats, []);
  if (held.length) out.push(`ungeneratable beats: ${held.map((b) => `${b.beatNumber}:${b.route}`).join(",")}`);
  const hashtags = Array.isArray(brief.hashtags) ? brief.hashtags : [];
  const composed = `${brief.selectedCaption ?? ""}\n\n${hashtags.join(" ")}`.trim();
  if (composed.length > CAPTION_LIMIT) out.push(`caption + hashtags is ${composed.length} chars, over ${CAPTION_LIMIT}`);
  if (hashtags.length > HASHTAG_CAP) out.push(`${hashtags.length} hashtags, cap is ${HASHTAG_CAP}`);
  const retiredLens = (brief as { motionLens?: string }).motionLens ?? "";
  if (RETIRED_MOTION_LENSES.includes(retiredLens)) out.push(`REEL_LENS_RETIRED: ${retiredLens}`);
  const askMismatch = captionAskMismatch(brief.selectedCaption, resolveReelAsk(brief));
  if (askMismatch) out.push(`caption ask disagrees with the end card: ${askMismatch}`);
  return out;
}
