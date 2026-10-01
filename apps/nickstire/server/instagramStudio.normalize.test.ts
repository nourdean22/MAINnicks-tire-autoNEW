import { describe, expect, it } from "vitest";
import { normalizeGeneratedInstagramDraft } from "./services/instagramStudio";

describe("Instagram Studio model-output normalization", () => {
  it("salvages overlong carousel copy before the strict render contract", () => {
    const normalized = normalizeGeneratedInstagramDraft({
      topic: "Cleveland pothole tire check",
      caption: "C".repeat(2400),
      hashtags: ["#Cleveland".repeat(8), "Nickstire", "Nickstire"],
      headline: "H".repeat(80),
      subheadline: "S".repeat(140),
      cta: "CALL OR WALK IN TODAY FOR A QUICK STRAIGHT ANSWER".repeat(2),
      artDirection: "A".repeat(700),
      rationale: "R".repeat(700),
      conceptKey: "Pothole Tire Bubble Warning With Extra Words".repeat(3),
      carouselSlides: [
        { role: "hook", headline: "H".repeat(80), body: "B".repeat(160), artDirection: "A".repeat(360) },
        { role: "truth", headline: "H".repeat(80), body: "B".repeat(160), artDirection: "A".repeat(360) },
        { role: "proof", headline: "H".repeat(80), body: "B".repeat(160), artDirection: "A".repeat(360) },
        { role: "action", headline: "H".repeat(80), body: "B".repeat(160), artDirection: "A".repeat(360) },
        { role: "cta", headline: "H".repeat(80), body: "B".repeat(160), artDirection: "A".repeat(360) },
      ],
    });

    expect(normalized.caption.length).toBe(2200);
    expect(normalized.headline.length).toBe(42);
    expect(normalized.subheadline.length).toBe(90);
    expect(normalized.cta.length).toBe(52);
    expect(normalized.artDirection.length).toBe(500);
    expect(normalized.rationale.length).toBe(500);
    expect(normalized.conceptKey.length).toBeLessThanOrEqual(64);
    expect(normalized.hashtags).toHaveLength(2);
    for (const slide of normalized.carouselSlides) {
      expect(slide.headline.length).toBe(42);
      expect(slide.body.length).toBe(110);
      expect(slide.artDirection.length).toBe(300);
    }
  });
});
