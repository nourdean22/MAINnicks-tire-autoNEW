import { describe, expect, it } from "vitest";
import { SAMPLE_REEL_BRIEFS } from "../lib/facelessReelStudioSamples";
import { clipCannotShowRefusals } from "../../../server/services/reelEnqueueRefusals";

// The sample reel is the first thing a new operator sees, and the server refuses
// any brief whose beat visual names text, a morphing icon, or detail a 4 s clip
// cannot show. Each sample beat must pass that same refusal.
describe("sample reel beats are renderable by a 4 s clip", () => {
  for (const brief of SAMPLE_REEL_BRIEFS) {
    it(`${brief.id}: no beat visual is refused by the clip rules`, () => {
      expect(clipCannotShowRefusals(brief.storyboardBeats)).toEqual([]);
    });
  }
});
