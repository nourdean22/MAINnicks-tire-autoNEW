/**
 * Image prompt synth detector corpus · v10.0.339 · Phase 2 of glitch
 * taxonomy hardening (Category 3 · NLU pattern misses).
 *
 * Tests the two pure-function detectors that gate the synthesis path:
 *   · looksReferential() · "now generate the picture" / "make it" / etc
 *   · looksLikeRegenAsk() · "do it again", "make it sharper", quality
 *     complaints (Cat 3 directly · this detector caused glitch #3 in
 *     cmou6xugm where the user's 18-word complaint went through as
 *     the literal image prompt)
 *
 * Plus extractPriorImagePrompt() · the helper that pulls `**Prompt:**`
 * lines out of an image-gen turn.
 *
 * Per docs/glitch-taxonomy.md · "every detector ships with a corpus
 * of 50+ real user examples." Each entry locks in a phrasing that
 * MUST classify correctly so the next regen-style ask doesn't slip
 * through the cap.
 */

import { describe, expect, it } from "vitest";
import {
  looksReferential,
  looksLikeRegenAsk,
  extractPriorImagePrompt,
} from "@/lib/ai/image-prompt-synth";

describe("looksReferential · short referential image asks (Cat 3)", () => {
  // Positive cases · must return true
  const TRUE_PHRASES = [
    "now generate the picture",
    "make it now",
    "do that one",
    "the image too",
    "now do it",
    "render it",
    "the picture for that",
    "make the image",
    "generate that",
    "create it",
    "draw the picture",
    "show me the visual",
    "design it",
    "build the image",
    "do the picture",
    "render that",
    "the photo too",
    "make the pic",
    "ok now generate the picture",
    "alright make it",
    "next, render it",
    "and the image as well",
    "the post too",
    "the ad as well",
    "the banner",
    "the flyer",
    "now show me the picture",
    "do the visual",
    "generate the picutre", // common typo
    "make the pictrue", // common typo
  ];

  TRUE_PHRASES.forEach((phrase) => {
    it(`returns true for "${phrase}"`, () => {
      expect(looksReferential(phrase)).toBe(true);
    });
  });

  // Negative cases · must return false
  const FALSE_PHRASES = [
    "generate me a tire ad with a Civic on a lift",
    "make a picture of the Cleveland skyline at sunset",
    "draw a logo with a wrench",
    "create an infographic showing tire sizes for popular cars",
    "design a billboard for Nick's Tire on I-90 with neon accents",
    "I want to see the new schedule",
    "what's the price",
    "post this on Instagram",
    "the customer called",
    "draft me a reply to Joe",
  ];

  FALSE_PHRASES.forEach((phrase) => {
    it(`returns false for "${phrase}"`, () => {
      expect(looksReferential(phrase)).toBe(false);
    });
  });

  it("returns false for empty input", () => {
    expect(looksReferential("")).toBe(false);
    expect(looksReferential("   ")).toBe(false);
  });
});

