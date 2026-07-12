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

export const INSTAGRAM_FORMATS = ["post", "carousel", "reel