/**
 * The storyboard's ACCEPTANCE ceiling is not a RENDER capability, and the gap
 * between them is now load-bearing.
 *
 * `REEL_OUTPUT_RULES.maxSeconds` was raised 22 -> 35 on 2026-09-07 by operator
 * decision: 95 of the 99 rotating packs are authored at 25-35s and were refused
 * by `validateReelLengthTarget` alone, which capped shippable inventory at 2.
 *
 * Raising it alone would have been a trap. Assembly does NOT render what the
 * storyboard declares — `briefToSegments` clamps every beat to
 * `maxClipSeconds`, because provider clips are ~4s and padding past a source
 * clip freezes the last frame rather than buying motion (2026-07-17: a 25s
 * container holding 72 unique frames, "one image the whole time"). So a brief
 * may DECLARE 35s while the finished video is `beats x maxClipSeconds + freeze`
 * — at most 27s for a 6-beat reel, 23s for a 5-beat one.
 *
 * That matters because the voiceover is HARD-TRIMMED to the video length
 * (`atrim=0:${videoTotal}` in the ffmpeg graph). A script written for the
 * declared duration is cut off mid-sentence. Measured across the packs the
 * raised ceiling admits: 29 of 30 carry more narration than their own render
 * can play, the worst being 121 words (~55s of speech) in a 27s video.
 *
 * These tests pin the two facts that keep the ceiling honest: there is ONE
 * definition of the clip cap, and the declared duration is never mistaken for
 * the rendered one.
 */
import { describe, expect, it } from "vitest";
import { REEL_OUTPUT_RULES, runReelPreflight, validateReelLengthTarget } from "../client/src/lib/facelessReelStudio";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";
import { buildSeedanceArgs } from "./services/higgsfieldStudio";
import { buildFacelessReelSystemPrompt } from "../client/src/lib/facelessReelStudioPrompt";
import {
  MAX_CLIP_SECONDS,
  SAVE_FREEZE_SECONDS,
  briefToSegments,
  segmentsTotalSeconds,
  type ReelAssemblyBrief,
} from "./services/reelAssembly";

/** A storyboard of `n` beats, each `sec` long, contiguous from 0. */
function beats(n: number, sec: number) {
  return Array.from({ length: n }, (_, i) => ({
    beatNumber: i + 1,
    startSecond: i * sec,
    endSecond: (i + 1) * sec,
    onScreenText: `BEAT ${i + 1}`,
    visual: "an object character on a shop bench",
  }));
}

describe("one definition of the clip cap", () => {
  it("reelAssembly re-exports the rule rather than redeclaring a second literal", () => {
    // Before this, `MAX_CLIP_SECONDS = 4` lived in reelAssembly while
    // REEL_OUTPUT_RULES described the band elsewhere, so nothing tied the
    // ACCEPTED duration to the RENDERABLE one. Two literals cannot disagree if
    // there is only one.
    expect(MAX_CLIP_SECONDS).toBe(REEL_OUTPUT_RULES.maxClipSeconds);
  });

  it("the render cap is SMALLER than the acceptance ceiling — that ordering is the whole point", () => {
    const longestRenderable =
      REEL_OUTPUT_RULES.maxBeats * REEL_OUTPUT_RULES.maxClipSeconds + SAVE_FREEZE_SECONDS;
    expect(longestRenderable).toBeLessThan(REEL_OUTPUT_RULES.maxSeconds + SAVE_FREEZE_SECONDS);
    // Concretely, at the values this ships with: 6 x 4 + 3 = 27s of video for a
    // storyboard allowed to declare 35s.
    expect(longestRenderable).toBe(27);
  });
});

describe("a declared duration is never the rendered duration", () => {
  it("clamps a beat longer than one clip, instead of padding it with a frozen frame", () => {
    const brief: ReelAssemblyBrief = { storyboardBeats: beats(5, 7) }; // declares 35s
    const segs = briefToSegments(brief);
    expect(segs).toHaveLength(5);
    for (const s of segs) expect(s.dur).toBeLessThanOrEqual(MAX_CLIP_SECONDS);
    // 5 x 4 = 20s of video, NOT the 35s the storyboard declares.
    expect(segmentsTotalSeconds(segs)).toBe(20);
  });

  it("a 35s storyboard — now legal — renders 12 seconds shorter than it claims", () => {
    const brief: ReelAssemblyBrief = { storyboardBeats: beats(5, 7) };
    const declared = 35;
    const rendered = segmentsTotalSeconds(briefToSegments(brief)) + SAVE_FREEZE_SECONDS;
    expect(validateReelLengthTarget(brief.storyboardBeats as never).ok).toBe(true);
    expect(rendered).toBe(23);
    expect(declared - rendered).toBe(12);
  });

  it("a beat SHORTER than a clip is left alone — the clamp is a ceiling, not a rewrite", () => {
    // Positive control. If the clamp replaced every duration, the assertions
    // above would pass for the wrong reason.
    const segs = briefToSegments({ storyboardBeats: beats(4, 2.5) });
    for (const s of segs) expect(s.dur).toBe(2.5);
    expect(segmentsTotalSeconds(segs)).toBe(10);
  });
});

