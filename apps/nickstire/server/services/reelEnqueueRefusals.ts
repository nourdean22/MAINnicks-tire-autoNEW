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

export function briefEnqueueRefusals(brief: ReelBrief): string[] {
  const beats = Array.isArray(brief.storyboardBeats) ? brief.storyboardBeats : [];
  const out: string[] = [];
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
  const askMismatch = captionAskMismatch(brief.selectedCaption, resolveReelAsk(brief));
  if (askMismatch) out.push(`caption ask disagrees with the end card: ${askMismatch}`);
  return out;
}
