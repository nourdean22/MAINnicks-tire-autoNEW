/**
 * Story + Photo directors (milestone 11 §68-69) — arc structure + subject-safe
 * crop geometry, pure and deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  STORY_SAFE,
  planPhotoCrop,
  planPhotoCrops,
  planStorySequence,
} from "./services/storyPhotoDirector";

describe("planStorySequence", () => {
  it("with proof -> 4 frames arc interruption/problem/proof/action", () => {
    const s = planStorySequence({ hasProof: true, cta: "DM POTHOLE" });
    expect(s.map((f) => f.role)).toEqual(["interruption", "problem", "proof", "action"]);
  });
  it("without proof -> 3 frames, proof omitted", () => {
    const s = planStorySequence({ hasProof: false, cta: "Book now" });
    expect(s.map((f) => f.role)).toEqual(["interruption", "problem", "action"]);
  });
  it("only the action frame carries an interaction sticker, inside the safe band", () => {
    const s = planStorySequence({ hasProof: true, cta: "x" });
    const withSticker = s.filter((f) => f.interactionZone);
    expect(withSticker).toHaveLength(1);
    expect(withSticker[0].role).toBe("action");
    const z = withSticker[0].interactionZone!;
    // sticker top is below the top UI reserve and its bottom clears the bottom UI reserve
    expect(z.yFrac).toBeGreaterThan(STORY_SAFE.topUiFrac);
    expect(z.yFrac + z.hFrac).toBeLessThanOrEqual(1 - STORY_SAFE.bottomUiFrac);
  });
});

describe("planPhotoCrop", () => {
  it("crops a landscape source to 9:16 at full height, centered", () => {
    const r = planPhotoCrop({ w: 1920, h: 1080 }, [9, 16], { xFrac: 0.5, yFrac: 0.5 });
    expect(r.h).toBe(1080);
    expect(r.w).toBe(Math.round(1080 * (9 / 16)));
    expect(r.x).toBe(Math.round(1920 / 2 - r.w / 2));
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1920);
  });

  it("keeps the crop INSIDE the source even when the subject is at the edge", () => {
    const r = planPhotoCrop({ w: 1000, h: 1000 }, [9, 16], { xFrac: 0.95, yFrac: 0.5 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1000);
  });

  it("a 4:5 (portrait) crop of a square keeps full HEIGHT and narrows width", () => {
    // 4:5 ratio 0.8 is narrower than 1:1 -> keep height, crop width to 0.8*h
    const r = planPhotoCrop({ w: 1080, h: 1080 }, [4, 5]);
    expect(r.h).toBe(1080);
    expect(r.w).toBe(Math.round(1080 * (4 / 5)));
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1080);
  });
});

describe("planPhotoCrops", () => {
  it("produces feed/story/square from one source, each a valid in-bounds rect", () => {
    const crops = planPhotoCrops({ w: 1440, h: 1440 });
    expect(crops.map((c) => c.format)).toEqual(["feed_portrait", "story", "square"]);
    for (const c of crops) {
      expect(c.rect.x).toBeGreaterThanOrEqual(0);
      expect(c.rect.y).toBeGreaterThanOrEqual(0);
      expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(1440);
      expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(1440);
    }
  });
});
