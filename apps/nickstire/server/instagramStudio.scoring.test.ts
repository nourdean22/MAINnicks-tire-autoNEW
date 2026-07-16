import { describe, expect, it } from "vitest";
import { evaluateInstagramDraft } from "./services/instagramStudio";

/**
 * Scoring-honesty regression tests (audit WS4). The evaluator previously
 * rewarded inputs the renderer never consumes:
 * - visual_readiness gave 10/10 partly for artDirection LENGTH — a dead input
 *   (the deterministic renderer never reads it), and for carousels it scored
 *   headline/subheadline, which the carousel render doesn't draw at all.
 * - novelty gave 8/10 for the mere EXISTENCE of a conceptKey — every
 *   generated draft has one, so the dimension measured nothing.
 */
const base = {
  source: { type: "seasonal" as const, detail: "first snow week" },
  caption: "Check your tread before the first Cleveland snow. Walk in, we will look.",
  headline: "Tread check before snow",
  subheadline: "Two minutes, no appointment",
  artDirection: "",
  cta: "Walk in today",
  carouselSlides: [] as Array<{ headline: string; body: string; role?: string; artDirection?: string }>,
};

const dim = (r: ReturnType<typeof evaluateInstagramDraft>, key: string) =>
  r.dimensions.find((d) => d.key === key)!;

describe("visual_readiness scores what the renderer draws", () => {
  it("no longer rewards artDirection length (dead input for deterministic renders)", () => {
    const withoutArt = evaluateInstagramDraft({ ...base, format: "post", artDirection: "" });
    const withArt = evaluateInstagramDraft({ ...base, format: "post", artDirection: "moody garage lighting, wide lens, dramatic" });
    expect(dim(withoutArt, "visual_readiness").score).toBe(10);
    expect(dim(withArt, "visual_readiness").score).toBe(10);
  });

  it("scores carousel SLIDES, not the headline the carousel never renders", () => {
    const overlongSlide = evaluateInstagramDraft({
      ...base,
      format: "carousel",
      carouselSlides: [
        { headline: "Fine", body: "ok" },
        { headline: "x".repeat(60), body: "over the 42-char render cap" },
      ],
    });
    expect(dim(overlongSlide, "visual_readiness").score).toBe(4);
    expect(dim(overlongSlide, "visual_readiness").finding).toMatch(/slides exceed render limits/);

    const cleanSlides = evaluateInstagramDraft({
      ...base,
      format: "carousel",
      carouselSlides: [
        { headline: "Hook", body: "short" },
        { headline: "Truth", body: "short" },
      ],
    });
    expect(dim(cleanSlides, "visual_readiness").score).toBe(10);
  });

  it("flags a carousel with no slide copy at all", () => {
    const res = evaluateInstagramDraft({ ...base, format: "carousel", carouselSlides: [] });
    expect(dim(res, "visual_readiness").score).toBe(4);
    expect(dim(res, "visual_readiness").finding).toMatch(/no slide copy/);
  });
});

describe("novelty measures distinctness, not key existence", () => {
  it("a repeated concept scores LOW and names the repeat", () => {
    const res = evaluateInstagramDraft({
      ...base,
      format: "post",
      conceptKey: "pothole-season",
      recentConceptKeys: ["tread-check", "Pothole-Season", "brake-myths"],
    });
    expect(dim(res, "novelty").score).toBe(2);
    expect(dim(res, "novelty").finding).toMatch(/repeats a recent post/);
  });

  it("a fresh concept against a real recency list scores high", () => {
    const res = evaluateInstagramDraft({
      ...base,
      format: "post",
      conceptKey: "tire-birthday",
      recentConceptKeys: ["tread-check", "pothole-season"],
    });
    expect(dim(res, "novelty").score).toBe(8);
  });

  it("an UNCHECKED concept no longer earns the old free 8 — mid score, honest finding", () => {
    const res = evaluateInstagramDraft({ ...base, format: "post", conceptKey: "tire-birthday" });
    expect(dim(res, "novelty").score).toBe(6);
    expect(dim(res, "novelty").finding).toMatch(/recency not checked/i);
  });
});