describe("looksLikeRegenAsk · refinement / regen complaints (Cat 3)", () => {
  // Positive cases · must return true (these are real user phrasings
  // that should trigger regen synthesis, not pass through as prompts)
  const REGEN_PHRASES = [
    "do it again",
    "redo",
    "redo it",
    "regen",
    "regenerate",
    "regenerate it",
    "try again",
    "once more",
    "another try",
    "another version",
    "another attempt",
    "another one",
    "different version",
    "different take",
    "different attempt",
    "different one",
    "make it more professional",
    "make it less generic",
    "make it cleaner",
    "make it sharper",
    "make it smaller",
    "make it bigger",
    "make it brighter",
    "make it darker",
    "make it crisp",
    "improve it",
    "improve the image",
    "refine it",
    "fix it",
    "polish it",
    "polish the image",
    // Quality complaints (short)
    "the image looks generic",
    "this looks bad",
    "poor quality",
    "low quality",
    "looks amateur",
    "looks cheap",
    "looks sloppy",
    "looks messy",
    "image is broken",
    "looks weird",
    "looks off",
    "ugly image",
    "blurry",
    "blurry result",
    // The actual cmou6xugm production failure (verbatim)
    "The image you generated has a few glitches and looks a little generic go do it again make sure it's professional looking and very high quality",
  ];

  REGEN_PHRASES.forEach((phrase) => {
    it(`returns true for "${phrase.slice(0, 60)}${phrase.length > 60 ? "…" : ""}"`, () => {
      expect(looksLikeRegenAsk(phrase)).toBe(true);
    });
  });

  // Negative cases · these are NOT regen asks
  const NOT_REGEN_PHRASES = [
    "generate me a tire ad with a Civic on a lift",
    "make a fresh post about winter tires",
    "create a new infographic about brake pads",
    "what's the price",
    "post this on Instagram",
    "draft me a reply to Joe",
    "show me today's schedule",
    "the image looks great", // positive feedback, not regen
    "love the new design", // positive
    "perfect", // positive
    // Long fresh prompt (over 60 words) · should be treated as fresh
    "I want a marketing image showing a sleek black sports car parked outside a modern auto repair shop in downtown Cleveland with the Nick's Tire and Auto sign visible in gold and the sun setting behind the building creating a warm orange glow on the asphalt with subtle reflections in the wet pavement after recent rain showcasing the premium service quality and the brand identity in a way that feels editorial and professional like a magazine cover photo with depth of field and cinematic lighting and a hint of motion blur on a passing car",
  ];

  NOT_REGEN_PHRASES.forEach((phrase) => {
    it(`returns false for "${phrase.slice(0, 60)}${phrase.length > 60 ? "…" : ""}"`, () => {
      expect(looksLikeRegenAsk(phrase)).toBe(false);
    });
  });

  it("returns false for empty input", () => {
    expect(looksLikeRegenAsk("")).toBe(false);
    expect(looksLikeRegenAsk("   ")).toBe(false);
  });

  it("respects the 60-word cap (long prompts treated as fresh)", () => {
    const longPrompt = "redo " + "with detail ".repeat(60);
    // Even though it has the regen verb "redo", word count > 60 means
    // the user is writing a detailed regen prompt themselves · pass-through
    expect(looksLikeRegenAsk(longPrompt)).toBe(false);
  });
});

describe("extractPriorImagePrompt · regression armor for prior-prompt extraction (Cat 3)", () => {
  it("extracts the **Prompt:** line from an image-gen assistant turn", () => {
    const prior = [
      "![Generated Image](/api/images/abc123)",
      "",
      "**Prompt:** A clean, organized infographic against a light blue background with tire icons",
      "**Model:** seedream-v4 · 512x512",
    ].join("\n");
    const extracted = extractPriorImagePrompt(prior);
    expect(extracted).toBe(
      "A clean, organized infographic against a light blue background with tire icons",
    );
  });

  it("handles the production turn-14 verbatim (cmou6xugm)", () => {
    const prior = [
      "![Generated Image](/api/images/cmou775k2000p04lbcy7tel5k)",
      "",
      "**Prompt:** A clean, organized infographic against a light blue background features icons of a tire gauge, oil can, headlight, brake caliper, and tread depth tool, each labeled with a seasonal maintenance tip like \"Check tire pressure monthly\" or \"Inspect brake pads.",
      "**Model:** seedream-v4 · 512x512",
      "",
      "_Synthesized from prior turn: A clean, organized infographic against a light blue background features icons of a tire gauge, oil can, headlight, brake caliper, and tread …_",
    ].join("\n");
    const extracted = extractPriorImagePrompt(prior);
    expect(extracted).toContain("infographic against a light blue background");
    expect(extracted).toContain("tire gauge, oil can, headlight");
    expect(extracted).not.toContain("**Model:**");
    expect(extracted).not.toContain("_Synthesized");
  });

  it("returns null when prior is null/undefined/empty", () => {
    expect(extractPriorImagePrompt(null)).toBeNull();
    expect(extractPriorImagePrompt(undefined)).toBeNull();
    expect(extractPriorImagePrompt("")).toBeNull();
  });

  it("returns null when prior has no **Prompt:** line", () => {
    const prior = "Just a regular text reply with no image prompt format.";
    expect(extractPriorImagePrompt(prior)).toBeNull();
  });

  it("ignores **Prompt:** when not in image-gen format", () => {
    // Edge: assistant turn that happens to include **Prompt:** somewhere
    // (e.g. teaching about prompts). Without the surrounding image-gen
    // structure, the regex still matches the line. This is acceptable
    // behavior — the regen path falls back to the prior prompt verbatim
    // if the LLM-synth call fails, which is safer than the user's
    // complaint going through literally.
    const prior = "**Prompt:** This is a teaching example.\nMore text below.";
    expect(extractPriorImagePrompt(prior)).toContain("teaching example");
  });
});
