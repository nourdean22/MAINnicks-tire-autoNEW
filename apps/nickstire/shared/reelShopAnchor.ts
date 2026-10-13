/**
 * The registered real_shop still every daily reel is anchored on (2026-10-13).
 * The one place the id lives. Pack briefs (approvedReelPackRotation) and the
 * daily brief path (reelDraftPrep.prepareCleanReelBrief) both read it from here.
 * The enqueue hero gate (reelPipeline.enqueueReelJob) verifies the registry row
 * at enqueue and refuses by name if it cannot bind.
 */
export const SHOP_ANCHOR_ASSET_ID = "ma_9d6743c4-f24d-4cf3-ac38-4e8f4fabc3ff";

/**
 * A brief with no hero of its own gets the shop still. A brief that already
 * names a hero keeps it. Mutates and returns the brief.
 */
export function anchorBriefToShop<T extends { heroAssetId?: string }>(brief: T): T {
  if (typeof brief.heroAssetId !== "string" || !brief.heroAssetId.trim()) {
    brief.heroAssetId = SHOP_ANCHOR_ASSET_ID;
  }
  return brief;
}
