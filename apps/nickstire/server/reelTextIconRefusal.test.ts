/**
 * A beat whose VISUAL asks the generator for on-screen text, legible words or
 * numbers, or a morphing or abstract icon sequence is refused at enqueue, before
 * spend (2026-10-13). The onScreenText field is the sanctioned place for words
 * (the renderer lays them over the frame), so only the visual field is judged.
 */
import { describe, expect, it } from "vitest";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";
import type { ReelBrief } from "../client/src/lib/facelessReelStudio";
import { briefEnqueueRefusals, clipCannotShowRefusals } from "./services/reelEnqueueRefusals";

const CLIP_REFUSAL = /REEL_CLIP_CANNOT_SHOW/;

function withBeat0(patch: { visual: string; onScreenText?: string }): ReelBrief {
  const b = structuredClone(SAMPLE_REEL_BRIEFS[0]);
  b.storyboardBeats = b.storyboardBeats.map((beat, i) => (i === 0 ? { ...beat, ...patch } : beat));
  return b;
}

describe("a visual that asks the generator for text or an icon sequence is refused before spend", () => {
  const BANNED: Array<[string, string]> = [
    ["a title card reading 'SAVE 20%' over the tire", "quoted words in the visual"],
    ["a numbered marker '1' pins the shoulder", "quoted digit as a legible number"],
    ["on-screen text: 'Check your tread' fades in", "on-screen text named in the visual"],
    ["legible numbers on the gauge face, 32 PSI", "legible numbers"],
    ["a sign with readable words over the bay door", "readable words"],
    ["icons morphing into a car outline", "morphing icons (operator example)"],
    ["an abstract icon sequence: wrench, gear, then tire", "abstract icon sequence"],
  ];

  it("the helper refuses every banned visual, and briefEnqueueRefusals reports it", () => {
    for (const [visual, label] of BANNED) {
      expect(clipCannotShowRefusals([{ beatNumber: 1, visual }]), label).toHaveLength(1);
      expect(briefEnqueueRefusals(withBeat0({ visual })).join("\n"), label).toMatch(CLIP_REFUSAL);
    }
  });

  it("CONTROL: a plain visual is not refused, apostrophes included", () => {
    const plain = [
      "close-up of a worn tread on a lift, slow push-in",
      "a wrench turns a lug nut, camera tracks the hand",
      "the tire's tread pattern under a slow orbit",
      "the driver's hand on the wheel at a slight angle",
    ];
    for (const visual of plain) {
      expect(clipCannotShowRefusals([{ beatNumber: 1, visual }]), visual).toEqual([]);
    }
  });

  it("CONTROL: words in onScreenText are the sanctioned overlay and are not refused", () => {
    const refusals = briefEnqueueRefusals(
      withBeat0({ visual: "close-up of a worn tread on a lift, slow push-in", onScreenText: "Check your tread 'depth' today" }),
    );
    // Beat 1 only: the sample's later beats carry their own quoted text and are refused on their own merits.
    expect(refusals.filter((r) => /REEL_CLIP_CANNOT_SHOW: beat 1 /.test(r))).toEqual([]);
  });
});
