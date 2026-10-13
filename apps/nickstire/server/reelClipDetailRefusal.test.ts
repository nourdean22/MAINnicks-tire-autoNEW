/**
 * Storyboard beats that a single 4-second clip cannot show are refused at
 * enqueue, before any reservation or spend (2026-10-12). The rule is judged from
 * the brief alone, so it belongs with the caption-ask refusal.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";
import type { ReelBrief } from "../client/src/lib/facelessReelStudio";
import { briefEnqueueRefusals, clipCannotShowRefusals } from "./services/reelEnqueueRefusals";

const PIPELINE = readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");
const HELPER = readFileSync(path.join(__dirname, "services", "reelEnqueueRefusals.ts"), "utf8");
const CLIP_REFUSAL = /REEL_CLIP_CANNOT_SHOW/;

function withBeat0Visual(visual: string): ReelBrief {
  const b = structuredClone(SAMPLE_REEL_BRIEFS[0]);
  b.storyboardBeats = b.storyboardBeats.map((beat, i) => (i === 0 ? { ...beat, visual } : beat));
  return b;
}

describe("a beat a 4-second clip cannot show is refused before spend", () => {
  // One row per rule in CLIP_DETAIL_RULES, so a dropped rule fails its own row.
  const BANNED: Array<[string, string]> = [
    ["cross-section of a tire", "cross-section"],
    ["cutaway of a tread block", "cutaway with tread"],
    ["cutaway showing the steel belt", "cutaway with belt"],
    ["the wheel with the weight missing from the rim", "weight missing"],
    ["a bent rim sitting on the lift", "bent rim"],
    ["uneven tread depth across the shoulder", "uneven tread depth"],
    ["tread depth gauge placed beside a wheel weight", "tread depth with wheel weight"],
  ];

  it("the helper refuses every banned beat, and briefEnqueueRefusals reports it", () => {
    for (const [visual, label] of BANNED) {
      expect(clipCannotShowRefusals([{ beatNumber: 1, visual }]), label).toHaveLength(1);
      expect(briefEnqueueRefusals(withBeat0Visual(visual)).join("\n"), label).toMatch(CLIP_REFUSAL);
    }
  });

  it("CONTROL: a plain beat is not refused on clip detail", () => {
    // Beat 1 only: the sample's later beats carry their own quoted text and are refused on their own merits.
    const refusals = briefEnqueueRefusals(withBeat0Visual("close-up of a worn tread on a lift, slow push-in"));
    expect(refusals.filter((r) => /REEL_CLIP_CANNOT_SHOW: beat 1 /.test(r))).toEqual([]);
  });

  it("CONTROL: a half-match is not refused (cutaway alone, tread depth alone, wheel weight alone)", () => {
    expect(clipCannotShowRefusals([{ beatNumber: 1, visual: "cutaway of the sidewall" }])).toEqual([]);
    expect(clipCannotShowRefusals([{ beatNumber: 2, visual: "tread depth gauge in the frame" }])).toEqual([]);
    expect(clipCannotShowRefusals([{ beatNumber: 3, visual: "a wheel weight clipped to the rim" }])).toEqual([]);
  });

  it("the refusal is inside enqueueReelJob and sits before the spend boundary", () => {
    const a = PIPELINE.indexOf("export async function enqueueReelJob");
    const b = PIPELINE.indexOf("\nexport async function processNextReelJob", a);
    expect(a, "enqueueReelJob not found").toBeGreaterThan(-1);
    const body = PIPELINE.slice(a, b);
    const refuse = body.indexOf("clipCannotShowRefusals(");
    expect(refuse, "refusal not wired into enqueueReelJob").toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(body.indexOf("enforceAtBoundary"));
    const thrown = body.indexOf("throw new ReelPreflightBlockedError(clipDetail)");
    expect(thrown, "the refusal must throw the typed error").toBeGreaterThan(refuse);
    expect(thrown).toBeLessThan(body.indexOf("enforceAtBoundary"));
  });

  it("the helper file defines the refusal prefix the enqueue error reports", () => {
    expect(HELPER).toContain("REEL_CLIP_CANNOT_SHOW");
  });
});
