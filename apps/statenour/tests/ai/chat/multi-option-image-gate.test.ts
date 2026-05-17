/**
 * tests/ai/chat/multi-option-image-gate.test.ts · v10.0.511
 *
 * Locks the multi-option-image-gate that prevents auto-firing image
 * generation when the prior assistant turn presented multiple options
 * and the user's image request doesn't specify which one. Caught by
 * the 2026-05-12 smoke test where operator was browsing 2 post drafts
 * (alignment vs used tires), said "now generate the picture", and the
 * system grabbed the last assistant blob to fire image-gen on a draft
 * the operator hadn't committed to.
 */
import { describe, it, expect } from "vitest";
import {
  priorTurnHadMultipleOptions,
  userReferenceIsAmbiguous,
  multiOptionImageClarification,
} from "@/lib/ai/chat/interceptors";

const MULTI_OPTION_PRIOR = `Got it, switching gears. Let's tackle **used tires**.

---

**Post 1:**

Title: **"How Much Should You Spend On Tires?"**

Used tires are a budget-friendly option...

---

**Post 2:**

Title: **"Trade Your Old Tires Today"**

If your treads are worn...`;

const SINGLE_OPTION_PRIOR = `Here's a strong post for the alignment promo:

Title: POTHOLE HIT HARD?

If your steering feels loose or your tires are wearing uneven, potholes from Dead Man's Curve and Euclid Ave construction can throw your alignment out of spec...`;

describe("priorTurnHadMultipleOptions · v10.0.511", () => {
  it("detects 'Post 1' + 'Post 2' headings", () => {
    expect(priorTurnHadMultipleOptions(MULTI_OPTION_PRIOR)).toBe(true);
  });

  it("detects 'Option 1' / 'Option 2'", () => {
    expect(priorTurnHadMultipleOptions("Option 1: X.\n\nOption 2: Y.")).toBe(true);
  });

  it("detects 'Idea 1' / 'Idea 2'", () => {
    expect(priorTurnHadMultipleOptions("Idea 1: shop-floor scene.\nIdea 2: storefront.")).toBe(true);
  });

  it("does NOT flag single-option content", () => {
    expect(priorTurnHadMultipleOptions(SINGLE_OPTION_PRIOR)).toBe(false);
  });

  it("does NOT flag null / empty prior", () => {
    expect(priorTurnHadMultipleOptions(null)).toBe(false);
    expect(priorTurnHadMultipleOptions("")).toBe(false);
    expect(priorTurnHadMultipleOptions(undefined)).toBe(false);
  });
});

describe("userReferenceIsAmbiguous · v10.0.511", () => {
  it("ambiguous for 'now generate the picture'", () => {
    expect(userReferenceIsAmbiguous("now generate the picture")).toBe(true);
  });

  it("ambiguous for 'make the image'", () => {
    expect(userReferenceIsAmbiguous("make the image")).toBe(true);
  });

  it("specific when user names 'option 1'", () => {
    expect(userReferenceIsAmbiguous("generate the picture for option 1")).toBe(false);
  });

  it("specific when user says 'the first one'", () => {
    expect(userReferenceIsAmbiguous("image the first one")).toBe(false);
  });

  it("specific when user says 'the alignment one'", () => {
    expect(userReferenceIsAmbiguous("make the image for the alignment one")).toBe(false);
  });

  it("specific when user says 'the used tires post'", () => {
    expect(userReferenceIsAmbiguous("draw the used tires post")).toBe(false);
  });
});

describe("multiOptionImageClarification · the gate", () => {
  it("returns clarification text on multi-option prior + ambiguous user", () => {
    const result = multiOptionImageClarification(
      "now generate the picture",
      MULTI_OPTION_PRIOR,
    );
    expect(result).not.toBeNull();
    expect(result).toContain("Which one");
  });

  it("returns null when user specifies which option", () => {
    expect(
      multiOptionImageClarification("image the used tires post", MULTI_OPTION_PRIOR),
    ).toBeNull();
    expect(
      multiOptionImageClarification("generate the picture for option 1", MULTI_OPTION_PRIOR),
    ).toBeNull();
  });

  it("returns null on single-option prior (no ambiguity to resolve)", () => {
    expect(
      multiOptionImageClarification("now generate the picture", SINGLE_OPTION_PRIOR),
    ).toBeNull();
  });

  it("returns null on no prior content", () => {
    expect(multiOptionImageClarification("generate an image", null)).toBeNull();
  });
});
