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

/**
 * DISTRIBUTION axis — deliberately SEPARATE from INSTAGRAM_OBJECTIVES above.
 *
 * Those seven describe what the BUSINESS wants (bookings, calls, walk-ins).
 * These five describe how INSTAGRAM distributes a post. They are orthogonal: a
 * `bookings` post can be DISCOVERY content (reach strangers) or CONVERSION
 * content (close people already following). Collapsing them would delete the
 * business axis, which is why this is an addition rather than a replacement.
 *
 * Each carries its own success metrics because a single engagement score cannot
 * rank them — measured 2026-07-31, the existing score is
 * (likes + comments) / followers, which ignores saves, shares, reach and watch
 * time entirely, and is computed over all formats so a strong photo can teach
 * the reel generator.
 */
export const CONTENT_DISTRIBUTION_OBJECTIVES = [
  "discovery",
  "utility",
  "trust",
  "conversion",
  "community",
] as const;
export type ContentDistributionObjective = typeof CONTENT_DISTRIBUTION_OBJECTIVES[number];

/** Primary metrics per distribution objective. Never collapse these into one score. */
export const DISTRIBUTION_OBJECTIVE_METRICS: Record<ContentDistributionObjective, readonly string[]> = {
  // Reels earn reach through watch time and sends, not saves.
  discovery: ["avg_watch_time", "skip_rate", "shares_per_reach", "follows_per_reach"],
  // Saves belong to reference formats (carousels, checklists) — content whose
  // value is returning to it later.
  utility: ["saves_per_reach", "shares_per_reach", "profile_visits_per_reach"],
  trust: ["profile_visits_per_reach", "dms", "direction_taps", "calls"],
  conversion: ["profile_link_taps", "calls", "dms", "booking_actions"],
  community: ["comments", "replies", "poll_participation", "dms"],
} as const;

/**
 * What the caption ASKS FOR. Distinct from `campaignKeyword` (e.g. "BRAKES"),
 * which the content governor was persisting as the CTA — meaning repetition
 * controls could not detect that N consecutive posts all said "save this".
 * NONE is first-class: on a short reel the final beat is watch-time critical,
 * so a bolted-on CTA can cost more than it returns.
 */
export const CTA_TYPES = ["send", "save", "comment", "visit", "none"] as const;
export type CtaType = typeof CTA_TYPES[number];

/**
 * Provenance of the MEDIA (not of the facts — that is evidenceRecords).
 * Generated media is permitted and is the intended production mode; generated
 * EVIDENCE is not. This field is what makes "no synthetic customer presented as
 * real" checkable rather than aspirational.
 */
export const CONTENT_ORIGINS = ["real_shop", "customer_proof", "ugc", "ai_generated", "stock"] as const;
export type ContentOrigin = typeof CONTENT_ORIGINS[number];

/** Origins that depict a REAL event and therefore may carry evidentiary weight.
 *  An ai_generated asset must never be presented as documentation of one. */
export const EVIDENTIARY_ORIGINS: readonly ContentOrigin[] = ["real_shop", "customer_proof", "ugc"];

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

/**
 * Does this source need operator prose alongside (or instead of) a record?
 *
 * Lives here rather than in the client's own registry because it was previously
 * declared in a SECOND copy of this taxonomy, keyed by a structurally identical
 * union — so the two could drift silently. `Record<InstagramSourceType, …>` is
 * the poka-yoke: adding a member to INSTAGRAM_SOURCE_TYPES now fails to compile
 * until every derived record has an entry.
 *
 * NOTE this is a separate question from whether generation is BLOCKED without a
 * verified record (review / declined_work only, enforced server-side in
 * services/instagramStudio.ts). `real_shop_photo` is the one source that needs
 * no prose at all — the photograph is the evidence.
 */
export const INSTAGRAM_SOURCE_REQUIRES_DETAIL: Record<InstagramSourceType, boolean> = {
  review: true,
  declined_work: true,
  customer_question: true,
  season_weather: true,
  proven_post: true,
  special_offer: true,
  manual_idea: true,
  real_shop_photo: false,
  faq_service_education: true,
};

/** lucide-react icon names for the source pickers. Presentation-only. */
export const INSTAGRAM_SOURCE_ICONS: Record<InstagramSourceType, string> = {
  review: "Star",
  declined_work: "AlertTriangle",
  customer_question: "MessageSquare",
  season_weather: "Cloud",
  proven_post: "TrendingUp",
  special_offer: "Tag",
  manual_idea: "Lightbulb",
  real_shop_photo: "Camera",
  faq_service_education: "HelpCircle",
};
