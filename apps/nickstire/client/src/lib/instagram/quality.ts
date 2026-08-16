import {
  INSTAGRAM_SOURCE_ICONS,
  INSTAGRAM_SOURCE_LABELS,
  INSTAGRAM_SOURCE_REQUIRES_DETAIL,
  INSTAGRAM_SOURCE_TYPES,
  type InstagramSourceType,
} from "@shared/instagramStudio";

export type ContentQualityGate = "pass" | "warn" | "block";

/**
 * The source taxonomy is DERIVED, not redeclared.
 *
 * This file used to declare its own nine-member union plus its own label table,
 * and `server/services/ig/quality.ts` held a third copy. The unions were
 * structurally identical, so TypeScript accepted all three and nothing could
 * detect drift — which had already happened in the labels: the same source read
 * "Verified Review" in Studio V2 and "5-Star Review" here, "Proven Post Sequel"
 * there and "Proven Post (Sequel)" here, "FAQ / Service Education" there and the
 * truncated "FAQ / Service Ed" here. One source, three names, depending on which
 * screen the operator happened to be on.
 *
 * `shared/instagramStudio.ts` is canonical because it is the layer both the
 * client and the server already import. The alias below is kept so the ~10 local
 * `SourceType` references stay unchanged.
 */
export type SourceType = InstagramSourceType;

export const ContentSourceRegistry: Record<SourceType, { label: string; requiresDetail: boolean; icon: string }> =
  Object.fromEntries(
    INSTAGRAM_SOURCE_TYPES.map((type) => [
      type,
      {
        label: INSTAGRAM_SOURCE_LABELS[type],
        requiresDetail: INSTAGRAM_SOURCE_REQUIRES_DETAIL[type],
        icon: INSTAGRAM_SOURCE_ICONS[type],
      },
    ]),
  ) as Record<SourceType, { label: string; requiresDetail: boolean; icon: string }>;

/**
 * DELIBERATELY NOT unified with the shared `INSTAGRAM_FORMATS`.
 *
 * That union's first member is `"post"`; this one's is `"single"`. They are
 * different vocabularies, not a duplication — aliasing them would silently
 * rename a value that flows into `enqueueReelJob` and the quality score. The
 * only real duplication of this registry lived in the dead
 * `server/services/ig/quality.ts`, which this change deletes, so there is now
 * exactly one FormatRegistry and nothing left to drift against.
 */
export type PostFormat = "single" | "carousel" | "reel" | "story" | "ad";

export const FormatRegistry: Record<PostFormat, { label: string; bestFor: string[] }> = {
  single: {
    label: "Single Post",
    bestFor: ["one punchy fact", "offer", "proof/testimonial", "quick warning"],
  },
  carousel: {
    label: "Carousel",
    bestFor: ["checklist", "multi-step education", "myth vs fact", "3 signs", "comparison"],
  },
  reel: {
    label: "Reel",
    bestFor: ["visual process", "texture/part closeup", "satisfying loop", "before/after", "diagnostic reveal"],
  },
  story: {
    label: "Story",
    bestFor: ["daily update", "poll", "behind the scenes"],
  },
  ad: {
    label: "Ad",
    bestFor: ["direct response offer", "retargeting"],
  }
};


export interface ContentQualityScore {
  /** 0-10: scroll-stopping power of first line/frame */
  hookStrength: number;
  /** 0-10: matches Nick's brand voice */
  voiceMatch: number;
  /** 0-10: price compliance + no fabrication */
  claimSafety: number;
  /** 0-10: worth saving/sharing */
  saveability: number;
  /** 0-10: Cleveland specificity */
  localRelevance: number;
  /** 0-10: not similar to recent posts */
  novelty: number;
  
  /** Weighted composite of all metrics (0-100) */
  overall: number;
  
  /** 
   * Strict blocking gate:
   * pass: Allowed to publish
   * warn: Needs review, can be overridden
   * block: Failed safety check, requires rewrite
   */
  gate: ContentQualityGate;
  
  /** Explanation for any warnings or blocks */
  reasoning?: string[];
}

export function evaluateQuality(
  metrics: Omit<ContentQualityScore, "overall" | "gate">
): Pick<ContentQualityScore, "overall" | "gate" | "reasoning"> {
  const reasoning: string[] = [];
  let gate: ContentQualityGate = "pass";

  // Critical safety check
  if (metrics.claimSafety < 8) {
    gate = "block";
    reasoning.push("Failed claim safety check. Post may contain pricing errors or fabrications.");
  }

  // Hook check
  if (metrics.hookStrength < 5) {
    if (gate !== "block") gate = "warn";
    reasoning.push("Weak hook. Consider starting with a question, command, or specific number.");
  }

  // Voice check
  if (metrics.voiceMatch < 6) {
    if (gate !== "block") gate = "warn";
    reasoning.push("Weak voice match. Needs to sound more like Nick.");
  }

  // Calculate weighted overall (0-100)
  // Max possible weight sum: 10
  const overall = Math.round(
    (metrics.hookStrength * 2.5 +
     metrics.voiceMatch * 1.5 +
     metrics.claimSafety * 3.0 +
     metrics.saveability * 1.0 +
     metrics.localRelevance * 1.0 +
     metrics.novelty * 1.0)
  );

  return { overall, gate, reasoning };
}