describe("the ceiling still refuses something — a gate that cannot fail is not a gate", () => {
  it("rejects a storyboard past the raised ceiling", () => {
    // The old fixtures were built against 22s; at 35s several of them became
    // merely valid, which would have left NOTHING asserting the ceiling.
    const over = validateReelLengthTarget(beats(6, 6.5) as never); // 39s
    expect(over.ok).toBe(false);
    expect(over.reason).toMatch(/over the 35s maximum/);
  });

  it("still rejects an under-length reel", () => {
    const under = validateReelLengthTarget(beats(4, 2) as never); // 8s
    expect(under.ok).toBe(false);
    expect(under.reason).toMatch(/under the 15s minimum/);
  });

  it("accepts the band the operator asked for — 25-35s now passes, and 22s still does", () => {
    expect(validateReelLengthTarget(beats(5, 5) as never).ok).toBe(true); // 25s
    expect(validateReelLengthTarget(beats(5, 7) as never).ok).toBe(true); // 35s
    expect(validateReelLengthTarget(beats(4, 5) as never).ok).toBe(true); // 20s
  });
});

describe("the authoring prompt budgets narration against the RENDER, not the declaration", () => {
  it("states the clip cap and the real video ceiling, not just the storyboard band", () => {
    const p = buildFacelessReelSystemPrompt();
    expect(p).toContain(`every beat is capped at\n  ${REEL_OUTPUT_RULES.maxClipSeconds}s of real footage`);
    expect(p).toContain(`${REEL_OUTPUT_RULES.maxBeats * REEL_OUTPUT_RULES.maxClipSeconds}s of video`);
  });

  it("warns that a long script is silently cut, which is the failure mode this prevents", () => {
    expect(buildFacelessReelSystemPrompt()).toMatch(/HARD-TRIMMED[\s\S]*cut off\s*\n?\s*mid-sentence/);
  });

  it("the word budget did NOT scale with the raised ceiling", () => {
    // The trap: 2.2 words/second x 35s suggests 77 words, but the pipeline can
    // only PLAY ~24s of narration. Scaling the budget to the declared band
    // would have instructed the generator to write scripts that get truncated.
    const p = buildFacelessReelSystemPrompt();
    expect(p).toContain("38-48 words TOTAL");
    expect(p).not.toContain("77 words");
  });

  it("the FORMAT contract does follow the ceiling — it describes the storyboard", () => {
    // Positive control for the assertion above: some prompt numbers SHOULD move
    // with maxSeconds. The check is that the right ones do.
    expect(buildFacelessReelSystemPrompt()).toContain(
      `${REEL_OUTPUT_RULES.minSeconds}-${REEL_OUTPUT_RULES.maxSeconds} seconds total`,
    );
  });
});

describe("the clip cap governs the REQUEST that makes the clip, not just the trim", () => {
  it("the CLI lane asks the provider for exactly maxClipSeconds", () => {
    // This was a bare "4" in an argv array. The constant documented the render
    // ceiling while a literal decided what was actually generated, so the two
    // could drift apart with nothing to notice.
    const args = buildSeedanceArgs({ prompt: "an object character on a shop bench" });
    const i = args.indexOf("--duration");
    expect(i, "--duration not present in the seedance argv").toBeGreaterThan(-1);
    expect(args[i + 1]).toBe(String(REEL_OUTPUT_RULES.maxClipSeconds));
  });
});

describe("narration must fit the video that will actually render", () => {
  /**
   * Driven through the REAL `runReelPreflight`, not through the helper.
   *
   * The helper is module-internal on purpose: the orphan gate flagged it as an
   * export nothing outside the module consumed, and it was right — exporting a
   * validator so a test can reach it makes the test prove something production
   * never asks. Preflight IS the production caller, so that is what these
   * assert. (It also keeps the check honest about ordering: the finding has to
   * survive every other gate in the same pass.)
   */
  const voFindings = (script: string, beatSec: number, beatCount = 5) => {
    const brief = structuredClone(SAMPLE_REEL_BRIEFS[0]);
    brief.storyboardBeats = beats(beatCount, beatSec).map((b, i) => ({
      ...brief.storyboardBeats[Math.min(i, brief.storyboardBeats.length - 1)],
      ...b,
    })) as never;
    brief.voiceoverScript = script;
    return runReelPreflight(brief).blocking.filter((f) => /Voiceover is \d+ words/.test(f.message));
  };

  it("blocks a script longer than the render, and says how much to cut", () => {
    // 90 words at 2.2 wps = ~40.9s of speech; 5 beats x 5s clamps to 20s of video.
    const found = voFindings(Array(90).fill("word").join(" "), 5);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/90 words/);
    expect(found[0].message).toMatch(/only renders 20\.0s of video/);
    expect(found[0].message).toMatch(/Trim to 44 words or fewer/);
  });

  it("budgets against the CLAMPED render, not the declared duration", () => {
    // The storyboard declares 25s; the clamp makes it 20s. A script sized for
    // 25s (55 words = 25s) must still be refused — that gap is the whole bug.
    const found = voFindings(Array(55).fill("word").join(" "), 5);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/only renders 20\.0s of video/);
  });

  it("passes a script that fits — the gate is not simply always-false", () => {
    // Positive control. 40 words = ~18.2s into 20s.
    expect(voFindings(Array(40).fill("word").join(" "), 5)).toHaveLength(0);
  });

  it("a SILENT reel is legal — an absent script is not a violation", () => {
    expect(voFindings("", 5)).toHaveLength(0);
  });

  it("a longer render buys more words — the budget tracks the beats", () => {
    // Same 90-word script, but 6 beats: 24s of video, budget 52. Still refused,
    // and the ADVICE must move, proving the number is computed and not fixed.
    const found = voFindings(Array(90).fill("word").join(" "), 5, 6);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/only renders 24\.0s of video/);
    expect(found[0].message).toMatch(/Trim to 52 words or fewer/);
  });
});
