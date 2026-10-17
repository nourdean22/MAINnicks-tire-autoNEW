/**
 * The generator prompt pack carries the unbranded-hardware tail on every beat,
 * and the no-morph opening on every beat that does NOT start from the hero
 * photo (job 2026-10-16-reel-quality-fixes: reel 2100001 showed a fake tire
 * brand and plate, and its underbody beats morphed out of the storefront).
 */
import { describe, expect, it } from "vitest";
import { buildHiggsfieldReelPromptPack } from "../client/src/lib/facelessReelStudio";

const UNBRANDED =
  "unbranded all-black tire with a blank sidewall, no lettering, no numbers, no logo; plain wheel with a blank centre cap; no license plate; plain painted lift columns with no stickers";
const NO_MORPH = "the subject fills the opening frame from the very first frame; no establishing shot, no transition, no morph";

const brief = {
  id: "tail", topic: "sway bar link", archetype: "satisfying_loop", objectCharacter: "plain_part", motionLens: "xray_cutaway",
  visualWorld: { style: "real_shop_still", heroFrameUrl: "https://nickstire.org/generated/reels/real-shop/shop-front-916.jpg", framePrompt: "", lockedInvariants: "" },
  storyboardBeats: [
    { beatNumber: 1, startSecond: 0, endSecond: 4, purpose: "p", visual: "low-angle shot of the storefront at dusk", motion: "slow push", onScreenText: "A", narration: "", audioCue: "", safeZoneNotes: "" },
    { beatNumber: 2, startSecond: 4, endSecond: 8, purpose: "p", visual: "close-up of a sway bar link under the car on the lift", motion: "static", onScreenText: "B", narration: "", audioCue: "", safeZoneNotes: "" },
    { beatNumber: 3, startSecond: 8, endSecond: 12, purpose: "p", visual: "wheel well rolling over a rough road", motion: "shake", onScreenText: "C", narration: "", audioCue: "", safeZoneNotes: "" },
  ],
} as unknown as Parameters<typeof buildHiggsfieldReelPromptPack>[0];

describe("prompt pack tail", () => {
  const pack = buildHiggsfieldReelPromptPack(brief);

  it("every beat carries the unbranded tire / wheel / plate / lift line", () => {
    for (const p of pack) expect(p.prompt).toContain(UNBRANDED);
  });

  it("beats without the start photo open on the subject, no morph; the storefront beat does not get that line", () => {
    expect(pack[0].prompt).not.toContain(NO_MORPH);
    expect(pack[1].prompt).toContain(NO_MORPH);
    expect(pack[2].prompt).toContain(NO_MORPH);
  });

  it("a real_shop_still world with no hero frame (conditioning off) gives the exterior beat the no-morph line too", () => {
    const off = { ...brief, visualWorld: { ...(brief as any).visualWorld, heroFrameUrl: undefined } } as typeof brief;
    const offPack = buildHiggsfieldReelPromptPack(off);
    for (const p of offPack) expect(p.prompt).toContain(NO_MORPH);
  });

  it("real_shop_still world WITH a hero URL, imageConditioning false -> the storefront beat carries the no-morph line", () => {
    // REEL_IMAGE_CONDITIONING off: the pipeline sends no start image to any beat, so none may skip the line.
    const offPack = buildHiggsfieldReelPromptPack(brief, { imageConditioning: false });
    for (const p of offPack) expect(p.prompt).toContain(NO_MORPH);
    // and explicitly on matches the default
    expect(buildHiggsfieldReelPromptPack(brief, { imageConditioning: true })[0].prompt).not.toContain(NO_MORPH);
  });

  it("the beat restatement is still the last thing the model reads", () => {
    for (const p of pack) {
      const tailAt = p.prompt.indexOf(UNBRANDED);
      expect(tailAt).toBeGreaterThan(-1);
      expect(p.prompt.indexOf("This shot must show:")).toBeGreaterThan(tailAt);
    }
  });
});
