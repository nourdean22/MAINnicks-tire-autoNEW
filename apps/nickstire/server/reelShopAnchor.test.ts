/**
 * Every daily reel brief is anchored on the registered real_shop still
 * (2026-10-13). One constant, one helper; the pack builder and the daily brief
 * path both go through them, so the asset id is never copied into several spots.
 *
 * The hero is verified and bound at enqueue (reelPipeline.enqueueReelJob). This
 * file only proves the BRIEF carries the id; it does not prove the registry row
 * exists or is bindable (that is a DB read, verified separately).
 */
import { describe, expect, it } from "vitest";
import { SHOP_ANCHOR_ASSET_ID, anchorBriefToShop } from "../shared/reelShopAnchor";
import { APPROVED_REEL_PACK_SLUGS, buildApprovedPackBriefForTest } from "./services/approvedReelPackRotation";

const SHOP_STILL = "ma_9d6743c4-f24d-4cf3-ac38-4e8f4fabc3ff";

describe("the shop anchor constant", () => {
  it("is the registered real_shop still id", () => {
    expect(SHOP_ANCHOR_ASSET_ID).toBe(SHOP_STILL);
  });
});

describe("anchorBriefToShop", () => {
  it("sets the shop still on a brief that names no hero", () => {
    expect(anchorBriefToShop({ topic: "t" }).heroAssetId).toBe(SHOP_STILL);
  });

  it("treats a blank hero as no hero", () => {
    expect(anchorBriefToShop({ heroAssetId: "   " }).heroAssetId).toBe(SHOP_STILL);
  });

  it("keeps a hero the brief already names", () => {
    expect(anchorBriefToShop({ heroAssetId: "ma_other" }).heroAssetId).toBe("ma_other");
  });
});

describe("an approved pack brief carries the shop anchor", () => {
  it("the pack builder sets heroAssetId to the constant on a real pack", () => {
    const slug = APPROVED_REEL_PACK_SLUGS.find((s) => buildApprovedPackBriefForTest(s) !== null);
    expect(slug, "no approved pack builds — the probe is vacuous").toBeTruthy();
    const brief = buildApprovedPackBriefForTest(slug as string);
    expect(brief?.heroAssetId).toBe(SHOP_ANCHOR_ASSET_ID);
  });
});
