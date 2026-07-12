export const INSTAGRAM_STUDIO_VERSION = "instagram-studio-v2" as const;

export const INSTAGRAM_SOURCE_TYPES = [
  "review",
  "declined_work",
  "customer_question",
  "season_weather",
  "proven_post",
  "special_offer",
  "manual_idea",
  "real_shop_photo",
  "faq_service_education",
] as const;
export type InstagramSourceType = typeof INSTAGRAM_SOURCE_TYPES[number];

export const INSTAGRAM_FORMATS = ["post", "carousel", "reel", "story", "ad"] as const;
export type InstagramFormat = typeof INSTAGRAM_FORMATS[number];

export const INSTAGRAM_OBJECTIVES = [
  "bookings",
  "calls",
  "walk_ins",
  "trust",
  "education",
  "engagement",
  "retargeting",
] as const;
export type InstagramObjective = typeof INSTAGRAM_OBJECTIVES[number];

export type InstagramEvidenceStatus = "verified" | "operator_context" | "unverified";
export type InstagramQualityGate = "pass" | "warn" | "block";

export interface InstagramSourceInput {
  type: InstagramSourceType;
  recordId?: string;
  detail?: string;
  evidenceStatus?: InstagramEvidenceStatus;
}

export interface InstagramCarouselSlide {
  role: "hook" | "truth" | "proof" | "action" | "cta";
  headline: string;
  body: string;
  artDirection: string;
}

export interface InstagramQualityDimension {
  key:
    | "claim_safety"
    | "source_grounding"
    | "hook_strength"
    | "voice_match"
    | "local_relevance"
    | "usefulness"
    | "visual_readiness"
    | "novelty";
  label: string;
  score: number;
  weight: number;
  status: InstagramQualityGate;
  finding?: string;
}

export interface InstagramQualityResult {
  version: typeof INSTAGRAM_STUDIO_VERSION;
  overall: number;
  gate: InstagramQualityGate;
  dimensions: InstagramQualityDimension[];
  blockers: string[];
  warnings: string[];
  evaluatedAt: string;
}

export interface InstagramStudioDraft {
  version: typeof INSTAGRAM_STUDIO_VERSION;
  id: string;
  source: InstagramSourceInput;
  format: InstagramFormat;
  objective: InstagramObjective;
  topic: string;
  caption: string;
  hashtags: string[];
  headline: string;
  subheadline: string;
  cta: string;
  artDirection: string;
  carouselSlides: InstagramCarouselSlide[];
  imageUrls: string[];
  videoUrl?: string;
  rationale: string;
  conceptKey: string;
  quality: InstagramQualityResult;
  createdAt: string;
}

export const INSTAGRAM_SOURCE_LABELS: Record<InstagramSourceType, string> = {
  review: "Verified Review",
  declined_work: "Declined Work",
  customer_question: "Customer Question",
  season_weather: "Season / Weather",
  proven_post: "Proven Post Sequel",
  special_offer: "Special / Offer",
  manual_idea: "Manual Idea",
  real_shop_photo: "Real Shop Photo",
  faq_service_education: "FAQ / Service Education",
};

export const INSTAGRAM_FORMAT_LABELS: Record<InstagramFormat, string> = {
  post: "Single Post",
  carousel: "Carousel",
  reel: "Reel",
  story: "Story",
  ad: "Ad",
};
