/**
 * Canonical, typed view of what's ACTUALLY persisted in `reel_jobs.payload`
 * — the full generator-returned `ReelBrief` (`StoryboardBeat[]`, topic,
 * archetype, mechanicTruth, clevelandAngle, etc.) plus the `episodeContract`
 * stamped onto it at enqueue (`reelPipeline.ts`'s `enqueueReelJob`).
 *
 * Post-merge self-review (2026-08-13) found five mutually-inconsistent,
 * hand-rolled ad-hoc inline types across this run's new code, each reading
 * the SAME persisted JSON blob with its own partial guess at its shape —
 * `buildReelShadowJudgeInput`, the QC-checklist block in `dailyReelPost.ts`,
 * and `attentionMicrostructureStore.ts` among them. That fragmentation is
 * exactly what let `attentionMicrostructureStore.ts`'s first version read a
 * field (`brief.ctaType`) that does not exist anywhere on a real payload —
 * nothing in the type system could catch it, because none of these readers
 * were checked against one shared, compiler-enforced shape.
 *
 * This is the narrow fix, not a full refactor: it types the fields the
 * NEW readers this run added actually use, reusing the real `StoryboardBeat`
 * and `EpisodeContract` types instead of weakening them (the QC-checklist
 * block's original inline type dropped `disclosureMode` from the real
 * `DisclosureMode` union to a bare `string`, and `entailment` from
 * `EntailmentVerdict` to `string`, for exactly this reason). It deliberately
 * does NOT touch `reelPipeline.ts`'s own pre-existing `ReelJobBrief` type
 * (used correctly, unweakened, at its own call sites) or the 15+ other
 * pre-existing `JSON.parse(job.payload)` sites elsewhere in this codebase —
 * unifying every reader is a larger refactor than this pass's scope on a
 * live production pipeline; this fixes the sites this run introduced.
 */
import type { StoryboardBeat } from "../client/src/lib/facelessReelStudio";
import type { EpisodeContract } from "./episodeContract";

export interface ReelJobPayloadView {
  topic?: string;
  /** A human-reviewed pack selected by the daily rotation. */
  approvedPackSlug?: string;
  archetype?: string;
  objectCharacter?: string;
  mechanicTruth?: string;
  clevelandAngle?: string;
  campaignKeyword?: string;
  motionLens?: string;
  storyboardBeats?: StoryboardBeat[];
  episodeContract?: EpisodeContract;
}

/** Never throws — an unparsable or missing payload returns an empty view,
 *  matching every existing reader's own "one bad row must not crash the
 *  caller" convention. */
export function parseReelJobPayload(payload: string | null | undefined): ReelJobPayloadView {
  if (!payload) return {};
  try {
    return JSON.parse(payload) as ReelJobPayloadView;
  } catch {
    return {};
  }
}
