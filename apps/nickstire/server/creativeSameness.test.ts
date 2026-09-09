/**
 * Three creative defects, each measured rather than opined about.
 *
 * 1 · ONE PALETTE FOR EVERY REEL. The continuity block hardcoded "graphite
 *     black and deep shadow tones with gold #FDB913 accent highlights" into
 *     every autonomous reel. Two harms, and the second is worse:
 *
 *     MONOTONY - 166 produced packs and the corpus is visually interchangeable.
 *     A distinctive asset used as the ground stops being distinctive.
 *
 *     CONTRADICTION - it fought the lens grammar printed beside it.
 *     xray_cutaway asks for "cool schematic glow, clean dark field";
 *     tilt_shift_miniature asks for "bright even daylight". The palette line
 *     demanded deep shadow and gold over both, so the generator received two
 *     instructions and split the difference. That is how everything ends up
 *     looking like the same murky render.
 *
 * 2 · ONE PACE FOR EVERY REEL. "A cut/push/text change every 1.5-2.5s" is a
 *     sound floor against slideshows and a bad ceiling. The repo's own hook
 *     analysis recorded a reel with a PERFECT first-frame score, an 82.6% skip
 *     rate and 3.0s average watch time - what a formula produces when it
 *     replaces an intention.
 *
 * 3 · THE PROMPT ASKED FOR TAGS THE PIPELINE THROWS AWAY. It requested 3-12
 *     hashtags while Instagram caps captions at five and reelPipeline trims the
 *     excess downstream.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const STUDIO = readFileSync(path.join(__dirname, "..", "client", "src", "lib", "facelessReelStudio.ts"), "utf8");
const PROMPT = readFileSync(path.join(__dirname, "..", "client", "src", "lib", "facelessReelStudioPrompt.ts"), "utf8");
// A gate is only as wide as its file list. This scan covered facelessReelStudio
// alone while the identical hardcoded palette lived on in visualWorld.ts - and
// that copy WON, because buildReelContinuityBlock returns an approved world's
// invariants before it ever reaches its own LENS_PALETTES line.
const WORLD = readFileSync(path.join(__dirname, "services", "visualWorld.ts"), "utf8");

describe("every lens gets the world its own grammar asks for", () => {
  it("the single hardcoded palette line is gone from EVERY writer of it", () => {
    const dead = "graphite black and deep shadow tones with gold #FDB913 accent highlights";
    expect(STUDIO, "facelessReelStudio still hardcodes one palette").not.toContain(dead);
    expect(WORLD, "visualWorld still hardcodes one palette - and it wins over the lens").not.toContain(dead);
    expect(WORLD, "the invariants block still asserts a fixed graphite-and-gold grade").not.toContain("same graphite-and-gold");
  });

  it("the visual-world path reads the palette from the reel's lens too", () => {
    // The path that wins for any reel with an approved world, and it is LIVE:
    // REEL_AUTO_VISUAL_WORLD is true in production (probed 2026-09-09).
    //
    // Assert inside the FUNCTION BODY, not across the file. A mutation run
    // proved why: deleting the BRAND_ACCENT_RULE usage line survived a
    // whole-file toContain, because the import statement still spells the
    // name. The import is not the behaviour.
    const start = WORLD.indexOf("export function buildReferenceFramePrompt");
    expect(start, "buildReferenceFramePrompt is gone").toBeGreaterThan(-1);
    const body = WORLD.slice(start, WORLD.indexOf("export function compileLockedInvariants"));
    expect(body).toContain("LENS_PALETTES[brief.motionLens]");
    expect(body, "the frame prompt no longer carries the brand accent rule").toContain("BRAND_ACCENT_RULE");
  });

  it("the metronome rule is gone from the CHECKLIST as well as the prompt", () => {
    // The prompt retired "a cut/push/text change every 1.5-2.5s" as a ceiling
    // masquerading as a floor. The render checklist in the studio library
    // still recited it, so the model was told one thing and graded on another.
    // A mutation run caught this scan being narrower than its own claim.
    // The prompt is ALLOWED to name the retired rule - it explains why the rule
    // was retired, and deleting that explanation is how a bad rule comes back.
    // What must not survive is the rule PRESCRIBED as an instruction, which is
    // what the checklist was still doing. The first version of this assertion
    // forbade the string outright and failed on the retirement note itself.
    expect(PROMPT, "the prompt no longer records WHY the metronome was retired")
      .toContain('used to prescribe "a cut/push/text change every 1.5-2.5s"');
    expect(STUDIO, "the render checklist still recites the metronome as a rule").not.toContain("1.5-2.5s");
  });

  it("the continuity block reads the palette from the reel's lens", () => {
    expect(STUDIO).toContain("LENS_PALETTES[brief.motionLens]");
  });

  it("EVERY lens in the union has a palette — a missing one silently falls back", async () => {
    const { MOTION_LENSES, LENS_PALETTES } = await import("../client/src/lib/facelessReelStudio");
    const lenses = Object.keys(MOTION_LENSES);
    expect(lenses.length).toBeGreaterThan(10);
    for (const lens of lenses) {
      expect(LENS_PALETTES[lens as keyof typeof LENS_PALETTES], `no palette for ${lens}`).toBeTruthy();
    }
  });

  it("the palettes are actually DIFFERENT, not the same sentence reworded", async () => {
    const { LENS_PALETTES } = await import("../client/src/lib/facelessReelStudio");
    const vals = Object.values(LENS_PALETTES);
    expect(new Set(vals).size).toBe(vals.length);
    // The specific failure being prevented: every world being a dark one.
    const dark = vals.filter((v) => /graphite|black|dark/i.test(v)).length;
    expect(dark, "most worlds must NOT be dark, or this is the old bug with more words").toBeLessThan(vals.length / 2);
  });

  it("Nick yellow survives in every world, as an accent", async () => {
    const { LENS_PALETTES, BRAND_ACCENT_RULE } = await import("../client/src/lib/facelessReelStudio");
    for (const [lens, v] of Object.entries(LENS_PALETTES)) {
      expect(v, `${lens} lost the brand accent`).toContain("#FDB913");
    }
    expect(BRAND_ACCENT_RULE).toContain("5-15%");
    expect(BRAND_ACCENT_RULE).toContain("never a global colour cast");
  });

  it("the lens grammar and its palette no longer contradict each other", async () => {
    const { MOTION_LENSES, LENS_PALETTES } = await import("../client/src/lib/facelessReelStudio");
    // The three that were provably fighting the old line.
    expect(LENS_PALETTES.xray_cutaway).toMatch(/schematic|blue/i);
    expect(MOTION_LENSES.xray_cutaway.grammar).toMatch(/schematic/i);
    expect(LENS_PALETTES.tilt_shift_miniature).toMatch(/daylight|bright/i);
    expect(MOTION_LENSES.tilt_shift_miniature.grammar).toMatch(/daylight/i);
    expect(LENS_PALETTES.blueprint_technical).toMatch(/blue|paper|drafting/i);
  });
});

describe("pacing is chosen per beat, not prescribed", () => {
  it("the universal metronome is gone", () => {
    expect(PROMPT).not.toContain("A cut/push/text change every 1.5-2.5s");
  });

  it("the modes name a JOB, not a duration", () => {
    for (const mode of ["REVEAL", "INSPECTION", "MECHANIC EXPLANATION", "SATISFYING PROCESS", "PREMIUM PRODUCT"]) {
      expect(PROMPT, `missing pacing mode ${mode}`).toContain(mode);
    }
  });

  it("the floor the old rule protected is kept explicitly", () => {
    // Removing the metronome must not license a slideshow.
    expect(PROMPT).toContain("No beat may be a static frame with nothing moving");
    expect(PROMPT).toContain("must not move at the same speed for the same reason");
  });
});

describe("the prompt asks for hashtags the platform will actually keep", () => {
  it("the 3-12 request is gone and the cap is five", () => {
    expect(PROMPT).not.toContain("3-12 hashtags");
    expect(PROMPT).toContain("0-5 hashtags");
  });

  it("it says WHY, so the next editor does not raise it back", () => {
    expect(PROMPT).toMatch(/capped captions at FIVE/i);
    expect(PROMPT).toMatch(/trims the excess downstream/i);
  });

  it("the downstream trim it refers to still exists", () => {
    const PIPE = readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");
    expect(PIPE).toContain("HASHTAG_CAP");
    expect(PIPE).toContain("unique.slice(0, HASHTAG_CAP)");
  });
});
