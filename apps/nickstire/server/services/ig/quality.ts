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

export const ContentSourceRegistry: Record<SourceType, { label: string; requiresDetail: boolean }> = {
  review: { label: "5-Star Review", requiresDetail: true },
  declined_work: { label: "Declined Work", requiresDetail: true },
  customer_question: { label: "Customer Question", requiresDetail: true },
  season_weather: { label: "Season / Weather", requiresDetail: true },
  proven_post: { label: "Proven Post (Sequel)", requiresDetail: true },
  special_offer: { label: "Special / Offer", requiresDetail: true },
  manual_idea: { label: "Manual Idea", requiresDetail: true },
  real_shop_photo: { label: "Real Shop Photo", requiresDetail: false },
  faq_service_education: { label: "FAQ / Service Ed", requiresDetail: true },
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

export type ContentQualityScore = {
  hook: number;
  specificity: number;
  proof: number;
  localRelevance: number;
  formatFit: number;
  visualClarity: number;
  voice: number;
  saveSharePotential: number;
  ctaClarity: number;
  novelty: number;
  claimSafety: number;
  priceCompliance: number;
  overall: number;
  passed: boolean;
  notes: string[];
};

export type ConceptBrief = {
  sourceType: SourceType;
  sourceSummary: string;
  customerPain: string;
  serviceCategory: string;
  recommendedFormat: PostFormat;
  hookOptions: string[];
  proofPoints: string[];
  visualDirection: string;
  ctaType: "save" | "send" | "dm" | "call" | "walk-in" | "link";
  complianceRisks: string[];
  recentSimilarity: string[];
};

export type DraftStatus = "needs_review" | "needs_asset" | "ready" | "scheduled" | "published" | "rejected";

export type InstagramDraft = {
  id: string;
  format: PostFormat;
  status: DraftStatus;
  conceptBrief: ConceptBrief;
  assetPack: unknown;
  qualityScore: ContentQualityScore | null;
  promptVersion: string;
  evalVersion: string;
  conceptKey: string;
  sourceRefs: string[];
  createdAt: string;
  publishedAt?: string;
  postUrl?: string;
  rejectionReason?: string;
};
