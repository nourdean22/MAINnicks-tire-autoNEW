export type ContentQualityGate = "pass" | "warn" | "block";

export type SourceType = 
  | "review"
  | "declined_work"
  | "customer_question"
  | "season_weather"
  | "proven_post"
  | "special_offer"
  | "manual_idea"
  | "real_shop_photo"
  | "faq_service_education";

export const ContentSourceRegistry: Record<SourceType, { label: string; requiresDetail: boolean; icon: string }> = {
  review: { label: "5-Star Review", requiresDetail: true, icon: "Star" },
  declined_work: { label: "Declined Work", requiresDetail: true, icon: "AlertTriangle" },
  customer_question: { label: "Customer Question", requiresDetail: true, icon: "MessageSquare" },
  season_weather: { label: "Season / Weather", requiresDetail: true, icon: "Cloud" },
  proven_post: { label: "Proven Post (Sequel)", requiresDetail: true, icon: "TrendingUp" },
  special_offer: { label: "Special / Offer", requiresDetail: true, icon: "Tag" },
  manual_idea: { label: "Manual Idea", requiresDetail: true, icon: "Lightbulb" },
  real_shop_photo: { label: "Real Shop Photo", requiresDetail: false, icon: "Camera" },
  faq_service_education: { label: "FAQ / Service Ed", requiresDetail: true, icon: "HelpCircle" },
};

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
