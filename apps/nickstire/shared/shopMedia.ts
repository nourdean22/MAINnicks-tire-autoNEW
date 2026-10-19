/**
 * Shop media library contract v1 (2026-10-18): Nour's edited shop photos and
 * videos, imported into media_assets behind a review gate.
 *
 * Importer: scripts/import-shop-media.mts · reader/reviewer: server/services/shopMediaLibrary.ts
 * · router: shopMedia (list / review / stats).
 */

/** The two providers the importer writes; review and list touch nothing else. */
export const SHOP_MEDIA_PROVIDERS = ["operator_capture", "operator_ai_edit"] as const;
export type ShopMediaProvider = (typeof SHOP_MEDIA_PROVIDERS)[number];

/** Recorded on every real (non-generative) item: what the edit was allowed to change. */
export const REAL_EDIT_ATTESTATION = "edited: color/exposure/crop/trim/stabilize only";

export type ShopMediaState = "quarantined" | "approved" | "rejected";
export type ShopMediaKind = "photo" | "video";
export type ShopMediaOrientation = "vertical" | "horizontal";
export type ShopMediaPeople = "none" | "staff" | "nour" | "customer" | "unclear";

export interface ShopMediaItem {
  assetId: string;
  url: string | null;
  kind: ShopMediaKind;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: string | null;
  subject: string | null;
  tags: string[];
  faces: number | null;
  moe: boolean | null;
  people: string | null;
  plate: boolean | null;
  quality: number | null;
  rightsStatus: string;
  lifecycleState: string;
  reuseAllowed: boolean;
}

export interface ShopMediaPage {
  items: ShopMediaItem[];
  /** Raw offset to pass back as `cursor`; null when the library is exhausted. */
  nextCursor: number | null;
}

export interface ShopMediaReviewResult {
  changed: string[];
  skipped: Array<{ assetId: string; reason: string }>;
}

export type ShopMediaStats = Record<ShopMediaState | "other", Record<ShopMediaKind, number>>;
