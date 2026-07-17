/**
 * Reel Visual World — reference-frame prompts, locked invariants, and the
 * continuity takeover in every beat prompt (the actual quality lever).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildReferenceFramePrompt,
  compileLockedInvariants,
  visualWorldFromCandidate,
  STYLE_DIRECTIVES,
} from "./services/visualWorld";
import {
  VISUAL_WORLD_STYLES,
  buildReelContinuityBlock,
  buildHiggsfieldReelPromptPack,
} from "../client/src/lib/facelessReelStudio";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";

const brief = SAMPLE_REEL_BRIEFS[0];

afterEach(() => {
  vi.doUnmock("./services/higgsfieldStudio");
  vi.resetModules();
});

describe("buildReferenceFramePrompt", () => {
  it("produces three genuinely different prompts sharing the same hero and lens", () => {
    const prompts = VISUAL_WORLD_STYLES.map((s) => buildReferenceFramePrompt(brief, s));
    expect(new Set(prompts).size).toBe(3);
    for (const [i, p] of prompts.entries()) {
      expect(p).toContain("9:16 vertical hero frame");
      expect(p).toContain(STYLE_DIRECTIVES[VISUAL_WORLD_STYLES[i]].slice(0, 40));
      expect(p).toContain("#FDB913");
      expect(p).toMatch(/DO NOT INCLUDE:.*humans, faces, hands, text/);
    }
  });
});

describe("compileLockedInvariants", () => {
  it("locks to the exact approved frame prompt and forbids drift", () => {
    const framePrompt = buildReferenceFramePrompt(brief, "bold");
    const block = compileLockedInvariants(brief, "bold", framePrompt);
    expect(block).toContain("operator-approved reference frame");
    expect(block).toContain(framePrompt);
    expect(block).toContain("same damage in the same location");
    expect(block).toContain("Never introduce a different vehicle");
  });
});

describe("continuity takeover", () => {
  it("brief WITHOUT a visual world keeps the standard derived continuity block", () => {
    const block = buildReelContinuityBlock(brief);
    expect(block).toContain("VISUAL CONTINUITY (identical in every shot of this reel):");
    expect(block).not.toContain("operator-approved reference frame");
  });

  it("brief WITH an approved visual world gets its locked invariants in EVERY beat prompt", () => {
    const framePrompt = buildReferenceFramePrompt(brief, "safe");
    const world = visualWorldFromCandidate({
      style: "safe",
      url: "https://example.test/hero.jpg",
      framePrompt,
      lockedInvariants: compileLockedInvariants(brief, "safe", framePrompt),
    });
    const withWorld = { ...brief, visualWorld: world };

    expect(buildReelContinuityBlock(withWorld)).toContain("operator-approved reference frame");

    const pack = buildHiggsfieldReelPromptPack(withWorld);
    expect(pack.length).toBeGreaterThan(0);
    for (const beat of pack) {
      expect(beat.prompt).toContain("operator-approved reference frame");
      expect(beat.prompt).toContain(framePrompt.slice(0, 60));
    }
  });
});

describe("generateReferenceFrames", () => {
  it("returns per-style candidates and drops (not fails) a single bad generation", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce("https://img.test/safe.jpg")
      .mockRejectedValueOnce(new Error("aspect rejected"))
      .mockResolvedValueOnce("https://img.test/experimental.jpg");
    vi.doMock("./services/higgsfieldStudio", () => ({ generateCarouselSlideImage: spy }));
    vi.resetModules();
    const { generateReferenceFrames } = await import("./services/visualWorld");

    const frames = await generateReferenceFrames(brief);

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][0]).toMatchObject({ aspectRatio: "9:16" });
    expect(frames.map((f) => f.style)).toEqual(["safe", "experimental"]);
    expect(frames[0].lockedInvariants).toContain("operator-approved reference frame");
  });

  it("throws loud when every candidate fails", async () => {
    const spy = vi.fn().mockRejectedValue(new Error("model unavailable"));
    vi.doMock("./services/higgsfieldStudio", () => ({ generateCarouselSlideImage: spy }));
    vi.resetModules();
    const { generateReferenceFrames } = await import("./services/visualWorld");
    await expect(generateReferenceFrames(brief)).rejects.toThrow(/All reference-frame candidates failed/);
  });
});
