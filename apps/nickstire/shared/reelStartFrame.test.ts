import { describe, expect, it } from "vitest";
import { startImageForBeat } from "./reelStartFrame";

// The hero of reel 2100001 was a shop-FRONT photo; every beat started from it,
// so the underbody and road beats morphed out of the storefront.
const HERO = "https://nickstire.org/generated/reels/real-shop/2026-10-13T03-31-16-688Z-shop-front-916.jpg";

describe("startImageForBeat: the photo goes only where the camera stood when it was taken", () => {
  it("a storefront beat starts from the photo", () => {
    expect(startImageForBeat({ beatNumber: 2, visual: "low-angle shot of the storefront at dusk" }, HERO)).toBe(HERO);
  });
  it.each(["slow push toward the open bay door", "wide shot of the shop exterior", "the parking lot outside the shop"])("%s -> photo", (visual) => {
    expect(startImageForBeat({ beatNumber: 3, visual }, HERO)).toBe(HERO);
  });
  it("an underbody beat renders text-to-video", () => {
    expect(startImageForBeat({ beatNumber: 2, visual: "close-up of a sway bar link under the car on the lift" }, HERO)).toBeUndefined();
  });
  it("a road beat renders text-to-video, even as beat 1 (2100001's opening shot)", () => {
    expect(startImageForBeat({ beatNumber: 1, visual: "wheel well rolling over a rough road" }, HERO)).toBeUndefined();
  });
  it("'a lot of' is not a parking lot", () => {
    expect(startImageForBeat({ beatNumber: 2, visual: "a lot of rust on the control arm" }, HERO)).toBeUndefined();
  });
  it("no hero, or a hero that is not an image, gives no start image", () => {
    expect(startImageForBeat({ beatNumber: 1, visual: "the storefront" }, undefined)).toBeUndefined();
    expect(startImageForBeat({ beatNumber: 1, visual: "the storefront" }, "https://x/clip.mp4")).toBeUndefined();
  });
});
