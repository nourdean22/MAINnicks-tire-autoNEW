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
      // Faceless + unbranded is now stated POSITIVELY (no pink-elephant DO-NOT
      // list) — this prompt is quoted verbatim into every beat's Seedance prompt.
      expect(p).toContain("no people, faces, hands, or gloves");
      expect(p).not.toContain("DO NOT INCLUDE");
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
      // Regression for reel 690001: the quoted framePrompt must NOT re-introduce
      // the pink-elephant "DO NOT INCLUDE ... text/lettering/logos/watermarks"
      // negation into the beat prompt on the operator-approved override path.
      expect(beat.prompt).not.toContain("DO NOT INCLUDE");
      expect(beat.prompt).not.toContain(", text, lettering, logos, watermarks");
    }
  });

  it("reference-frame prompt is POSITIVE clean-scene, not a pink-elephant DO-NOT list", () => {
    const framePrompt = buildReferenceFramePrompt(brief, "safe");
    expect(framePrompt).not.toContain("DO NOT INCLUDE");
    expect(framePrompt).not.toContain("text, lettering, logos, watermarks");
    expect(framePrompt).toContain("Unpopulated and unbranded");
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

  it("requests ONLY the styles passed — one image call for a single style (cost control)", async () => {
    const spy = vi.fn().mockResolvedValue("https://img.test/safe.jpg");
    vi.doMock("./services/higgsfieldStudio", () => ({ generateCarouselSlideImage: spy }));
    vi.resetModules();
    const { generateReferenceFrames } = await import("./services/visualWorld");
    const frames = await generateReferenceFrames(brief, ["safe"]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(frames.map((f) => f.style)).toEqual(["safe"]);
  });
});

// Audit gap #8: give AUTONOMOUS (cron) reels a continuity anchor. Flag-gated,
// default OFF (zero cost until enabled), non-fatal on failure.
describe("attachAutonomousVisualWorld", () => {
  const prevFlag = process.env.REEL_AUTO_VISUAL_WORLD;
  const prevCond = process.env.REEL_IMAGE_CONDITIONING;
  afterEach(() => {
    if (prevFlag === undefined) delete process.env.REEL_AUTO_VISUAL_WORLD;
    else process.env.REEL_AUTO_VISUAL_WORLD = prevFlag;
    if (prevCond === undefined) delete process.env.REEL_IMAGE_CONDITIONING;
    else process.env.REEL_IMAGE_CONDITIONING = prevCond;
    vi.doUnmock("./services/referenceFrameScreen");
  });

  it("M7: with image conditioning ON, a REJECTED anchor screen falls back to text-only", async () => {
    process.env.REEL_AUTO_VISUAL_WORLD = "true";
    process.env.REEL_IMAGE_CONDITIONING = "true";
    vi.doMock("./services/higgsfieldStudio", () => ({ generateCarouselSlideImage: vi.fn().mockResolvedValue("https://img.test/safe.jpg") }));
    vi.doMock("./services/referenceFrameScreen", () => ({
      screenReferenceFrame: vi.fn().mockResolvedValue({ hasGeneratedText: true }),
      referenceFrameVerdict: vi.fn().mockReturnValue({ accept: false, reasons: ["generated text in the anchor"] }),
    }));
    vi.resetModules();
    const { attachAutonomousVisualWorld } = await import("./services/visualWorld");
    const b = structuredClone(brief);
    delete b.visualWorld;
    const out = await attachAutonomousVisualWorld(b);
    expect(out.visualWorld).toBeUndefined(); // defective anchor rejected → text-only
  });

  it("M7: with image conditioning ON, an ACCEPTED anchor screen attaches the world", async () => {
    process.env.REEL_AUTO_VISUAL_WORLD = "true";
    process.env.REEL_IMAGE_CONDITIONING = "true";
    vi.doMock("./services/higgsfieldStudio", () => ({ generateCarouselSlideImage: vi.fn().mockResolvedValue("https://img.test/safe.jpg") }));
    vi.doMock("./services/referenceFrameScreen", () => ({
      screenReferenceFrame: vi.fn().mockResolvedValue({ conditioningSuitable: true }),
      referenceFrameVerdict: vi.fn().mockReturnValue({ accept: true, reasons: [] }),
    }));
    vi.resetModules();
    const { attachAutonomousVisualWorld } = await import("./services/visualWorld");
    const b = structuredClone(brief);
    delete b.visualWorld;
    const out = await attachAutonomousVisualWorld(b);
    expect(out.visualWorld?.style).toBe("safe");
  });

  it("is a no-op with zero generation calls when the flag is OFF", async () => {
    delete process.env.REEL_AUTO_VISUAL_WORLD;
    const spy = vi.fn().mockResolvedValue("https://img.test/safe.jpg");
    vi.doMock("./services/higgsfieldStudio", () => ({ generateCarouselSlideImage: spy }));
    vi.resetModules();
    const { attachAutonomousVisualWorld } = await import("./services/visualWorld");
    const b = structuredClone(brief);
    delete b.visualWorld;
    const out = await attachAutonomousVisualWorld(b);
    expect(spy).not.toHaveBeenCalled();
    expect(out.visualWorld).toBeUndefined();
  });

  it("attaches a 'safe' visual world when the flag is ON and none exists", async () => {
    process.env.REEL_AUTO_VISUAL_WORLD = "true";
    const spy = vi.fn().mockResolvedValue("https://img.test/safe.jpg");
    vi.doMock("./services/higgsfieldStudio", () => ({ generateCarouselSlideImage: spy }));
    vi.resetModules();
    const { attachAutonomousVisualWorld } = await import("./services/visualWorld");
    const b = structuredClone(brief);
    delete b.visualWorld;
    const out = await attachAutonomousVisualWorld(b);
    expect(spy).toHaveBeenCalledTimes(1); // one style => one paid image, not three
    expect(out.visualWorld?.style).toBe("safe");
    expect(out.visualWorld?.heroFrameUrl).toBe("https://img.test/safe.jpg");
    expect(out.visualWorld?.lockedInvariants).toContain("operator-approved reference frame");
  });

  it("leaves an operator-approved world untouched (no generation)", async () => {
    process.env.REEL_AUTO_VISUAL_WORLD = "true";
    const spy = vi.fn().mockResolvedValue("https://img.test/other.jpg");
    vi.doMock("./services/higgsfieldStudio", () => ({ generateCarouselSlideImage: spy }));
    vi.resetModules();
    const { attachAutonomousVisualWorld } = await import("./services/visualWorld");
    const b = structuredClone(brief);
    b.visualWorld = { style: "bold", heroFrameUrl: "https://img.test/operator.jpg", framePrompt: "fp", lockedInvariants: "operator-approved reference frame locked" };
    const out = await attachAutonomousVisualWorld(b);
    expect(spy).not.toHaveBeenCalled();
    expect(out.visualWorld?.heroFrameUrl).toBe("https://img.test/operator.jpg");
  });

  it("degrades gracefully — a generation failure leaves the reel text-only, never throws", async () => {
    process.env.REEL_AUTO_VISUAL_WORLD = "true";
    const spy = vi.fn().mockRejectedValue(new Error("model unavailable"));
    vi.doMock("./services/higgsfieldStudio", () => ({ generateCarouselSlideImage: spy }));
    vi.resetModules();
    const { attachAutonomousVisualWorld } = await import("./services/visualWorld");
    const b = structuredClone(brief);
    delete b.visualWorld;
    const out = await attachAutonomousVisualWorld(b);
    expect(out.visualWorld).toBeUndefined();
  });
});
