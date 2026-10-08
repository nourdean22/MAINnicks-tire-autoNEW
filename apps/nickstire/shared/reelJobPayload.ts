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
import type { ApprovedProductionPackSnapshot, EpisodeContract, ProductionSlot } from "./episodeContract";
import type { ReelStructureFingerprint } from "./reelStructureFingerprint";
import type { RenderedQaVerdict } from "../server/services/renderedQa";
import type { ClipProbe } from "./clipDrift";

/** Durable provenance for which approved-pack cursor owns this Reel job. */
export type ApprovedPackPool = "active_slate" | "full_approved_library";

/**
 * A real-shop photo the retrieval layer (`server/services/realAssetFirst`)
 * matched to this brief. Media provenance only — `rights_status = real_shop`
 * on the registry row is what licenses its use; `enrichment` is the typed
 * vision read that scored it. Shaped here, not imported from the server
 * service, so this contract stays client-safe.
 */
export interface RealAssetRef {
  assetId: string;
  url: string;
  score: number;
  why: string[];
  enrichment: {
    subject?: string;
    service?: string;
    symptoms?: string[];
    failureMode?: string;
    visibleEvidence?: string[];
    safeClaims?: string[];
    quality?: number;
    season?: string;
  };
}

export interface ReelJobPayloadView {
  topic?: string;
  /** A human-reviewed pack selected by the daily rotation. */
  approvedPackSlug?: string;
  /** Which durable cursor selected the pack. Prevents mid-render mode switches
   * from advancing a different queue that happens to point at the same slug. */
  approvedPackPool?: ApprovedPackPool;
  /** Revision of the slate definition that selected this job. Only present for
   * active-slate jobs; lets later publish/refusal detect a save/reorder/clear. */
  approvedPackSlateRevision?: string;
  approvedProductionPack?: ApprovedProductionPackSnapshot;
  productionSlot?: ProductionSlot;
  archetype?: string;
  objectCharacter?: string;
  mechanicTruth?: string;
  clevelandAngle?: string;
  campaignKeyword?: string;
  motionLens?: string;
  /** Pattern Lab structure used to generate this Reel. Persisted specifically
   * so published outcomes can be joined back to the structure policy. */
  structurePatternId?: string;
  /** Diagnostic production-grammar metadata stamped by approved-pack intake. */
  productionGrammarFingerprint?: ReelStructureFingerprint;
  productionGrammarNovelty?: {
    similarity: number;
    isProductionTwin: boolean;
    collisions: string[];
    nearestSignature?: string | null;
    comparisonWindow?: number;
  };
  storyboardBeats?: StoryboardBeat[];
  /**
   * The narration. IN the persisted payload all along and simply undeclared
   * here — same shape as `motion`/`audioCue` on StoryboardBeat, and the same
   * fix: the brief is JSON.stringify'd whole at enqueue and a TS interface does
   * not strip fields at runtime, so declaring it needs no migration.
   *
   * Verified against production 2026-09-07: jobs 1710001, 1740001, 1740004,
   * 1770005 and 1830001-1830003 all carry a non-empty `voiceoverScript`.
   *
   * It matters because the condemned-script check reads it. Left undeclared,
   * that gate would have compared an `undefined` voiceover against every
   * condemned script, scored 0.00 on all of them, and reported "clean" —
   * a green gate measuring nothing.
   */
  voiceoverScript?: string;
  episodeContract?: EpisodeContract;
  /** Set by reelDraftPrep when a real-shop photo matched the brief's topic. */
  realAsset?: RealAssetRef;
  /**
   * The rendered-QA verdict `runRenderedQaOnJob` writes back onto the same
   * payload (frames → pixel stats → vision critic → craft score). Declared
   * here (type-only import, erased at runtime) so the writer and the readers
   * in qualityGate / selectiveRepair / commandCenter share one shape instead
   * of each casting `payload.renderedQa` to its own guess. Carries
   * `craftScore`, `escalate`, `pixelStats` and `visionCalls` since 2026-10-01.
   */
  renderedQa?: RenderedQaVerdict;
  /**
   * Shape of each generated clip as ffprobe read it at assembly (width, height,
   * fps, seconds), labelled by the beat's provider. Written by reelPipeline
   * after assembly (2026-10-08); read by reelLaneHealth to spot a provider whose
   * clips changed shape week over week (shared/clipDrift.ts).
   */
  clipProbes?: ClipProbe[];
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
